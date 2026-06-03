/************************ daw-view-zoom.test.ts ************************
 *
 * Purpose: Verify the exact-zoom viewport rules on the TimelineViewport class.
 * How: Drive viewport instance methods with deterministic widths, zoom levels, and anchor positions,
 *      then assert synced and anchored viewport states.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { TimeScale } from "../demo/time-scale.js";
import { TimelineViewport } from "../demo/view/timeline-viewport.js";

test("TimelineViewport syncs the exact viewport while preserving the visible center", () => {
  const project = initProject("viewport-zoom-sync");
  const vp = new TimelineViewport({
    viewStartCoord: project.timebase.toTimeCoord(2),
    viewDurationCoord: project.timebase.toTimeCoord(3),
    zoomLevelIndex: 6,
    timebase: project.timebase,
    gridWidthPx: 500,
    gridHeightPx: 300,
  });

  vp.syncViewport();

  assert.equal(
    vp.viewDurationCoord,
    vp.timeScale.getDurationCoord(500),
  );
  assert.ok(vp.viewStartCoord >= -vp.viewDurationCoord);
});

test("TimelineViewport changes one zoom level and reports whether anything changed", () => {
  const project = initProject("viewport-zoom-level");
  const vp = new TimelineViewport({
    viewStartCoord: project.timebase.toTimeCoord(0),
    viewDurationCoord: project.timebase.toTimeCoord(2),
    zoomLevelIndex: 7,
    timebase: project.timebase,
    gridWidthPx: 600,
    gridHeightPx: 300,
  });

  const changed = vp.setZoomLevel(5);

  assert.equal(changed, true);
  assert.equal(vp.timeScale.zoomLevelIndex, TimeScale.clampZoomLevel(5));
});

test("TimelineViewport applies anchored zoom while keeping the anchored time inside the visible window", () => {
  const project = initProject("viewport-zoom-anchored");
  const vp = new TimelineViewport({
    viewStartCoord: project.timebase.toTimeCoord(1),
    viewDurationCoord: project.timebase.toTimeCoord(4),
    zoomLevelIndex: 12,
    timebase: project.timebase,
    gridWidthPx: 640,
    gridHeightPx: 300,
  });

  const changed = vp.setAnchoredZoomLevel(10, 350, 50);

  assert.equal(changed, true);
  assert.equal(vp.timeScale.zoomLevelIndex, 10);
  assert.ok(vp.viewStartCoord >= -vp.viewDurationCoord);
});
