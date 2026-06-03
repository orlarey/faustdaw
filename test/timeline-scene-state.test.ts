/************************ timeline-scene-state.test.ts ************************
 *
 * Purpose: Verify the internal timeline scene state ADT keeps cache invalidation and full reset coherent.
 * How: Exercise the scene-local history and reset paths with a stub waveform port and assert the coupled state changes.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { demoState } from "../demo/state.js";
import { TimelineSceneState } from "../demo/timeline/timeline-scene-state.js";

test("TimelineSceneState invalidates waveform buffers and clears waveform history together", () => {
  const project = initProject("timeline-scene-state-waveforms");
  const sceneState = new TimelineSceneState();
  const displayStartCoord = project.timebase.toTimeCoord(1);
  const displayEndCoord = project.timebase.toTimeCoord(3);

  sceneState.history().updateWaveforms({
    displayStartCoord,
    displayEndCoord,
    bufferedViewport: true,
  });
  assert.equal(sceneState.history().waveformDisplayChanged(displayStartCoord, displayEndCoord, true), false);

  sceneState.invalidateWaveformSlidingBuffers();

  assert.equal(sceneState.history().waveformDisplayChanged(displayStartCoord, displayEndCoord, true), true);
});

test("TimelineSceneState resets full-render scene fields and cached clip history together", () => {
  const project = initProject("timeline-scene-state-reset");
  const sceneState = new TimelineSceneState();
  const previous = {
    clipRenderStableStartCoord: demoState.clipRenderStable.startCoord,
    clipRenderStableEndCoord: demoState.clipRenderStable.endCoord,
    clipRenderStructureDirty: demoState.clipRenderStable.dirty,
    geometryWindow: { ...demoState.geometryWindow },
  };

  try {
    sceneState.history().updateClips({
      windowStartCoord: project.timebase.toTimeCoord(1),
      windowEndCoord: project.timebase.toTimeCoord(2),
      pixelsPerCoord: 10,
      gridHeightPx: 200,
    });
    demoState.clipRenderStable.startCoord = 11;
    demoState.clipRenderStable.endCoord = 12;
    demoState.clipRenderStable.dirty = true;
    demoState.geometryWindow.stableStart = 21;
    demoState.geometryWindow.stableEnd = 22;
    demoState.geometryWindow.displayStart = 31;
    demoState.geometryWindow.displayEnd = 32;
    demoState.geometryWindow.keepWarm = true;

    sceneState.resetForFullRender({
      resetStableWindows() {
        demoState.clipRenderStable.startCoord = null;
        demoState.clipRenderStable.endCoord = null;
        demoState.clipRenderStable.dirty = false;
        demoState.geometryWindow.stableStart = null;
        demoState.geometryWindow.stableEnd = null;
        demoState.geometryWindow.displayStart = null;
        demoState.geometryWindow.displayEnd = null;
        demoState.geometryWindow.keepWarm = false;
      },
    });

    assert.equal(sceneState.history().hasRenderedClipWindow(), false);
    assert.equal(demoState.clipRenderStable.startCoord, null);
    assert.equal(demoState.clipRenderStable.endCoord, null);
    assert.equal(demoState.clipRenderStable.dirty, false);
    assert.equal(demoState.geometryWindow.stableStart, null);
    assert.equal(demoState.geometryWindow.stableEnd, null);
    assert.equal(demoState.geometryWindow.displayStart, null);
    assert.equal(demoState.geometryWindow.displayEnd, null);
    assert.equal(demoState.geometryWindow.keepWarm, false);
  } finally {
    demoState.clipRenderStable.startCoord = previous.clipRenderStableStartCoord;
    demoState.clipRenderStable.endCoord = previous.clipRenderStableEndCoord;
    demoState.clipRenderStable.dirty = previous.clipRenderStructureDirty;
    demoState.geometryWindow.stableStart = previous.geometryWindow.stableStart;
    demoState.geometryWindow.stableEnd = previous.geometryWindow.stableEnd;
    demoState.geometryWindow.displayStart = previous.geometryWindow.displayStart;
    demoState.geometryWindow.displayEnd = previous.geometryWindow.displayEnd;
    demoState.geometryWindow.keepWarm = previous.geometryWindow.keepWarm;
  }
});
