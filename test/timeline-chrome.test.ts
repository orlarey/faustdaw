/************************ timeline-chrome.test.ts ************************
 *
 * Purpose: Verify the immutable chrome state derived for the timeline overlays.
 * How: Build deterministic chrome states without DOM access, then assert the
 *      marker visibility and label/drag flags exported by the ADT.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { TimelineChrome } from "../demo/timeline/timeline-chrome.js";

test("TimelineChrome builds one consistent chrome state from markers and interaction flags", () => {
  const project = initProject("timeline-chrome");
  const state = TimelineChrome.buildState({
    negativeOverlayWidthPx: 42.5,
    cursorCoord: project.timebase.toTimeCoord(1.5),
    timebase: project.timebase,
    pixelsPerSample: 1,
    cursorDragActive: true,
    rulerDragging: false,
    rulerLabelsHidden: true,
    rulerLabelsWidthPx: 512,
  });

  assert.equal(state.negativeOverlayWidthPx, 42.5);
  assert.match(state.cursorDragFeedbackText!, /^00:00:01\.500/);
  assert.equal(state.rulerDragging, false);
  assert.equal(state.rulerLabelsHidden, true);
  assert.equal(state.rulerLabelsWidthPx, 512);
});
