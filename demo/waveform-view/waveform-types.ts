/**************************** waveform-types.ts *******************************
 *
 * Purpose: Cache types for multi-resolution waveform data derived from audio
 *          resources. Feed waveform rendering at any zoom level.
 * How: Pair raw min/max pyramid levels with a compact texture-oriented
 *      counterpart ready for GPU consumption. Consumers: waveform-view/,
 *      timeline/timeline-waveform-preview.ts, track/track-activity.ts.
 *
 ******************************************************************************/

/**
 * Purpose: Represent one aggregated min/max waveform level over fixed-size sample buckets.
 * How: Store the bucket size and the parallel min/max/mean arrays used for fast envelope rendering.
 */
export type WaveformLevel = {
  samplesPerBucket: number;
  mins: Float32Array;
  maxs: Float32Array;
  means: Float32Array;
};

/**
 * Purpose: Represent one compact interleaved min/max waveform level ready for texture-style consumption.
 * How: Store the bucket size together with one packed float32x2 array laid out as [min0, max0, min1, max1, ...].
 */
export type WaveformTextureLevel = {
  bucketSizeSamples: number;
  bucketCount: number;
  packedMinMax: Float32Array;
};

/**
 * Purpose: Represent the compact texture-oriented waveform cache derived from one audio resource.
 * How: Index all retained min/max levels by their exact samples-per-bucket size.
 */
export type ResourceWaveformTextureBank = {
  levels: Map<number, WaveformTextureLevel>;
};

/**
 * Purpose: Represent the complete multi-resolution waveform cache derived from one audio resource.
 * How: Store the ordered min/max levels from the finest retained bucket size upward.
 */
export type WaveformPyramid = {
  levels: WaveformLevel[];
};
