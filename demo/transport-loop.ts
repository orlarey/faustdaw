/******************************* transport-loop.ts ****************************
 *
 * Purpose: Own the real-time transport animation loop. Drives the transport
 *          cursor forward in lock-step with the audio clock via
 *          requestAnimationFrame, handles Play Selection looping, and
 *          maintains the follow-mode preview offset so the view keeps the
 *          cursor centred while scrolling smoothly.
 * How: Implemented as a class so the interface (start, stop, reset,
 *      getter for preview offset) is visible at a glance. The rAF handle,
 *      frame timestamps, and preview offset are private. `#step` is the
 *      recursive rAF body; `#updatePlaybackFollowPreview` is the per-frame
 *      viewport adjustment.
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import { seek } from "../src/domain/transport.js";
import { demoState } from "./state.js";
import { recordPerfCounter } from "./perf.js";
import { renderFrame } from "./daw-render/daw-render-runtime.js";
import { commitTimelinePreviewOffset } from "./view/viewport-commit.js";
import { presetTrackingSystem } from "./preset-tracking.js";

export class TransportLoop {
  #frameId: number | null = null;
  #timestamp: number | null = null;
  #lastFrameTimestamp: number | null = null;
  #previewOffsetPx: number = 0;

  // -------------------------------------------------------------------------
  // Read access
  // -------------------------------------------------------------------------

  /** Current follow-mode preview offset in pixels (read by the render pipeline). */
  get previewOffsetPx(): number {
    return this.#previewOffsetPx;
  }

  /** Last rAF timestamp observed by the loop, or null when the loop is idle. */
  get timestamp(): number | null {
    return this.#timestamp;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Purpose: Start the real-time transport loop when playback becomes active.
   * How: Reset the frame timestamps and schedule the first animation frame once.
   */
  startIfNeeded(elements: Elements): void {
    if (demoState.project.timeline.transport !== "Playing" || this.#frameId !== null) {
      return;
    }
    this.#timestamp = null;
    this.#lastFrameTimestamp = null;
    this.#frameId = requestAnimationFrame((timestamp) => this.#step(timestamp, elements));
  }

  /**
   * Purpose: Cancel the real-time transport loop.
   * How: Cancel the pending animation frame, clear loop bookkeeping, and commit
   *      any pending playback-follow preview offset so the view does not jump.
   *      Stops the playback session and silent audio engine on the way out.
   */
  stop(elements?: Elements): void {
    if (this.#frameId !== null) {
      cancelAnimationFrame(this.#frameId);
    }
    this.#frameId = null;
    this.#timestamp = null;
    if (this.#previewOffsetPx !== 0 && elements) {
      const gridWidthPx = demoState.viewport.gridWidthPx;
      if (gridWidthPx > 0) {
        commitTimelinePreviewOffset(this.#previewOffsetPx, gridWidthPx, elements, true);
      }
    }
    this.#previewOffsetPx = 0;
    demoState.playbackSession.stop();
    demoState.audio.stopSilent();
  }

  /**
   * Purpose: Reset the loop's timing counters and preview offset.
   * How: Called by PlaybackSession.start when a fresh audio session begins —
   *      the next frame should measure from the new start, not from the
   *      previous session's last tick.
   */
  resetTimingCounters(): void {
    this.#timestamp = null;
    this.#lastFrameTimestamp = null;
    this.#previewOffsetPx = 0;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Purpose: Advance one animation frame of transport playback in real time.
   * How: Sample the audio-clock session, update the transport cursor from that
   *      clock, loop back if needed, refresh the follow preview, and rerender.
   */
  #step(timestamp: number, elements: Elements): void {
    if (demoState.project.timeline.transport !== "Playing") {
      this.#lastFrameTimestamp = null;
      this.stop(elements);
      return;
    }

    if (this.#lastFrameTimestamp !== null) {
      recordPerfCounter("transport.frameDeltaMs", timestamp - this.#lastFrameTimestamp);
    }
    this.#lastFrameTimestamp = timestamp;

    const audioContext = demoState.audio.context;
    if (demoState.playbackSession.isActive && audioContext?.state === "running") {
      this.#timestamp = timestamp;
      const targetCursor = demoState.scheduler.transportCoordAt(audioContext.currentTime);
      if (targetCursor !== demoState.project.timeline.cursor) {
        demoState.project = seek(demoState.project, targetCursor);
      }

      // Loop back to start when the cursor reaches the end of the play-selection range.
      const loopRange = demoState.playSelection.loopRange;
      if (loopRange && demoState.project.timeline.cursor >= loopRange.endCoord) {
        demoState.project = seek(demoState.project, loopRange.startCoord);
        demoState.playbackSession.stop();
        // Soft restart : do NOT reset Faust DSP state, so reverb tails
        // and delay lines continue smoothly across the loop boundary.
        demoState.playbackSession.start({ resetEffects: false });
      }
    }

    if (demoState.project.timeline.transport === "Playing") {
      this.#updatePlaybackFollowPreview(elements);
    }

    // Background preset promotion evaluation. Fire-and-forget : errors inside
    // the tracker system are swallowed to keep the render frame steady.
    // NB: `timestamp` is performance.now()-based, but the tracker's
    // recordCommit uses Date.now(). We let tick fall back to its default
    // (Date.now()) so the two clocks stay aligned.
    void presetTrackingSystem.tick();

    renderFrame(elements);
    this.#frameId = requestAnimationFrame((nextTimestamp) => this.#step(nextTimestamp, elements));
  }

  #updatePlaybackFollowPreview(elements: Elements): void {
    if (demoState.project.timeline.transport !== "Playing") {
      this.#previewOffsetPx = 0;
      return;
    }

    const vp = demoState.viewport;
    const gridWidthPx = vp.gridWidthPx > 0 ? vp.gridWidthPx : 0;
    if (gridWidthPx <= 0 || vp.viewDurationCoord <= 0) {
      this.#previewOffsetPx = 0;
      return;
    }

    const exactGridWidthPx = vp.timeScale.getGridWidthPx(gridWidthPx);
    if (exactGridWidthPx <= 0) {
      this.#previewOffsetPx = 0;
      return;
    }

    const pixelsPerCoord = exactGridWidthPx / vp.viewDurationCoord;
    let previewOffsetPx = vp.getPlaybackFollowPreviewOffset(demoState.project.timeline.cursor) * pixelsPerCoord;
    if (previewOffsetPx !== 0) {
      const commitResult = commitTimelinePreviewOffset(previewOffsetPx, gridWidthPx, elements);
      previewOffsetPx = commitResult.committed
        ? vp.getPlaybackFollowPreviewOffset(demoState.project.timeline.cursor) * pixelsPerCoord
        : commitResult.previewOffsetPx;
    }
    this.#previewOffsetPx = Math.abs(previewOffsetPx) < 0.001 ? 0 : previewOffsetPx;
  }
}
