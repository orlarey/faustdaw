/**************************** preset-transition.test.ts ***********************
 *
 * Purpose: Verify the timing and interpolation primitives that drive
 *          continuous configuration glides — pure, no audio / DOM.
 *
 ******************************************************************************/
import test from "node:test";
import assert from "node:assert/strict";

import {
  TransitionTimer,
  lerpCenter,
  lerpConfig,
} from "../demo/preset-transition.js";

test("TransitionTimer alpha walks from 0 to 1 across the duration", () => {
  const timer = new TransitionTimer();
  assert.equal(timer.alpha(0), null, "inactive timer returns null");
  timer.start(1000, 100);
  assert.equal(timer.alpha(100), 0);
  assert.equal(timer.alpha(600), 0.5);
  assert.equal(timer.alpha(1100), 1);
  assert.equal(timer.alpha(99999), 1, "alpha clamps at 1 past the end");
  assert.equal(timer.alpha(50), 0, "alpha clamps at 0 before the start");
});

test("TransitionTimer isActive flips off at duration", () => {
  const timer = new TransitionTimer();
  timer.start(500, 0);
  assert.equal(timer.isActive(0), true);
  assert.equal(timer.isActive(499), true);
  assert.equal(timer.isActive(500), false);
  assert.equal(timer.isActive(1000), false);
});

test("TransitionTimer treats zero or negative duration as instant", () => {
  const timer = new TransitionTimer();
  timer.start(0, 0);
  assert.equal(timer.alpha(0), 1, "zero-duration is already at the target");
  assert.equal(timer.isActive(0), false, "zero-duration never reports active");
  timer.start(-100, 0);
  assert.equal(timer.alpha(0), 1, "negative duration clamps to 0 ms");
});

test("TransitionTimer.stop returns the timer to inactive", () => {
  const timer = new TransitionTimer();
  timer.start(1000, 0);
  assert.equal(timer.alpha(500), 0.5);
  timer.stop();
  assert.equal(timer.alpha(500), null);
  assert.equal(timer.isActive(500), false);
});

test("lerpConfig blends per-address with α and covers exactly the requested addresses", () => {
  const start = { a: 0, b: 10, c: -5 };
  const target = { a: 100, b: 0, c: 5 };
  const addresses = ["a", "b", "c"];
  assert.deepEqual(lerpConfig(start, target, 0, addresses), { a: 0, b: 10, c: -5 });
  assert.deepEqual(lerpConfig(start, target, 1, addresses), { a: 100, b: 0, c: 5 });
  assert.deepEqual(lerpConfig(start, target, 0.5, addresses), { a: 50, b: 5, c: 0 });
});

test("lerpConfig defaults missing keys to 0", () => {
  const start = { a: 1 };
  const target = { b: 2 };
  assert.deepEqual(
    lerpConfig(start, target, 0.5, ["a", "b"]),
    { a: 0.5, b: 1 },
  );
});

test("lerpCenter is linear in 2D", () => {
  assert.deepEqual(lerpCenter([0, 0], [10, -4], 0), [0, 0]);
  assert.deepEqual(lerpCenter([0, 0], [10, -4], 1), [10, -4]);
  assert.deepEqual(lerpCenter([0, 0], [10, -4], 0.5), [5, -2]);
});
