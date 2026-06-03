/****************************** grid-view/grid-view-buffers.ts *******************************
 *
 * Purpose: Build, cache, and render the shared time-grid raster layer using a
 *          sliding-buffer strategy for efficient panning.
 * How: Tile a repeatable primary-block pattern into offscreen canvases, manage
 *      a three-slot sliding window keyed by the current scale and viewport, and
 *      composite the visible portion into the timeline shared-grid canvas.
 *
 * @invariant: sharedGridSlidingState.slots always contains exactly three buffers
 *             covering a contiguous range of primary divisions.
 *
 ******************************************************************************/
import type { Elements } from "../bind-elements.js";
import {
  demoState,
} from "../state.js";
import { TimeScale, type ExactTimelineScale } from "../time-scale.js";
import { floorDivide, positiveModulo } from "../format.js";
import { recordPerfCounter } from "../perf.js";
import { prepareRasterCanvas, preparePatternTileCanvas, getRasterCanvasContext } from "../raster-canvas.js";
import {
  logPrimaryDivisionDraw,
  logRareRenderCost,
  type PrimaryDivisionBufferRole,
} from "../timeline/timeline-debug.js";
import {
  getRenderDivisionSpec,
  type RenderDivisionSpec,
} from "../timeline/timeline-geometry.js";
import { TimelineProjection } from "../timeline/timeline-projection.js";
import { DAWRenderView } from "../view/daw-render-view.js";
import { estimateRenderedLabelWidth, type RulerLabelRenderModel } from "../ruler-labels.js";

// ── Constants ──────────────────────────────────────────────────────────────────

export const SHARED_GRID_RULER_HEIGHT_PX = 68;
const SHARED_GRID_SECONDARY_START_Y_PX = 34;
const SHARED_GRID_TERTIARY_START_Y_PX = 52;
const SHARED_GRID_PRIMARY_LINE_COLOR = "rgba(145, 178, 215, 0.12)";
const SHARED_GRID_SECONDARY_RULER_LINE_COLOR = "rgba(145, 178, 215, 0.2)";
const SHARED_GRID_TERTIARY_RULER_LINE_COLOR = "rgba(145, 178, 215, 0.14)";
const SHARED_GRID_SECONDARY_LINE_COLOR = "rgba(145, 178, 215, 0.06)";
const SHARED_GRID_TERTIARY_LINE_COLOR = "rgba(145, 178, 215, 0.06)";
const SHARED_GRID_SECONDARY_LABEL_COLOR = "rgba(142, 161, 191, 0.9)";
const SHARED_GRID_SECONDARY_LABEL_FONT = '11px "IBM Plex Mono", monospace';
const SHARED_GRID_SECONDARY_LABEL_BASELINE_Y_PX = 62;
const RULER_PRIMARY_LABEL_COLOR = "#8ea1bf";
const RULER_PRIMARY_LABEL_FONT = '12px "IBM Plex Mono", monospace';
const RULER_PRIMARY_LABEL_TOP_PX = 12;
export const PRIMARY_RENDER_WIDTH_LIMIT_VIEWPORT_FACTOR = 1;

// ── Types ──────────────────────────────────────────────────────────────────────

// Purpose: Callback invoked after each grid-tile division is drawn into a slot.
// How: Receives the canvas context (already translated to the division origin) and division metadata so overlay content (e.g. waveforms) can be painted into the same buffer.
export type DivisionContentPainter = (
  context: CanvasRenderingContext2D,
  divisionOffsetIndex: number,
  renderUnitIndex: number,
  unitStepCoord: number,
  unitWidthPx: number,
  renderHeightPx: number,
  bufferWidthPx: number,
) => void;

// Purpose: Describe one buffer slot holding a pre-rendered strip of primary divisions.
// How: Pair an offscreen canvas with its coordinate range and primary-index bounds.
export type SharedGridBufferSlot = {
  canvas: HTMLCanvasElement;
  startPrimaryIndex: number;
  endPrimaryIndex: number;
  startCoord: number;
  endCoord: number;
};

// Purpose: Capture the full sliding-window state for the shared grid layer.
// How: Track three buffer slots, their role assignments, and the last known viewport position.
export type SharedGridSlidingState = {
  key: string;
  direction: -1 | 1;
  renderDivision: RenderDivisionSpec;
  primaryStepCoord: number;
  bufferPrimaryCount: number;
  bufferWidthPx: number;
  renderHeightPx: number;
  leftSlot: number;
  rightSlot: number;
  reserveSlot: number;
  slots: [SharedGridBufferSlot, SharedGridBufferSlot, SharedGridBufferSlot];
  lastViewStartCoord: number;
  lastProgressPrimaryIndex: number;
  reserveFilledPrimaryCount: number;
};

// Purpose: Describe one positioned line in the shared grid for raster rendering.
// How: Bundle a pixel offset, display text, and optional text alignment.
type SharedGridLineRenderModel = {
  leftPx: number;
  text: string;
  align?: CanvasTextAlign;
};

// Purpose: Describe the full raster geometry for one shared-grid frame.
// How: Collect the block width, subdivision offsets, labels, and block count.
export type SharedGridRasterModel = {
  key: string;
  renderWidthPx: number;
  renderHeightPx: number;
  primaryOffsetPx: number;
  blockWidthPx: number;
  edgeZeroLabelText: string;
  edgeZeroLabelOffsetPx: number;
  secondaryLineOffsetsPx: number[];
  tertiaryLineOffsetsPx: number[];
  secondaryLabels: SharedGridLineRenderModel[];
  blockCount: number;
};

// ── Module state ───────────────────────────────────────────────────────────────

const sharedGridTileCanvasCache = new Map<string, HTMLCanvasElement>();
const sharedGridSubprimaryTileCanvasCache = new Map<string, HTMLCanvasElement>();
const warmedSharedGridTileCacheKeys = new Set<string>();
let sharedGridSlidingState: SharedGridSlidingState | null = null;
let _registeredContentPainter: DivisionContentPainter | null = null;
let _registeredContentKey: string = "";

// Purpose: Expose the current sliding-window state for read access from the render loop.
// How: Return the module-level reference directly.
export function getSharedGridSlidingState(): SharedGridSlidingState | null {
  return sharedGridSlidingState;
}

// Purpose: Register an overlay painter that will be called after each grid-tile division draw.
// How: Store the painter and its cache key at module scope so the sliding-buffer fill functions invoke it.
export function registerContentPainter(painter: DivisionContentPainter, key: string): void {
  _registeredContentPainter = painter;
  _registeredContentKey = key;
}

// Purpose: Clear the registered overlay painter.
// How: Reset the module-level painter and key references to their empty defaults.
export function clearContentPainter(): void {
  _registeredContentPainter = null;
  _registeredContentKey = "";
}

// Purpose: Force full re-initialization of the shared-grid sliding buffers on the next sync.
// How: Null out the module-level state so the next syncSharedGridSlidingBuffers call rebuilds from scratch.
export function invalidateSharedGridSlidingBuffers(): void {
  sharedGridSlidingState = null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Purpose: Format one secondary tile label from the elapsed samples within a primary.
// How: Divide by the label unit and pad to the requested digit count.
function formatExactSecondaryTileLabel(
  elapsedSamplesWithinPrimary: number,
  renderScale: ExactTimelineScale,
  minimumDigits = 1,
): string {
  const displayValue = elapsedSamplesWithinPrimary / renderScale.secondaryLabelSamplesPerUnit;
  if (Number.isInteger(displayValue)) {
    return String(displayValue).padStart(minimumDigits, "0");
  }
  return displayValue.toFixed(3).replace(/\.?0+$/, "");
}

// Purpose: Determine how many digits the secondary labels need at the current scale.
// How: Format the largest secondary value and measure its string length.
function getExactSecondaryLabelDigits(renderScale: ExactTimelineScale): number {
  const secondaryDivisionsPerPrimary = Math.max(1, Math.floor(renderScale.primaryStepSamples / renderScale.secondaryStepSamples));
  const maxSecondaryValue = Math.max(0, secondaryDivisionsPerPrimary - 1) * renderScale.secondaryStepSamples;
  const maxSecondaryLabel = formatExactSecondaryTileLabel(maxSecondaryValue, renderScale);
  return Math.max(1, maxSecondaryLabel.length);
}

// Purpose: Compute the edge-zero label text and its pixel offset for alignment.
// How: Pad with zeros to the required digit count and center-offset using estimated width.
function getExactSecondaryEdgeZeroLabel(renderScale: ExactTimelineScale): {
  text: string;
  offsetPx: number;
} {
  const zeroLabelText = "0".padStart(getExactSecondaryLabelDigits(renderScale), "0");
  const zeroLabelWidth = estimateRenderedLabelWidth(zeroLabelText, false);
  return {
    text: zeroLabelText,
    offsetPx: -Math.floor((zeroLabelWidth - 3) / 2),
  };
}

// ── Raster model ───────────────────────────────────────────────────────────────

// Purpose: Compute the repeatable raster geometry for the shared time grid.
// How: Derive one primary block width, collect the secondary and tertiary subdivision offsets inside that block, and count how many such blocks cover the widened render window.
export function buildSharedGridRasterModel(
  renderScale: ExactTimelineScale,
  renderStartCoord: number,
  renderEndCoord: number,
  viewportWidthPx: number,
  renderWidthPx: number,
  renderHeightPx: number,
  pixelsPerCoord: number,
): SharedGridRasterModel {
  const primaryStepCoord = renderScale.primaryStepCoord;
  const secondaryStepCoord = renderScale.secondaryStepCoord;
  const tertiaryStepCoord = renderScale.tertiaryStepCoord;
  const firstPrimary = floorDivide(renderStartCoord, primaryStepCoord) * primaryStepCoord;
  const firstSecondary = floorDivide(renderStartCoord, secondaryStepCoord) * secondaryStepCoord;
  const lastSecondary = Math.ceil(renderEndCoord / secondaryStepCoord) * secondaryStepCoord;
  const lastPrimaryExclusive = Math.ceil(renderEndCoord / primaryStepCoord) * primaryStepCoord;
  const blockWidthPx = primaryStepCoord * pixelsPerCoord;
  const primaryOffsetPx = (firstPrimary - renderStartCoord) * pixelsPerCoord;
  const secondaryLabelDigits = getExactSecondaryLabelDigits(renderScale);
  const edgeZeroLabel = getExactSecondaryEdgeZeroLabel(renderScale);
  const secondaryLineOffsetsPx: number[] = [];
  const tertiaryLineOffsetsPx: number[] = [];
  const secondaryLabels: SharedGridLineRenderModel[] = [];

  secondaryLabels.push({
    leftPx: edgeZeroLabel.offsetPx,
    text: edgeZeroLabel.text,
    align: "left",
  });

  for (
    let timeCoord = firstPrimary + secondaryStepCoord;
    timeCoord < firstPrimary + primaryStepCoord;
    timeCoord += secondaryStepCoord
  ) {
    const relativeLeftPx = Math.round((timeCoord - firstPrimary) * pixelsPerCoord);
    secondaryLineOffsetsPx.push(relativeLeftPx);
    secondaryLabels.push({
      leftPx: relativeLeftPx,
      text: formatExactSecondaryTileLabel(timeCoord - firstPrimary, renderScale, secondaryLabelDigits),
      align: "center",
    });
  }

  secondaryLabels.push({
    leftPx: Math.round(blockWidthPx) + edgeZeroLabel.offsetPx,
    text: edgeZeroLabel.text,
    align: "left",
  });

  if (tertiaryStepCoord !== null) {
    for (
      let timeCoord = firstPrimary + tertiaryStepCoord;
      timeCoord < firstPrimary + primaryStepCoord;
      timeCoord += tertiaryStepCoord
    ) {
      if (positiveModulo(timeCoord, secondaryStepCoord) === 0) {
        continue;
      }
      tertiaryLineOffsetsPx.push(Math.round((timeCoord - firstPrimary) * pixelsPerCoord));
    }
  }

  const blockCount = Math.max(0, Math.ceil((lastPrimaryExclusive - firstPrimary) / primaryStepCoord));
  recordPerfCounter("render.timeline.sharedGrid.blocks", blockCount);
  recordPerfCounter("render.timeline.sharedGrid.lines.primary", blockCount);
  recordPerfCounter("render.timeline.sharedGrid.lines.secondary", blockCount * secondaryLineOffsetsPx.length);
  recordPerfCounter("render.timeline.sharedGrid.lines.tertiary", blockCount * tertiaryLineOffsetsPx.length);
  recordPerfCounter("render.timeline.sharedGrid.labels.primary", blockCount);
  recordPerfCounter("render.timeline.sharedGrid.labels.secondary", blockCount * secondaryLabels.length);
  recordPerfCounter("render.timeline.sharedGrid.primaryStepCoord", primaryStepCoord);
  recordPerfCounter("render.timeline.sharedGrid.secondaryStepCoord", secondaryStepCoord);
  if (tertiaryStepCoord !== null) {
    recordPerfCounter("render.timeline.sharedGrid.tertiaryStepCoord", tertiaryStepCoord);
  }
  return {
    key: [
      "exact-z0",
      blockWidthPx.toFixed(4),
      renderHeightPx,
      secondaryLineOffsetsPx.join(","),
      tertiaryLineOffsetsPx.join(","),
      edgeZeroLabel.text,
    ].join(";"),
    renderWidthPx,
    renderHeightPx,
    primaryOffsetPx,
    blockWidthPx,
    edgeZeroLabelText: edgeZeroLabel.text,
    edgeZeroLabelOffsetPx: edgeZeroLabel.offsetPx,
    secondaryLineOffsetsPx,
    tertiaryLineOffsetsPx,
    secondaryLabels,
    blockCount,
  };
}

// ── Tile caching ───────────────────────────────────────────────────────────────

// Purpose: Create or reuse the cached raster tile for one primary shared-grid block.
// How: Draw the primary, secondary, and tertiary line segments once into a small offscreen canvas keyed by the current scale signature, then reuse that tile across the full grid.
export function getSharedGridTileCanvas(model: SharedGridRasterModel): HTMLCanvasElement {
  const cachedCanvas = sharedGridTileCanvasCache.get(model.key);
  if (cachedCanvas) {
    recordPerfCounter("render.timeline.sharedGrid.canvas.cacheHit", 1);
    return cachedCanvas;
  }

  recordPerfCounter("render.timeline.sharedGrid.canvas.cacheMiss", 1);
  const tileCanvas = document.createElement("canvas");
  const context = preparePatternTileCanvas(tileCanvas, model.blockWidthPx, model.renderHeightPx);
  if (!context) {
    return tileCanvas;
  }

  const drawVerticalLineSegment = (
    x: number,
    startYPx: number,
    endYPx: number,
    color: string,
    widthPx = 1,
  ): void => {
    if (endYPx <= startYPx) {
      return;
    }
    context.fillStyle = color;
    context.fillRect(Math.round(x), startYPx, widthPx, endYPx - startYPx);
  };

  drawVerticalLineSegment(0, 0, model.renderHeightPx, SHARED_GRID_PRIMARY_LINE_COLOR);

  for (const offsetPx of model.secondaryLineOffsetsPx) {
    drawVerticalLineSegment(
      offsetPx,
      SHARED_GRID_SECONDARY_START_Y_PX,
      SHARED_GRID_RULER_HEIGHT_PX,
      SHARED_GRID_SECONDARY_RULER_LINE_COLOR,
      1.25,
    );
    drawVerticalLineSegment(
      offsetPx,
      SHARED_GRID_RULER_HEIGHT_PX,
      model.renderHeightPx,
      SHARED_GRID_SECONDARY_LINE_COLOR,
    );
  }

  for (const offsetPx of model.tertiaryLineOffsetsPx) {
    drawVerticalLineSegment(
      offsetPx,
      SHARED_GRID_TERTIARY_START_Y_PX,
      SHARED_GRID_RULER_HEIGHT_PX,
      SHARED_GRID_TERTIARY_RULER_LINE_COLOR,
      1.25,
    );
    drawVerticalLineSegment(
      offsetPx,
      SHARED_GRID_RULER_HEIGHT_PX,
      model.renderHeightPx,
      SHARED_GRID_TERTIARY_LINE_COLOR,
    );
  }

  if (model.secondaryLabels.length > 0) {
    context.save();
    context.fillStyle = SHARED_GRID_SECONDARY_LABEL_COLOR;
    context.font = SHARED_GRID_SECONDARY_LABEL_FONT;
    context.textBaseline = "alphabetic";
    for (const label of model.secondaryLabels) {
      context.textAlign = label.align ?? "center";
      context.fillText(label.text, Math.round(label.leftPx), SHARED_GRID_SECONDARY_LABEL_BASELINE_Y_PX);
    }
    context.restore();
  }

  sharedGridTileCanvasCache.set(model.key, tileCanvas);
  return tileCanvas;
}

// Purpose: Get the sub-primary tile canvas for a specific render-division unit.
// How: Extract the relevant slice from the full primary tile and cache it.
function getSharedGridRenderUnitTileCanvas(
  renderScale: ExactTimelineScale,
  renderHeightPx: number,
  pixelsPerCoord: number,
  renderDivision: RenderDivisionSpec,
  renderUnitIndex: number,
): HTMLCanvasElement {
  const primaryTileModel = buildSharedGridRasterModel(
    renderScale,
    0,
    renderScale.primaryStepCoord,
    renderScale.primarySpacingPx,
    renderScale.primarySpacingPx,
    renderHeightPx,
    pixelsPerCoord,
  );
  const primaryTileCanvas = getSharedGridTileCanvas(primaryTileModel);
  if (renderDivision.unitCountPerPrimary === 1) {
    return primaryTileCanvas;
  }

  const phaseIndex = positiveModulo(renderUnitIndex, renderDivision.unitCountPerPrimary);
  const cacheKey = `${primaryTileModel.key};subprimary:${renderDivision.unitCountPerPrimary};phase:${phaseIndex}`;
  const cachedCanvas = sharedGridSubprimaryTileCanvasCache.get(cacheKey);
  if (cachedCanvas) {
    return cachedCanvas;
  }

  const tileCanvas = document.createElement("canvas");
  const context = preparePatternTileCanvas(tileCanvas, renderDivision.unitWidthPx, renderHeightPx);
  if (!context) {
    return tileCanvas;
  }
  const sourceLeftPx = phaseIndex * renderDivision.unitWidthPx;
  context.drawImage(
    primaryTileCanvas,
    sourceLeftPx,
    0,
    renderDivision.unitWidthPx,
    renderHeightPx,
    0,
    0,
    renderDivision.unitWidthPx,
    renderHeightPx,
  );
  sharedGridSubprimaryTileCanvasCache.set(cacheKey, tileCanvas);
  return tileCanvas;
}

// Purpose: Pre-warm the shared-grid tile cache for all zoom levels at the given height.
// How: Iterate over every scale level and force tile creation.
export function warmSharedGridPrimaryTileCanvases(renderHeightPx: number): void {
  const warmKey = `${Math.round(renderHeightPx)}`;
  if (warmedSharedGridTileCacheKeys.has(warmKey)) {
    return;
  }
  const timebase = demoState.viewport.timeScale.timebase;
  for (const level of TimeScale.levels) {
    const renderScale = TimeScale.getExactTimelineScale(level.levelIndex, timebase);
    const pixelsPerCoord = renderScale.pixelsPerSample / renderScale.sampleCoord;
    const blockWidthPx = renderScale.primarySpacingPx;
    const tileModel = buildSharedGridRasterModel(
      renderScale,
      0,
      renderScale.primaryStepCoord,
      blockWidthPx,
      blockWidthPx,
      renderHeightPx,
      pixelsPerCoord,
    );
    getSharedGridTileCanvas(tileModel);
  }
  warmedSharedGridTileCacheKeys.add(warmKey);
}

// ── Buffer slot operations ─────────────────────────────────────────────────────

// Purpose: Create one reusable buffer slot with a fresh offscreen canvas.
// How: Allocate a canvas element and initialize range fields to zero.
export function createSharedGridBufferSlot(): SharedGridBufferSlot {
  return {
    canvas: document.createElement("canvas"),
    startPrimaryIndex: 0,
    endPrimaryIndex: 0,
    startCoord: 0,
    endCoord: 0,
  };
}

// Purpose: Reset a buffer slot's coordinate range without redrawing.
// How: Assign the primary-index bounds and derive the coordinate range.
export function resetBufferSlotRange(
  slot: SharedGridBufferSlot,
  startPrimaryIndex: number,
  primaryStepCoord: number,
  bufferPrimaryCount: number,
): void {
  slot.startPrimaryIndex = startPrimaryIndex;
  slot.endPrimaryIndex = startPrimaryIndex + bufferPrimaryCount;
  slot.startCoord = slot.startPrimaryIndex * primaryStepCoord;
  slot.endCoord = slot.endPrimaryIndex * primaryStepCoord;
}

// Purpose: Determine which primary index the viewport has progressed to.
// How: Use the left edge for rightward scrolling, the right edge for leftward.
export function getSlidingProgressPrimaryIndex(
  direction: -1 | 1,
  view: { viewStartCoord: number; viewEndCoord: number },
  primaryStepCoord: number,
): number {
  return direction > 0
    ? floorDivide(view.viewStartCoord, primaryStepCoord)
    : Math.ceil(view.viewEndCoord / primaryStepCoord) - 1;
}

// ── Raster rendering ───────────────────────────────────────────────────────────

// Purpose: Render the full shared-grid raster model into a target canvas.
// How: Create a repeating pattern from the primary tile and fill the canvas.
function renderSharedGridRasterToCanvas(targetCanvas: HTMLCanvasElement, model: SharedGridRasterModel): void {
  const context = prepareRasterCanvas(targetCanvas, model.renderWidthPx, model.renderHeightPx);
  if (!context) {
    return;
  }

  const tileCanvas = getSharedGridTileCanvas(model);
  const pattern = context.createPattern(tileCanvas, "repeat");
  if (!pattern) {
    return;
  }

  context.save();
  context.translate(model.primaryOffsetPx, 0);
  context.fillStyle = pattern;
  context.fillRect(-model.primaryOffsetPx, 0, model.renderWidthPx, model.renderHeightPx);
  context.restore();
}

// Purpose: Draw primary ruler labels on top of the shared grid canvas.
// How: Iterate over the label models and render each with the primary font.
function drawRulerPreviewLabelsToCanvas(
  targetCanvas: HTMLCanvasElement,
  model: SharedGridRasterModel,
  labels: readonly RulerLabelRenderModel[],
): void {
  if (labels.length === 0) {
    return;
  }
  const context = targetCanvas.getContext("2d");
  if (!context) {
    return;
  }
  const devicePixelRatio = window.devicePixelRatio || 1;
  context.save();
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.fillStyle = RULER_PRIMARY_LABEL_COLOR;
  context.font = RULER_PRIMARY_LABEL_FONT;
  context.textBaseline = "top";
  for (const label of labels) {
    context.fillText(label.label, label.leftPx + 2, RULER_PRIMARY_LABEL_TOP_PX);
  }
  context.restore();
}

// Purpose: Paint the full shared time grid into the shared grid canvas layer.
// How: Prepare the destination canvas, build or reuse the primary-block tile, and fill the widened render window with a repeated canvas pattern aligned to the current render start.
export function renderSharedGridCanvas(
  elements: Elements,
  model: SharedGridRasterModel,
  rulerPreviewLabels: readonly RulerLabelRenderModel[] = [],
): void {
  renderSharedGridRasterToCanvas(elements.timelineSharedGrid, model);
  drawRulerPreviewLabelsToCanvas(elements.timelineSharedGrid, model, rulerPreviewLabels);

  recordPerfCounter("render.timeline.sharedGrid.dom.removedBlocks", 0);
  recordPerfCounter("render.timeline.sharedGrid.dom.createdBlocks", model.blockCount);
  recordPerfCounter("render.timeline.sharedGrid.dom.pooledBlocks", 0);
  recordPerfCounter("render.timeline.sharedGrid.dom.movedBlocks", 0);
  recordPerfCounter("render.timeline.sharedGrid.dom.existingBlocks", 0);
  recordPerfCounter("render.timeline.sharedGrid.dom.rebuiltBlocks", model.blockCount);
  recordPerfCounter(
    "render.timeline.sharedGrid.dom.rebuiltLineNodes",
    model.blockCount * (1 + model.secondaryLineOffsetsPx.length + model.tertiaryLineOffsetsPx.length),
  );
  recordPerfCounter(
    "render.timeline.sharedGrid.dom.rebuiltLabelNodes",
    model.blockCount * model.secondaryLabels.length,
  );
  recordPerfCounter("render.timeline.sharedGrid.dom.stableBlocks", 0);
}

// ── Sliding-buffer state ───────────────────────────────────────────────────────

// Purpose: Build the deduplication key for the shared-grid sliding state.
// How: Combine scale, geometry, and buffer parameters into a string.
function getSharedGridSlidingKey(
  renderScale: ExactTimelineScale,
  view: DAWRenderView,
  projection: TimelineProjection,
  renderHeightPx: number,
  bufferPrimaryCount: number,
  renderDivision: RenderDivisionSpec,
): string {
  return [
    demoState.viewport.timeScale.zoomLevelIndex,
    renderScale.primaryStepCoord,
    renderDivision.unitStepCoord,
    renderDivision.unitCountPerPrimary,
    renderScale.secondaryStepCoord,
    renderScale.tertiaryStepCoord ?? "n",
    view.viewDurationCoord,
    projection.pixelsPerCoord.toFixed(6),
    projection.canvasWidthPx.toFixed(4),
    renderHeightPx.toFixed(4),
    bufferPrimaryCount,
    _registeredContentKey,
  ].join(";");
}

// Purpose: Fill a buffer slot with the shared-grid tiles for a range of primary divisions.
// How: Prepare the canvas and draw each division's tile at the correct offset.
function fillSharedGridBufferSlot(
  slot: SharedGridBufferSlot,
  startPrimaryIndex: number,
  bufferPrimaryCount: number,
  projection: TimelineProjection,
  view: DAWRenderView,
  renderScale: ExactTimelineScale,
  renderHeightPx: number,
  bufferWidthPx: number,
  renderDivision: RenderDivisionSpec,
  role: PrimaryDivisionBufferRole,
  reason: string,
): void {
  const fillStartMs = performance.now();
  const startCoord = startPrimaryIndex * renderDivision.unitStepCoord;
  const endPrimaryIndex = startPrimaryIndex + bufferPrimaryCount;
  const endCoord = endPrimaryIndex * renderDivision.unitStepCoord;
  const context = prepareRasterCanvas(slot.canvas, bufferWidthPx, renderHeightPx);
  if (context) {
    for (let divisionOffsetIndex = 0; divisionOffsetIndex < bufferPrimaryCount; divisionOffsetIndex += 1) {
      const renderUnitIndex = startPrimaryIndex + divisionOffsetIndex;
      const destLeftPx = divisionOffsetIndex * renderDivision.unitWidthPx;
      const tileCanvas = getSharedGridRenderUnitTileCanvas(
        renderScale,
        renderHeightPx,
        projection.pixelsPerCoord,
        renderDivision,
        renderUnitIndex,
      );
      context.drawImage(
        tileCanvas,
        destLeftPx,
        0,
        renderDivision.unitWidthPx,
        renderHeightPx,
      );
      if (_registeredContentPainter) {
        _registeredContentPainter(
          context,
          divisionOffsetIndex,
          renderUnitIndex,
          renderDivision.unitStepCoord,
          renderDivision.unitWidthPx,
          renderHeightPx,
          bufferWidthPx,
        );
      }
      logPrimaryDivisionDraw("grid", role, reason, renderUnitIndex, renderDivision.unitStepCoord);
    }
  }
  slot.startPrimaryIndex = startPrimaryIndex;
  slot.endPrimaryIndex = endPrimaryIndex;
  slot.startCoord = startCoord;
  slot.endCoord = endCoord;
  logRareRenderCost("shared-grid-fill-slot", performance.now() - fillStartMs, {
    bufferPrimaryCount,
    bufferWidthPx: Math.round(bufferWidthPx),
    startPrimaryIndex,
    endPrimaryIndex,
    viewStartCoord: view.viewStartCoord,
    viewEndCoord: view.viewEndCoord,
  });
}

// Purpose: Draw one primary division into a specific offset within a buffer slot.
// How: Clear the target area and blit the appropriate tile canvas.
function drawSharedGridPrimaryDivisionIntoSlot(
  slot: SharedGridBufferSlot,
  divisionOffsetIndex: number,
  projection: TimelineProjection,
  renderScale: ExactTimelineScale,
  renderHeightPx: number,
  bufferWidthPx: number,
  renderDivision: RenderDivisionSpec,
  role: PrimaryDivisionBufferRole,
  reason: string,
): void {
  const context = getRasterCanvasContext(slot.canvas, bufferWidthPx, renderHeightPx, false);
  if (!context) {
    return;
  }
  const blockWidthPx = renderDivision.unitWidthPx;
  const destLeftPx = divisionOffsetIndex * blockWidthPx;
  const renderUnitIndex = slot.startPrimaryIndex + divisionOffsetIndex;
  const tileCanvas = getSharedGridRenderUnitTileCanvas(
    renderScale,
    renderHeightPx,
    projection.pixelsPerCoord,
    renderDivision,
    renderUnitIndex,
  );
  context.clearRect(destLeftPx, 0, blockWidthPx, renderHeightPx);
  context.drawImage(tileCanvas, destLeftPx, 0, blockWidthPx, renderHeightPx);
  if (_registeredContentPainter) {
    _registeredContentPainter(
      context,
      divisionOffsetIndex,
      renderUnitIndex,
      renderDivision.unitStepCoord,
      renderDivision.unitWidthPx,
      renderHeightPx,
      bufferWidthPx,
    );
  }
  logPrimaryDivisionDraw(
    "grid",
    role,
    reason,
    renderUnitIndex,
    renderDivision.unitStepCoord,
  );
}

// Purpose: Configure the reserve slot to cover the next unseen range.
// How: Position it adjacent to the visible pair and pre-fill as many divisions as the viewport has already passed.
function configureSharedGridReserveSlot(
  state: SharedGridSlidingState,
  view: DAWRenderView,
  projection: TimelineProjection,
  renderScale: ExactTimelineScale,
  currentProgressPrimaryIndex: number,
  reason: string,
): void {
  const reserveSlot = state.slots[state.reserveSlot]!;
  const reserveStartPrimaryIndex = state.direction > 0
    ? state.slots[state.rightSlot]!.startPrimaryIndex + state.bufferPrimaryCount
    : state.slots[state.leftSlot]!.startPrimaryIndex - state.bufferPrimaryCount;
  resetBufferSlotRange(reserveSlot, reserveStartPrimaryIndex, state.primaryStepCoord, state.bufferPrimaryCount);
  const context = prepareRasterCanvas(reserveSlot.canvas, state.bufferWidthPx, state.renderHeightPx);
  if (!context) {
    state.reserveFilledPrimaryCount = 0;
    return;
  }
  const initialFilledCount = state.direction > 0
    ? Math.max(
        0,
        Math.min(currentProgressPrimaryIndex - state.slots[state.leftSlot]!.startPrimaryIndex, state.bufferPrimaryCount),
      )
    : Math.max(
        0,
        Math.min(state.slots[state.rightSlot]!.endPrimaryIndex - 1 - currentProgressPrimaryIndex, state.bufferPrimaryCount),
      );
  state.reserveFilledPrimaryCount = 0;
  for (let fillIndex = 0; fillIndex < initialFilledCount; fillIndex += 1) {
    const divisionOffsetIndex = state.direction > 0
      ? fillIndex
      : state.bufferPrimaryCount - 1 - fillIndex;
    drawSharedGridPrimaryDivisionIntoSlot(
      reserveSlot,
      divisionOffsetIndex,
      projection,
      renderScale,
      state.renderHeightPx,
      state.bufferWidthPx,
      state.renderDivision,
      "reserve",
      reason,
    );
    state.reserveFilledPrimaryCount += 1;
  }
}

// Purpose: Incrementally fill one more division in the reserve slot.
// How: Draw the next unfilled division and bump the counter.
function advanceSharedGridReserveFill(
  state: SharedGridSlidingState,
  projection: TimelineProjection,
  renderScale: ExactTimelineScale,
): void {
  if (state.reserveFilledPrimaryCount >= state.bufferPrimaryCount) {
    return;
  }
  const divisionOffsetIndex = state.direction > 0
    ? state.reserveFilledPrimaryCount
    : state.bufferPrimaryCount - 1 - state.reserveFilledPrimaryCount;
  drawSharedGridPrimaryDivisionIntoSlot(
    state.slots[state.reserveSlot]!,
    divisionOffsetIndex,
    projection,
    renderScale,
    state.renderHeightPx,
    state.bufferWidthPx,
    state.renderDivision,
    "reserve",
    "reserve-step",
  );
  state.reserveFilledPrimaryCount += 1;
}

// Purpose: Publish the sliding-window coordinate range into demoState for external queries.
// How: Copy the left and right buffer bounds into the state properties.
export function syncSharedGridSlidingWindowState(): void {
  if (!sharedGridSlidingState) {
    demoState.geometryWindow.renderStart = null;
    demoState.geometryWindow.renderEnd = null;
    demoState.geometryWindow.stableStart = null;
    demoState.geometryWindow.stableEnd = null;
    demoState.geometryWindow.displayStart = null;
    demoState.geometryWindow.displayEnd = null;
    return;
  }
  const leftBuffer = sharedGridSlidingState.slots[sharedGridSlidingState.leftSlot]!;
  const rightBuffer = sharedGridSlidingState.slots[sharedGridSlidingState.rightSlot]!;
  demoState.geometryWindow.renderStart = leftBuffer.startCoord;
  demoState.geometryWindow.renderEnd = rightBuffer.endCoord;
  demoState.geometryWindow.stableStart = leftBuffer.startCoord;
  demoState.geometryWindow.stableEnd = rightBuffer.endCoord;
}

// Purpose: Build and initialize the sliding-window state for the shared grid.
// How: Compute buffer dimensions, fill the left and right slots, and pre-seed the reserve.
function initializeSharedGridSlidingState(
  view: DAWRenderView,
  projection: TimelineProjection,
  renderScale: ExactTimelineScale,
  renderHeightPx: number,
  direction: -1 | 1,
): SharedGridSlidingState {
  const initStartMs = performance.now();
  const renderDivision = getRenderDivisionSpec(
    renderScale,
    projection.canvasWidthPx * PRIMARY_RENDER_WIDTH_LIMIT_VIEWPORT_FACTOR,
  );
  const blockWidthPx = renderDivision.unitWidthPx;
  const bufferPrimaryCount = Math.max(1, Math.ceil(projection.canvasWidthPx / Math.max(blockWidthPx, 1)));
  const bufferWidthPx = bufferPrimaryCount * blockWidthPx;
  const state: SharedGridSlidingState = {
    key: getSharedGridSlidingKey(renderScale, view, projection, renderHeightPx, bufferPrimaryCount, renderDivision),
    direction,
    renderDivision,
    primaryStepCoord: renderDivision.unitStepCoord,
    bufferPrimaryCount,
    bufferWidthPx,
    renderHeightPx,
    leftSlot: 0,
    rightSlot: 1,
    reserveSlot: 2,
    slots: [
      createSharedGridBufferSlot(),
      createSharedGridBufferSlot(),
      createSharedGridBufferSlot(),
    ],
    lastViewStartCoord: view.viewStartCoord,
    lastProgressPrimaryIndex: getSlidingProgressPrimaryIndex(direction, view, renderDivision.unitStepCoord),
    reserveFilledPrimaryCount: 0,
  };

  if (direction >= 0) {
    const firstVisiblePrimaryIndex = floorDivide(view.viewStartCoord, renderDivision.unitStepCoord);
    const leftStartPrimaryIndex = floorDivide(firstVisiblePrimaryIndex, bufferPrimaryCount) * bufferPrimaryCount;
    fillSharedGridBufferSlot(state.slots[state.leftSlot]!, leftStartPrimaryIndex, bufferPrimaryCount, projection, view, renderScale, renderHeightPx, bufferWidthPx, renderDivision, "left", "init-visible-fill");
    fillSharedGridBufferSlot(state.slots[state.rightSlot]!, leftStartPrimaryIndex + bufferPrimaryCount, bufferPrimaryCount, projection, view, renderScale, renderHeightPx, bufferWidthPx, renderDivision, "right", "init-visible-fill");
  } else {
    const lastVisiblePrimaryIndex = Math.ceil(view.viewEndCoord / renderDivision.unitStepCoord) - 1;
    const rightStartPrimaryIndex = floorDivide(lastVisiblePrimaryIndex, bufferPrimaryCount) * bufferPrimaryCount;
    const leftStartPrimaryIndex = rightStartPrimaryIndex - bufferPrimaryCount;
    fillSharedGridBufferSlot(state.slots[state.leftSlot]!, leftStartPrimaryIndex, bufferPrimaryCount, projection, view, renderScale, renderHeightPx, bufferWidthPx, renderDivision, "left", "init-visible-fill");
    fillSharedGridBufferSlot(state.slots[state.rightSlot]!, rightStartPrimaryIndex, bufferPrimaryCount, projection, view, renderScale, renderHeightPx, bufferWidthPx, renderDivision, "right", "init-visible-fill");
  }
  configureSharedGridReserveSlot(state, view, projection, renderScale, state.lastProgressPrimaryIndex, "reserve-prefill");

  sharedGridSlidingState = state;
  syncSharedGridSlidingWindowState();
  logRareRenderCost("shared-grid-init", performance.now() - initStartMs, {
    direction,
    blockWidthPx: Math.round(blockWidthPx),
    bufferPrimaryCount,
    bufferWidthPx: Math.round(bufferWidthPx),
    gridWidthPx: Math.round(projection.canvasWidthPx),
    subprimaryCount: renderDivision.unitCountPerPrimary,
  });
  return state;
}

// Purpose: Rotate the three buffer slots rightward after the viewport crosses a boundary.
// How: Promote right to left, reserve to right, then re-seed the freed reserve slot.
function rotateSharedGridBuffersRight(
  state: SharedGridSlidingState,
  view: DAWRenderView,
  projection: TimelineProjection,
  renderScale: ExactTimelineScale,
  currentProgressPrimaryIndex: number,
): void {
  const rotateStartMs = performance.now();
  const previousLeftSlot = state.leftSlot;
  state.leftSlot = state.rightSlot;
  state.rightSlot = state.reserveSlot;
  state.reserveSlot = previousLeftSlot;
  configureSharedGridReserveSlot(state, view, projection, renderScale, currentProgressPrimaryIndex, "reserve-reseed");
  logRareRenderCost("shared-grid-rotate-right", performance.now() - rotateStartMs, {
    reserveStartPrimaryIndex: state.slots[state.reserveSlot]!.startPrimaryIndex,
    bufferPrimaryCount: state.bufferPrimaryCount,
    bufferWidthPx: Math.round(state.bufferWidthPx),
    reserveFilledPrimaryCount: state.reserveFilledPrimaryCount,
  });
}

// Purpose: Rotate the three buffer slots leftward after the viewport crosses a boundary.
// How: Promote left to right, reserve to left, then re-seed the freed reserve slot.
function rotateSharedGridBuffersLeft(
  state: SharedGridSlidingState,
  view: DAWRenderView,
  projection: TimelineProjection,
  renderScale: ExactTimelineScale,
  currentProgressPrimaryIndex: number,
): void {
  const rotateStartMs = performance.now();
  const previousRightSlot = state.rightSlot;
  state.rightSlot = state.leftSlot;
  state.leftSlot = state.reserveSlot;
  state.reserveSlot = previousRightSlot;
  configureSharedGridReserveSlot(state, view, projection, renderScale, currentProgressPrimaryIndex, "reserve-reseed");
  logRareRenderCost("shared-grid-rotate-left", performance.now() - rotateStartMs, {
    reserveStartPrimaryIndex: state.slots[state.reserveSlot]!.startPrimaryIndex,
    bufferPrimaryCount: state.bufferPrimaryCount,
    bufferWidthPx: Math.round(state.bufferWidthPx),
    reserveFilledPrimaryCount: state.reserveFilledPrimaryCount,
  });
}

// Purpose: Synchronize the sliding buffers with the current viewport position.
// How: Detect direction changes, fill crossed divisions, rotate when needed, and update tracking state.
export function syncSharedGridSlidingBuffers(
  view: DAWRenderView,
  projection: TimelineProjection,
  renderScale: ExactTimelineScale,
  renderHeightPx: number,
): boolean {
  const nextDirection: -1 | 1 = sharedGridSlidingState && view.viewStartCoord < sharedGridSlidingState.lastViewStartCoord ? -1 : 1;
  const renderDivision = getRenderDivisionSpec(
    renderScale,
    projection.canvasWidthPx * PRIMARY_RENDER_WIDTH_LIMIT_VIEWPORT_FACTOR,
  );
  const blockWidthPx = renderDivision.unitWidthPx;
  const bufferPrimaryCount = Math.max(1, Math.ceil(projection.canvasWidthPx / Math.max(blockWidthPx, 1)));
  const nextKey = getSharedGridSlidingKey(renderScale, view, projection, renderHeightPx, bufferPrimaryCount, renderDivision);
  if (!sharedGridSlidingState || sharedGridSlidingState.key !== nextKey || sharedGridSlidingState.direction !== nextDirection) {
    initializeSharedGridSlidingState(view, projection, renderScale, renderHeightPx, nextDirection);
    return true;
  }

  const currentProgressPrimaryIndex = getSlidingProgressPrimaryIndex(nextDirection, view, renderDivision.unitStepCoord);
  const crossedPrimaryCount = nextDirection > 0
    ? Math.max(0, currentProgressPrimaryIndex - sharedGridSlidingState.lastProgressPrimaryIndex)
    : Math.max(0, sharedGridSlidingState.lastProgressPrimaryIndex - currentProgressPrimaryIndex);
  for (
    let fillStep = 0;
    fillStep < Math.min(crossedPrimaryCount, sharedGridSlidingState.bufferPrimaryCount);
    fillStep += 1
  ) {
    advanceSharedGridReserveFill(sharedGridSlidingState, projection, renderScale);
  }

  let changed = false;
  if (nextDirection > 0) {
    while (view.viewStartCoord >= sharedGridSlidingState.slots[sharedGridSlidingState.rightSlot]!.startCoord) {
      rotateSharedGridBuffersRight(sharedGridSlidingState, view, projection, renderScale, currentProgressPrimaryIndex);
      changed = true;
    }
  } else {
    while (view.viewEndCoord <= sharedGridSlidingState.slots[sharedGridSlidingState.leftSlot]!.endCoord) {
      rotateSharedGridBuffersLeft(sharedGridSlidingState, view, projection, renderScale, currentProgressPrimaryIndex);
      changed = true;
    }
  }

  sharedGridSlidingState.lastViewStartCoord = view.viewStartCoord;
  sharedGridSlidingState.lastProgressPrimaryIndex = currentProgressPrimaryIndex;
  syncSharedGridSlidingWindowState();
  return changed;
}

// ── Viewport compositing ───────────────────────────────────────────────────────

// Purpose: Composite the full height (ruler + tracks) of the unified sliding buffers into the shared-grid canvas.
// How: Determine the overlap between the display window and the two visible slots, then blit each at full height.
export function renderFullViewport(
  elements: Elements,
  projection: TimelineProjection,
  windowStartCoord: number,
  windowEndCoord: number,
  fullHeightPx: number,
): boolean {
  if (!sharedGridSlidingState) {
    return false;
  }
  const leftVisibleSlot = sharedGridSlidingState.slots[sharedGridSlidingState.leftSlot]!;
  const rightVisibleSlot = sharedGridSlidingState.slots[sharedGridSlidingState.rightSlot]!;
  const renderStartCoord = Math.max(windowStartCoord, leftVisibleSlot.startCoord);
  const renderEndCoord = Math.min(windowEndCoord, rightVisibleSlot.endCoord);
  const renderWidthPx = Math.max((renderEndCoord - renderStartCoord) * projection.pixelsPerCoord, 1);
  const context = prepareRasterCanvas(elements.timelineSharedGrid, renderWidthPx, fullHeightPx);
  if (!context) {
    return false;
  }
  const devicePixelRatio = window.devicePixelRatio || 1;
  const visibleSlots = [leftVisibleSlot, rightVisibleSlot];
  let drewAnything = false;

  for (const slot of visibleSlots) {
    const destLeftPx = (slot.startCoord - renderStartCoord) * projection.pixelsPerCoord;
    const sourceLeftPx = Math.max(0, (renderStartCoord - slot.startCoord) * projection.pixelsPerCoord);
    const drawLeftPx = Math.max(0, destLeftPx);
    const drawWidthPx = Math.min(
      sharedGridSlidingState.bufferWidthPx - sourceLeftPx,
      renderWidthPx - drawLeftPx,
    );
    if (drawWidthPx <= 0) {
      continue;
    }
    context.drawImage(
      slot.canvas,
      Math.round(sourceLeftPx * devicePixelRatio),
      0,
      Math.round(drawWidthPx * devicePixelRatio),
      Math.round(fullHeightPx * devicePixelRatio),
      drawLeftPx,
      0,
      drawWidthPx,
      fullHeightPx,
    );
    drewAnything = true;
  }
  return drewAnything;
}
