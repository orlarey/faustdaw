/************************ timeline-drag-frame.test.ts ************************
 *
 * Purpose: Verify the lightweight clip-drag frame helper extracted from the timeline renderer.
 * How: Exercise the fallback and incremental-overlay paths with fake ports so the helper can be
 *      validated without a DOM-backed renderer.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS } from "../demo/clip/clip-presentation-inputs.js";
import { TimelineDragFrame } from "../demo/timeline/timeline-drag-frame.js";
import { DAWRenderView } from "../demo/view/daw-render-view.js";

function buildView() {
  const project = initProject("timeline-drag-frame-view");
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

test("TimelineDragFrame falls back when drag preview detachment changes", () => {
  const project = initProject("timeline-drag-frame-fallback");
  const dragState = {
    previewDetachedFromBackground: false,
    previewStart: 1,
    sourceGroupStart: 0,
    sourceGroupMinTrackIndex: 0,
    previewTrackId: "fake-track",
  };
  let fallbackCalls = 0;
  let dirtyCalls = 0;
  let overlayCalls = 0;

  const dragContext = {
    dragState: dragState as never,
    clipRenderStartCoord: 0,
    alignmentGuideMagnetismPx: 12,
    exactTimelineZoomLevelIndex: 0,
  };
  TimelineDragFrame.render({
    project,
    view: buildView(),
    dragContext,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    historyHasRenderedClipWindow: true,
    clipRenderStructureDirty: false,
    surface: {
      renderDragOverlay() {
        overlayCalls += 1;
      },
      renderTrackViews() {},
    },
    renderScale: { levelIndex: 0 } as never,
    dragOverlay: {} as never,
    trackViewState: {
      dragContext,
      selectedClipId: null,
    },
    markClipRenderStructureDirty() {
      dirtyCalls += 1;
    },
    renderFallback() {
      fallbackCalls += 1;
    },
  });

  assert.equal(dragState.previewDetachedFromBackground, true);
  assert.equal(dirtyCalls, 1);
  assert.equal(fallbackCalls, 1);
  assert.equal(overlayCalls, 0);
});

test("TimelineDragFrame renders only the drag overlay and track views when the clip window is reusable", () => {
  const project = initProject("timeline-drag-frame-active");
  const dragState = {
    previewDetachedFromBackground: true,
    previewStart: 1,
    sourceGroupStart: 0,
    sourceGroupMinTrackIndex: 0,
    previewTrackId: "fake-track",
  };
  let fallbackCalls = 0;
  let overlayCalls = 0;
  let trackViewCalls = 0;
  let viewReads = 0;
  const view = (() => {
    viewReads += 1;
    return buildView();
  })();

  const dragContext = {
    dragState: dragState as never,
    clipRenderStartCoord: 0,
    alignmentGuideMagnetismPx: 12,
    exactTimelineZoomLevelIndex: 0,
  };
  TimelineDragFrame.render({
    project,
    view,
    dragContext,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    historyHasRenderedClipWindow: true,
    clipRenderStructureDirty: false,
    surface: {
      renderDragOverlay() {
        overlayCalls += 1;
      },
      renderTrackViews() {
        trackViewCalls += 1;
      },
    },
    renderScale: { levelIndex: 0 } as never,
    dragOverlay: {} as never,
    trackViewState: {
      dragContext,
      selectedClipId: null,
    },
    markClipRenderStructureDirty() {},
    renderFallback() {
      fallbackCalls += 1;
    },
  });

  assert.equal(viewReads, 1);
  assert.equal(overlayCalls, 1);
  assert.equal(trackViewCalls, 1);
  assert.equal(fallbackCalls, 0);
});
