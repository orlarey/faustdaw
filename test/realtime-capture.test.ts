/****************************** realtime-capture.test.ts ***********************
 *
 * Purpose: Check how the real-time export lays frame-dated chunks on the
 *          frame axis: it starts exactly at the anchor frame, keeps every
 *          captured sample in place, and reports what was not captured.
 * How: Feed assembleCapture hand-made chunks (before / across / after the
 *      anchor, with a gap, mono into stereo) and compare sample by sample.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { assembleCapture, type CapturedChunk } from "../demo/realtime-capture.js";

function ramp(startFrame: number, length: number, channels = 2): CapturedChunk {
  return {
    startFrame,
    channels: Array.from({ length: channels }, (_, c) => Float32Array.from({ length }, (_, i) => (startFrame + i) + c * 0.5)),
  };
}

test("the file starts exactly on the anchor frame; earlier frames are dropped", () => {
  const { channels, missingFrames } = assembleCapture([ramp(1000, 512), ramp(1512, 512)], 1200, 2);
  assert.equal(channels[0]!.length, 1024 + 1000 - 1200);
  assert.equal(channels[0]![0], 1200); // sample value = its frame number
  assert.equal(channels[1]![0], 1200.5);
  assert.equal(channels[0]!.at(-1), 2023);
  assert.equal(missingFrames, 0);
});

test("every captured sample keeps its frame position across chunks", () => {
  const { channels } = assembleCapture([ramp(0, 128), ramp(128, 4096), ramp(4224, 300)], 0, 2);
  for (let i = 0; i < channels[0]!.length; i++) {
    assert.equal(channels[0]![i], i);
  }
});

test("a gap between chunks stays silent and is counted, without shifting what follows", () => {
  const { channels, missingFrames } = assembleCapture([ramp(0, 256), ramp(384, 256)], 0, 2);
  assert.equal(missingFrames, 128);
  assert.equal(channels[0]![255], 255);
  assert.equal(channels[0]![300], 0);
  assert.equal(channels[0]![384], 384);
});

test("a capture that began after the anchor is padded and counted", () => {
  const { channels, missingFrames } = assembleCapture([ramp(1100, 100)], 1000, 2);
  assert.equal(missingFrames, 100);
  assert.equal(channels[0]![99], 0);
  assert.equal(channels[0]![100], 1100);
});

test("mono chunks fill both channels; no chunk gives an empty capture", () => {
  const { channels } = assembleCapture([ramp(0, 4, 1)], 0, 2);
  assert.deepEqual(Array.from(channels[1]!), [0, 1, 2, 3]);
  assert.equal(assembleCapture([], 500, 2).channels[0]!.length, 0);
});
