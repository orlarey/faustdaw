/************************ timeline-frame-plan.test.ts ************************
 *
 * Purpose: Verify the pure frame-planning ADT extracted from the timeline renderer.
 * How: Build deterministic view, projection, history, and interaction snapshots,
 *      then assert the buffered/direct decisions and geometry-change detection.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { play } from "../src/domain/transport.js";
import { TimelineFramePlanner, type TimelineRenderHistory } from "../demo/timeline/timeline-frame-plan.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";
import { DAWRenderView } from "../demo/view/daw-render-view.js";

function buildEmptyHistory(): TimelineRenderHistory {
  return {
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
  };
}

test("TimelineFramePlanner enables buffered viewports during playback follow", () => {
  const project = play(initProject("timeline-frame-plan-playback"));
  const view = DAWRenderView.fromSnapshot({
    exactTimelineZoomLevelIndex: 0,
    timebase: project.timebase,
    viewStartCoord: project.timebase.toTimeCoord(2),
    viewDurationCoord: project.timebase.toTimeCoord(4),
    viewportWidthPx: 500,
    viewportHeightPx: 240,
    cursorCoord: project.timeline.cursor,
    lastPlayStartCoord: null,
    trackCount: 4,
  });
  const geometry = TimelineProjection.fromView(view);
  const gridFrame = {
    renderHeightPx: geometry.canvasHeightPx,
    renderStartCoord: view.viewStartCoord,
    renderEndCoord: view.viewEndCoord,
    renderWidthPx: geometry.canvasWidthPx,
    displayStartCoord: view.viewStartCoord,
    displayEndCoord: view.viewEndCoord,
    displayProjection: geometry,
    windowChanged: true,
  };

  const plan = TimelineFramePlanner.build({
    project,
    view,
    geometry,
    gridFrame,
    history: buildEmptyHistory(),
    dragState: null,
    rulerDragState: null,
    keepBufferedGeometryViewportWarm: false,
    playbackFollowPreviewOffsetPx: 24,
    clipRenderStructureDirty: false,
    geometryRenderWindowStartCoord: view.viewStartCoord,
    geometryRenderWindowEndCoord: view.viewEndCoord,
    freezeGeometryDuringPan: false,
  });

  assert.equal(plan.freezeDuringPlaybackFollow, true);
  assert.equal(plan.useBufferedGeometryViewport, true);
  assert.equal(plan.useBufferedWaveformViewport, true);
  assert.equal(plan.previewOffsetPx, 24);
  assert.equal(plan.shouldRefreshClipVisuals, false);
  assert.equal(plan.geometryChanged, true);
  assert.equal(plan.clipGeometryChanged, false);
});

test("TimelineFramePlanner reuses clip visuals during pan and reports unchanged windows", () => {
  const project = initProject("timeline-frame-plan-pan");
  const view = DAWRenderView.fromSnapshot({
    exactTimelineZoomLevelIndex: 0,
    timebase: project.timebase,
    viewStartCoord: project.timebase.toTimeCoord(1),
    viewDurationCoord: project.timebase.toTimeCoord(4),
    viewportWidthPx: 500,
    viewportHeightPx: 240,
    cursorCoord: project.timeline.cursor,
    lastPlayStartCoord: null,
    trackCount: 4,
  });
  const geometry = TimelineProjection.fromView(view);
  const gridFrame = {
    renderHeightPx: geometry.canvasHeightPx,
    renderStartCoord: view.viewStartCoord,
    renderEndCoord: view.viewEndCoord,
    renderWidthPx: geometry.canvasWidthPx,
    displayStartCoord: view.viewStartCoord,
    displayEndCoord: view.viewEndCoord,
    displayProjection: geometry,
    windowChanged: false,
  };
  const history: TimelineRenderHistory = {
    ...buildEmptyHistory(),
    lastRenderedGeometryWindowStartCoord: view.viewStartCoord,
    lastRenderedGeometryWindowEndCoord: view.viewEndCoord,
    lastRenderedGeometryPixelsPerCoord: geometry.pixelsPerCoord,
    lastRenderedGeometryGridWidthPx: geometry.canvasWidthPx,
    lastRenderedGeometryDisplayStartCoord: view.viewStartCoord,
    lastRenderedGeometryDisplayEndCoord: view.viewEndCoord,
    lastRenderedGeometryBufferedViewport: true,
    lastRenderedClipWindowStartCoord: project.timebase.toTimeCoord(0.5),
    lastRenderedClipWindowEndCoord: view.viewEndCoord,
    lastRenderedClipPixelsPerCoord: geometry.pixelsPerCoord,
    lastRenderedClipGridHeightPx: geometry.canvasHeightPx,
  };

  const plan = TimelineFramePlanner.build({
    project,
    view,
    geometry,
    gridFrame,
    history,
    dragState: null,
    rulerDragState: {
      pointerId: 1,
      startPointerX: 0,
      startPointerY: 0,
      lastPointerX: 20,
      lastPointerY: 0,
      lastPointerTimestampMs: 0,
      startZoomLevelIndex: 0,
      gridWidthPx: view.viewportWidthPx,
      gridHeightPx: view.viewportHeightPx,
      pendingZoomDeltaY: 0,
      panPreviewOffsetPx: -18,
      panCommittedOffsetPx: 0,
      panVelocityPxPerMs: 0,
      mode: "pan",
    },
    keepBufferedGeometryViewportWarm: false,
    playbackFollowPreviewOffsetPx: 0,
    clipRenderStructureDirty: false,
    geometryRenderWindowStartCoord: view.viewStartCoord,
    geometryRenderWindowEndCoord: view.viewEndCoord,
    freezeGeometryDuringPan: true,
  });

  assert.equal(plan.useBufferedGeometryViewport, true);
  assert.equal(plan.useBufferedWaveformViewport, true);
  assert.equal(plan.previewOffsetPx, -18);
  assert.equal(plan.shouldRefreshClipVisuals, false);
  assert.equal(plan.clipDisplayStartCoord, history.lastRenderedClipWindowStartCoord);
  assert.equal(plan.geometryChanged, false);
  assert.equal(plan.clipGeometryChanged, false);
});
