/************************ timeline/timeline-branch-effects.ts ************************
 *
 * Purpose: Own the specialized timeline branches that bypass the normal buffered clip pipeline.
 * How: Hide the direct-zoom and empty-timeline DOM effects behind one helper so the
 *      main timeline renderer only dispatches by branch mode.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import type { ExactTimelineScale } from "../time-scale.js";
import type { TimelineFramePlan } from "./timeline-frame-plan.js";
import type { TimelineFrameSequence } from "./timeline-frame-sequence.js";
import { TimelineProjection } from "./timeline-projection.js";
import type { TimelineRenderHistoryState } from "./timeline-render-history.js";
import type { TimelineSceneSurface } from "./timeline-scene-surface.js";
import type { TimelineSurface } from "./timeline-surface.js";
import type { ClipDragRenderContext, TimelineDragOverlay } from "./timeline-drag-overlay.js";
import type { TrackViewState } from "../track/track-render.js";
import { TimelineChrome } from "./timeline-chrome.js";
import type { DAWRenderView } from "../view/daw-render-view.js";
import { TimelineFrameEffects } from "./timeline-frame-effects.js";
import { buildBufferedRulerModels } from "../ruler-labels.js";

type TimelineSceneSurfacePort = Pick<
  TimelineSceneSurface,
  | "renderChrome"
  | "renderDirectGridFrame"
  | "renderDirectWaveforms"
  | "clearDragOverlay"
  | "renderTrackViews"
>;

export class TimelineBranchEffects {
  static renderDirectZoom(input: {
    project: Project;
    view: DAWRenderView;
    geometry: TimelineProjection;
    renderScale: ExactTimelineScale;
    geometryRenderHeightPx: number;
    frameSequence: TimelineFrameSequence;
    timelineSurface: TimelineSurface;
    sceneSurface: TimelineSceneSurfacePort;
    dragOverlay: TimelineDragOverlay;
    dragContext: ClipDragRenderContext;
    presentationInputs: ClipPresentationInputs;
    trackViewState: TrackViewState;
    cursorDragActive: boolean;
    rulerDragging: boolean;
    setCursorDragFeedback(text: string | null): void;
    setPanPreviewOffset(offsetPx: number): void;
  }): void {
    const directGridProjection = TimelineProjection.fromCanvasRange(
      input.view,
      input.view.viewStartCoord,
      input.view.viewEndCoord,
      input.geometryRenderHeightPx,
    );
    const directRulerModels = buildBufferedRulerModels(
      input.renderScale,
      directGridProjection.canvasStartCoord,
      directGridProjection.canvasEndCoord,
      directGridProjection.canvasWidthPx,
      directGridProjection.pixelsPerCoord,
    );
    input.sceneSurface.renderDirectGridFrame(directGridProjection, input.renderScale, directRulerModels, input.geometryRenderHeightPx);
    input.timelineSurface.syncFrame({
      view: input.view,
      visibleProjection: input.geometry,
      geometryDisplayProjection: directGridProjection,
      useBufferedGeometryViewport: false,
      clipDisplayStartCoord: input.view.viewStartCoord,
    });
    const branchChromeState = TimelineChrome.buildState({
      negativeOverlayWidthPx: input.timelineSurface.negativeOverlayWidthPx(),
      cursorCoord: input.project.timeline.cursor,
      timebase: input.project.timebase,
      pixelsPerSample: input.renderScale.pixelsPerSample,
      cursorDragActive: input.cursorDragActive,
      rulerDragging: input.rulerDragging,
      rulerLabelsHidden: true,
      rulerLabelsWidthPx: input.geometry.canvasWidthPx,
    });
    input.sceneSurface.renderChrome(branchChromeState);
    input.setCursorDragFeedback(branchChromeState.cursorDragFeedbackText);
    // Always render direct waveforms during zoom — this also draws track-area grid lines.
    input.sceneSurface.renderDirectWaveforms(
      input.project,
      input.geometry,
      input.renderScale,
      input.dragContext.dragState,
      input.presentationInputs,
    );
    input.sceneSurface.clearDragOverlay(input.dragOverlay);
    input.setPanPreviewOffset(0);
    input.sceneSurface.renderTrackViews(input.project, input.trackViewState);
  }

  static renderEmpty(input: {
    project: Project;
    view: DAWRenderView;
    geometry: TimelineProjection;
    renderScale: ExactTimelineScale;
    framePlan: TimelineFramePlan;
    timelineSurface: TimelineSurface;
    sceneSurface: TimelineSceneSurfacePort;
    history: TimelineRenderHistoryState;
    dragOverlay: TimelineDragOverlay;
    trackViewState: TrackViewState;
    markClipRenderStructureClean(): void;
    setPanPreviewOffset(offsetPx: number): void;
  }): void {
    TimelineFrameEffects.clearWaveforms({
      history: input.history,
    });
    input.timelineSurface.syncFrame({
      view: input.view,
      visibleProjection: input.geometry,
      geometryDisplayProjection: input.geometry,
      useBufferedGeometryViewport: input.framePlan.useBufferedGeometryViewport,
      clipDisplayStartCoord: input.framePlan.clipDisplayStartCoord,
    });
    input.sceneSurface.clearDragOverlay(input.dragOverlay);
    input.markClipRenderStructureClean();
    input.setPanPreviewOffset(input.framePlan.previewOffsetPx);
    input.sceneSurface.renderTrackViews(input.project, input.trackViewState);
  }
}
