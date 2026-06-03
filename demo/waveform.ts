/******************************** waveform.ts *********************************
 *
 * Purpose: Build and query the exact waveform envelope levels used by the
 *          timeline renderer.
 * How: Derive one exact bucket size per coarse zoom level from the exact zoom
 *      table, aggregate per-resource min/max buckets at those exact sizes, and
 *      select the level whose bucket size matches the current zoom.
 *
 ******************************************************************************/
import { TimeScale } from "./time-scale.js";
import type { ResourceWaveformTextureBank, WaveformLevel, WaveformPyramid, WaveformTextureLevel } from "./waveform-view/waveform-types.js";

type WaveformWorkerRequest = {
  requestId: number;
  channels: ArrayBuffer[];
  length: number;
  prioritizedBucketSizeSamples: number | null;
};
type WaveformWorkerLevelResponse = {
  requestId: number;
  level: WaveformLevel;
};
type WaveformWorkerDoneResponse = {
  requestId: number;
  done: true;
};
type WaveformWorkerErrorResponse = {
  requestId: number;
  error: string;
};
type WaveformWorkerResponse = WaveformWorkerLevelResponse | WaveformWorkerDoneResponse | WaveformWorkerErrorResponse;

let waveformWorker: Worker | null = null;
let nextWaveformWorkerRequestId = 1;
const pendingWaveformWorkerRequests = new Map<number, {
  levels: Map<number, WaveformLevel>;
  onUpdate?: (value: WaveformPyramid) => void;
  resolve: (value: WaveformPyramid) => void;
  reject: (reason?: unknown) => void;
}>();

function getSortedWaveformLevels(levels: Iterable<WaveformLevel>): WaveformLevel[] {
  return Array.from(levels).sort((left, right) => left.samplesPerBucket - right.samplesPerBucket);
}

function handleWaveformWorkerMessage(event: MessageEvent<WaveformWorkerResponse>): void {
  const message = event.data;
  const pending = pendingWaveformWorkerRequests.get(message.requestId);
  if (!pending) {
    return;
  }
  if ("error" in message) {
    pendingWaveformWorkerRequests.delete(message.requestId);
    pending.reject(new Error(message.error));
    return;
  }
  if ("done" in message) {
    pendingWaveformWorkerRequests.delete(message.requestId);
    pending.resolve({ levels: getSortedWaveformLevels(pending.levels.values()) });
    return;
  }
  pending.levels.set(message.level.samplesPerBucket, message.level);
  pending.onUpdate?.({ levels: getSortedWaveformLevels(pending.levels.values()) });
}

function getWaveformWorker(): Worker | null {
  if (typeof Worker === "undefined") {
    return null;
  }
  if (waveformWorker) {
    return waveformWorker;
  }
  waveformWorker = new Worker(new URL("./waveform-worker.js", import.meta.url), { type: "module" });
  waveformWorker.addEventListener("message", handleWaveformWorkerMessage);
  waveformWorker.addEventListener("error", (event) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || "Waveform worker failed");
    for (const pending of pendingWaveformWorkerRequests.values()) {
      pending.reject(error);
    }
    pendingWaveformWorkerRequests.clear();
    waveformWorker = null;
  });
  return waveformWorker;
}

/**
 * Purpose: Decide whether the timeline zoom should render in `detailed` or
 *          `envelope` regime, and pick the bucket size for envelope mode.
 * How: The threshold is expressed in **device pixels** (so it scales with
 *      `devicePixelRatio`) — visual fidelity is gated by samples per device
 *      pixel, not per CSS pixel, and on a 2× display the detailed regime
 *      can cover twice as many CSS samples-per-pixel before switching out.
 *      `getExactWaveformBucketSizeSamples` converts the threshold back to
 *      CSS-pixel space using the current DPR.
 */
export const WAVEFORM_DETAIL_MAX_SAMPLES_PER_DEVICE_PIXEL = 24;

function currentDevicePixelRatio(): number {
  if (typeof window === "undefined") return 1;
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

export function getExactWaveformBucketSizeSamples(zoomPixels: number, zoomSamples: number): number | null {
  const cssThreshold = WAVEFORM_DETAIL_MAX_SAMPLES_PER_DEVICE_PIXEL * currentDevicePixelRatio();
  if (zoomPixels * cssThreshold >= zoomSamples) {
    return null;
  }
  return zoomSamples;
}

/**
 * Purpose: Return the exact waveform bucket sizes implied by the coarse exact zoom levels.
 * How: Keep the distinct zoom sample ratios only for levels where one pixel spans multiple samples.
 */
export function getExactWaveformBucketSizesSamples(): number[] {
  const bucketSizes = new Set<number>();
  for (const level of TimeScale.levels) {
    const bucketSizeSamples = getExactWaveformBucketSizeSamples(level.zoomPixels, level.zoomSamples);
    if (bucketSizeSamples !== null) {
      bucketSizes.add(bucketSizeSamples);
    }
  }
  return Array.from(bucketSizes).sort((left, right) => left - right);
}

/**
 * Purpose: Order waveform bucket sizes so the most immediately useful one can be built first.
 * How: Move the preferred bucket size to the front when it exists, while keeping all other exact levels available afterward.
 */
export function getPrioritizedWaveformBucketSizesSamples(preferredBucketSizeSamples: number | null): number[] {
  const bucketSizes = getExactWaveformBucketSizesSamples();
  if (preferredBucketSizeSamples === null) {
    return bucketSizes;
  }
  const preferredIndex = bucketSizes.indexOf(preferredBucketSizeSamples);
  if (preferredIndex < 0) {
    return bucketSizes;
  }
  return [
    bucketSizes[preferredIndex]!,
    ...bucketSizes.slice(0, preferredIndex),
    ...bucketSizes.slice(preferredIndex + 1),
  ];
}

/**
 * Purpose: Build one exact min/max envelope level for a specific bucket size,
 *          on the **mono mixdown** of the channels (the standard DAW
 *          convention for waveform display).
 * How: For each frame, project the multi-channel sample to mono via the
 *      arithmetic mean of all channels, then track min / max / mean on
 *      that single signal. This guarantees the envelope renderer (bars,
 *      band) and the detailed renderer (polyline, also drawing the
 *      mono-projected sample per frame) read coherent data — anti-
 *      correlated stereo collapses to silence for both, asymmetric
 *      stereo gives the same amplitude envelope in both regimes.
 */
export function buildWaveformLevelFromChannels(
  channels: readonly Float32Array[],
  length: number,
  samplesPerBucket: number,
): WaveformLevel {
  const bucketCount = Math.ceil(length / samplesPerBucket);
  const mins = new Float32Array(bucketCount);
  const maxs = new Float32Array(bucketCount);
  const means = new Float32Array(bucketCount);
  const channelCount = Math.max(1, channels.length);

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = bucketIndex * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, length);
    let min = 1;
    let max = -1;
    let monoSum = 0;

    for (let frame = start; frame < end; frame += 1) {
      let monoSample = 0;
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        monoSample += channels[channelIndex]?.[frame] ?? 0;
      }
      monoSample /= channelCount;
      if (monoSample < min) min = monoSample;
      if (monoSample > max) max = monoSample;
      monoSum += monoSample;
    }

    mins[bucketIndex] = min;
    maxs[bucketIndex] = max;
    means[bucketIndex] = end > start ? monoSum / (end - start) : 0;
  }

  return {
    samplesPerBucket,
    mins,
    maxs,
    means,
  };
}

/**
 * Purpose: Build the exact waveform envelope bank from decoded multichannel audio samples.
 * How: Precompute one min/max level per exact coarse zoom bucket size derived from the exact zoom table.
 */
export function buildWaveformPyramidFromChannels(
  channels: readonly Float32Array[],
  length: number,
): WaveformPyramid {
  if (length <= 0 || channels.length === 0) {
    return { levels: [] };
  }

  const levels = getExactWaveformBucketSizesSamples().map((samplesPerBucket) =>
    buildWaveformLevelFromChannels(channels, length, samplesPerBucket));

  return { levels };
}

/**
 * Purpose: Build the exact waveform envelope bank directly from one AudioBuffer.
 * How: Read all channels once and delegate to the generic multichannel builder.
 */
export function buildWaveformPyramid(audioBuffer: AudioBuffer): WaveformPyramid {
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    channels.push(audioBuffer.getChannelData(channel));
  }
  return buildWaveformPyramidFromChannels(channels, audioBuffer.length);
}

/**
 * Purpose: Build the exact waveform pyramid without blocking the main UI thread during large imports.
 * How: Copy channel data into transferable buffers, send them to a dedicated worker, and fall back to the synchronous builder if workers are unavailable.
 */
export function buildWaveformPyramidInBackground(
  audioBuffer: AudioBuffer,
  preferredBucketSizeSamples: number | null = null,
  onUpdate?: (value: WaveformPyramid) => void,
): Promise<WaveformPyramid> {
  const worker = getWaveformWorker();
  if (!worker) {
    return Promise.resolve().then(() => buildWaveformPyramid(audioBuffer));
  }

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    channels.push(new Float32Array(audioBuffer.getChannelData(channel)));
  }

  const requestId = nextWaveformWorkerRequestId;
  nextWaveformWorkerRequestId += 1;

  return new Promise<WaveformPyramid>((resolve, reject) => {
    pendingWaveformWorkerRequests.set(requestId, {
      levels: new Map(),
      resolve,
      reject,
      ...(onUpdate ? { onUpdate } : {}),
    });
    const request: WaveformWorkerRequest = {
      requestId,
      channels: channels.map((channel) => channel.buffer),
      length: audioBuffer.length,
      prioritizedBucketSizeSamples: preferredBucketSizeSamples,
    };
    worker.postMessage(request, request.channels);
  });
}

/**
 * Purpose: Decide whether the current zoom should render detailed waveform samples.
 * How: Stay detailed whenever the current zoom shows at least one pixel per sample.
 */
export function shouldRenderDetailedWaveform(samplesPerPixel: number): boolean {
  return samplesPerPixel <= WAVEFORM_DETAIL_MAX_SAMPLES_PER_DEVICE_PIXEL * currentDevicePixelRatio();
}

/**
 * Purpose: Return the exact envelope level whose bucket size matches the current zoom bucket size.
 * How: Look up the precomputed level by exact samples-per-bucket value and fall back to the finest stored level.
 */
export function getWaveformEnvelopeLevel(
  bucketSizeSamples: number,
  pyramid: WaveformPyramid,
): WaveformLevel | null {
  if (pyramid.levels.length === 0) {
    return null;
  }
  return pyramid.levels.find((level) => level.samplesPerBucket === bucketSizeSamples) ?? pyramid.levels[0] ?? null;
}

/**
 * Purpose: Convert one envelope level into the compact float32x2 layout expected by the future GPU-oriented cache.
 * How: Interleave min and max values bucket by bucket so one logical bucket occupies exactly two float32 values.
 */
export function buildWaveformTextureLevel(level: WaveformLevel): WaveformTextureLevel {
  const bucketCount = level.mins.length;
  const packedMinMax = new Float32Array(bucketCount * 2);
  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const packedIndex = bucketIndex * 2;
    packedMinMax[packedIndex] = level.mins[bucketIndex] ?? 0;
    packedMinMax[packedIndex + 1] = level.maxs[bucketIndex] ?? 0;
  }
  return {
    bucketSizeSamples: level.samplesPerBucket,
    bucketCount,
    packedMinMax,
  };
}

/**
 * Purpose: Materialize the compact texture-oriented bank that mirrors one resource waveform pyramid.
 * How: Convert every retained level into an interleaved min/max buffer indexed by exact bucket size.
 */
export function buildWaveformTextureBank(pyramid: WaveformPyramid): ResourceWaveformTextureBank {
  const levels = new Map<number, WaveformTextureLevel>();
  for (const level of getSortedWaveformLevels(pyramid.levels)) {
    levels.set(level.samplesPerBucket, buildWaveformTextureLevel(level));
  }
  return { levels };
}

/**
 * Purpose: Return the compact min/max level matching the exact bucket size currently needed for envelope rendering.
 * How: Prefer the exact keyed level and otherwise fall back to the finest retained level just like the pyramid lookup does.
 */
export function getWaveformTextureLevel(
  bucketSizeSamples: number,
  textureBank: ResourceWaveformTextureBank,
): WaveformTextureLevel | null {
  const exactLevel = textureBank.levels.get(bucketSizeSamples);
  if (exactLevel) {
    return exactLevel;
  }
  return textureBank.levels.values().next().value ?? null;
}
