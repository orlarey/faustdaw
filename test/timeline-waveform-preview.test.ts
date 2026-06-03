/************************ timeline-waveform-preview.test.ts ************************
 *
 * Purpose: Verify the direct visible-waveform preview helper extracted from the timeline renderer.
 * How: Drive it with fake surface and waveform ports so the helper can be validated without a browser canvas.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS } from "../demo/clip/clip-presentation-inputs.js";
import { TimelineWaveformPreview } from "../demo/timeline/timeline-waveform-preview.js";
import { DAWRenderView } from "../demo/view/daw-render-view.js";

function buildView(project = initProject("timeline-waveform-preview-view")) {
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

test("TimelineWaveformPreview does nothing when the project has no clips", () => {
  const project = initProject("timeline-waveform-preview-empty");
  let syncCalls = 0;
  let renderCalls = 0;

  TimelineWaveformPreview.render({
    project,
    view: buildView(project),
    renderScale: { levelIndex: 0 } as never,
    totalClipCount: 0,
    dragState: null,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    sceneSurface: {
      renderDirectWaveforms() {
        renderCalls += 1;
      },
    },
    timelineSurface: {
      syncFrame() {
        syncCalls += 1;
        return {} as never;
      },
    },
    setPanPreviewOffset() {},
  });

  assert.equal(syncCalls, 0);
  assert.equal(renderCalls, 0);
});

test("TimelineWaveformPreview redraws the visible waveform canvas and resets pan preview", () => {
  const project = initProject("timeline-waveform-preview-direct");
  let syncCalls = 0;
  let renderCalls = 0;
  let previewOffset: number | null = null;

  TimelineWaveformPreview.render({
    project,
    view: buildView(project),
    renderScale: { levelIndex: 0 } as never,
    totalClipCount: 3,
    dragState: null,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    sceneSurface: {
      renderDirectWaveforms() {
        renderCalls += 1;
      },
    },
    timelineSurface: {
      syncFrame() {
        syncCalls += 1;
        return {} as never;
      },
    },
    setPanPreviewOffset(offsetPx) {
      previewOffset = offsetPx;
    },
  });

  assert.equal(syncCalls, 1);
  assert.equal(renderCalls, 1);
  assert.equal(previewOffset, 0);
});
