/************************ timeline-projection.test.ts ************************
 *
 * Purpose: Verify the DAW view and timeline projection ADTs introduced for rendering.
 * How: Build deterministic snapshots without DOM access, then assert exact-grid sizing
 *      and coordinate conversions on derived canvas projections.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";
import { DAWRenderView } from "../demo/view/daw-render-view.js";

test("DAWRenderView and TimelineProjection separate visible view state from one canvas projection", () => {
  const project = initProject("timeline-projection");
  const view = DAWRenderView.fromSnapshot({
    exactTimelineZoomLevelIndex: 0,
    timebase: project.timebase,
    viewStartCoord: project.timebase.toTimeCoord(1),
    viewDurationCoord: project.timebase.toTimeCoord(4),
    viewportWidthPx: 500,
    viewportHeightPx: 250,
    cursorCoord: project.timebase.toTimeCoord(1.5),
    lastPlayStartCoord: project.timebase.toTimeCoord(1.25),
    trackCount: 5,
  });
  const projection = TimelineProjection.fromCanvasRange(
    view,
    project.timebase.toTimeCoord(0.5),
    project.timebase.toTimeCoord(2.5),
    300,
  );

  assert.equal(view.viewEndCoord, project.timebase.toTimeCoord(5));
  assert.equal(view.exactTimelineGridWidthPx(), 496);
  assert.equal(view.pixelsPerCoord(), 496 / project.timebase.toTimeCoord(4));
  assert.equal(projection.canvasStartCoord, project.timebase.toTimeCoord(0.5));
  assert.equal(projection.canvasEndCoord, project.timebase.toTimeCoord(2.5));
  assert.equal(projection.canvasWidthPx, project.timebase.toTimeCoord(2) * view.pixelsPerCoord());
  assert.equal(projection.coordToCanvasX(project.timebase.toTimeCoord(0.5)), 0);
  assert.equal(projection.canvasXToCoord(projection.canvasWidthPx), project.timebase.toTimeCoord(2.5));
  assert.equal(projection.trackIndexToCanvasY(2), 120);
});
