/************************ timeline/timeline-frame-runner.ts ************************
 *
 * Purpose: Orchestrate the post-geometry timeline frame branches from one prepared frame context.
 * How: Dispatch the direct-zoom, empty, steady, and rebuild branches to the existing helper ADTs
 *      so the main timeline renderer stays focused on building context and triggering the frame run.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import { TimelineBranchEffects } from "./timeline-branch-effects.js";
import { TimelineChrome } from "./timeline-chrome.js";
import { TimelineClipEffects } from "./timeline-clip-effects.js";
import type { TimelineFrameContext } from "./timeline-frame-context.js";
import type { ClipDragRenderContext, TimelineDragOverlay } from "./timeline-drag-overlay.js";
import type { TimelineRenderHistoryState } from "./timeline-render-history.js";
import type { TimelineSceneSurface } from "./timeline-scene-surface.js";
import { TimelineSteadyEffects } from "./timeline-steady-effects.js";
import { TimelineSurface } from "./timeline-surface.js";
import type { TrackViewState } from "../track/track-render.js";

export class TimelineFrameRunner {
  static run(input: {
    project: Project;
    frameContext: TimelineFrameContext;
    timelineSurface: TimelineSurface;
    sceneSurface: TimelineSceneSurface;
    history: TimelineRenderHistoryState;
    dragOverlay: TimelineDragOverlay;
    dragContext: ClipDragRenderContext;
    trackViewState: TrackViewState;
    cursorDragActive: boolean;
    rulerDragging: boolean;
    setCursorDragFeedback(text: string | null): void;
    markClipRenderStructureClean(): void;
    setPanPreviewOffset(offsetPx: number): void;
  }): number {
    const {
      project,
      frameContext,
      timelineSurface,
    } = input;
    const { framePlan, geometry, renderScale, view, geometryRenderHeightPx } = frameContext;
    const {
      waveformFrame,
      totalClipCount,
      frameSequence,
      geometryDisplayProjection,
      geometryDisplayWidthPx,
      presentationInputs,
    } = frameContext;

    const directSurfaceFrame = TimelineSurface.buildFrame({
      view,
      visibleProjection: geometry,
      geometryDisplayProjection,
      useBufferedGeometryViewport: framePlan.useBufferedGeometryViewport,
      clipDisplayStartCoord: framePlan.clipDisplayStartCoord,
    });
    timelineSurface.setFrame(directSurfaceFrame);
    const chromeState = TimelineChrome.buildState({
      negativeOverlayWidthPx: timelineSurface.negativeOverlayWidthPx(),
      cursorCoord: project.timeline.cursor,
      timebase: project.timebase,
      pixelsPerSample: renderScale.pixelsPerSample,
      cursorDragActive: input.cursorDragActive,
      rulerDragging: input.rulerDragging,
      rulerLabelsHidden: false,
      rulerLabelsWidthPx: geometryDisplayWidthPx,
    });
    input.sceneSurface.renderChrome(chromeState);
    input.setCursorDragFeedback(chromeState.cursorDragFeedbackText);

    if (frameSequence.mode === "direct-zoom") {
      TimelineBranchEffects.renderDirectZoom({
        project,
        view,
        geometry,
        renderScale,
        geometryRenderHeightPx,
        frameSequence,
        timelineSurface,
        sceneSurface: input.sceneSurface,
        dragOverlay: input.dragOverlay,
        dragContext: input.dragContext,
        presentationInputs,
        trackViewState: input.trackViewState,
        cursorDragActive: input.cursorDragActive,
        rulerDragging: input.rulerDragging,
        setCursorDragFeedback: input.setCursorDragFeedback,
        setPanPreviewOffset: input.setPanPreviewOffset,
      });
      return 0;
    }

    timelineSurface.syncFrame({
      view,
      visibleProjection: geometry,
      geometryDisplayProjection,
      useBufferedGeometryViewport: framePlan.useBufferedGeometryViewport,
      clipDisplayStartCoord: framePlan.clipDisplayStartCoord,
    });

    if (frameSequence.mode === "steady") {
      TimelineSteadyEffects.render({
        project,
        geometry,
        renderScale,
        framePlan,
        frameSequence,
        waveformFrame,
        history: input.history,
        dragOverlay: input.dragOverlay,
        dragContext: input.dragContext,
        presentationInputs,
        trackViewState: input.trackViewState,
        setPanPreviewOffset: input.setPanPreviewOffset,
        surface: input.sceneSurface,
      });
      return 0;
    }

    return TimelineClipEffects.renderRebuild({
      project,
      viewStartCoord: view.viewStartCoord,
      viewEndCoord: view.viewEndCoord,
      geometry,
      renderScale,
      framePlan,
      frameSequence,
      waveformFrame,
      totalClipCount,
      dragContext: input.dragContext,
      presentationInputs,
      trackViewState: input.trackViewState,
      history: input.history,
      surface: input.sceneSurface,
      dragOverlay: input.dragOverlay,
      setPanPreviewOffset: input.setPanPreviewOffset,
      markClipRenderStructureClean: input.markClipRenderStructureClean,
    }).renderedClipCount;
  }
}
