/******************************** view/daw-ruler-gesture.ts ********************************
 *
 * Purpose: Represent the pure ruler pan/zoom gesture rules independently from viewport state wiring.
 * How: Own the sub-sample pan accumulator, resolve the pending gesture mode, quantize ruler pan
 *      into committed samples, and convert vertical drag into discrete zoom steps.
 *
 ******************************************************************************/
import type { TimeCoord } from "../../src/domain/timebase.js";
import type { TimeScale } from "../time-scale.js";
import { clampViewStart } from "./view-clamps.js";

// Purpose: Represent the ruler gesture runtime independently from the surrounding viewport module.
// How: Keep the pan accumulator private and expose deterministic mode, pan, and zoom quantization helpers.
export class DAWRulerGesture {
  #pendingPanDeltaSamples = 0;

  // Purpose: Resolve one pending ruler drag into either pan, zoom, or remain-pending.
  // How: Compare the pointer travel magnitude against the lock threshold, then choose the dominant axis.
  resolveMode(input: {
    startPointerX: number;
    startPointerY: number;
    lastPointerX: number;
    lastPointerY: number;
    lockThresholdPx: number;
  }): "pending" | "pan" | "zoom" {
    const deltaX = input.lastPointerX - input.startPointerX;
    const deltaY = input.lastPointerY - input.startPointerY;
    if (Math.hypot(deltaX, deltaY) < input.lockThresholdPx) {
      return "pending";
    }
    return Math.abs(deltaY) > Math.abs(deltaX) ? "zoom" : "pan";
  }

  // Purpose: Convert one horizontal ruler drag delta into committed sample steps and a new visible start.
  // How: Accumulate sub-sample motion, commit only whole samples, then clamp the snapped start against the current duration.
  pan(input: {
    deltaX: number;
    rulerWidthPx: number;
    timeScale: TimeScale;
    timelineViewStartCoord: TimeCoord;
    timelineViewDurationCoord: TimeCoord;
  }): {
    deltaSamples: number;
    timelineViewStartCoord: TimeCoord;
  } {
    const pixelsPerSample = input.timeScale.pixelsPerSample;
    const exactGridWidthPx = input.timeScale.getGridWidthPx(input.rulerWidthPx);
    if (exactGridWidthPx <= 0) {
      return {
        deltaSamples: 0,
        timelineViewStartCoord: input.timelineViewStartCoord,
      };
    }
    this.#pendingPanDeltaSamples += input.deltaX / pixelsPerSample;
    const deltaSamples =
      this.#pendingPanDeltaSamples >= 0
        ? Math.floor(this.#pendingPanDeltaSamples)
        : Math.ceil(this.#pendingPanDeltaSamples);
    this.#pendingPanDeltaSamples -= deltaSamples;
    if (deltaSamples === 0) {
      return {
        deltaSamples: 0,
        timelineViewStartCoord: input.timelineViewStartCoord,
      };
    }
    const deltaCoord = deltaSamples * input.timeScale.timebase.internalTimeFactor;
    return {
      deltaSamples,
      timelineViewStartCoord: clampViewStart(
        input.timeScale.snapToSample(input.timelineViewStartCoord - deltaCoord),
        input.timelineViewDurationCoord,
      ),
    };
  }

  // Purpose: Reset the private sub-sample pan accumulator before a new independent gesture.
  // How: Forget the stored fractional sample residue.
  resetPanAccumulator(): void {
    this.#pendingPanDeltaSamples = 0;
  }

  // Purpose: Convert one vertical ruler drag accumulation into discrete zoom steps.
  // How: Consume only full step multiples from the pending delta and return the leftover remainder for the caller to keep.
  consumeZoomSteps(input: {
    pendingZoomDeltaY: number;
    deltaY: number;
    zoomStepPx: number;
  }): {
    zoomStepCount: number;
    pendingZoomDeltaY: number;
  } {
    const nextPendingZoomDeltaY = input.pendingZoomDeltaY + input.deltaY;
    const zoomStepCount = nextPendingZoomDeltaY >= 0
      ? Math.floor(nextPendingZoomDeltaY / input.zoomStepPx)
      : Math.ceil(nextPendingZoomDeltaY / input.zoomStepPx);
    if (zoomStepCount === 0) {
      return {
        zoomStepCount: 0,
        pendingZoomDeltaY: nextPendingZoomDeltaY,
      };
    }
    return {
      zoomStepCount,
      pendingZoomDeltaY: nextPendingZoomDeltaY - zoomStepCount * input.zoomStepPx,
    };
  }

  // Purpose: Resolve the target exact zoom level from the total vertical ruler drag since gesture start.
  // How: Quantize the accumulated drag against the zoom step size, then offset the starting level by that discrete step count.
  resolveZoomLevel(input: {
    startZoomLevelIndex: number;
    totalDeltaY: number;
    zoomStepPx: number;
  }): number {
    const zoomStepCount = input.totalDeltaY >= 0
      ? Math.floor(input.totalDeltaY / input.zoomStepPx)
      : Math.ceil(input.totalDeltaY / input.zoomStepPx);
    return input.startZoomLevelIndex - zoomStepCount;
  }
}
