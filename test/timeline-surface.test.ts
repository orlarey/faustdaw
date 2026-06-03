/************************ timeline-surface.test.ts ************************
 *
 * Purpose: Verify the timeline surface ADT that composes layer offsets and markers.
 * How: Build deterministic DAW-view and projection snapshots, then assert the derived
 *      pan-preview offsets and visible marker positions without touching the DOM.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";
import { TimelineSurface } from "../demo/timeline/timeline-surface.js";
import { DAWRenderView } from "../demo/view/daw-render-view.js";

test("TimelineSurface builds one composition frame from buffered and visible projections", () => {
  const project = initProject("timeline-surface");
  const view = DAWRenderView.fromSnapshot({
    exactTimelineZoomLevelIndex: 0,
    timebase: project.timebase,
    viewStartCoord: project.timebase.toTimeCoord(4),
    viewDurationCoord: project.timebase.toTimeCoord(4),
    viewportWidthPx: 500,
    viewportHeightPx: 240,
    cursorCoord: project.timebase.toTimeCoord(5),
    lastPlayStartCoord: project.timebase.toTimeCoord(4.5),
    trackCount: 4,
  });
  const visibleProjection = TimelineProjection.fromView(view);
  const geometryDisplayProjection = TimelineProjection.fromCanvasRange(
    view,
    project.timebase.toTimeCoord(3),
    project.timebase.toTimeCoord(9),
    view.viewportHeightPx,
  );

  const frame = TimelineSurface.buildFrame({
    view,
    visibleProjection,
    geometryDisplayProjection,
    useBufferedGeometryViewport: true,
    clipDisplayStartCoord: project.timebase.toTimeCoord(3.5),
  });

  assert.equal(frame.geometryRenderOffsetPx, geometryDisplayProjection.coordToCanvasX(view.viewStartCoord));
  assert.equal(
    frame.clipRenderOffsetPx,
    (view.viewStartCoord - project.timebase.toTimeCoord(3.5)) * visibleProjection.pixelsPerCoord,
  );
  assert.equal(frame.clipRenderStartCoord, view.viewStartCoord);
  assert.equal(frame.playheadLeftPx, visibleProjection.coordToCanvasX(view.cursorCoord));
  assert.equal(frame.lastPlayStartLeftPx, visibleProjection.coordToCanvasX(view.lastPlayStartCoord ?? view.viewStartCoord));
});

test("TimelineSurface hides the last-play marker when it is outside the visible view", () => {
  const project = initProject("timeline-surface-hidden-marker");
  const view = DAWRenderView.fromSnapshot({
    exactTimelineZoomLevelIndex: 0,
    timebase: project.timebase,
    viewStartCoord: project.timebase.toTimeCoord(2),
    viewDurationCoord: project.timebase.toTimeCoord(4),
    viewportWidthPx: 500,
    viewportHeightPx: 240,
    cursorCoord: project.timebase.toTimeCoord(3),
    lastPlayStartCoord: project.timebase.toTimeCoord(7),
    trackCount: 4,
  });
  const visibleProjection = TimelineProjection.fromView(view);

  const frame = TimelineSurface.buildFrame({
    view,
    visibleProjection,
    geometryDisplayProjection: visibleProjection,
    useBufferedGeometryViewport: false,
    clipDisplayStartCoord: view.viewStartCoord,
  });

  assert.equal(frame.lastPlayStartLeftPx, null);
});
