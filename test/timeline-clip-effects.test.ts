/************************ timeline-clip-effects.test.ts ************************
 *
 * Purpose: Verify the clip-rebuild helper extracted from the timeline renderer.
 * How: Drive it with fake track, waveform, overlay, and perf ports so the branch
 *      behavior can be asserted without a DOM-backed timeline renderer.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { importAudioResource } from "../src/domain/audio-resource.js";
import { initProject } from "../src/domain/project.js";
import { placeClip } from "../src/domain/clip.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS } from "../demo/clip/clip-presentation-inputs.js";
import { TimelineClipEffects } from "../demo/timeline/timeline-clip-effects.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";
import { TimelineRenderHistoryState } from "../demo/timeline/timeline-render-history.js";
import { DAWRenderView } from "../demo/view/daw-render-view.js";

const resource = {
  id: "timeline-clip-effects-resource",
  sampleRate: 48_000,
  channels: 2,
  length: 96_000,
};

test("TimelineClipEffects rebuilds clip layers and returns rendered clip count", () => {
  const imported = importAudioResource(initProject("timeline-clip-effects"), resource);
  const project = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-1");
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
  let resizeCalls = 0;
  let renderWaveformCalls = 0;
  let renderOverlayCalls = 0;
  let trackViewCalls = 0;
  let cleaned = false;
  const dragContext = {
    dragState: {} as never,
    clipRenderStartCoord: view.viewStartCoord,
    alignmentGuideMagnetismPx: 12,
    exactTimelineZoomLevelIndex: 0,
  };
  const result = TimelineClipEffects.renderRebuild({
    surface: {
      resizeClipLayers() {
        resizeCalls += 1;
      },
      renderWaveformsFrame() {
        renderWaveformCalls += 1;
        return { visibleModels: [{ id: "clip-1" }] as never };
      },
      clearDragOverlay() {},
      renderDragOverlay() {
        renderOverlayCalls += 1;
      },
      renderTrackViews() {
        trackViewCalls += 1;
      },
    },
    project,
    viewStartCoord: view.viewStartCoord,
    viewEndCoord: view.viewEndCoord,
    geometry,
    renderScale: { levelIndex: 0 } as never,
    framePlan: {
      useBufferedWaveformViewport: true,
      previewOffsetPx: 12,
    } as never,
    frameSequence: {
      shouldBuildClipModels: true,
      shouldRenderWaveforms: true,
      shouldCollectDomModels: true,
      shouldRenderDragOverlay: true,
    } as never,
    waveformFrame: {
      displayStartCoord: view.viewStartCoord,
      displayEndCoord: view.viewEndCoord,
      displayProjection: geometry,
      windowChanged: false,
    },
    totalClipCount: 3,
    dragContext,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    trackViewState: {
      dragContext,
      selectedClipId: null,
    },
    history,
    dragOverlay: {} as never,
    setPanPreviewOffset() {},
    markClipRenderStructureClean() {
      cleaned = true;
    },
  });

  assert.equal(resizeCalls, 1);
  assert.equal(renderWaveformCalls, 1);
  assert.equal(renderOverlayCalls, 1);
  assert.equal(trackViewCalls, 1);
  assert.equal(cleaned, true);
  assert.equal(result.renderedClipCount, 1);
  assert.equal(history.hasRenderedClipWindow(), true);
  assert.equal(history.waveformDisplayChanged(view.viewStartCoord, view.viewEndCoord, true), false);
});

test("TimelineClipEffects skips optional work when the frame sequence disables it", () => {
  const project = initProject("timeline-clip-effects-light");
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
  let resizeCalls = 0;
  let renderWaveformCalls = 0;
  let renderOverlayCalls = 0;

  const dragContext = {
    dragState: null,
    clipRenderStartCoord: view.viewStartCoord,
    alignmentGuideMagnetismPx: 12,
    exactTimelineZoomLevelIndex: 0,
  };
  const result = TimelineClipEffects.renderRebuild({
    surface: {
      resizeClipLayers() {
        resizeCalls += 1;
      },
      renderWaveformsFrame() {
        renderWaveformCalls += 1;
        return { visibleModels: [] };
      },
      clearDragOverlay() {},
      renderDragOverlay() {
        renderOverlayCalls += 1;
      },
      renderTrackViews() {},
    },
    project,
    viewStartCoord: view.viewStartCoord,
    viewEndCoord: view.viewEndCoord,
    geometry,
    renderScale: { levelIndex: 0 } as never,
    framePlan: {
      useBufferedWaveformViewport: false,
      previewOffsetPx: 0,
    } as never,
    frameSequence: {
      shouldBuildClipModels: false,
      shouldRenderWaveforms: false,
      shouldCollectDomModels: false,
      shouldRenderDragOverlay: false,
    } as never,
    waveformFrame: {
      displayStartCoord: view.viewStartCoord,
      displayEndCoord: view.viewEndCoord,
      displayProjection: geometry,
      windowChanged: false,
    },
    totalClipCount: 1,
    dragContext,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    trackViewState: {
      dragContext,
      selectedClipId: null,
    },
    history: new TimelineRenderHistoryState(),
    dragOverlay: {} as never,
    setPanPreviewOffset() {},
    markClipRenderStructureClean() {},
  });

  assert.equal(resizeCalls, 1);
  assert.equal(renderWaveformCalls, 0);
  assert.equal(renderOverlayCalls, 0);
  assert.equal(result.renderedClipCount, 0);
});
