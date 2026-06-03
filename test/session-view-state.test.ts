/************************ session-view-state.test.ts ************************
 *
 * Purpose: Verify capture and restoration of the persisted timeline view state.
 * How: Snapshot controlled viewport inputs, then assert clamping and default
 *      restoration against deterministic timebases.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { TimeScale } from "../demo/time-scale.js";
import {
  areSessionViewStatesEqual,
  captureSessionViewState,
  restoreSessionViewState,
  type SessionViewState,
} from "../demo/session-view-state.js";
import { demoState } from "../demo/state.js";
import { DEFAULT_TIMELINE_VIEW_DURATION } from "../demo/timeline/render-constants.js";
import { TimelineViewport } from "../demo/view/timeline-viewport.js";
import { initProject } from "../src/domain/project.js";

// Purpose: Run one assertion block with isolated mutable viewport fields.
// How: Swap the viewport and last-play marker for the test duration, then restore them.
function withDemoViewState(run: () => void): void {
  const previousViewport = demoState.viewport;
  const previousLastPlayStartCoord = demoState.lastPlayStartCoord;

  try {
    run();
  } finally {
    demoState.viewport = previousViewport;
    demoState.lastPlayStartCoord = previousLastPlayStartCoord;
  }
}

test("captureSessionViewState snapshots the current zoom and timeline positions in seconds", () => {
  const project = initProject("session-view-state");
  project.timeline.cursor = project.timebase.toTimeCoord(3.5);

  withDemoViewState(() => {
    demoState.viewport = new TimelineViewport({
      viewStartCoord: project.timebase.toTimeCoord(-1.25),
      viewDurationCoord: project.timebase.toTimeCoord(7.5),
      zoomLevelIndex: 11,
      timebase: project.timebase,
      gridWidthPx: 0,
      gridHeightPx: 0,
    });
    demoState.lastPlayStartCoord = project.timebase.toTimeCoord(1.75);

    const snapshot = captureSessionViewState(project);

    assert.deepEqual(snapshot, {
      exactTimelineZoomLevelIndex: 11,
      timelineViewStartSeconds: -1.25,
      timelineViewDurationSeconds: 7.5,
      cursorSeconds: 3.5,
      lastPlayStartSeconds: 1.75,
    });
  });
});

test("restoreSessionViewState clamps malformed persisted values and converts them into target coordinates", () => {
  const project = initProject("session-view-restore");
  const snapshot: SessionViewState = {
    exactTimelineZoomLevelIndex: 999,
    timelineViewStartSeconds: -20,
    timelineViewDurationSeconds: 0.0001,
    cursorSeconds: -4,
    lastPlayStartSeconds: 2.25,
  };

  const restored = restoreSessionViewState(snapshot, project.timebase, 5);
  const minimumDuration = project.timebase.toTimeCoord(0.05);

  assert.equal(restored.exactTimelineZoomLevelIndex, TimeScale.clampZoomLevel(999));
  assert.equal(restored.timelineViewDurationCoord, minimumDuration);
  assert.equal(restored.timelineViewStartCoord, -minimumDuration);
  assert.equal(restored.cursorCoord, 0);
  assert.equal(restored.lastPlayStartCoord, project.timebase.toTimeCoord(2.25));
});

test("restoreSessionViewState falls back to the default session view when no snapshot is stored", () => {
  const project = initProject("session-view-default");

  const restored = restoreSessionViewState(null, project.timebase, 9);

  assert.equal(restored.exactTimelineZoomLevelIndex, 9);
  assert.equal(restored.timelineViewStartCoord, 0);
  assert.equal(restored.timelineViewDurationCoord, project.timebase.toTimeCoord(DEFAULT_TIMELINE_VIEW_DURATION));
  assert.equal(restored.cursorCoord, 0);
  assert.equal(restored.lastPlayStartCoord, null);
});

test("areSessionViewStatesEqual compares nullable persisted snapshots structurally", () => {
  const left: SessionViewState = {
    exactTimelineZoomLevelIndex: 4,
    timelineViewStartSeconds: 1,
    timelineViewDurationSeconds: 8,
    cursorSeconds: 0.5,
    lastPlayStartSeconds: null,
  };

  assert.equal(areSessionViewStatesEqual(left, { ...left }), true);
  assert.equal(areSessionViewStatesEqual(left, { ...left, cursorSeconds: 0.75 }), false);
  assert.equal(areSessionViewStatesEqual(null, null), true);
  assert.equal(areSessionViewStatesEqual(left, null), false);
});
