/****************************** waveform.test.ts *******************************
 *
 * Purpose: Verify the waveform pyramid construction and level selection logic.
 * How: Build a small deterministic multichannel signal, then assert the bucket
 *      envelopes and threshold-based mode selection.
 *
 ******************************************************************************/
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWaveformLevelFromChannels,
  buildWaveformPyramidFromChannels,
  getExactWaveformBucketSizeSamples,
  getExactWaveformBucketSizesSamples,
  getWaveformEnvelopeLevel,
  shouldRenderDetailedWaveform,
  WAVEFORM_DETAIL_MAX_SAMPLES_PER_DEVICE_PIXEL,
} from "../demo/waveform.js";

function rounded(values: Float32Array | readonly number[]): number[] {
  return Array.from(values, (value) => Number(value.toFixed(3)));
}

test("getExactWaveformBucketSizesSamples lists bucket sizes above the device-pixel threshold", () => {
  // In Node `window` is undefined → currentDevicePixelRatio = 1, so the
  // CSS threshold equals WAVEFORM_DETAIL_MAX_SAMPLES_PER_DEVICE_PIXEL.
  // Only TimeScale levels with samplesPerPixel > threshold appear.
  const sizes = getExactWaveformBucketSizesSamples();
  assert.ok(sizes.every((s) => s > WAVEFORM_DETAIL_MAX_SAMPLES_PER_DEVICE_PIXEL));
  assert.deepEqual(sizes, [
    32,
    48,
    60,
    80,
    96,
    120,
    160,
    240,
    480,
    720,
    960,
    1200,
    1440,
    1800,
    2400,
    2880,
    3600,
    4800,
    7200,
  ]);
});

test("buildWaveformLevelFromChannels builds exact min/max levels aligned on sample zero", () => {
  const left = new Float32Array([
    -0.5, 0.25, -0.25, 0.4,
    0.1, -0.9, 0.8, -0.2,
    0.3, -0.1, 0.7, -0.4,
  ]);
  const right = new Float32Array([
    0.75, -0.8, 0.2, -0.6,
    -0.2, 0.5, -0.7, 0.6,
    -0.3, 0.9, -0.5, 0.1,
  ]);
  const length = left.length;

  const level2 = buildWaveformLevelFromChannels([left, right], length, 2);
  const level3 = buildWaveformLevelFromChannels([left, right], length, 3);
  const level4 = buildWaveformLevelFromChannels([left, right], length, 4);

  // Min / max are computed on the mono mixdown (L+R)/2, so they're tighter
  // than the cross-channel extremes that the previous implementation
  // produced. Means coincide with the previous implementation for 2-channel
  // input because (frameMin+frameMax)/2 = (L+R)/2 in that case.
  assert.equal(level2.samplesPerBucket, 2);
  assert.deepEqual(rounded(level2.mins), [-0.275, -0.1, -0.2, 0.05, 0, -0.15]);
  assert.deepEqual(rounded(level2.maxs), [0.125, -0.025, -0.05, 0.2, 0.4, 0.1]);
  assert.deepEqual(rounded(level2.means), [-0.075, -0.063, -0.125, 0.125, 0.2, -0.025]);

  assert.equal(level3.samplesPerBucket, 3);
  assert.deepEqual(rounded(level3.mins), [-0.275, -0.2, 0, -0.15]);
  assert.deepEqual(rounded(level3.maxs), [0.125, -0.05, 0.2, 0.4]);
  assert.deepEqual(rounded(level3.means), [-0.058, -0.117, 0.083, 0.117]);

  assert.equal(level4.samplesPerBucket, 4);
  assert.deepEqual(rounded(level4.mins), [-0.275, -0.2, -0.15]);
  assert.deepEqual(rounded(level4.maxs), [0.125, 0.2, 0.4]);
  assert.deepEqual(rounded(level4.means), [-0.069, 0, 0.087]);
});

test("buildWaveformPyramidFromChannels keeps only above-threshold bucket sizes", () => {
  const left = new Float32Array(64);
  for (let i = 0; i < left.length; i += 1) left[i] = (i % 2 === 0 ? 1 : -1) * 0.5;
  const pyramid = buildWaveformPyramidFromChannels([left], left.length);
  for (const level of pyramid.levels) {
    assert.ok(level.samplesPerBucket > WAVEFORM_DETAIL_MAX_SAMPLES_PER_DEVICE_PIXEL);
  }
  // The smallest retained level resolves through the public lookup helper.
  const smallest = pyramid.levels[0];
  if (smallest) {
    assert.equal(getWaveformEnvelopeLevel(smallest.samplesPerBucket, pyramid), smallest);
  }
});

test("waveform mode selection follows the device-pixel threshold", () => {
  // In Node `window` is undefined → currentDevicePixelRatio = 1, so the
  // CSS threshold equals WAVEFORM_DETAIL_MAX_SAMPLES_PER_DEVICE_PIXEL.
  const T = WAVEFORM_DETAIL_MAX_SAMPLES_PER_DEVICE_PIXEL;
  assert.equal(shouldRenderDetailedWaveform(T - 1), true);
  assert.equal(shouldRenderDetailedWaveform(T), true);
  assert.equal(shouldRenderDetailedWaveform(T + 1), false);
  assert.equal(getExactWaveformBucketSizeSamples(1, T), null);
  assert.equal(getExactWaveformBucketSizeSamples(1, T + 1), T + 1);
  assert.equal(getExactWaveformBucketSizeSamples(16, 1), null);
});
