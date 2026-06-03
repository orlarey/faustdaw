/************************ timeline/timeline-scene-state.ts ************************
 *
 * Purpose: Own the mutable caches and reset rules local to one timeline scene runtime.
 * How: Keep the drag overlay, surface, render history, and full-reset behavior behind
 *      one ADT so TimelineScene orchestrates rendering instead of carrying cache details.
 *
 ******************************************************************************/
import type { TimeCoord } from "../../src/domain/timebase.js";
import { TimelineDragOverlay } from "./timeline-drag-overlay.js";
import { TimelineRenderHistoryState } from "./timeline-render-history.js";
import type { TimelineSceneSurface } from "./timeline-scene-surface.js";
import { TimelineSurface } from "./timeline-surface.js";
import { WaveformView } from "../waveform-view/waveform-view.js";

type TimelineSceneSurfacePort = Pick<TimelineSceneSurface, "applyPanPreview">;
type TimelineSceneMarkerPort = {
  setPanOffset(offset: number): void;
  updateCursorPosition(coord: TimeCoord): void;
  updateCutPosition(coord: TimeCoord): void;
  getCutPosition(): TimeCoord;
  updateLastPlayPosition(coord: TimeCoord | null): void;
  updateLoopEndPosition(coord: TimeCoord | null): void;
};
type TimelineSceneStatePort = {
  resetStableWindows(): void;
};

export class TimelineSceneState {
  #dragOverlay = new TimelineDragOverlay();
  #surface = new TimelineSurface();
  #history = new TimelineRenderHistoryState();

  dragOverlay(): TimelineDragOverlay {
    return this.#dragOverlay;
  }

  surface(): TimelineSurface {
    return this.#surface;
  }

  history(): TimelineRenderHistoryState {
    return this.#history;
  }

  setPanPreviewOffset(input: {
    surface: TimelineSceneSurfacePort;
    markers: TimelineSceneMarkerPort;
    offsetPx: number;
    hasDetachedDragOverlay: boolean;
    cursorCoord: TimeCoord;
    lastPlayStartCoord: TimeCoord | null;
    loopEndCoord: TimeCoord | null;
  }): void {
    input.surface.applyPanPreview(
      this.#surface.buildPanPreviewState(input.offsetPx, input.hasDetachedDragOverlay),
    );
    input.markers.setPanOffset(input.offsetPx);
    input.markers.updateCursorPosition(input.cursorCoord);
    input.markers.updateCutPosition(input.markers.getCutPosition());
    input.markers.updateLastPlayPosition(input.lastPlayStartCoord);
    input.markers.updateLoopEndPosition(input.loopEndCoord);
  }

  hasRenderedClipWindow(): boolean {
    return this.#history.hasRenderedClipWindow();
  }

  clipRenderStartCoord(): number {
    return this.#surface.clipRenderStartCoord();
  }

  invalidateWaveformSlidingBuffers(): void {
    WaveformView.invalidateBuffers();
    this.#history.clearWaveforms();
  }

  resetForFullRender(state: TimelineSceneStatePort): void {
    state.resetStableWindows();
    // Waveform content lives in the shared grid sliding buffers now.
    // The content painter is re-registered each frame with current project data,
    // so explicit invalidation is only needed for content changes (via invalidateWaveformSlidingBuffers).
    this.#history.reset();
    this.#surface.reset();
  }
}
