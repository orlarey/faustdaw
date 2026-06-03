/************************ timeline-geometry-effects.test.ts ************************
 *
 * Purpose: Verify the geometry/ruler rebuild helper extracted from the timeline renderer.
 * How: Drive the helper with small fake ports and a real history object, then assert that
 *      it redraws the expected subsystems only when enabled and updates geometry history.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { TimelineGeometryEffects } from "../demo/timeline/timeline-geometry-effects.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";
import { TimelineRenderHistoryState } from "../demo/timeline/timeline-render-history.js";
import { DAWRenderView } from "../demo/view/daw-render-view.js";

test("TimelineGeometryEffects skips geometry rebuild work when disabled", () => {
  const project = initProject("timeline-geometry-effects-disabled");
  const view = DAWRenderView.fromSnapshot({
    exactTimelineZoomLevelIndex: 0,
    timebase: project.timebase,
    viewStartCoord: project.timebase.toTimeCoord(0),
    viewDurationCoord: project.timebase.toTimeCoord(4),
    viewportWidthPx: 640,
    viewportHeightPx: 240,
    cursorCoord: project.timeline.cursor,
    lastPlayStartCoord: null,
    trackCount: 4,
  });
  const geometry = TimelineProjection.fromView(view);
  const history = new TimelineRenderHistoryState();
  let gridCalls = 0;
  let rulerCalls = 0;

  TimelineGeometryEffects.renderRebuild({
    enabled: false,
    surface: {
      renderGridFrame() {
        gridCalls += 1;
      },
      renderRulerLabels() {
        rulerCalls += 1;
      },
    },
    gridFrame: {
      renderHeightPx: geometry.canvasHeightPx,
      renderStartCoord: view.viewStartCoord,
      renderEndCoord: view.viewEndCoord,
      renderWidthPx: geometry.canvasWidthPx,
      displayStartCoord: view.viewStartCoord,
      displayEndCoord: view.viewEndCoord,
      displayProjection: geometry,
      windowChanged: false,
    },
    renderScale: { levelIndex: 0 } as never,
    geometry,
    view,
    framePlan: { useBufferedGeometryViewport: false } as never,
    history,
    geometryRenderWindowStartCoord: view.viewStartCoord,
    geometryRenderWindowEndCoord: view.viewEndCoord,
    geometryRenderWidthPx: geometry.canvasWidthPx,
    totalClipCount: 0,
  });

  assert.equal(gridCalls, 0);
  assert.equal(rulerCalls, 0);
  assert.equal(history.previousGeometryDisplayStartCoord(), null);
});

test("TimelineGeometryEffects redraws grid and ruler and updates geometry history", () => {
  const project = initProject("timeline-geometry-effects-enabled");
  const view = DAWRenderView.fromSnapshot({
    exactTimelineZoomLevelIndex: 0,
    timebase: project.timebase,
    viewStartCoord: project.timebase.toTimeCoord(1),
    viewDurationCoord: project.timebase.toTimeCoord(4),
    viewportWidthPx: 640,
    viewportHeightPx: 240,
    cursorCoord: project.timeline.cursor,
    lastPlayStartCoord: null,
    trackCount: 4,
  });
  const geometry = TimelineProjection.fromView(view);
  const history = new TimelineRenderHistoryState();
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
  let gridCalls = 0;
  let rulerCalls = 0;

  TimelineGeometryEffects.renderRebuild({
    enabled: true,
    surface: {
      renderGridFrame() {
        gridCalls += 1;
      },
      renderRulerLabels() {
        rulerCalls += 1;
      },
    },
    gridFrame,
    renderScale: { levelIndex: 0 } as never,
    geometry,
    view,
    framePlan: { useBufferedGeometryViewport: true } as never,
    history,
    geometryRenderWindowStartCoord: view.viewStartCoord,
    geometryRenderWindowEndCoord: view.viewEndCoord,
    geometryRenderWidthPx: geometry.canvasWidthPx,
    totalClipCount: 3,
  });

  assert.equal(gridCalls, 1);
  assert.equal(rulerCalls, 1);
  assert.equal(history.previousGeometryDisplayStartCoord(), view.viewStartCoord);
  assert.equal(history.previousGeometryDisplayEndCoord(), view.viewEndCoord);
});
