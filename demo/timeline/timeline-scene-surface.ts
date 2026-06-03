/******************************** timeline/timeline-scene-surface.ts ********************************
 *
 * Purpose: Represent the DOM-backed surface through which the timeline scene applies its visible output.
 * How: Wrap the bound demo elements and expose only scene-level operations such as capturing the
 *      current view, redrawing the background grid, resizing layers, and applying preview transforms.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { Elements } from "../bind-elements.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import { renderRulerLabels, type RulerLabelRenderModel } from "../ruler-labels.js";
import type { DragState } from "../gesture/gesture-state.js";
import type { ExactTimelineScale } from "../time-scale.js";
import { GridView, type GridViewFrame } from "../grid-view/grid-view.js";
import { renderTrackViews, type TrackViewState } from "../track/track-render.js";
import { WaveformView } from "../waveform-view/waveform-view.js";
import type { WaveformFrameRenderResult, WaveformViewFrame } from "../waveform-view/waveform-view.js";
import type { TimelineProjection } from "./timeline-projection.js";
import type { TimelinePanPreviewState } from "./timeline-surface.js";
import { TimelineChrome, type TimelineChromeState } from "./timeline-chrome.js";
import type { DragOverlayRenderInput, TimelineDragOverlay } from "./timeline-drag-overlay.js";

// Purpose: Represent the DOM-backed surface owned by the timeline scene.
// How: Keep the bound elements private and expose only named scene operations instead of leaking raw DOM access.
export class TimelineSceneSurface {
  readonly #elements: Elements;

  private constructor(elements: Elements) {
    this.#elements = elements;
  }

  // Purpose: Wrap one bound element collection as the scene surface consumed by the timeline runtime.
  // How: Capture the element collection once and hide the rest of the DOM details behind named operations.
  static fromElements(elements: Elements): TimelineSceneSurface {
    return new TimelineSceneSurface(elements);
  }

  // Purpose: Render one prepared buffered grid frame into the background surface.
  // How: Delegate to GridView through the wrapped element collection.
  renderGridFrame(frame: GridViewFrame): void {
    GridView.renderFrame(this.#elements, frame);
  }

  // Purpose: Reconcile the ruler label layer to the current render models.
  // How: Delegate to the ruler-label reconciler through the wrapped element collection.
  renderRulerLabels(models: readonly RulerLabelRenderModel[]): void {
    renderRulerLabels(this.#elements, models);
  }

  // Purpose: Render one timeline chrome state onto the wrapped overlay and ruler nodes.
  // How: Delegate to TimelineChrome through the wrapped element collection.
  renderChrome(state: TimelineChromeState): void {
    TimelineChrome.render(this.#elements, state);
  }

  // Purpose: Render one direct, non-buffered grid frame onto the wrapped background canvas.
  // How: Delegate to GridView through the wrapped element collection.
  renderDirectGridFrame(
    projection: TimelineProjection,
    renderScale: ExactTimelineScale,
    rulerLabels: readonly RulerLabelRenderModel[],
    renderHeightPx: number,
  ): void {
    GridView.renderDirectFrame({
      elements: this.#elements,
      projection,
      renderScale,
      rulerLabels,
      renderHeightPx,
    });
  }

  // Purpose: Render one direct, non-buffered waveform slice on the shared grid canvas.
  // How: Delegate to WaveformView through the wrapped element collection.
  renderDirectWaveforms(
    project: Project,
    projection: TimelineProjection,
    renderScale: ExactTimelineScale,
    dragState: DragState | null,
    presentationInputs: ClipPresentationInputs,
  ): void {
    WaveformView.renderDirectFrame(this.#elements, project, projection, renderScale, dragState, presentationInputs);
  }

  // Purpose: Render one buffered waveform frame on the shared grid canvas.
  // How: Delegate to WaveformView through the wrapped element collection.
  renderWaveformsFrame(
    project: Project,
    frame: WaveformViewFrame,
    dragState: DragState | null,
    presentationInputs: ClipPresentationInputs,
  ): WaveformFrameRenderResult {
    return WaveformView.renderFrame(this.#elements, project, frame, dragState, presentationInputs);
  }

  // Purpose: Resize the drag-overlay layer to one projected render window.
  // How: Apply the projection width to the drag overlay layer.
  resizeClipLayers(projection: TimelineProjection): void {
    this.#elements.dragOverlayLayer.style.width = `${projection.canvasWidthPx.toFixed(4)}px`;
  }

  // Purpose: Clear the detached drag overlay DOM owned by the current scene.
  // How: Delegate to the drag-overlay ADT through the wrapped element collection.
  clearDragOverlay(overlay: TimelineDragOverlay): void {
    overlay.clear(this.#elements);
  }

  // Purpose: Render the detached drag overlay DOM for the current scene.
  // How: Delegate to the drag-overlay ADT through the wrapped element collection.
  renderDragOverlay(overlay: TimelineDragOverlay, input: DragOverlayRenderInput): void {
    overlay.render({ ...input, elements: this.#elements });
  }

  // Purpose: Apply one precomputed pan-preview state to the visible timeline DOM layers.
  // How: Update the wrapped transforms and overlay widths from the immutable preview state object.
  applyPanPreview(state: TimelinePanPreviewState): void {
    this.#elements.timelineRulerLabels.style.transform = state.geometryRenderWindowTransform;
    this.#elements.timelineSharedGrid.style.transform = state.geometryRenderWindowTransform;
    this.#elements.timelineGridNegativeOverlay.style.width = `${state.negativeOverlayWidthPx.toFixed(4)}px`;
    this.#elements.timelineRulerNegativeOverlay.style.width = `${state.negativeOverlayWidthPx.toFixed(4)}px`;
    this.#elements.dragOverlayLayer.style.transform = state.dragOverlayTransform;
  }

  // Purpose: Refresh the fixed track-strip views alongside the timeline content.
  // How: Delegate to the Track view renderer through the wrapped element collection.
  renderTrackViews(project: Project, state: TrackViewState): void {
    renderTrackViews(this.#elements, project, state);
  }
}
