/******************************** timeline/timeline-scene.ts ********************************
 *
 * Purpose: Own the internal timeline scene runtime behind the public Timeline facade.
 * How: Keep scene-local caches and delegate frame planning, geometry rebuilds,
 *      layered rendering, waveform refreshes, and drag-only redraws.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { TimeCoord } from "../../src/domain/timebase.js";
import type { Elements } from "../bind-elements.js";
import { captureClipPresentationInputs, type ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import { demoState } from "../state.js";
import { CLIP_ALIGNMENT_GUIDE_MAGNETISM_PX } from "../magnetism.js";
import type { DragState, RulerDragState } from "../gesture/gesture-state.js";
import { markerManager } from "../marker/marker-manager.js";
import { View } from "../view/view.js";
import { getTotalClipCount } from "../project-index.js";
import { measurePerf } from "../perf.js";
import type { ClipDragRenderContext } from "./timeline-drag-overlay.js";
import { TimelineFrameContextBuilder } from "./timeline-frame-context.js";
import { TimelineFrameRunner } from "./timeline-frame-runner.js";
import { TimelineGeometryEffects } from "./timeline-geometry-effects.js";
import { TimelineDragFrame } from "./timeline-drag-frame.js";
import type { TrackViewState } from "../track/track-render.js";
import { TimelineSceneState } from "./timeline-scene-state.js";
import { TimelineSceneSurface } from "./timeline-scene-surface.js";
import { TimelineWaveformPreview } from "./timeline-waveform-preview.js";
import type { ExactTimelineScale, TimeScale } from "../time-scale.js";
import type { DAWRenderView } from "../view/daw-render-view.js";
import {
  getPanRenderDebugSnapshot as _getPanRenderDebugSnapshot,
  setLatestPanRenderDebugSnapshot,
} from "./timeline-debug.js";

const timelineSceneState = new TimelineSceneState();

type TimelineSceneMarkerPort = {
  isCursorDragging(): boolean;
  setCursorDragFeedback(text: string | null): void;
  setPanOffset(offset: number): void;
  updateCursorPosition(coord: TimeCoord): void;
  updateCutPosition(coord: TimeCoord): void;
  getCutPosition(): TimeCoord;
  updateLastPlayPosition(coord: TimeCoord | null): void;
  updateLoopEndPosition(coord: TimeCoord | null): void;
};

type TimelineSceneRenderState = {
  view: DAWRenderView;
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
  exactTimelineZoomLevelIndex: number;
  alignmentGuideMagnetismPx: number;
  selectedClipId: string | null;
  lastPlayStartCoord: TimeCoord | null;
  loopEndCoord: TimeCoord | null;
  markers: TimelineSceneMarkerPort;
  setClipRenderStructureDirty(dirty: boolean): void;
  setGeometryDisplayWindow(startCoord: TimeCoord, endCoord: TimeCoord): void;
};

type TimelineSceneClipDragState = {
  project: Project;
  view: DAWRenderView;
  dragState: DragState | null;
  presentationInputs: ClipPresentationInputs;
  clipRenderStructureDirty: boolean;
  renderScale: ExactTimelineScale;
  exactTimelineZoomLevelIndex: number;
  alignmentGuideMagnetismPx: number;
  selectedClipId: string | null;
  setClipRenderStructureDirty(dirty: boolean): void;
  renderFallback(): void;
};

type TimelineSceneWaveformPreviewState = {
  project: Project;
  view: DAWRenderView;
  renderScale: ExactTimelineScale;
  totalClipCount: number;
  dragState: DragState | null;
  presentationInputs: ClipPresentationInputs;
  lastPlayStartCoord: TimeCoord | null;
  loopEndCoord: TimeCoord | null;
  markers: TimelineSceneMarkerPort;
};

// Purpose: Represent the internal scene runtime that owns timeline-local caches and layered drawing.
// How: Expose one class boundary so the public Timeline facade can delegate to one internal ADT.
export class TimelineScene {
  // Purpose: Read the latest pan-render debug snapshot owned by the scene runtime.
  // How: Forward the cached snapshot from the timeline debug module.
  static getPanRenderDebugSnapshot() {
    return _getPanRenderDebugSnapshot();
  }

  // Purpose: Apply a temporary horizontal translation to the timeline content during an interactive pan.
  // How: Move every time-dependent layer together with a CSS transform, without recomputing clip geometry.
  static setPanPreviewOffsetOnSurface(input: {
    sceneSurface: TimelineSceneSurface;
    offsetPx: number;
    dragState: DragState | null;
    cursorCoord: TimeCoord;
    lastPlayStartCoord: TimeCoord | null;
    loopEndCoord: TimeCoord | null;
    markers: TimelineSceneMarkerPort;
  }): void {
    timelineSceneState.setPanPreviewOffset({
      surface: input.sceneSurface,
      markers: input.markers,
      offsetPx: input.offsetPx,
      hasDetachedDragOverlay: input.dragState !== null,
      cursorCoord: input.cursorCoord,
      lastPlayStartCoord: input.lastPlayStartCoord,
      loopEndCoord: input.loopEndCoord,
    });
  }

  static setPanPreviewOffset(elements: Elements, offsetPx: number): void {
    TimelineScene.setPanPreviewOffsetOnSurface({
      sceneSurface: TimelineSceneSurface.fromElements(elements),
      offsetPx,
      dragState: demoState.dragState,
      cursorCoord: demoState.project.timeline.cursor,
      lastPlayStartCoord: demoState.lastPlayStartCoord,
      loopEndCoord: demoState.playSelection.loopRange?.endCoord as TimeCoord ?? null,
      markers: markerManager(),
    });
  }

  // Purpose: Build one drag-overlay render context bound to the given clip render origin.
  // How: Group the current drag state with the clip origin, magnetism radius, and zoom level.
  static #buildDragContext(input: {
    dragState: DragState | null;
    clipRenderStartCoord: TimeCoord;
    alignmentGuideMagnetismPx: number;
    exactTimelineZoomLevelIndex: number;
  }): ClipDragRenderContext {
    return {
      dragState: input.dragState,
      clipRenderStartCoord: input.clipRenderStartCoord,
      alignmentGuideMagnetismPx: input.alignmentGuideMagnetismPx,
      exactTimelineZoomLevelIndex: input.exactTimelineZoomLevelIndex,
    };
  }

  static #buildTrackViewState(input: {
    dragContext: ClipDragRenderContext;
    selectedClipId: string | null;
  }): TrackViewState {
    return {
      dragContext: input.dragContext,
      selectedClipId: input.selectedClipId,
    };
  }

  static renderOnSurface(
    sceneSurface: TimelineSceneSurface,
    current: Project,
    state: TimelineSceneRenderState,
  ): void {
    const frameContext = TimelineFrameContextBuilder.prepare({
      project: current,
      view: state.view,
      history: timelineSceneState.history(),
      timeScale: state.timeScale,
      dragState: state.dragState,
      presentationInputs: state.presentationInputs,
      rulerDragState: state.rulerDragState,
      keepBufferedGeometryViewportWarm: state.keepBufferedGeometryViewportWarm,
      playbackFollowPreviewOffsetPx: state.playbackFollowPreviewOffsetPx,
      clipRenderStructureDirty: state.clipRenderStructureDirty,
      geometryRenderWindowStartCoord: state.geometryRenderWindowStartCoord,
      geometryRenderWindowEndCoord: state.geometryRenderWindowEndCoord,
      freezeGeometryDuringPan: state.freezeGeometryDuringPan,
    });
    state.setGeometryDisplayWindow(
      frameContext.gridFrame.displayStartCoord,
      frameContext.gridFrame.displayEndCoord,
    );
    const { framePlan, geometry, gridFrame, renderScale, view } = frameContext;
    const { geometryRenderWidthPx } = frameContext;
    const { panDebugSnapshot } = frameContext;
    setLatestPanRenderDebugSnapshot(panDebugSnapshot);

    TimelineGeometryEffects.renderRebuild({
      enabled: framePlan.geometryChanged || !framePlan.freezeBackgroundRasterDuringInteraction,
      surface: sceneSurface,
      gridFrame,
      renderScale,
      geometry,
      view,
      framePlan,
      history: timelineSceneState.history(),
      geometryRenderWindowStartCoord: state.geometryRenderWindowStartCoord,
      geometryRenderWindowEndCoord: state.geometryRenderWindowEndCoord,
      geometryRenderWidthPx,
      totalClipCount: getTotalClipCount(current),
    });
    const dragContext = TimelineScene.#buildDragContext({
      dragState: state.dragState,
      clipRenderStartCoord: view.viewStartCoord,
      alignmentGuideMagnetismPx: state.alignmentGuideMagnetismPx,
      exactTimelineZoomLevelIndex: state.exactTimelineZoomLevelIndex,
    });
    const trackViewState = TimelineScene.#buildTrackViewState({
      dragContext,
      selectedClipId: state.selectedClipId,
    });
    panDebugSnapshot.renderedClipCount = TimelineFrameRunner.run({
      project: current,
      frameContext,
      timelineSurface: timelineSceneState.surface(),
      sceneSurface,
      history: timelineSceneState.history(),
      dragOverlay: timelineSceneState.dragOverlay(),
      dragContext,
      trackViewState,
      cursorDragActive: state.markers.isCursorDragging(),
      rulerDragging: state.rulerDragState !== null,
      setCursorDragFeedback: (text) => state.markers.setCursorDragFeedback(text),
      markClipRenderStructureClean: () => state.setClipRenderStructureDirty(false),
      setPanPreviewOffset: (offsetPx) => TimelineScene.setPanPreviewOffsetOnSurface({
        sceneSurface,
        offsetPx,
        dragState: state.dragState,
        cursorCoord: current.timeline.cursor,
        lastPlayStartCoord: state.lastPlayStartCoord,
        loopEndCoord: state.loopEndCoord,
        markers: state.markers,
      }),
    });
  }

  static renderClipDragOnSurface(
    sceneSurface: TimelineSceneSurface,
    state: TimelineSceneClipDragState,
  ): void {
    const dragContext = TimelineScene.#buildDragContext({
      dragState: state.dragState,
      clipRenderStartCoord: timelineSceneState.clipRenderStartCoord(),
      alignmentGuideMagnetismPx: state.alignmentGuideMagnetismPx,
      exactTimelineZoomLevelIndex: state.exactTimelineZoomLevelIndex,
    });
    const trackViewState = TimelineScene.#buildTrackViewState({
      dragContext,
      selectedClipId: state.selectedClipId,
    });
    TimelineDragFrame.render({
      project: state.project,
      view: state.view,
      dragContext,
      presentationInputs: state.presentationInputs,
      historyHasRenderedClipWindow: timelineSceneState.hasRenderedClipWindow(),
      clipRenderStructureDirty: state.clipRenderStructureDirty,
      surface: sceneSurface,
      renderScale: state.renderScale,
      dragOverlay: timelineSceneState.dragOverlay(),
      trackViewState,
      markClipRenderStructureDirty: () => state.setClipRenderStructureDirty(true),
      renderFallback: state.renderFallback,
    });
  }

  static renderWaveformPreviewOnSurface(
    sceneSurface: TimelineSceneSurface,
    state: TimelineSceneWaveformPreviewState,
  ): void {
    TimelineWaveformPreview.render({
      project: state.project,
      view: state.view,
      renderScale: state.renderScale,
      totalClipCount: state.totalClipCount,
      dragState: state.dragState,
      presentationInputs: state.presentationInputs,
      sceneSurface,
      timelineSurface: timelineSceneState.surface(),
      setPanPreviewOffset: (offsetPx) => TimelineScene.setPanPreviewOffsetOnSurface({
        sceneSurface,
        offsetPx,
        dragState: state.dragState,
        cursorCoord: state.project.timeline.cursor,
        lastPlayStartCoord: state.lastPlayStartCoord,
        loopEndCoord: state.loopEndCoord,
        markers: state.markers,
      }),
    });
  }

  // Purpose: Render the full timeline area: grid, ruler, playhead, clips, and track views.
  // How: Compute the pixel geometry from the view window, draw grid lines and ruler, position clips and the playhead.
  static render(elements: Elements, current: Project): void {
    measurePerf("renderTimeline", () => {
      View.syncExactTimelineViewport(elements);
      const sceneSurface = TimelineSceneSurface.fromElements(elements);
      TimelineScene.renderOnSurface(sceneSurface, current, {
        view: View.captureRenderView(),
        timeScale: demoState.viewport.timeScale,
        dragState: demoState.dragState,
        presentationInputs: captureClipPresentationInputs(),
        rulerDragState: demoState.rulerDragState,
        keepBufferedGeometryViewportWarm: demoState.geometryWindow.keepWarm,
        playbackFollowPreviewOffsetPx: demoState.transportLoop.previewOffsetPx,
        clipRenderStructureDirty: demoState.clipRenderStable.dirty,
        geometryRenderWindowStartCoord: demoState.geometryWindow.renderStart,
        geometryRenderWindowEndCoord: demoState.geometryWindow.renderEnd,
        freezeGeometryDuringPan:
          demoState.devFlags.freezeGeometryDuringPan && demoState.rulerDragState?.mode === "pan",
        exactTimelineZoomLevelIndex: demoState.viewport.timeScale.zoomLevelIndex,
        alignmentGuideMagnetismPx: CLIP_ALIGNMENT_GUIDE_MAGNETISM_PX,
        selectedClipId: demoState.selection.primaryId,
        lastPlayStartCoord: demoState.lastPlayStartCoord,
        loopEndCoord: demoState.playSelection.loopRange?.endCoord as TimeCoord ?? null,
        markers: markerManager(),
        setClipRenderStructureDirty: (dirty) => {
          demoState.clipRenderStable.dirty = dirty;
        },
        setGeometryDisplayWindow: (startCoord, endCoord) => {
          demoState.geometryWindow.displayStart = startCoord;
          demoState.geometryWindow.displayEnd = endCoord;
        },
      });
    });
  }

  // Purpose: Perform the minimal DOM work needed while dragging a clip inside a fixed viewport.
  // How: Update only the dragged clip element and the left-column track highlight, without rebuilding ruler or grid geometry.
  static renderClipDrag(elements: Elements): void {
    measurePerf("renderClipDragFrame", () => {
      const sceneSurface = TimelineSceneSurface.fromElements(elements);
      View.syncExactTimelineViewport(elements);
      TimelineScene.renderClipDragOnSurface(sceneSurface, {
        project: demoState.project,
        view: View.captureRenderView(),
        dragState: demoState.dragState,
        presentationInputs: captureClipPresentationInputs(),
        clipRenderStructureDirty: demoState.clipRenderStable.dirty,
        renderScale: demoState.viewport.timeScale.getScale(),
        exactTimelineZoomLevelIndex: demoState.viewport.timeScale.zoomLevelIndex,
        alignmentGuideMagnetismPx: CLIP_ALIGNMENT_GUIDE_MAGNETISM_PX,
        selectedClipId: demoState.selection.primaryId,
        setClipRenderStructureDirty: (dirty) => {
          demoState.clipRenderStable.dirty = dirty;
        },
        renderFallback: () => {
          TimelineScene.render(elements, demoState.project);
        },
      });
    });
  }

  // Purpose: Refresh only the visible waveform scene slice after waveform data arrives asynchronously.
  // How: Redraw only the waveform viewport while preserving the rest of the scene caches.
  static renderWaveformPreview(elements: Elements): void {
    View.syncExactTimelineViewport(elements);
    const sceneSurface = TimelineSceneSurface.fromElements(elements);
    TimelineScene.renderWaveformPreviewOnSurface(sceneSurface, {
      project: demoState.project,
      view: View.captureRenderView(),
      renderScale: demoState.viewport.timeScale.getScale(),
      totalClipCount: getTotalClipCount(demoState.project),
      dragState: demoState.dragState,
      presentationInputs: captureClipPresentationInputs(),
      lastPlayStartCoord: demoState.lastPlayStartCoord,
      loopEndCoord: demoState.playSelection.loopRange?.endCoord as TimeCoord ?? null,
      markers: markerManager(),
    });
  }

  // Purpose: Drop the cached sliding waveform buffers after waveform data changes asynchronously.
  // How: Forget the current buffer chain so the next timeline frame rebuilds it from the latest resource waveform data.
  static invalidateWaveformSlidingBuffers(): void {
    timelineSceneState.invalidateWaveformSlidingBuffers();
  }

  // Purpose: Reset every scene-local cache before one full DAW render pass.
  // How: Forget stable render windows, buffered geometry hints, waveform buffers, and surface transforms.
  static resetForFullRender(): void {
    timelineSceneState.resetForFullRender({
      resetStableWindows: () => {
        demoState.clipRenderStable.startCoord = null;
        demoState.clipRenderStable.endCoord = null;
        demoState.clipRenderStable.dirty = false;
        demoState.geometryWindow.stableStart = null;
        demoState.geometryWindow.stableEnd = null;
        demoState.geometryWindow.displayStart = null;
        demoState.geometryWindow.displayEnd = null;
        demoState.geometryWindow.keepWarm = false;
      },
    });
  }
}
