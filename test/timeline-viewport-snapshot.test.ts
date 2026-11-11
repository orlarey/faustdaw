/******************** timeline-viewport-snapshot.test.ts ********************
 *
 * Purpose: Verify that a viewport snapshot puts the visible window back
 *          exactly (used when Escape cancels a ruler pan or zoom).
 * How: Snapshot a viewport, move it with the same operations as the ruler
 *      gesture (anchored zoom, pan), restore, and compare every field.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { TimelineViewport } from "../demo/view/timeline-viewport.js";

function makeViewport(): TimelineViewport {
  const project = initProject("viewport-snapshot");
  const vp = new TimelineViewport({
    viewStartCoord: project.timebase.toTimeCoord(4),
    viewDurationCoord: project.timebase.toTimeCoord(3),
    zoomLevelIndex: 12,
    timebase: project.timebase,
    gridWidthPx: 800,
    gridHeightPx: 300,
  });
  vp.syncViewport();
  return vp;
}

test("restore puts back the start, the duration and the zoom level after a zoom and a pan", () => {
  const vp = makeViewport();
  const before = vp.snapshot();

  assert.equal(vp.setAnchoredZoomLevel(before.zoomLevelIndex - 3, 230, 0), true);
  vp.viewStartCoord = vp.clampStartCoord(vp.viewStartCoord + vp.timeScale.toTimeCoord(1.5));
  assert.notDeepEqual(vp.snapshot(), before);

  assert.equal(vp.restore(before), true);
  assert.deepEqual(vp.snapshot(), before);
  assert.equal(vp.timeScale.zoomLevelIndex, before.zoomLevelIndex);
  assert.equal(vp.viewDurationCoord, vp.timeScale.getDurationCoord(800));
});

test("restore of an unchanged view reports no change", () => {
  const vp = makeViewport();
  const before = vp.snapshot();
  assert.equal(vp.restore(before), false);
  assert.deepEqual(vp.snapshot(), before);
});

test("a snapshot is a copy: later moves do not alter it", () => {
  const vp = makeViewport();
  const before = vp.snapshot();
  const frozen = { ...before };
  vp.setZoomLevel(before.zoomLevelIndex + 2);
  vp.viewStartCoord += vp.timeScale.toTimeCoord(2);
  assert.deepEqual(before, frozen);
});
