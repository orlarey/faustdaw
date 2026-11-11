/**************************** ruler-gesture.ts ********************************
 *
 * Purpose: Wire the pointer event cycle for ruler pan/zoom gestures, including
 *          the pan momentum while the pointer is held and the shift-click-to-seek
 *          shortcut.
 * How: `wireRulerDragging(elements, ctx)` installs pointerdown / pointermove /
 *      pointerup / pointercancel handlers on the timeline ruler. The closure
 *      holds the momentum state (animation frame id, velocities, dragging flag).
 *
 *      Pan behaviour, as wanted (do not add an inertia after release):
 *        - While the pointer is held (finger on the trackpad, button down), the
 *          view follows the gesture's velocity; once the pointer stops moving,
 *          the view keeps going on its momentum and slows down
 *          (RULER_PAN_DRAG_DECAY_PER_MS), so a flick scrolls by itself as long
 *          as the finger stays down.
 *        - On release (or pointercancel), the view stops at once: the
 *          remaining preview offset is committed and the momentum loop ends.
 *      Escape during a pan or zoom cancels it: the view goes back to where it
 *      was at pointerdown, as Escape does for a clip drag.
 *      One callback is injected:
 *        - restartPlaybackSessionIfNeeded: re-syncs the audio clock after a
 *          shift-click seek moves the cursor.
 *
 ******************************************************************************/
import type { Elements } from "../bind-elements.js";
import { demoState } from "../state.js";
import { RULER_PAN_DRAG_DECAY_PER_MS } from "./gesture-state.js";
import { seek } from "../../src/domain/transport.js";
import { snapCursorToNearestTertiaryDivision } from "../magnetism.js";
import { recordPerfCounter } from "../perf.js";
import { TimelineScene } from "../timeline/timeline-scene.js";
import { View } from "../view/view.js";
import type { TimelineViewportSnapshot } from "../view/timeline-viewport.js";
import { commitTimelinePreviewOffset } from "../view/viewport-commit.js";
import { pushRenderLog, render, renderFrame, renderGestureOverlayFrame } from "../daw-render/daw-render-runtime.js";

/** Frame-gap above which the ruler pan logs a debug entry, in milliseconds. */
const PAN_DEBUG_FRAME_GAP_THRESHOLD_MS = 40;

const {
  getTimeFromGridClientX,
  resetRulerPanAccumulator,
  updateRulerGestureMode,
  zoomTimelineFromRuler,
} = View;

/**
 * Purpose: Set up the pointer event cycle for ruler pan/zoom gestures.
 * How: Listen on the ruler, detect gesture direction, then pan or zoom accordingly until release.
 */
export function wireRulerDragging(elements: Elements): void {
  let rulerZoomFrameId: number | null = null;
  let rulerPanFrameId: number | null = null;
  let rulerPanVelocityPxPerMs = 0;
  let rulerPanMouseVelocityPxPerMs = 0;
  let rulerPanFrameTimestampMs: number | null = null;
  let rulerPanDragging = false;
  // The view at the gesture's pointerdown, put back if Escape cancels it.
  let rulerGestureStartView: TimelineViewportSnapshot | null = null;

  function logPanFrameGap(rawDeltaMs: number): void {
    if (!demoState.devFlags.perfLogging || demoState.rulerDragState?.mode !== "pan" || rawDeltaMs < PAN_DEBUG_FRAME_GAP_THRESHOLD_MS) {
      return;
    }
    const snapshot = TimelineScene.getPanRenderDebugSnapshot();
    recordPerfCounter("pan.frameGap.ms", rawDeltaMs);
    console.debug("[pan-debug] frame-gap", {
      rawDeltaMs: Number(rawDeltaMs.toFixed(3)),
      dragging: rulerPanDragging,
      panPreviewOffsetPx: demoState.rulerDragState?.panPreviewOffsetPx ?? null,
      viewStartCoord: demoState.viewport.viewStartCoord,
      ...snapshot,
    });
  }

  function stopRulerPanMotion(): void {
    if (rulerPanFrameId !== null) {
      cancelAnimationFrame(rulerPanFrameId);
      rulerPanFrameId = null;
    }
    rulerPanVelocityPxPerMs = 0;
    rulerPanMouseVelocityPxPerMs = 0;
    rulerPanFrameTimestampMs = null;
    rulerPanDragging = false;
    resetRulerPanAccumulator();
  }

  function commitRulerPanPreview(elements: Elements, force = false): boolean {
    const rulerDragState = demoState.rulerDragState;
    if (!rulerDragState || rulerDragState.mode !== "pan") {
      return false;
    }
    const commitResult = commitTimelinePreviewOffset(
      rulerDragState.panPreviewOffsetPx,
      rulerDragState.gridWidthPx,
      elements,
      force,
    );
    if (!commitResult.committed) {
      if (force) {
        rulerDragState.panPreviewOffsetPx = commitResult.previewOffsetPx;
      }
      return false;
    }
    const committedOffsetPx = rulerDragState.panPreviewOffsetPx - commitResult.previewOffsetPx;
    rulerDragState.panCommittedOffsetPx += committedOffsetPx;
    rulerDragState.panPreviewOffsetPx = commitResult.previewOffsetPx;
    return true;
  }

  /**
   * Purpose: Advance the pan by one animation frame while the pointer is held.
   * How: Decay the momentum velocity, take the pointer's velocity when it is
   *      faster or reverses, move the preview offset, and commit it past the
   *      threshold. The loop only runs during the gesture: the release stops it.
   */
  function stepRulerPanMotion(timestampMs: number): void {
    if (!rulerPanDragging) {
      stopRulerPanMotion();
      return;
    }
    if (rulerPanFrameTimestampMs === null) {
      rulerPanFrameTimestampMs = timestampMs;
    }
    const rawDeltaMs = Math.max(timestampMs - rulerPanFrameTimestampMs, 0);
    logPanFrameGap(rawDeltaMs);
    const deltaMs = Math.min(rawDeltaMs, 32);
    rulerPanFrameTimestampMs = timestampMs;
    if (deltaMs > 0) {
      rulerPanVelocityPxPerMs *= Math.exp(-RULER_PAN_DRAG_DECAY_PER_MS * deltaMs);
      rulerPanMouseVelocityPxPerMs *= Math.exp(-RULER_PAN_DRAG_DECAY_PER_MS * deltaMs);
      if (
        Math.abs(rulerPanMouseVelocityPxPerMs) >= Math.abs(rulerPanVelocityPxPerMs)
        || Math.sign(rulerPanMouseVelocityPxPerMs) !== Math.sign(rulerPanVelocityPxPerMs)
      ) {
        rulerPanVelocityPxPerMs = rulerPanMouseVelocityPxPerMs;
      }
      if (Math.abs(rulerPanVelocityPxPerMs) > 0) {
        const deltaXPx = rulerPanVelocityPxPerMs * deltaMs;
        if (demoState.rulerDragState?.mode === "pan") {
          demoState.rulerDragState.panPreviewOffsetPx += deltaXPx;
        }
        const committed = commitRulerPanPreview(elements);
        const previewOffsetPx = demoState.rulerDragState?.mode === "pan"
          ? demoState.rulerDragState.panPreviewOffsetPx
          : 0;
        TimelineScene.setPanPreviewOffset(elements, previewOffsetPx);
        if (committed) {
          renderFrame(elements);
        }
      }
    }
    rulerPanFrameId = requestAnimationFrame((nextTimestampMs) => stepRulerPanMotion(nextTimestampMs));
  }

  function ensureRulerPanMotion(): void {
    if (rulerPanFrameId === null) {
      rulerPanFrameId = requestAnimationFrame((timestampMs) => stepRulerPanMotion(timestampMs));
    }
  }

  function flushRulerZoomFrame(): void {
    rulerZoomFrameId = null;
    if (!demoState.rulerDragState || demoState.rulerDragState.mode !== "zoom") {
      return;
    }
    const changed = applyPendingRulerZoomDelta();
    if (changed) {
      renderFrame(elements);
    }
  }

  function applyPendingRulerZoomDelta(): boolean {
    if (!demoState.rulerDragState || demoState.rulerDragState.mode !== "zoom") {
      return false;
    }
    return zoomTimelineFromRuler(
      demoState.rulerDragState.startPointerX,
      demoState.rulerDragState.lastPointerY - demoState.rulerDragState.startPointerY,
      elements,
    );
  }

  function scheduleRulerZoomFrame(): void {
    if (rulerZoomFrameId !== null) {
      return;
    }
    rulerZoomFrameId = requestAnimationFrame(() => flushRulerZoomFrame());
  }

  elements.timelineRuler.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (event.button === 0 && event.shiftKey) {
      stopRulerPanMotion();
      demoState.project = seek(
        demoState.project,
        snapCursorToNearestTertiaryDivision(getTimeFromGridClientX(event.clientX, elements)),
      );
      pushRenderLog(`Seek to ${demoState.viewport.timeScale.fromTimeCoord(demoState.project.timeline.cursor).toFixed(2)} s`);
      render(elements);
      demoState.playbackSession.restartIfNeeded();
      return;
    }
    stopRulerPanMotion();
    rulerGestureStartView = demoState.viewport.snapshot();
    const gridRect = elements.timelineGrid.getBoundingClientRect();
    demoState.rulerDragState = {
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      lastPointerX: event.clientX,
      lastPointerY: event.clientY,
      lastPointerTimestampMs: event.timeStamp,
      startZoomLevelIndex: demoState.viewport.timeScale.zoomLevelIndex,
      gridWidthPx: gridRect.width,
      gridHeightPx: gridRect.height,
      pendingZoomDeltaY: 0,
      panPreviewOffsetPx: 0,
      panCommittedOffsetPx: 0,
      panVelocityPxPerMs: 0,
      mode: "pending",
    };
    elements.timelineRuler.setPointerCapture(event.pointerId);
    renderGestureOverlayFrame(elements);
  });

  elements.timelineRuler.addEventListener("pointermove", (event) => {
    if (!demoState.rulerDragState || event.pointerId !== demoState.rulerDragState.pointerId) {
      return;
    }
    const previousMode = demoState.rulerDragState.mode;
    const previousX = demoState.rulerDragState.lastPointerX;
    const previousY = demoState.rulerDragState.lastPointerY;
    const previousTimestampMs = demoState.rulerDragState.lastPointerTimestampMs;
    demoState.rulerDragState.lastPointerX = event.clientX;
    demoState.rulerDragState.lastPointerY = event.clientY;
    demoState.rulerDragState.lastPointerTimestampMs = event.timeStamp;
    updateRulerGestureMode();
    if (demoState.rulerDragState.mode === "pan") {
      if (previousMode !== "pan") {
        renderFrame(elements);
      }
      rulerPanDragging = true;
      const deltaMs = Math.max(event.timeStamp - previousTimestampMs, 1);
      rulerPanMouseVelocityPxPerMs = (event.clientX - previousX) / deltaMs;
      demoState.rulerDragState.panVelocityPxPerMs = rulerPanMouseVelocityPxPerMs;
      ensureRulerPanMotion();
      return;
    } else if (demoState.rulerDragState.mode === "zoom") {
      if (demoState.rulerDragState.panPreviewOffsetPx !== 0) {
        demoState.rulerDragState.panPreviewOffsetPx = 0;
        TimelineScene.setPanPreviewOffset(elements, 0);
      }
      scheduleRulerZoomFrame();
      return;
    }
    renderGestureOverlayFrame(elements);
  });

  const endRulerDrag = (event: PointerEvent): void => {
    if (!demoState.rulerDragState || event.pointerId !== demoState.rulerDragState.pointerId) {
      return;
    }
    const previousMode = demoState.rulerDragState.mode;
    demoState.rulerDragState.lastPointerX = event.clientX;
    demoState.rulerDragState.lastPointerY = event.clientY;
    demoState.rulerDragState.lastPointerTimestampMs = event.timeStamp;
    updateRulerGestureMode();
    if (demoState.rulerDragState.mode === "pan") {
      if (previousMode !== "pan") {
        renderFrame(elements);
      }
      // Release stops the pan at once (no inertia after release, by design):
      // the remaining preview offset is committed below, then the momentum
      // loop is stopped.
    } else if (demoState.rulerDragState.mode === "zoom") {
      if (rulerZoomFrameId !== null) {
        cancelAnimationFrame(rulerZoomFrameId);
        rulerZoomFrameId = null;
      }
      applyPendingRulerZoomDelta();
    }
    const finalMode = demoState.rulerDragState.mode;
    const committedOnRelease = finalMode === "pan"
      ? commitRulerPanPreview(elements, true)
      : false;
    demoState.rulerDragState = null;
    rulerGestureStartView = null;
    if (finalMode === "pan") {
      stopRulerPanMotion();
    }
    demoState.geometryWindow.keepWarm = finalMode === "pan";
    TimelineScene.setPanPreviewOffset(elements, 0);
    if (elements.timelineRuler.hasPointerCapture(event.pointerId)) {
      elements.timelineRuler.releasePointerCapture(event.pointerId);
    }
    if (finalMode === "zoom") {
      pushRenderLog(`Zoom timeline to ${demoState.viewport.viewDurationSeconds().toFixed(2)} s`);
      renderFrame(elements);
    } else if (finalMode === "pan") {
      pushRenderLog(`Pan timeline to ${demoState.viewport.viewStartSeconds().toFixed(2)} s`);
      if (committedOnRelease) {
        renderFrame(elements);
      }
      return;
    }
  };

  /**
   * Purpose: Cancel the ruler gesture in progress (Escape).
   * How: Stop the zoom frame and the pan momentum, drop the gesture state and
   *      the pan preview offset, release the pointer capture, and put the
   *      view back as it was at pointerdown. The rest of the press is then
   *      ignored (pointermove / pointerup find no gesture).
   */
  const cancelRulerDrag = (): void => {
    const rulerDragState = demoState.rulerDragState;
    if (!rulerDragState) {
      return;
    }
    if (rulerZoomFrameId !== null) {
      cancelAnimationFrame(rulerZoomFrameId);
      rulerZoomFrameId = null;
    }
    stopRulerPanMotion();
    demoState.rulerDragState = null;
    demoState.geometryWindow.keepWarm = false;
    TimelineScene.setPanPreviewOffset(elements, 0);
    if (elements.timelineRuler.hasPointerCapture(rulerDragState.pointerId)) {
      elements.timelineRuler.releasePointerCapture(rulerDragState.pointerId);
    }
    if (rulerGestureStartView) {
      demoState.viewport.restore(rulerGestureStartView);
      rulerGestureStartView = null;
    }
    pushRenderLog("Ruler gesture cancelled");
    renderFrame(elements);
  };

  elements.timelineRuler.addEventListener("pointerup", endRulerDrag);
  elements.timelineRuler.addEventListener("pointercancel", endRulerDrag);
  // Escape cancels a ruler pan or zoom in progress. Capture phase and
  // stopImmediatePropagation, as for a clip drag: the key belongs to the
  // gesture and does not also close a panel. Without a gesture it does nothing.
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !demoState.rulerDragState) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelRulerDrag();
    },
    { capture: true },
  );
}
