/**************************** ruler-gesture.ts ********************************
 *
 * Purpose: Wire the pointer event cycle for ruler pan/zoom gestures, including
 *          inertia after release and the shift-click-to-seek shortcut.
 * How: `wireRulerDragging(elements, ctx)` installs pointerdown / pointermove /
 *      pointerup / pointercancel handlers on the timeline ruler. The closure
 *      holds inertia state (animation frame id, velocities, dragging flag).
 *      One callback is injected:
 *        - restartPlaybackSessionIfNeeded: re-syncs the audio clock after a
 *          shift-click seek moves the cursor.
 *
 ******************************************************************************/
import type { Elements } from "../bind-elements.js";
import { demoState } from "../state.js";
import {
  RULER_PAN_DRAG_DECAY_PER_MS,
  RULER_PAN_INERTIA_DECAY_PER_MS,
  RULER_PAN_INERTIA_MIN_VELOCITY_PX_PER_MS,
} from "./gesture-state.js";
import { seek } from "../../src/domain/transport.js";
import { snapCursorToNearestTertiaryDivision } from "../magnetism.js";
import { recordPerfCounter } from "../perf.js";
import { TimelineScene } from "../timeline/timeline-scene.js";
import { View } from "../view/view.js";
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
  let rulerPanInertiaFrameCount = 0;

  function logPanFrameGap(rawDeltaMs: number): void {
    if (!demoState.devFlags.perfLogging || demoState.rulerDragState?.mode !== "pan" || rawDeltaMs < PAN_DEBUG_FRAME_GAP_THRESHOLD_MS) {
      return;
    }
    const snapshot = TimelineScene.getPanRenderDebugSnapshot();
    recordPerfCounter("pan.frameGap.ms", rawDeltaMs);
    console.debug("[pan-debug] frame-gap", {
      rawDeltaMs: Number(rawDeltaMs.toFixed(3)),
      dragging: rulerPanDragging,
      inertiaFrameCount: rulerPanInertiaFrameCount,
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
    rulerPanInertiaFrameCount = 0;
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

  function stepRulerPanMotion(timestampMs: number): void {
    if (rulerPanFrameTimestampMs === null) {
      rulerPanFrameTimestampMs = timestampMs;
    }
    const rawDeltaMs = Math.max(timestampMs - rulerPanFrameTimestampMs, 0);
    logPanFrameGap(rawDeltaMs);
    const deltaMs = Math.min(rawDeltaMs, 32);
    rulerPanFrameTimestampMs = timestampMs;
    if (deltaMs > 0) {
      const decayPerMs = rulerPanDragging ? RULER_PAN_DRAG_DECAY_PER_MS : RULER_PAN_INERTIA_DECAY_PER_MS;
      rulerPanVelocityPxPerMs *= Math.exp(-decayPerMs * deltaMs);
      rulerPanMouseVelocityPxPerMs *= Math.exp(-decayPerMs * deltaMs);
      if (
        rulerPanDragging
        && (
          Math.abs(rulerPanMouseVelocityPxPerMs) >= Math.abs(rulerPanVelocityPxPerMs)
          || Math.sign(rulerPanMouseVelocityPxPerMs) !== Math.sign(rulerPanVelocityPxPerMs)
        )
      ) {
        rulerPanVelocityPxPerMs = rulerPanMouseVelocityPxPerMs;
      }
      if (Math.abs(rulerPanVelocityPxPerMs) > 0) {
        const deltaXPx = rulerPanVelocityPxPerMs * deltaMs;
        if (demoState.rulerDragState?.mode === "pan") {
          demoState.rulerDragState.panPreviewOffsetPx += deltaXPx;
        }
        const committed = commitRulerPanPreview(elements);
        if (!rulerPanDragging) {
          rulerPanInertiaFrameCount += 1;
        }
        const previewOffsetPx = demoState.rulerDragState?.mode === "pan"
          ? demoState.rulerDragState.panPreviewOffsetPx
          : 0;
        TimelineScene.setPanPreviewOffset(elements, previewOffsetPx);
        if (committed) {
          renderFrame(elements);
        }
      }
    }
    if (!rulerPanDragging && Math.abs(rulerPanVelocityPxPerMs) < RULER_PAN_INERTIA_MIN_VELOCITY_PX_PER_MS) {
      stopRulerPanMotion();
      return;
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
      rulerPanDragging = false;
      const deltaMs = Math.max(event.timeStamp - previousTimestampMs, 1);
      const releaseMouseVelocityPxPerMs = (event.clientX - previousX) / deltaMs;
      if (Math.abs(releaseMouseVelocityPxPerMs) > 0.0001) {
        rulerPanMouseVelocityPxPerMs = releaseMouseVelocityPxPerMs;
      }
      if (
        Math.abs(rulerPanMouseVelocityPxPerMs) >= Math.abs(rulerPanVelocityPxPerMs)
        || (
          Math.abs(rulerPanMouseVelocityPxPerMs) > 0.0001
          && Math.sign(rulerPanMouseVelocityPxPerMs) !== Math.sign(rulerPanVelocityPxPerMs)
        )
      ) {
        rulerPanVelocityPxPerMs = rulerPanMouseVelocityPxPerMs;
      }
      ensureRulerPanMotion();
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

  elements.timelineRuler.addEventListener("pointerup", endRulerDrag);
  elements.timelineRuler.addEventListener("pointercancel", endRulerDrag);
}
