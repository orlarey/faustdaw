/************************ timeline-frame-sequence.test.ts ************************
 *
 * Purpose: Verify that timeline frame sequencing selects the correct render branch.
 * How: Feed the sequencer representative frame-plan snapshots and assert the resulting
 *      mode plus the secondary waveform, clip, and drag-overlay work it requests.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import type { TimelineFramePlan } from "../demo/timeline/timeline-frame-plan.js";
import { TimelineFrameSequencer } from "../demo/timeline/timeline-frame-sequence.js";

function buildFramePlan(overrides: Partial<TimelineFramePlan> = {}): TimelineFramePlan {
  return {
    rulerGestureMode: null,
    freezeDuringPlaybackFollow: false,
    useBufferedGeometryViewport: false,
    useBufferedWaveformViewport: false,
    previewOffsetPx: 0,
    freezeBackgroundRasterDuringInteraction: false,
    freezeClipVisualsDuringInteraction: false,
    shouldRefreshClipVisuals: true,
    useDirectZoomViewportRendering: false,
    clipDisplayStartCoord: 0,
    geometryChanged: false,
    geometryWindowChanged: false,
    clipWindowChanged: false,
    clipGeometryChanged: false,
    ...overrides,
  };
}

test("TimelineFrameSequencer prioritizes direct zoom rendering", () => {
  const sequence = TimelineFrameSequencer.build({
    framePlan: buildFramePlan({
      useDirectZoomViewportRendering: true,
      clipGeometryChanged: true,
    }),
    totalClipCount: 3,
    waveformWindowChanged: true,
    waveformDisplayChanged: true,
    clipRenderStructureDirty: true,
    dragActive: true,
  });

  assert.equal(sequence.mode, "direct-zoom");
  assert.equal(sequence.shouldRenderWaveforms, true);
  assert.equal(sequence.shouldBuildClipModels, false);
  assert.equal(sequence.shouldCollectDomModels, false);
  assert.equal(sequence.shouldRenderDragOverlay, false);
});

test("TimelineFrameSequencer returns rebuild mode for zero-clip projects", () => {
  const sequence = TimelineFrameSequencer.build({
    framePlan: buildFramePlan({
      clipGeometryChanged: true,
    }),
    totalClipCount: 0,
    waveformWindowChanged: true,
    waveformDisplayChanged: true,
    clipRenderStructureDirty: true,
    dragActive: true,
  });

  assert.equal(sequence.mode, "rebuild");
  assert.equal(sequence.shouldRenderWaveforms, true);
  assert.equal(sequence.shouldBuildClipModels, true);
  assert.equal(sequence.shouldRenderDragOverlay, true);
});

test("TimelineFrameSequencer keeps steady frames lightweight", () => {
  const sequence = TimelineFrameSequencer.build({
    framePlan: buildFramePlan({
      clipGeometryChanged: false,
      freezeBackgroundRasterDuringInteraction: true,
      shouldRefreshClipVisuals: false,
    }),
    totalClipCount: 2,
    waveformWindowChanged: false,
    waveformDisplayChanged: false,
    clipRenderStructureDirty: false,
    dragActive: true,
  });

  assert.equal(sequence.mode, "steady");
  assert.equal(sequence.shouldRenderWaveforms, false);
  assert.equal(sequence.shouldBuildClipModels, false);
  assert.equal(sequence.shouldCollectDomModels, false);
  assert.equal(sequence.shouldRenderDragOverlay, true);
});

test("TimelineFrameSequencer requests full rebuild work when clip geometry changes", () => {
  const sequence = TimelineFrameSequencer.build({
    framePlan: buildFramePlan({
      clipGeometryChanged: true,
      freezeBackgroundRasterDuringInteraction: true,
      shouldRefreshClipVisuals: true,
    }),
    totalClipCount: 2,
    waveformWindowChanged: false,
    waveformDisplayChanged: false,
    clipRenderStructureDirty: true,
    dragActive: false,
  });

  assert.equal(sequence.mode, "rebuild");
  assert.equal(sequence.shouldRenderWaveforms, true);
  assert.equal(sequence.shouldBuildClipModels, true);
  assert.equal(sequence.shouldCollectDomModels, true);
  assert.equal(sequence.shouldRenderDragOverlay, false);
});

test("TimelineFrameSequencer always renders waveforms when rebuild work must refresh clip visuals", () => {
  const sequence = TimelineFrameSequencer.build({
    framePlan: buildFramePlan({
      clipGeometryChanged: true,
      freezeBackgroundRasterDuringInteraction: true,
      shouldRefreshClipVisuals: true,
    }),
    totalClipCount: 2,
    waveformWindowChanged: false,
    waveformDisplayChanged: false,
    clipRenderStructureDirty: false,
    dragActive: false,
  });

  assert.equal(sequence.mode, "rebuild");
  assert.equal(sequence.shouldBuildClipModels, true);
  assert.equal(sequence.shouldCollectDomModels, true);
  assert.equal(sequence.shouldRenderWaveforms, true);
});
