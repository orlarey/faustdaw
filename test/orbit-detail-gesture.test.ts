/************************* orbit-detail-gesture.test.ts ***********************
 *
 * Purpose: Verify that an edit in orbit-ui's detail panel (typed value,
 *          arrow-key step, checkbox, menu) reaches the host as one gesture:
 *          onInteractionStart, the parameter change, onInteractionEnd. The
 *          host records undo and persists the session only on gesture end.
 * How: Run the vendored `_applyDetailValue` on a stub instance and log the
 *      order of the host callbacks, for a slider, a checkbox, a button, and
 *      while a canvas or slider drag already brackets the change.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

type Control = { path: string; type: string; min: number; max: number; x: number; y: number };
type StubOrbit = {
  pointer: unknown;
  detailDragActive: boolean;
  paramValues: Record<string, number>;
  _applyDetailValue(control: Control, value: number): void;
};

async function makeOrbit(log: string[]): Promise<StubOrbit> {
  // Load the vendored copy the demo serves, not the npm package.
  const url = new URL("../../demo/vendor/faust-orbit-ui/faust-orbit-ui.js", import.meta.url).href;
  const { FaustOrbitUI } = await import(url) as { FaustOrbitUI: { prototype: object } };
  const orbit = Object.create(FaustOrbitUI.prototype) as StubOrbit & Record<string, unknown>;
  Object.assign(orbit, {
    pointer: null,
    detailDragActive: false,
    paramValues: {},
    onInteractionStart: () => log.push("start"),
    onInteractionEnd: () => log.push("end"),
    paramChangeByUI: (path: string, value: number) => log.push(`change ${path}=${value}`),
    _positionFromValue: () => ({ x: 1, y: 2 }),
    _requestRender: () => {},
    _requestStateEmit: () => {},
    _updateDetailPanel: () => {},
  });
  return orbit;
}

const slider: Control = { path: "/fx/gain", type: "hslider", min: 0, max: 1, x: 0, y: 0 };

test("a typed value or arrow step in the detail panel is one gesture", async () => {
  const log: string[] = [];
  const orbit = await makeOrbit(log);
  orbit._applyDetailValue({ ...slider }, 0.9);
  assert.deepEqual(log, ["start", "change /fx/gain=0.9", "end"]);
  assert.equal(orbit.paramValues["/fx/gain"], 0.9);
});

test("a checkbox toggle in the detail panel is one gesture", async () => {
  const log: string[] = [];
  const orbit = await makeOrbit(log);
  orbit._applyDetailValue({ path: "/fx/mute", type: "checkbox", min: 0, max: 1, x: 0, y: 0 }, 1);
  assert.deepEqual(log, ["start", "change /fx/mute=1", "end"]);
});

test("a momentary button is not bracketed", async () => {
  const log: string[] = [];
  const orbit = await makeOrbit(log);
  orbit._applyDetailValue({ path: "/fx/trig", type: "button", min: 0, max: 1, x: 0, y: 0 }, 1);
  assert.deepEqual(log, ["change /fx/trig=1"]);
});

test("no nested bracket while a canvas or slider drag owns the gesture", async () => {
  for (const drag of [{ pointer: { pointerId: 1 } }, { detailDragActive: true }]) {
    const log: string[] = [];
    const orbit = await makeOrbit(log);
    Object.assign(orbit, drag);
    orbit._applyDetailValue({ ...slider }, 0.3);
    assert.deepEqual(log, ["change /fx/gain=0.3"], JSON.stringify(drag));
  }
});

test("the value is clamped before it reaches the host", async () => {
  const log: string[] = [];
  const orbit = await makeOrbit(log);
  orbit._applyDetailValue({ ...slider }, 7);
  assert.deepEqual(log, ["start", "change /fx/gain=1", "end"]);
});
