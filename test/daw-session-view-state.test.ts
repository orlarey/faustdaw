/************************ daw-session-view-state.test.ts ************************
 *
 * Purpose: Verify the runtime DAW view-state ADT extracted from session persistence logic.
 * How: Capture controlled viewport values into the ADT, then assert that applying one restored state
 *      writes the expected view fields back into the viewport.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { DAWSessionViewState } from "../demo/view/daw-session-view-state.js";
import { demoState } from "../demo/state.js";
import { TimelineViewport } from "../demo/view/timeline-viewport.js";
import { initProject } from "../src/domain/project.js";

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

test("DAWSessionViewState captures the current runtime zoom, visible window, and cursor markers", () => {
  const project = initProject("daw-session-view-state-capture");
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

    const viewState = DAWSessionViewState.capture(project);

    assert.deepEqual(viewState, DAWSessionViewState.fromSnapshot({
      exactTimelineZoomLevelIndex: 11,
      timelineViewStartCoord: project.timebase.toTimeCoord(-1.25),
      timelineViewDurationCoord: project.timebase.toTimeCoord(7.5),
      cursorCoord: project.timebase.toTimeCoord(3.5),
      lastPlayStartCoord: project.timebase.toTimeCoord(1.75),
    }));
  });
});

test("DAWSessionViewState reapplies one restored runtime view snapshot to demo state", () => {
  const project = initProject("daw-session-view-state-apply");
  const viewState = DAWSessionViewState.fromSnapshot({
    exactTimelineZoomLevelIndex: 7,
    timelineViewStartCoord: project.timebase.toTimeCoord(2),
    timelineViewDurationCoord: project.timebase.toTimeCoord(6),
    cursorCoord: project.timebase.toTimeCoord(4),
    lastPlayStartCoord: project.timebase.toTimeCoord(1.5),
  });

  withDemoViewState(() => {
    demoState.viewport = new TimelineViewport({
      viewStartCoord: 0,
      viewDurationCoord: 0,
      zoomLevelIndex: 0,
      timebase: project.timebase,
      gridWidthPx: 0,
      gridHeightPx: 0,
    });

    viewState.applyToDemoState(project.timebase);

    assert.equal(demoState.viewport.timeScale.timebase, project.timebase);
    assert.equal(demoState.viewport.timeScale.zoomLevelIndex, 7);
    assert.equal(demoState.viewport.viewStartCoord, project.timebase.toTimeCoord(2));
    assert.equal(demoState.viewport.viewDurationCoord, project.timebase.toTimeCoord(6));
    assert.equal(demoState.lastPlayStartCoord, project.timebase.toTimeCoord(1.5));
  });
});
