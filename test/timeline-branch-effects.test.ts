/************************ timeline-branch-effects.test.ts ************************
 *
 * Purpose: Verify the specialized direct-zoom and empty branch helpers.
 * How: Exercise them with fake ports so the branch dispatch can be validated without
 *      a browser-backed timeline renderer.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS } from "../demo/clip/clip-presentation-inputs.js";
import { TimelineBranchEffects } from "../demo/timeline/timeline-branch-effects.js";
import { TimelineRenderHistoryState } from "../demo/timeline/timeline-render-history.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";
import { DAWRenderView } from "../demo/view/daw-render-view.js";

function buildView(project = initProject("timeline-branch-effects")) {
  return DAWRenderView.fromSnapshot({
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
}

test("TimelineBranchEffects renders the direct-zoom branch without clip layers when no waveforms are needed", () => {
  const project = initProject("timeline-branch-direct");
  const view = buildView(project);
  const geometry = TimelineProjection.fromView(view);
  let directGridCalls = 0;
  let renderDirectWaveformsCalls = 0;
  let clearDragOverlayCalls = 0;
  let renderTrackViewsCalls = 0;

  const dragContext = {
    dragState: null,
    clipRenderStartCoord: view.viewStartCoord,
    alignmentGuideMagnetismPx: 0,
    exactTimelineZoomLevelIndex: 0,
  };
  TimelineBranchEffects.renderDirectZoom({
    project,
    view,
    geometry,
    renderScale: { levelIndex: 0 } as never,
    geometryRenderHeightPx: geometry.canvasHeightPx,
    frameSequence: { shouldRenderWaveforms: false } as never,
    timelineSurface: {
      syncFrame() {},
      negativeOverlayWidthPx() { return 0; },
      lastPlayStartLeftPx() { return null; },
      clipRenderStartCoord() { return view.viewStartCoord; },
    } as never,
    sceneSurface: {
      renderChrome() {},
      renderDirectGridFrame() {
        directGridCalls += 1;
      },
      renderDirectWaveforms() {
        renderDirectWaveformsCalls += 1;
      },
      clearDragOverlay() {
        clearDragOverlayCalls += 1;
      },
      renderTrackViews() {
        renderTrackViewsCalls += 1;
      },
    } as never,
    dragOverlay: {} as never,
    dragContext,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    trackViewState: {
      dragContext,
      selectedClipId: null,
    },
    cursorDragActive: false,
    rulerDragging: false,
    setCursorDragFeedback() {},
    setPanPreviewOffset() {},
  });

  assert.equal(directGridCalls, 1);
  assert.equal(renderDirectWaveformsCalls, 1);
  assert.equal(clearDragOverlayCalls, 1);
  assert.equal(renderTrackViewsCalls, 1);
});

test("TimelineBranchEffects clears the empty branch and marks clip structure clean", () => {
  const project = initProject("timeline-branch-empty");
  const view = buildView(project);
  const geometry = TimelineProjection.fromView(view);
  const history = new TimelineRenderHistoryState();
  history.updateWaveforms({
    displayStartCoord: project.timebase.toTimeCoord(0.5),
    displayEndCoord: project.timebase.toTimeCoord(1.5),
    bufferedViewport: false,
  });
  let clearDragOverlayCalls = 0;
  let renderTrackViewsCalls = 0;
  let cleaned = false;

  TimelineBranchEffects.renderEmpty({
    project,
    view,
    geometry,
    renderScale: { levelIndex: 0 } as never,
    framePlan: {
      useBufferedGeometryViewport: false,
      clipDisplayStartCoord: view.viewStartCoord,
      previewOffsetPx: 18,
    } as never,
    timelineSurface: {
      syncFrame() {},
      clipRenderStartCoord() { return view.viewStartCoord; },
    } as never,
    sceneSurface: {
      renderChrome() {},
      renderDirectGridFrame() {},
      renderDirectWaveforms() {},
      clearDragOverlay() {
        clearDragOverlayCalls += 1;
      },
      renderTrackViews() {
        renderTrackViewsCalls += 1;
      },
    } as never,
    history,
    dragOverlay: {} as never,
    trackViewState: {
      dragContext: {
        dragState: null,
        clipRenderStartCoord: view.viewStartCoord,
        alignmentGuideMagnetismPx: 0,
        exactTimelineZoomLevelIndex: 0,
      },
      selectedClipId: null,
    },
    markClipRenderStructureClean() {
      cleaned = true;
    },
    setPanPreviewOffset() {},
  });

  assert.equal(clearDragOverlayCalls, 1);
  assert.equal(renderTrackViewsCalls, 1);
  assert.equal(cleaned, true);
  assert.equal(history.previousWaveformDisplayStartCoord(), null);
});
