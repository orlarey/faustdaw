/**************************** audio-param-smoothing.test.ts ********************
 *
 * Purpose: Check that mixer changes approach their target while the context
 *          runs (no step, so no click) and are set at once otherwise.
 * How: Drive setParamSmoothly / setParamImmediately with a recording fake
 *      AudioParam and fake contexts in the running / suspended states.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { PARAM_SMOOTHING_SECONDS, setParamImmediately, setParamSmoothly } from "../demo/audio-param-smoothing.js";

function fakeParam(initial: number) {
  const calls: unknown[][] = [];
  const param = {
    value: initial,
    setTargetAtTime(target: number, start: number, tau: number) { calls.push(["setTargetAtTime", target, start, tau]); return param; },
    cancelScheduledValues(t: number) { calls.push(["cancelScheduledValues", t]); return param; },
  };
  return { param: param as unknown as AudioParam, raw: param, calls };
}
const context = (state: AudioContextState, currentTime = 12.5) => ({ state, currentTime }) as unknown as BaseAudioContext;

test("while running, the value approaches its target from now, without a step", () => {
  const { param, raw, calls } = fakeParam(1);
  setParamSmoothly(param, 0, context("running"));
  assert.deepEqual(calls, [["setTargetAtTime", 0, 12.5, PARAM_SMOOTHING_SECONDS]]);
  assert.equal(raw.value, 1); // not stepped
});

test("when the context does not run, the value is set at once", () => {
  for (const state of ["suspended", "closed"] as AudioContextState[]) {
    const { param, raw, calls } = fakeParam(1);
    setParamSmoothly(param, 0.25, context(state));
    assert.equal(raw.value, 0.25);
    assert.deepEqual(calls, [["cancelScheduledValues", 0]]);
  }
});

test("setParamImmediately drops any approach in progress and sets the value", () => {
  const { param, raw, calls } = fakeParam(1);
  setParamImmediately(param, 0);
  assert.equal(raw.value, 0);
  assert.deepEqual(calls, [["cancelScheduledValues", 0]]);
});

test("the approach reaches 95 % within 15 ms", () => {
  assert.ok(1 - Math.exp(-0.015 / PARAM_SMOOTHING_SECONDS) >= 0.95);
});
