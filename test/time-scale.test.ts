/************************ time-scale.test.ts ************************
 *
 * Purpose: Verify that TimeScale groups zoom level and timebase into a cohesive service.
 * How: Exercise zoom, conversion, and snapping methods on a TimeScale instance.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { TimeScale } from "../demo/time-scale.js";

const project = initProject("time-scale-test");
const timebase = project.timebase;

test("TimeScale exposes the exact timeline lattice", () => {
  assert.equal(TimeScale.levels.length > 0, true);
  assert.equal(TimeScale.levelCount, TimeScale.levels.length);
});

test("TimeScale.clampZoomLevel bounds the index inside the implemented lattice", () => {
  assert.equal(TimeScale.clampZoomLevel(-1), 0);
  assert.equal(TimeScale.clampZoomLevel(999), TimeScale.levels.length - 1);
});

test("TimeScale clamps zoom level on construction", () => {
  const ts = new TimeScale(-5, timebase);
  assert.equal(ts.zoomLevelIndex, 0);

  const ts2 = new TimeScale(9999, timebase);
  assert.equal(ts2.zoomLevelIndex, TimeScale.levelCount - 1);
});

test("TimeScale.setZoomLevel clamps and returns whether it changed", () => {
  const ts = new TimeScale(10, timebase);
  assert.equal(ts.setZoomLevel(10), false);
  assert.equal(ts.setZoomLevel(12), true);
  assert.equal(ts.zoomLevelIndex, 12);
  assert.equal(ts.setZoomLevel(-1), true);
  assert.equal(ts.zoomLevelIndex, 0);
});

test("TimeScale.stepZoomLevel increments by one", () => {
  const ts = new TimeScale(5, timebase);
  assert.equal(ts.stepZoomLevel(1), true);
  assert.equal(ts.zoomLevelIndex, 6);
  assert.equal(ts.stepZoomLevel(-1), true);
  assert.equal(ts.zoomLevelIndex, 5);
});

test("TimeScale.getScale returns a consistent descriptor", () => {
  const ts = new TimeScale(6, timebase);
  const scale = ts.getScale();
  assert.equal(scale.levelIndex, 6);
  assert.equal(scale.pixelsPerSample, ts.pixelsPerSample);
  assert.equal(scale.sampleCoord, ts.sampleCoord);
});

test("TimeScale.getGridWidthPx snaps to sample boundary", () => {
  const ts = new TimeScale(6, timebase);
  const gridWidth = ts.getGridWidthPx(503);
  assert.equal(gridWidth % ts.pixelsPerSample, 0);
});

test("TimeScale.getDurationCoord is consistent with getGridWidthPx", () => {
  const ts = new TimeScale(6, timebase);
  const gridWidth = ts.getGridWidthPx(503);
  const duration = ts.getDurationCoord(503);
  const expectedSamples = Math.max(1, Math.floor(gridWidth / ts.pixelsPerSample));
  assert.equal(duration, expectedSamples * ts.sampleCoord);
});

test("TimeScale.snapToSample rounds to nearest sample boundary", () => {
  const ts = new TimeScale(0, timebase);
  const sampleCoord = ts.sampleCoord;
  assert.equal(ts.snapToSample(0), 0);
  assert.equal(ts.snapToSample(sampleCoord * 2.3), sampleCoord * 2);
  assert.equal(ts.snapToSample(sampleCoord * 2.7), sampleCoord * 3);
});

test("TimeScale.formatZoomLevel returns Z<n> format", () => {
  const ts = new TimeScale(14, timebase);
  assert.equal(ts.formatZoomLevel(), "Z14");
});

test("TimeScale.setTimebase updates the timebase", () => {
  const project2 = initProject("time-scale-test-2");
  const ts = new TimeScale(6, timebase);
  const oldSampleCoord = ts.sampleCoord;
  ts.setTimebase(project2.timebase);
  assert.equal(ts.timebase, project2.timebase);
  assert.equal(ts.sampleCoord, oldSampleCoord);
});
