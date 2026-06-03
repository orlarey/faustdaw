/******************************** timeline/timeline-frame-plan.ts ********************************
 *
 * Purpose: Compute one immutable timeline frame plan from view state, interaction state, and render history.
 * How: Centralize the buffered/direct viewport choices, clip-visual refresh policy, and change detection
 *      so the timeline renderer only orchestrates sub-systems instead of re-deriving those booleans inline.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { TimeCoord } from "../../src/domain/timebase.js";
import type { GridViewFrame } from "../grid-view/grid-view.js";
import type { DragState, RulerDragState } from "../gesture/gesture-state.js";
import type { TimelineProjection } from "./timeline-projection.js";
import { DAWRenderView } from "../view/daw-render-view.js";

export type TimelineRenderHistory = {
  lastRenderedGeometryWindowStartCoord: number | null;
  lastRenderedGeometryWindowEndCoord: number | null;
  lastRenderedGeometryPixelsPerCoord: number | null;
  lastRenderedGeometryGridWidthPx: number | null;
  lastRenderedGeometryDisplayStartCoord: number | null;
  lastRenderedGeometryDisplayEndCoord: number | null;
  lastRenderedGeometryBufferedViewport: boolean | null;
  lastRenderedClipWindowStartCoord: number | null;
  lastRenderedClipWindowEndCoord: number | null;
  lastRenderedClipPixelsPerCoord: number | null;
  lastRenderedClipGridHeightPx: number | null;
};

export type TimelineFramePlan = {
  rulerGestureMode: RulerDragState["mode"] | null;
  freezeDuringPlaybackFollow: boolean;
  useBufferedGeometryViewport: boolean;
  useBufferedWaveformViewport: boolean;
  previewOffsetPx: number;
  freezeBackgroundRasterDuringInteraction: boolean;
  freezeClipVisualsDuringInteraction: boolean;
  shouldRefreshClipVisuals: boolean;
  useDirectZoomViewportRendering: boolean;
  clipDisplayStartCoord: TimeCoord;
  geometryChanged: boolean;
  geometryWindowChanged: boolean;
  clipWindowChanged: boolean;
  clipGeometryChanged: boolean;
};

// Purpose: Represent the pure decision tree that determines how one timeline frame should be rendered.
// How: Derive one immutable plan from interaction flags, render history, and the current view/projection snapshots.
export class TimelineFramePlanner {
  static build(input: {
    project: Project;
    view: DAWRenderView;
    geometry: TimelineProjection;
    gridFrame: GridViewFrame;
    history: TimelineRenderHistory;
    dragState: DragState | null;
    rulerDragState: RulerDragState | null;
    keepBufferedGeometryViewportWarm: boolean;
    playbackFollowPreviewOffsetPx: number;
    clipRenderStructureDirty: boolean;
    geometryRenderWindowStartCoord: number | null;
    geometryRenderWindowEndCoord: number | null;
    freezeGeometryDuringPan: boolean;
  }): TimelineFramePlan {
    const rulerGestureMode = input.rulerDragState?.mode ?? null;
    const freezeDuringPlaybackFollow = input.project.timeline.transport === "Playing";
    const useBufferedGeometryViewport =
      input.dragState !== null
      || rulerGestureMode === "pan"
      || freezeDuringPlaybackFollow
      || input.keepBufferedGeometryViewportWarm;
    // Waveform and geometry share unified sliding buffers, so both use the same viewport strategy.
    const useBufferedWaveformViewport = useBufferedGeometryViewport;
    const previewOffsetPx = rulerGestureMode === "pan" && input.rulerDragState
      ? input.rulerDragState.panPreviewOffsetPx
      : freezeDuringPlaybackFollow
        ? input.playbackFollowPreviewOffsetPx
        : 0;
    const freezeBackgroundRasterDuringInteraction =
      input.dragState !== null || rulerGestureMode === "pan" || freezeDuringPlaybackFollow;
    const freezeClipVisualsDuringInteraction =
      input.dragState !== null
      || rulerGestureMode === "pan"
      || rulerGestureMode === "zoom"
      || freezeDuringPlaybackFollow;
    const shouldRefreshClipVisuals =
      !freezeClipVisualsDuringInteraction || input.clipRenderStructureDirty;
    const useDirectZoomViewportRendering = rulerGestureMode === "zoom";
    const clipDisplayStartCoord = freezeClipVisualsDuringInteraction && input.history.lastRenderedClipWindowStartCoord !== null
      ? input.history.lastRenderedClipWindowStartCoord
      : input.view.viewStartCoord;
    const geometryWindowChanged = input.gridFrame.windowChanged;
    const geometryChanged =
      input.history.lastRenderedGeometryWindowStartCoord !== input.geometryRenderWindowStartCoord
      || input.history.lastRenderedGeometryWindowEndCoord !== input.geometryRenderWindowEndCoord
      || input.history.lastRenderedGeometryPixelsPerCoord !== input.geometry.pixelsPerCoord
      || input.history.lastRenderedGeometryGridWidthPx !== input.geometry.canvasWidthPx
      || input.history.lastRenderedGeometryDisplayStartCoord !== input.gridFrame.displayStartCoord
      || input.history.lastRenderedGeometryDisplayEndCoord !== input.gridFrame.displayEndCoord
      || input.history.lastRenderedGeometryBufferedViewport !== useBufferedGeometryViewport
      || geometryWindowChanged;
    const clipWindowChanged =
      input.history.lastRenderedClipWindowStartCoord !== input.view.viewStartCoord
      || input.history.lastRenderedClipWindowEndCoord !== input.view.viewEndCoord;
    const clipGeometryChanged =
      (shouldRefreshClipVisuals && clipWindowChanged)
      || (shouldRefreshClipVisuals && input.history.lastRenderedClipPixelsPerCoord !== input.geometry.pixelsPerCoord)
      || (shouldRefreshClipVisuals && input.history.lastRenderedClipGridHeightPx !== input.geometry.canvasHeightPx)
      || input.clipRenderStructureDirty;

    return {
      rulerGestureMode,
      freezeDuringPlaybackFollow,
      useBufferedGeometryViewport,
      useBufferedWaveformViewport,
      previewOffsetPx,
      freezeBackgroundRasterDuringInteraction,
      freezeClipVisualsDuringInteraction,
      shouldRefreshClipVisuals,
      useDirectZoomViewportRendering,
      clipDisplayStartCoord,
      geometryChanged,
      geometryWindowChanged,
      clipWindowChanged,
      clipGeometryChanged,
    };
  }
}
