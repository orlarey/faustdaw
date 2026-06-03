/****************************** daw-render.test.ts ******************************
 *
 * Purpose: Verify the small DAW render runtime operations exposed to the rest of the demo.
 * How: Exercise pushRenderLog and the timeline scene pan-debug snapshot accessor directly.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { demoState } from "../demo/state.js";
import { pushRenderLog } from "../demo/daw-render/daw-render-runtime.js";
import { TimelineScene } from "../demo/timeline/timeline-scene.js";

test("pushRenderLog appends one timestamped entry to the demo log", () => {
  const previousLogEntries = demoState.logEntries;
  demoState.logEntries = [];

  try {
    pushRenderLog("DAW render runtime test");

    assert.equal(demoState.logEntries.length, 1);
    assert.match(demoState.logEntries[0] ?? "", /DAW render runtime test$/);
  } finally {
    demoState.logEntries = previousLogEntries;
  }
});

test("TimelineScene.getPanRenderDebugSnapshot is null before any render", () => {
  assert.equal(TimelineScene.getPanRenderDebugSnapshot(), null);
});
