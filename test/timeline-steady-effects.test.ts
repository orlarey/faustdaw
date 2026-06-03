/************************ timeline-steady-effects.test.ts ************************
 *
 * Purpose: Verify the lightweight steady branch helper extracted from the timeline renderer.
 * How: Drive it with fake waveform, overlay, and track ports so the branch can be
 *      validated without a DOM-backed timeline renderer.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS } from "../demo/clip/clip-presentation-inputs.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";
import { TimelineRenderHistoryState } from "../demo/timeline/timeline-render-history.js";
import { TimelineSteadyEffects } from "../demo/timeline/timeline-steady-effects.js";
import { DAWRenderView } from "../demo/view/daw-render-view.js";

test("TimelineSteadyEffects refreshes waveform, overlay, pan preview, and track views", () => {
  const project = initProject("timeline-steady-effects");
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
  let waveformCalls = 0;
  let overlayCalls = 0;
  let previewOffset: number | null = null;
  let trackViewCalls = 0;

  const dragContext = {
    dragState: {} as never,
    clipRenderStartCoord: view.viewStartCoord,
    alignmentGuideMagnetismPx: 12,
    exactTimelineZoomLevelIndex: 0,
  };
  TimelineSteadyEffects.render({
    project,
    geometry,
    renderScale: { levelIndex: 0 } as never,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    framePlan: {
      useBufferedWaveformViewport: true,
      previewOffsetPx: 24,
    } as never,
    frameSequence: {
      shouldRenderWaveforms: true,
      shouldRenderDragOverlay: true,
    } as never,
    waveformFrame: {
      displayStartCoord: view.viewStartCoord,
      displayEndCoord: view.viewEndCoord,
      displayProjection: geometry,
      windowChanged: false,
    },
    history,
    dragOverlay: {} as never,
    dragContext,
    trackViewState: {
      dragContext,
      selectedClipId: null,
    },
    setPanPreviewOffset(offsetPx) {
      previewOffset = offsetPx;
    },
    surface: {
      renderWaveformsFrame() {
        waveformCalls += 1;
        return { visibleModels: [] };
      },
      clearDragOverlay() {},
      renderDragOverlay() {
        overlayCalls += 1;
      },
      renderTrackViews() {
        trackViewCalls += 1;
      },
    },
  });

  assert.equal(waveformCalls, 1);
  assert.equal(overlayCalls, 1);
  assert.equal(previewOffset, 24);
  assert.equal(trackViewCalls, 1);
});

test("TimelineSteadyEffects respects disabled waveform and overlay work", () => {
  const project = initProject("timeline-steady-effects-disabled");
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
  let waveformCalls = 0;
  let overlayCalls = 0;
  let clearOverlayCalls = 0;

  const dragContext = {
    dragState: null,
    clipRenderStartCoord: view.viewStartCoord,
    alignmentGuideMagnetismPx: 12,
    exactTimelineZoomLevelIndex: 0,
  };
  TimelineSteadyEffects.render({
    project,
    geometry,
    renderScale: { levelIndex: 0 } as never,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    framePlan: {
      useBufferedWaveformViewport: false,
      previewOffsetPx: 0,
    } as never,
    frameSequence: {
      shouldRenderWaveforms: false,
      shouldRenderDragOverlay: false,
    } as never,
    waveformFrame: {
      displayStartCoord: view.viewStartCoord,
      displayEndCoord: view.viewEndCoord,
      displayProjection: geometry,
      windowChanged: false,
    },
    history: new TimelineRenderHistoryState(),
    dragOverlay: {} as never,
    dragContext,
    trackViewState: {
      dragContext,
      selectedClipId: null,
    },
    setPanPreviewOffset() {},
    surface: {
      renderWaveformsFrame() {
        waveformCalls += 1;
        return { visibleModels: [] };
      },
      clearDragOverlay() {
        clearOverlayCalls += 1;
      },
      renderDragOverlay() {
        overlayCalls += 1;
      },
      renderTrackViews() {},
    },
  });

  assert.equal(waveformCalls, 0);
  assert.equal(overlayCalls, 0);
  assert.equal(clearOverlayCalls, 1);
});
