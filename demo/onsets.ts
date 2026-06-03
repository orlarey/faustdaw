/*********************************** onsets.ts ********************************
 *
 * Purpose: Detect transient onsets inside one clip slice and carry the compact
 *          annotation payload used by preview and explode operations.
 * How: Derive one mono analysis buffer from the clip slice, run a coarse STFT
 *      spectral-flux detector, pick thresholded local maxima, then refine the
 *      resulting cut positions near zero crossings.
 *
 ******************************************************************************/

export type ClipOnsetDetectionSettings = {
  sensitivity: number;
  minSpacingMs: number;
  refineCuts: boolean;
};

/**
 * Purpose: In-flight onset-editor UI state for a single clip.
 * How: Pair the edited settings with the live preview annotation, plus a
 *      busy flag while re-detection runs.
 */
export type ClipOnsetEditorState = {
  clipId: string;
  settings: ClipOnsetDetectionSettings;
  previewAnnotation: ClipOnsetAnnotation | null;
  busy: boolean;
};

export type ClipOnsetAnnotation = {
  version: 1;
  settings: ClipOnsetDetectionSettings;
  onsetSamples: number[];
};

export const DEFAULT_CLIP_ONSET_DETECTION_SETTINGS: ClipOnsetDetectionSettings = {
  sensitivity: 55,
  minSpacingMs: 30,
  refineCuts: true,
};

const ONSET_WINDOW_SIZE_SAMPLES = 1024;
const ONSET_HOP_SIZE_SAMPLES = 256;
const ONSET_THRESHOLD_WINDOW_FRAMES = 8;
const ONSET_ZERO_CROSSING_SEARCH_RADIUS_SAMPLES = 128;

const hannWindowCache = new Map<number, Float32Array>();

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function normalizeClipOnsetDetectionSettings(
  settings: Partial<ClipOnsetDetectionSettings> | null | undefined,
): ClipOnsetDetectionSettings {
  return {
    sensitivity: clamp(Math.round(settings?.sensitivity ?? DEFAULT_CLIP_ONSET_DETECTION_SETTINGS.sensitivity), 1, 100),
    minSpacingMs: clamp(
      Math.round(settings?.minSpacingMs ?? DEFAULT_CLIP_ONSET_DETECTION_SETTINGS.minSpacingMs),
      5,
      500,
    ),
    refineCuts: settings?.refineCuts ?? DEFAULT_CLIP_ONSET_DETECTION_SETTINGS.refineCuts,
  };
}

function getHannWindow(length: number): Float32Array {
  const cached = hannWindowCache.get(length);
  if (cached) {
    return cached;
  }
  const window = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / Math.max(length - 1, 1)));
  }
  hannWindowCache.set(length, window);
  return window;
}

function buildClipAnalysisSignal(
  audioBuffer: AudioBuffer,
  sourceStartSample: number,
  sourceLengthSamples: number,
): Float32Array {
  const frameCount = Math.max(0, Math.min(sourceLengthSamples, audioBuffer.length - sourceStartSample));
  const signal = new Float32Array(frameCount);
  if (frameCount === 0 || audioBuffer.numberOfChannels === 0) {
    return signal;
  }
  const channelCount = audioBuffer.numberOfChannels;
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      signal[frameIndex] = (signal[frameIndex] ?? 0) + (channelData[sourceStartSample + frameIndex] ?? 0);
    }
  }
  const inverseChannelCount = 1 / channelCount;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    signal[frameIndex] = (signal[frameIndex] ?? 0) * inverseChannelCount;
  }
  return signal;
}

function fftMagnitudesInPlace(real: Float64Array, imag: Float64Array): Float64Array {
  const length = real.length;
  for (let index = 1, bit = 0; index < length; index += 1) {
    let mask = length >> 1;
    while (bit & mask) {
      bit ^= mask;
      mask >>= 1;
    }
    bit ^= mask;
    if (index < bit) {
      const realValue = real[index]!;
      real[index] = real[bit]!;
      real[bit] = realValue;
      const imagValue = imag[index]!;
      imag[index] = imag[bit]!;
      imag[bit] = imagValue;
    }
  }

  for (let blockSize = 2; blockSize <= length; blockSize <<= 1) {
    const halfBlockSize = blockSize >> 1;
    const phaseStep = -2 * Math.PI / blockSize;
    for (let blockStart = 0; blockStart < length; blockStart += blockSize) {
      for (let offset = 0; offset < halfBlockSize; offset += 1) {
        const evenIndex = blockStart + offset;
        const oddIndex = evenIndex + halfBlockSize;
        const angle = offset * phaseStep;
        const twiddleReal = Math.cos(angle);
        const twiddleImag = Math.sin(angle);
        const oddReal = real[oddIndex]!;
        const oddImag = imag[oddIndex]!;
        const rotatedReal = twiddleReal * oddReal - twiddleImag * oddImag;
        const rotatedImag = twiddleReal * oddImag + twiddleImag * oddReal;
        real[oddIndex] = (real[evenIndex] ?? 0) - rotatedReal;
        imag[oddIndex] = (imag[evenIndex] ?? 0) - rotatedImag;
        real[evenIndex] = (real[evenIndex] ?? 0) + rotatedReal;
        imag[evenIndex] = (imag[evenIndex] ?? 0) + rotatedImag;
      }
    }
  }

  const magnitudes = new Float64Array((length >> 1) + 1);
  for (let index = 0; index < magnitudes.length; index += 1) {
    const realValue = real[index] ?? 0;
    const imagValue = imag[index] ?? 0;
    magnitudes[index] = Math.hypot(realValue, imagValue);
  }
  return magnitudes;
}

function computeSpectralFlux(signal: Float32Array): Float64Array {
  if (signal.length === 0) {
    return new Float64Array(0);
  }
  const window = getHannWindow(ONSET_WINDOW_SIZE_SAMPLES);
  const frameCount = Math.max(
    1,
    Math.ceil(Math.max(signal.length - ONSET_WINDOW_SIZE_SAMPLES, 0) / ONSET_HOP_SIZE_SAMPLES) + 1,
  );
  const novelty = new Float64Array(frameCount);
  let previousMagnitudes: Float64Array | null = null;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameStart = frameIndex * ONSET_HOP_SIZE_SAMPLES;
    const real = new Float64Array(ONSET_WINDOW_SIZE_SAMPLES);
    const imag = new Float64Array(ONSET_WINDOW_SIZE_SAMPLES);
    for (let sampleIndex = 0; sampleIndex < ONSET_WINDOW_SIZE_SAMPLES; sampleIndex += 1) {
      const signalIndex = frameStart + sampleIndex;
      real[sampleIndex] = (signal[signalIndex] ?? 0) * (window[sampleIndex] ?? 0);
    }
    const magnitudes = fftMagnitudesInPlace(real, imag);
    if (previousMagnitudes) {
      let flux = 0;
      for (let binIndex = 0; binIndex < magnitudes.length; binIndex += 1) {
        const delta = magnitudes[binIndex]! - previousMagnitudes[binIndex]!;
        if (delta > 0) {
          flux += delta;
        }
      }
      novelty[frameIndex] = flux;
    }
    previousMagnitudes = magnitudes;
  }

  let maximum = 0;
  for (const value of novelty) {
    if (value > maximum) {
      maximum = value;
    }
  }
  if (maximum <= 0) {
    return novelty;
  }
  for (let index = 0; index < novelty.length; index += 1) {
    novelty[index] = (novelty[index] ?? 0) / maximum;
  }
  return novelty;
}

function smoothNovelty(values: Float64Array): Float64Array {
  if (values.length <= 2) {
    return values.slice();
  }
  const smoothed = new Float64Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - 1);
    const end = Math.min(values.length - 1, index + 1);
    let sum = 0;
    let count = 0;
    for (let cursor = start; cursor <= end; cursor += 1) {
      sum += values[cursor] ?? 0;
      count += 1;
    }
    smoothed[index] = count > 0 ? sum / count : 0;
  }
  return smoothed;
}

function pickOnsetCandidates(
  novelty: Float64Array,
  sampleRate: number,
  settings: ClipOnsetDetectionSettings,
): number[] {
  if (novelty.length === 0) {
    return [];
  }
  const minSpacingFrames = Math.max(1, Math.round((settings.minSpacingMs / 1000) * sampleRate / ONSET_HOP_SIZE_SAMPLES));
  const normalizedSensitivity = clamp((settings.sensitivity - 1) / 99, 0, 1);
  const thresholdOffset = 0.38 - Math.pow(normalizedSensitivity, 0.8) * 0.28;
  const absoluteThreshold = 0.24 - Math.pow(normalizedSensitivity, 0.9) * 0.18;
  const candidates: number[] = [];
  let lastAcceptedFrame = -minSpacingFrames * 2;

  for (let frameIndex = 1; frameIndex < novelty.length - 1; frameIndex += 1) {
    const value = novelty[frameIndex] ?? 0;
    const previous = novelty[frameIndex - 1] ?? 0;
    const next = novelty[frameIndex + 1] ?? 0;
    if (value <= previous || value < next) {
      continue;
    }
    const thresholdStart = Math.max(0, frameIndex - ONSET_THRESHOLD_WINDOW_FRAMES);
    const thresholdEnd = Math.min(novelty.length - 1, frameIndex + ONSET_THRESHOLD_WINDOW_FRAMES);
    let localMean = 0;
    let localCount = 0;
    for (let cursor = thresholdStart; cursor <= thresholdEnd; cursor += 1) {
      localMean += novelty[cursor] ?? 0;
      localCount += 1;
    }
    localMean = localCount > 0 ? localMean / localCount : 0;
    if (value < Math.max(localMean + thresholdOffset, absoluteThreshold)) {
      continue;
    }
    if (frameIndex - lastAcceptedFrame < minSpacingFrames) {
      if (candidates.length > 0 && value > (novelty[lastAcceptedFrame] ?? 0)) {
        candidates[candidates.length - 1] = frameIndex;
        lastAcceptedFrame = frameIndex;
      }
      continue;
    }
    candidates.push(frameIndex);
    lastAcceptedFrame = frameIndex;
  }
  return candidates;
}

function refineOnsetSample(signal: Float32Array, candidate: number, refineCuts: boolean): number {
  const clampedCandidate = clamp(candidate, 1, Math.max(signal.length - 1, 1));
  if (!refineCuts || signal.length <= 2) {
    return clampedCandidate;
  }
  const start = Math.max(1, clampedCandidate - ONSET_ZERO_CROSSING_SEARCH_RADIUS_SAMPLES);
  const end = Math.min(signal.length - 1, clampedCandidate + ONSET_ZERO_CROSSING_SEARCH_RADIUS_SAMPLES);
  let bestIndex = clampedCandidate;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = start; index <= end; index += 1) {
    const previous = signal[index - 1] ?? 0;
    const current = signal[index] ?? 0;
    const crossesZero = previous === 0 || current === 0 || (previous < 0 && current >= 0) || (previous > 0 && current <= 0);
    if (!crossesZero) {
      continue;
    }
    const amplitudeScore = Math.abs(previous) + Math.abs(current);
    const distanceScore = Math.abs(index - clampedCandidate) / Math.max(ONSET_ZERO_CROSSING_SEARCH_RADIUS_SAMPLES, 1);
    const score = amplitudeScore * 4 + distanceScore;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function detectClipOnsets(
  audioBuffer: AudioBuffer,
  sourceStartSample: number,
  sourceLengthSamples: number,
  rawSettings?: Partial<ClipOnsetDetectionSettings> | null,
): ClipOnsetAnnotation {
  const settings = normalizeClipOnsetDetectionSettings(rawSettings);
  const signal = buildClipAnalysisSignal(audioBuffer, sourceStartSample, sourceLengthSamples);
  const novelty = smoothNovelty(computeSpectralFlux(signal));
  const onsetSamples = pickOnsetCandidates(novelty, audioBuffer.sampleRate, settings)
    .map((frameIndex) => {
      const candidate = Math.min(
        Math.max(signal.length - 1, 1),
        frameIndex * ONSET_HOP_SIZE_SAMPLES + Math.floor(ONSET_WINDOW_SIZE_SAMPLES / 2),
      );
      return refineOnsetSample(signal, candidate, settings.refineCuts);
    })
    .filter((sample, index, allSamples) => (
      sample > 0
      && sample < signal.length
      && (index === 0 || sample > allSamples[index - 1]!)
    ));

  return {
    version: 1,
    settings,
    onsetSamples,
  };
}
