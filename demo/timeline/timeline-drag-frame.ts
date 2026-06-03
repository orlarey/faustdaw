/************************ timeline/timeline-drag-frame.ts ************************
 *
 * Purpose: Own the lightweight clip-drag render path independently from the main timeline renderer.
 * How: Decide when the drag frame can stay incremental, fall back to a full timeline frame when needed,
 *      and otherwise redraw only the detached overlay plus the left-column track views.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import type { ExactTimelineScale } from "../time-scale.js";
import { hasEffectiveDragPreview } from "../clip/clip-drag-preview.js";
import { measurePerf } from "../perf.js";
import type { TrackViewState } from "../track/track-render.js";
import { TimelineProjection } from "./timeline-projection.js";
import type { ClipDragRenderContext, TimelineDragOverlay } from "./timeline-drag-overlay.js";
import type { TimelineSceneSurface } from "./timeline-scene-surface.js";
import type { DAWRenderView } from "../view/daw-render-view.js";

type TimelineSceneSurfacePort = Pick<
  TimelineSceneSurface,
  "renderDragOverlay" | "renderTrackViews"
>;

export class TimelineDragFrame {
  static render(input: {
    project: Project;
    view: DAWRenderView;
    dragContext: ClipDragRenderContext;
    presentationInputs: ClipPresentationInputs;
    historyHasRenderedClipWindow: boolean;
    clipRenderStructureDirty: boolean;
    surface: TimelineSceneSurfacePort;
    renderScale: ExactTimelineScale;
    dragOverlay: TimelineDragOverlay;
    trackViewState: TrackViewState;
    markClipRenderStructureDirty(): void;
    renderFallback(): void;
  }): void {
    const dragState = input.dragContext.dragState;
    if (!dragState || !input.historyHasRenderedClipWindow || input.clipRenderStructureDirty) {
      input.renderFallback();
      return;
    }

    const previewDetachedFromBackground = hasEffectiveDragPreview(dragState);
    if (previewDetachedFromBackground !== dragState.previewDetachedFromBackground) {
      dragState.previewDetachedFromBackground = previewDetachedFromBackground;
      input.markClipRenderStructureDirty();
      input.renderFallback();
      return;
    }

    const projection = TimelineProjection.fromView(input.view);
    input.surface.renderDragOverlay(input.dragOverlay, {
      project: input.project,
      projection,
      renderScale: input.renderScale,
      dragContext: input.dragContext,
      presentationInputs: input.presentationInputs,
    });
    measurePerf("render.timeline.trackViews", () => input.surface.renderTrackViews(input.project, input.trackViewState));
  }
}
