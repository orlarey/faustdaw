/************************ timeline/timeline-frame-context.ts ************************
 *
 * Purpose: Prepare one immutable timeline frame context before any DOM effects run.
 * How: Collect the visible view, projection, sliding-buffer frames, render plan, debug
 *      snapshot, and branch sequence into one value so the renderer only applies effects.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import { getTotalClipCount } from "../project-index.js";
import type { ExactTimelineScale } from "../time-scale.js";
import type { TimeScale } from "../time-scale.js";
import { RULER_PAN_COMMIT_THRESHOLD_PX, type DragState, type RulerDragState } from "../gesture/gesture-state.js";
import { GridView, type GridViewFrame } from "../grid-view/grid-view.js";

// Purpose: Set the buffered viewport visible margin so a committed pan never drags beyond the buffered content.
// How: Pick a minimum of 320px and otherwise scale with twice the pan commit threshold.
const BUFFERED_VIEWPORT_VISIBLE_MARGIN_PX = Math.max(320, RULER_PAN_COMMIT_THRESHOLD_PX * 2);
import {
  registerContentPainter,
  clearContentPainter,
} from "../grid-view/grid-view-buffers.js";
import {
  buildWaveformContentPainter,
  buildWaveformContentKey,
  type WaveformViewFrame,
} from "../waveform-view/waveform-view.js";
import { TimelineFramePlanner, type TimelineFramePlan } from "./timeline-frame-plan.js";
import { TimelineFrameSequencer, type TimelineFrameSequence } from "./timeline-frame-sequence.js";
import type { TimelineRenderHistoryState } from "./timeline-render-history.js";
import { TimelineProjection } from "./timeline-projection.js";
import type { PanRenderDebugSnapshot } from "./timeline-debug.js";
import { DAWRenderView } from "../view/daw-render-view.js";

export type TimelineFrameContext = {
  view: DAWRenderView;
  geometry: TimelineProjection;
  renderScale: ExactTimelineScale;
  clipRenderWidthPx: number;
  bufferedDisplayMarginCoord: number;
  freezeGeometryDuringPan: boolean;
  gridFrame: GridViewFrame;
  geometryRenderHeightPx: number;
  geometryRenderWidthPx: number;
  geometryDisplayProjection: TimelineProjection;
  geometryDisplayWidthPx: number;
  framePlan: TimelineFramePlan;
  totalClipCount: number;
  waveformFrame: WaveformViewFrame;
  frameSequence: TimelineFrameSequence;
  panDebugSnapshot: PanRenderDebugSnapshot;
  presentationInputs: ClipPresentationInputs;
};

export class TimelineFrameContextBuilder {
  static prepare(input: {
    project: Project;
    view: DAWRenderView;
    history: TimelineRenderHistoryState;
    timeScale: TimeScale;
    dragState: DragState | null;
    presentationInputs: ClipPresentationInputs;
    rulerDragState: RulerDragState | null;
    keepBufferedGeometryViewportWarm: boolean;
    playbackFollowPreviewOffsetPx: number;
    clipRenderStructureDirty: boolean;
    geometryRenderWindowStartCoord: number | null;
    geometryRenderWindowEndCoord: number | null;
    freezeGeometryDuringPan: boolean;
    gridView?: {
      prepareFrame(input: {
        view: DAWRenderView;
        visibleProjection: TimelineProjection;
        renderScale: ExactTimelineScale;
        useBufferedViewport: boolean;
        bufferedDisplayMarginCoord: number;
        previousDisplayStartCoord: number | null;
        previousDisplayEndCoord: number | null;
      }): GridViewFrame;
    };
    waveformView?: {
      prepareFrame(input: {
        project: Project;
        view: DAWRenderView;
        visibleProjection: TimelineProjection;
        renderScale: ExactTimelineScale;
        useBufferedViewport: boolean;
        bufferedDisplayMarginCoord: number;
        previousDisplayStartCoord: number | null;
        previousDisplayEndCoord: number | null;
      }): WaveformViewFrame;
    };
  }): TimelineFrameContext {
    const geometry = TimelineProjection.fromView(input.view);
    const renderScale = input.timeScale.getScale();
    const clipRenderWidthPx = geometry.canvasWidthPx;
    const bufferedDisplayMarginCoord =
      BUFFERED_VIEWPORT_VISIBLE_MARGIN_PX / Math.max(geometry.pixelsPerCoord, 1e-9);
    const useBufferedGeometryViewport =
      input.dragState !== null
      || input.rulerDragState?.mode === "pan"
      || input.project.timeline.transport === "Playing"
      || input.keepBufferedGeometryViewportWarm;
    // Register the waveform content painter so that when the grid's sliding buffers
    // fill or rotate slots, waveform content is drawn into the same canvases.
    const totalClipCount = getTotalClipCount(input.project);
    if (totalClipCount > 0) {
      registerContentPainter(
        buildWaveformContentPainter(
          input.project,
          geometry,
          renderScale,
          input.dragState,
          input.presentationInputs,
        ),
        buildWaveformContentKey(input.dragState),
      );
    } else {
      clearContentPainter();
    }
    const gridFrame = (input.gridView ?? GridView).prepareFrame({
      view: input.view,
      visibleProjection: geometry,
      renderScale,
      useBufferedViewport: useBufferedGeometryViewport,
      bufferedDisplayMarginCoord,
      previousDisplayStartCoord: input.history.previousGeometryDisplayStartCoord(),
      previousDisplayEndCoord: input.history.previousGeometryDisplayEndCoord(),
    });
    const framePlan = TimelineFramePlanner.build({
      project: input.project,
      view: input.view,
      geometry,
      gridFrame,
      history: input.history.plannerHistory(),
      dragState: input.dragState,
      rulerDragState: input.rulerDragState,
      keepBufferedGeometryViewportWarm: input.keepBufferedGeometryViewportWarm,
      playbackFollowPreviewOffsetPx: input.playbackFollowPreviewOffsetPx,
      clipRenderStructureDirty: input.clipRenderStructureDirty,
      geometryRenderWindowStartCoord: input.geometryRenderWindowStartCoord,
      geometryRenderWindowEndCoord: input.geometryRenderWindowEndCoord,
      freezeGeometryDuringPan: input.freezeGeometryDuringPan,
    });
    // Derive the waveform frame from the grid frame: both share the same unified
    // sliding buffers, so the display window is identical (just with track-only height).
    // Always create the frame even with 0 clips so the track-area grid lines remain visible.
    const waveformFrame: WaveformViewFrame = {
      displayStartCoord: gridFrame.displayStartCoord,
      displayEndCoord: gridFrame.displayEndCoord,
      displayProjection: TimelineProjection.fromCanvasRange(
        input.view,
        gridFrame.displayStartCoord,
        gridFrame.displayEndCoord,
        geometry.canvasHeightPx,
      ),
      windowChanged: gridFrame.windowChanged,
    };
    const waveformDisplayChanged = input.history.waveformDisplayChanged(
      waveformFrame.displayStartCoord,
      waveformFrame.displayEndCoord,
      framePlan.useBufferedWaveformViewport,
    );
    const frameSequence = TimelineFrameSequencer.build({
      framePlan,
      totalClipCount,
      waveformWindowChanged: waveformFrame.windowChanged,
      waveformDisplayChanged,
      clipRenderStructureDirty: input.clipRenderStructureDirty,
      dragActive: input.dragState !== null,
    });

    return {
      view: input.view,
      geometry,
      renderScale,
      clipRenderWidthPx,
      bufferedDisplayMarginCoord,
      freezeGeometryDuringPan: input.freezeGeometryDuringPan,
      gridFrame,
      geometryRenderHeightPx: gridFrame.renderHeightPx,
      geometryRenderWidthPx: gridFrame.renderWidthPx,
      geometryDisplayProjection: gridFrame.displayProjection,
      geometryDisplayWidthPx: gridFrame.displayProjection.canvasWidthPx,
      framePlan,
      totalClipCount,
      waveformFrame,
      frameSequence,
      presentationInputs: input.presentationInputs,
      panDebugSnapshot: {
        geometryChanged: framePlan.geometryChanged,
        clipGeometryChanged: framePlan.clipGeometryChanged,
        geometryWindowChanged: framePlan.geometryWindowChanged,
        clipWindowChanged: framePlan.clipWindowChanged,
        freezeGeometryDuringPan: input.freezeGeometryDuringPan,
        gridWidthPx: geometry.canvasWidthPx,
        geometryRenderWidthPx: gridFrame.renderWidthPx,
        clipRenderWidthPx,
        totalClipCount,
        renderedClipCount: 0,
        viewStartCoord: input.view.viewStartCoord,
        viewEndCoord: input.view.viewEndCoord,
      },
    };
  }
}
