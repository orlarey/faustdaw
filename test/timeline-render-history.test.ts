/************************ timeline-render-history.test.ts ************************
 *
 * Purpose: Verify that timeline render history stays coherent as geometry, waveform,
 *      and clip caches are updated and reset incrementally.
 * How: Exercise the public ADT methods directly and assert the snapshots they expose
 *      back to the frame planner.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { TimelineRenderHistoryState } from "../demo/timeline/timeline-render-history.js";

test("TimelineRenderHistoryState stores planner snapshots and waveform cache markers", () => {
  const project = initProject("timeline-render-history");
  const history = new TimelineRenderHistoryState();
  const windowStartCoord = project.timebase.toTimeCoord(1);
  const windowEndCoord = project.timebase.toTimeCoord(5);

  history.updateGeometry({
    renderWindowStartCoord: windowStartCoord,
    renderWindowEndCoord: windowEndCoord,
    pixelsPerCoord: 2,
    gridWidthPx: 640,
    displayStartCoord: windowStartCoord,
    displayEndCoord: windowEndCoord,
    bufferedViewport: true,
  });
  history.updateClips({
    windowStartCoord,
    windowEndCoord,
    pixelsPerCoord: 2,
    gridHeightPx: 180,
  });
  history.updateWaveforms({
    displayStartCoord: windowStartCoord,
    displayEndCoord: windowEndCoord,
    bufferedViewport: true,
  });

  assert.equal(history.previousGeometryDisplayStartCoord(), windowStartCoord);
  assert.equal(history.previousGeometryDisplayEndCoord(), windowEndCoord);
  assert.equal(history.previousWaveformDisplayStartCoord(), windowStartCoord);
  assert.equal(history.previousWaveformDisplayEndCoord(), windowEndCoord);
  assert.equal(history.hasRenderedClipWindow(), true);
  assert.equal(history.waveformDisplayChanged(windowStartCoord, windowEndCoord, true), false);
  assert.equal(history.waveformDisplayChanged(windowStartCoord, windowEndCoord, false), true);

  const plannerHistory = history.plannerHistory();
  assert.equal(plannerHistory.lastRenderedGeometryWindowStartCoord, windowStartCoord);
  assert.equal(plannerHistory.lastRenderedGeometryWindowEndCoord, windowEndCoord);
  assert.equal(plannerHistory.lastRenderedGeometryPixelsPerCoord, 2);
  assert.equal(plannerHistory.lastRenderedGeometryGridWidthPx, 640);
  assert.equal(plannerHistory.lastRenderedClipWindowStartCoord, windowStartCoord);
  assert.equal(plannerHistory.lastRenderedClipWindowEndCoord, windowEndCoord);
  assert.equal(plannerHistory.lastRenderedClipGridHeightPx, 180);
});

test("TimelineRenderHistoryState clears waveform caches and resets everything", () => {
  const project = initProject("timeline-render-history-reset");
  const history = new TimelineRenderHistoryState();
  const windowStartCoord = project.timebase.toTimeCoord(0.5);
  const windowEndCoord = project.timebase.toTimeCoord(1.5);

  history.updateWaveforms({
    displayStartCoord: windowStartCoord,
    displayEndCoord: windowEndCoord,
    bufferedViewport: false,
  });
  history.clearWaveforms();

  assert.equal(history.previousWaveformDisplayStartCoord(), null);
  assert.equal(history.previousWaveformDisplayEndCoord(), null);

  history.updateClips({
    windowStartCoord,
    windowEndCoord,
    pixelsPerCoord: 1.25,
    gridHeightPx: 220,
  });
  assert.equal(history.hasRenderedClipWindow(), true);

  history.reset();

  assert.equal(history.previousGeometryDisplayStartCoord(), null);
  assert.equal(history.previousWaveformDisplayStartCoord(), null);
  assert.equal(history.hasRenderedClipWindow(), false);
  assert.deepEqual(history.plannerHistory(), {
    lastRenderedGeometryWindowStartCoord: null,
    lastRenderedGeometryWindowEndCoord: null,
    lastRenderedGeometryPixelsPerCoord: null,
    lastRenderedGeometryGridWidthPx: null,
    lastRenderedGeometryDisplayStartCoord: null,
    lastRenderedGeometryDisplayEndCoord: null,
    lastRenderedGeometryBufferedViewport: null,
    lastRenderedClipWindowStartCoord: null,
    lastRenderedClipWindowEndCoord: null,
    lastRenderedClipPixelsPerCoord: null,
    lastRenderedClipGridHeightPx: null,
  });
});
