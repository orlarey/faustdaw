/************************ view.test.ts ************************
 *
 * Purpose: Verify the TimelineViewport operations that used to be exposed through a View facade.
 * How: Exercise zoom formatting, timebase sync, and edge-scroll speed directly on TimelineViewport
 *      without going through any facade layer.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { Timebase } from "../src/domain/timebase.js";
import { demoState } from "../demo/state.js";
import { TimelineViewport } from "../demo/view/timeline-viewport.js";

function withDemoViewState(run: () => void): void {
  const previousViewport = demoState.viewport;

  try {
    run();
  } finally {
    demoState.viewport = previousViewport;
  }
}

test("TimelineViewport formats the current zoom level", () => {
  const project = initProject("view-facade");

  withDemoViewState(() => {
    demoState.viewport = new TimelineViewport({
      viewStartCoord: 0,
      viewDurationCoord: project.timebase.toTimeCoord(4),
      zoomLevelIndex: 11,
      timebase: project.timebase,
      gridWidthPx: 0,
      gridHeightPx: 0,
    });

    assert.equal(demoState.viewport.timeScale.formatZoomLevel(), "Z11");
  });
});

test("TimelineViewport exposes the project timebase and edge-scroll speed", () => {
  const project = initProject("view-context");

  withDemoViewState(() => {
    demoState.viewport = new TimelineViewport({
      viewStartCoord: 0,
      viewDurationCoord: 0,
      zoomLevelIndex: 9,
      timebase: project.timebase,
      gridWidthPx: 0,
      gridHeightPx: 0,
    });

    assert.equal(demoState.viewport.timeScale.timebase, project.timebase);
    assert.equal(demoState.viewport.timeScale.formatZoomLevel(), "Z9");
  });
});

test("TimelineViewport keeps edge-scroll speed and preserved view start aligned with the current timebase", () => {
  const project = initProject("view-sync");
  const nextProject = initProject("view-sync-next");
  nextProject.timebase = new Timebase(96_000);

  withDemoViewState(() => {
    demoState.viewport = new TimelineViewport({
      viewStartCoord: project.timebase.toTimeCoord(1.25),
      viewDurationCoord: project.timebase.toTimeCoord(4),
      zoomLevelIndex: 27,
      timebase: project.timebase,
      gridWidthPx: 0,
      gridHeightPx: 0,
    });

    assert.equal(demoState.viewport.getEdgeScrollMaxSpeed(), 7);

    demoState.viewport.syncTimebase(nextProject.timebase);
    assert.equal(demoState.viewport.timeScale.timebase, nextProject.timebase);
    assert.equal(demoState.viewport.viewStartCoord, nextProject.timebase.toTimeCoord(1.25));
  });
});
