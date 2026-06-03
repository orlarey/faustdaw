/******************************* ruler-labels.ts ********************************
 *
 * Purpose: Build and synchronize the ruler time-label DOM layer.
 * How: Compute label models from the current scale and viewport, then reconcile
 *      the DOM with a reuse-first strategy that creates, updates, or removes
 *      label elements as needed.
 *
 * @invariant: renderedRulerLabelElements always mirrors the DOM children of
 *             the ruler labels container.
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import { demoState } from "./state.js";
import { PRIMARY_DIGIT_SPACE_PX, SECONDARY_DIGIT_SPACE_PX } from "./timeline/render-constants.js";
import type { ExactTimelineScale } from "./time-scale.js";
import { decomposeAbsoluteTime, floorDivide, formatAbsoluteTimeLabel } from "./format.js";

// Purpose: Describe one positioned ruler label ready for DOM rendering.
// How: Bundle a deduplication key, visual kind, pixel position, and display text.
export type RulerLabelRenderModel = {
  key: string;
  kind: "primary" | "secondary";
  leftPx: number;
  label: string;
};

/**
 * Purpose: Estimate the pixel width of an already-formatted ruler label string.
 * How: Multiply the character count by the appropriate digit spacing constant.
 */
export function estimateRenderedLabelWidth(label: string, isPrimary: boolean): number {
  return label.length * (isPrimary ? PRIMARY_DIGIT_SPACE_PX : SECONDARY_DIGIT_SPACE_PX);
}

const renderedRulerLabelElements = new Map<string, HTMLDivElement>();

// Purpose: Format one primary ruler label from the current time context and scale.
// How: Decompose the time coordinate and select the relevant fields based on the unit pair.
function formatExactPrimaryRulerLabel(timeCoord: number, renderScale: ExactTimelineScale): string {
  const fields = decomposeAbsoluteTime(timeCoord, demoState.viewport.timeScale.timebase);
  const unitPair = `${renderScale.primaryUnit}:${renderScale.secondaryUnit}`;

  switch (unitPair) {
    case "H:M":
      return `${fields.sign}${fields.hours}:`;
    case "M:s":
      return `${fields.sign}${fields.hours}:${fields.minutes}:`;
    case "s:d":
      return `${fields.sign}${fields.hours}:${fields.minutes}:${fields.seconds}.`;
    case "d:c":
      return `${fields.sign}${fields.hours}:${fields.minutes}:${fields.seconds}.${fields.tenth}`;
    case "c:m":
      return `${fields.sign}${fields.hours}:${fields.minutes}:${fields.seconds}.${fields.centisecond}`;
    case "m:e":
      return `${fields.sign}${fields.hours}:${fields.minutes}:${fields.seconds}.${fields.centisecond}${fields.millisecond}+`;
    default:
      return formatAbsoluteTimeLabel(timeCoord, demoState.viewport.timeScale.timebase);
  }
}

// Purpose: Build the ruler label models over the widened geometry render window.
// How: Enumerate visible primary graduations, project them into render-window pixels, and discard labels that are completely off-screen.
export function buildBufferedRulerModels(
  renderScale: ExactTimelineScale,
  renderStartCoord: number,
  renderEndCoord: number,
  renderWidthPx: number,
  pixelsPerCoord: number,
): RulerLabelRenderModel[] {
  const labels: RulerLabelRenderModel[] = [];
  const primaryStepCoord = renderScale.primaryStepCoord;
  const firstPrimary = floorDivide(renderStartCoord, primaryStepCoord) * primaryStepCoord;
  const lastPrimary = Math.ceil(renderEndCoord / primaryStepCoord) * primaryStepCoord;
  const labelWidthCache = new Map<string, number>();

  function pushLabel(time: number, kind: "primary" | "secondary", label: string): void {
    const isPrimary = kind === "primary";
    const leftPx = (time - renderStartCoord) * pixelsPerCoord;
    const widthCacheKey = `${kind}:${label}`;
    const labelWidth = label
      ? (labelWidthCache.get(widthCacheKey)
          ?? (() => {
            const width = estimateRenderedLabelWidth(label, isPrimary);
            labelWidthCache.set(widthCacheKey, width);
            return width;
          })())
      : 0;
    const labelLeftPx = leftPx + 2;
    const labelRightPx = labelLeftPx + labelWidth;
    const anchorVisible = leftPx >= 0 && leftPx <= renderWidthPx;
    const labelVisible = Boolean(label) && labelRightPx > 0 && labelLeftPx < renderWidthPx;

    if (!anchorVisible && !labelVisible) {
      return;
    }

    labels.push({
      key: `${kind}:${time}:${label}`,
      kind,
      leftPx,
      label,
    });
  }

  for (let timeCoord = firstPrimary; timeCoord <= lastPrimary + Math.trunc(primaryStepCoord / 2); timeCoord += primaryStepCoord) {
    pushLabel(timeCoord, "primary", formatExactPrimaryRulerLabel(timeCoord, renderScale));
  }

  return labels;
}

// Purpose: Create one reusable DOM node for a ruler label anchor.
// How: Build the anchor/span structure once, then mutate its class, position, and text on later renders.
function createRulerLabelElement(model: RulerLabelRenderModel): HTMLDivElement {
  const element = document.createElement("div");
  const span = document.createElement("span");
  element.appendChild(span);
  (element as HTMLDivElement & { _label?: HTMLSpanElement })._label = span;
  updateRulerLabelElement(element, model);
  return element;
}

// Purpose: Update one reusable ruler label DOM node to match the current render model.
// How: Mutate class, horizontal position, and text without recreating the element.
function updateRulerLabelElement(element: HTMLDivElement, model: RulerLabelRenderModel): void {
  element.className = `ruler-label-anchor ruler-label-anchor-${model.kind}`;
  element.style.left = `${model.leftPx.toFixed(4)}px`;
  const span = (element as HTMLDivElement & { _label?: HTMLSpanElement })._label ?? element.querySelector("span");
  if (span) {
    span.textContent = model.label;
  }
}

// Purpose: Synchronize the ruler labels layer with the current buffered render models.
// How: Reuse existing nodes when possible, remove stale ones, and preserve DOM order by time.
export function renderRulerLabels(elements: Elements, models: readonly RulerLabelRenderModel[]): void {
  const nextKeys = new Set(models.map((model) => model.key));

  for (const [key, element] of renderedRulerLabelElements.entries()) {
    if (nextKeys.has(key)) {
      continue;
    }
    element.remove();
    renderedRulerLabelElements.delete(key);
  }

  for (const [index, model] of models.entries()) {
    let element = renderedRulerLabelElements.get(model.key);
    if (!element) {
      element = createRulerLabelElement(model);
      renderedRulerLabelElements.set(model.key, element);
    } else {
      updateRulerLabelElement(element, model);
    }
    const referenceNode = elements.timelineRulerLabels.children[index] ?? null;
    if (referenceNode !== element) {
      elements.timelineRulerLabels.insertBefore(element, referenceNode);
    }
  }
}
