/************************ timeline-frame-effects.test.ts ************************
 *
 * Purpose: Verify the branch-effect helpers extracted from the timeline renderer.
 * How: Exercise the public helpers with small fake ports so waveform cache updates and
 *      drag-overlay routing stay correct without requiring real DOM renderers.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS } from "../demo/clip/clip-presentation-inputs.js";
import { TimelineFrameEffects } from "../demo/timeline/timeline-frame-effects.js";
import { TimelineRenderHistoryState } from "../demo/timeline/timeline-render-history.js";

test("TimelineFrameEffects renders waveforms only when enabled and updates history", () => {
  const project = initProject("timeline-frame-effects-waveforms");
  const history = new TimelineRenderHistoryState();
  let renderCalls = 0;
  const displayStartCoord = project.timebase.toTimeCoord(1);
  const displayEndCoord = project.timebase.toTimeCoord(3);
  const frame = { displayStartCoord, displayEndCoord } as never;

  assert.equal(TimelineFrameEffects.renderWaveforms({
    enabled: false,
    surface: {
      renderWaveformsFrame() {
        throw new Error("renderWaveformsFrame should not be called");
      },
    },
    history,
    project,
    frame,
    bufferedViewport: true,
    dragContext: {
      dragState: null,
      clipRenderStartCoord: 0,
      alignmentGuideMagnetismPx: 0,
      exactTimelineZoomLevelIndex: 0,
    },
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
  }), null);
  assert.equal(renderCalls, 0);

  const models = TimelineFrameEffects.renderWaveforms({
    enabled: true,
    surface: {
      renderWaveformsFrame() {
        renderCalls += 1;
        return { visibleModels: [] };
      },
    },
    history,
    project,
    frame,
    bufferedViewport: true,
    dragContext: {
      dragState: null,
      clipRenderStartCoord: 0,
      alignmentGuideMagnetismPx: 0,
      exactTimelineZoomLevelIndex: 0,
    },
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
  });
  assert.deepEqual(models, []);
  assert.equal(renderCalls, 1);
  assert.equal(history.waveformDisplayChanged(displayStartCoord, displayEndCoord, true), false);
});

test("TimelineFrameEffects clears waveform caches and routes drag overlay decisions", () => {
  const project = initProject("timeline-frame-effects-overlay");
  const history = new TimelineRenderHistoryState();
  history.updateWaveforms({
    displayStartCoord: project.timebase.toTimeCoord(0.5),
    displayEndCoord: project.timebase.toTimeCoord(1.5),
    bufferedViewport: false,
  });

  TimelineFrameEffects.clearWaveforms({
    history,
  });
  assert.equal(history.previousWaveformDisplayStartCoord(), null);

  let renderCalls = 0;
  let clearCalls = 0;
  const overlay = {
    render() {
      renderCalls += 1;
    },
    clear() {
      clearCalls += 1;
    },
  };

  TimelineFrameEffects.renderDragOverlay({
    enabled: false,
    surface: {
      clearDragOverlay(innerOverlay) {
        innerOverlay.clear({} as never);
      },
      renderDragOverlay() {},
    },
    overlay: overlay as never,
    project,
    projection: {} as never,
    renderScale: {} as never,
    dragContext: {
      dragState: null,
      clipRenderStartCoord: 0,
      alignmentGuideMagnetismPx: 12,
      exactTimelineZoomLevelIndex: 0,
    },
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
  });
  assert.equal(clearCalls, 1);

  TimelineFrameEffects.renderDragOverlay({
    enabled: true,
    surface: {
      clearDragOverlay() {},
      renderDragOverlay(innerOverlay) {
        innerOverlay.render({} as never);
      },
    },
    overlay: overlay as never,
    project,
    projection: {} as never,
    renderScale: {} as never,
    dragContext: {
      dragState: {} as never,
      clipRenderStartCoord: 0,
      alignmentGuideMagnetismPx: 12,
      exactTimelineZoomLevelIndex: 0,
    },
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
  });
  assert.equal(renderCalls, 1);
});
