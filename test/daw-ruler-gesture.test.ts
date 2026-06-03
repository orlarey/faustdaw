/************************ daw-ruler-gesture.test.ts ************************
 *
 * Purpose: Verify the pure ruler pan/zoom gesture helper extracted from viewport.ts.
 * How: Drive the helper with deterministic drag deltas so gesture mode, pan accumulation,
 *      and zoom-step quantization can be validated without DOM-backed interactions.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { TimeScale } from "../demo/time-scale.js";
import { DAWRulerGesture } from "../demo/view/daw-ruler-gesture.js";

test("DAWRulerGesture resolves pending drags into pan or zoom once the lock threshold is crossed", () => {
  const gesture = new DAWRulerGesture();

  assert.equal(gesture.resolveMode({
    startPointerX: 0,
    startPointerY: 0,
    lastPointerX: 2,
    lastPointerY: 1,
    lockThresholdPx: 8,
  }), "pending");
  assert.equal(gesture.resolveMode({
    startPointerX: 0,
    startPointerY: 0,
    lastPointerX: 20,
    lastPointerY: 4,
    lockThresholdPx: 8,
  }), "pan");
  assert.equal(gesture.resolveMode({
    startPointerX: 0,
    startPointerY: 0,
    lastPointerX: 4,
    lastPointerY: 20,
    lockThresholdPx: 8,
  }), "zoom");
});

test("DAWRulerGesture accumulates sub-sample pan deltas and updates the visible start only on committed samples", () => {
  const gesture = new DAWRulerGesture();
  const project = initProject("daw-ruler-gesture-pan");
  const timeScale = new TimeScale(0, project.timebase);
  const initialStart = project.timebase.toTimeCoord(3);
  const duration = project.timebase.toTimeCoord(4);

  const first = gesture.pan({
    deltaX: 0.4,
    rulerWidthPx: 640,
    timeScale,
    timelineViewStartCoord: initialStart,
    timelineViewDurationCoord: duration,
  });
  const second = gesture.pan({
    deltaX: 16,
    rulerWidthPx: 640,
    timeScale,
    timelineViewStartCoord: initialStart,
    timelineViewDurationCoord: duration,
  });

  assert.equal(first.deltaSamples, 0);
  assert.equal(first.timelineViewStartCoord, initialStart);
  assert.equal(second.deltaSamples, 1);
  assert.equal(second.timelineViewStartCoord, initialStart - project.timebase.internalTimeFactor);
});

test("DAWRulerGesture quantizes vertical drag into zoom steps and preserves the remainder", () => {
  const gesture = new DAWRulerGesture();
  const first = gesture.consumeZoomSteps({
    pendingZoomDeltaY: 0,
    deltaY: 10,
    zoomStepPx: 24,
  });
  const second = gesture.consumeZoomSteps({
    pendingZoomDeltaY: first.pendingZoomDeltaY,
    deltaY: 20,
    zoomStepPx: 24,
  });

  assert.equal(first.zoomStepCount, 0);
  assert.equal(first.pendingZoomDeltaY, 10);
  assert.equal(second.zoomStepCount, 1);
  assert.equal(second.pendingZoomDeltaY, 6);
});

test("DAWRulerGesture resolves one target zoom level from the total ruler drag", () => {
  const gesture = new DAWRulerGesture();

  assert.equal(gesture.resolveZoomLevel({
    startZoomLevelIndex: 10,
    totalDeltaY: 23,
    zoomStepPx: 24,
  }), 10);
  assert.equal(gesture.resolveZoomLevel({
    startZoomLevelIndex: 10,
    totalDeltaY: 24,
    zoomStepPx: 24,
  }), 9);
  assert.equal(gesture.resolveZoomLevel({
    startZoomLevelIndex: 10,
    totalDeltaY: -48,
    zoomStepPx: 24,
  }), 12);
});
