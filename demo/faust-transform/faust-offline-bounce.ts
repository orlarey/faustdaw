/**************************** faust-offline-bounce.ts ***************************
 *
 * Purpose: Render a clip's audio through a Faust Transform Chain offline,
 *          producing a Float32Array[] result with automatic tail detection.
 * How: Use low-level Faust WASM `compute()` API for block-by-block processing.
 *      After the clip PCM ends, keep feeding silence until the output has
 *      stayed below a threshold for TAIL_SILENCE_DURATION_SEC. No early guess
 *      from the samples right after the clip: an echo can be silent there and
 *      sound later. When nothing after the clip rises above the threshold,
 *      the result keeps exactly the original sample count; otherwise it is
 *      the clip plus its tail, never shorter than the clip.
 *
 *****************************************************************************/
import type { FxEffect, FxParam } from "../../src/domain/fx-chain.js";

// ---------------------------------------------------------------------------
// Tail detection constants
// ---------------------------------------------------------------------------

/** RMS threshold in linear amplitude (corresponds to -60 dB). */
const TAIL_SILENCE_THRESHOLD = 1e-3;

/**
 * Minimum consecutive silent duration before declaring tail end (in seconds).
 * It bounds the gap the tail may contain: echo repeats spaced by more than
 * this are cut. 2 s covers common delay times; it costs at most 2 s of extra
 * offline computation per bounce.
 */
const TAIL_SILENCE_DURATION_SEC = 2;

/** Maximum tail duration guard-rail (in seconds). */
const TAIL_MAX_DURATION_SEC = 30;

/** Faust native block size. */
const BLOCK_SIZE = 128;

// ---------------------------------------------------------------------------
// Offline processor wrapper (thin wrapper around FaustMonoWebAudioDsp)
// ---------------------------------------------------------------------------

export type OfflineProcessor = {
  compute(inputs: Float32Array[], outputs: Float32Array[]): void;
  setParamValue(path: string, value: number): void;
  getNumInputs(): number;
  getNumOutputs(): number;
  destroy(): void;
};

/**
 * Purpose: Create a synchronous offline Faust DSP processor from a factory.
 * How: Use FaustMonoDspGenerator.createOfflineProcessor to build the WASM
 *      instance, then call start() so fDSPCode.compute() is enabled, and
 *      delegate compute() to the processor's block-level API.
 */
export async function createOfflineProcessor(
  faustWasmModule: any,
  factory: any,
  sampleRate: number,
): Promise<OfflineProcessor> {
  const generator = new faustWasmModule.FaustMonoDspGenerator();
  generator.factory = factory;
  const processor = await generator.createOfflineProcessor(sampleRate, BLOCK_SIZE);
  if (!processor) {
    throw new Error("Failed to create offline Faust processor");
  }
  // start() sets fProcessing=true on the underlying DSP — without it compute() is a no-op.
  processor.start();
  return {
    compute(inputs: Float32Array[], outputs: Float32Array[]) {
      processor.compute(inputs, outputs);
    },
    setParamValue(path: string, value: number) {
      processor.setParamValue(path, value);
    },
    getNumInputs(): number {
      return processor.getNumInputs();
    },
    getNumOutputs(): number {
      return processor.getNumOutputs();
    },
    destroy() {
      processor.stop();
      if (typeof processor.destroy === "function") {
        processor.destroy();
      }
    },
  };
}

/**
 * Purpose: Apply saved parameter values to an offline processor.
 * How: Iterate the FxParam array and call setParamValue for each.
 */
function applyParameters(processor: OfflineProcessor, params: readonly FxParam[]): void {
  for (const param of params) {
    processor.setParamValue(param.address, param.value);
  }
}

// ---------------------------------------------------------------------------
// Channel adaptation helpers
// ---------------------------------------------------------------------------

function monoToStereo(input: Float32Array[]): Float32Array[] {
  if (input.length === 1) {
    return [input[0]!, input[0]!];
  }
  return input;
}

function stereoToMono(input: Float32Array[]): Float32Array[] {
  if (input.length >= 2) {
    const mono = new Float32Array(input[0]!.length);
    const left = input[0]!;
    const right = input[1]!;
    for (let i = 0; i < mono.length; i++) {
      mono[i] = (left[i]! + right[i]!) * 0.5;
    }
    return [mono];
  }
  return input;
}

function adaptChannels(data: Float32Array[], targetChannels: number): Float32Array[] {
  if (data.length === targetChannels) return data;
  if (data.length === 1 && targetChannels === 2) return monoToStereo(data);
  if (data.length === 2 && targetChannels === 1) return stereoToMono(data);
  // Fallback: pad or truncate
  const result: Float32Array[] = [];
  for (let ch = 0; ch < targetChannels; ch++) {
    result.push(data[ch % data.length]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// RMS computation
// ---------------------------------------------------------------------------

function computeRms(channels: Float32Array[]): number {
  let sumSq = 0;
  let count = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      sumSq += ch[i]! * ch[i]!;
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

// ---------------------------------------------------------------------------
// Block processing helper
// ---------------------------------------------------------------------------

/**
 * Purpose: Process one block through the entire processor chain.
 * How: Adapt channels between processors, allocate output buffers, call compute.
 */
function processBlock(blockData: Float32Array[], processors: OfflineProcessor[]): Float32Array[] {
  let data = blockData;
  for (const proc of processors) {
    const inputChannels = proc.getNumInputs();
    const outChannels = proc.getNumOutputs();
    const adapted = adaptChannels(data, inputChannels);
    const output: Float32Array[] = [];
    for (let ch = 0; ch < outChannels; ch++) {
      output.push(new Float32Array(BLOCK_SIZE));
    }
    proc.compute(adapted, output);
    data = output;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Main bounce function
// ---------------------------------------------------------------------------

export type BounceResult = {
  samples: Float32Array[];
  sampleRate: number;
};

/**
 * Purpose: Render clip PCM through the Transform Chain offline with tail detection.
 * How: Pad the clip to a whole number of blocks + 1 guard block of silence.
 *      Process all padded blocks. Then inspect the guard block output:
 *      - If silent → stateless effect → trim result to exact original sample count.
 *      - If non-silent → stateful effect (tail) → continue feeding silence until
 *        the output decays below the threshold for the configured duration.
 */
export async function bounceTransformChain(
  clipSamples: Float32Array[],
  sampleRate: number,
  effects: readonly FxEffect[],
  faustWasmModule: any,
  effectFactories: ReadonlyMap<string, any>,
): Promise<BounceResult> {
  // Filter to non-bypassed effects that have a factory
  const activeEffects = effects.filter((e) => !e.bypassed && effectFactories.has(e.id));
  if (activeEffects.length === 0) {
    // No effects — return original samples
    return { samples: clipSamples, sampleRate };
  }

  // Create offline processors for each active effect
  const processors: OfflineProcessor[] = [];
  try {
    for (const effect of activeEffects) {
      const factory = effectFactories.get(effect.id)!;
      const proc = await createOfflineProcessor(faustWasmModule, factory, sampleRate);
      applyParameters(proc, effect.parameters);
      processors.push(proc);
    }

    const outputChannels = processors.at(-1)!.getNumOutputs();
    const clipLength = clipSamples[0]?.length ?? 0;

    // Phase 1: process the clip, zero-padded to whole blocks.
    const clipBlocks = Math.ceil(clipLength / BLOCK_SIZE);
    const outputBlocks: Float32Array[][] = [];
    for (let block = 0; block < clipBlocks; block++) {
      const offset = block * BLOCK_SIZE;
      const blockLen = Math.min(BLOCK_SIZE, clipLength - offset);
      const blockData: Float32Array[] = clipSamples.map((ch) => {
        const slice = new Float32Array(BLOCK_SIZE); // zero-initialized
        slice.set(ch.subarray(offset, offset + blockLen));
        return slice;
      });
      outputBlocks.push(processBlock(blockData, processors));
    }

    // Phase 2: tail. Always run it: whether an effect has a tail cannot be
    // read from the samples right after the clip (a 250 ms echo is silent
    // there). Feed silence until the output stays below the threshold for
    // TAIL_SILENCE_DURATION_SEC; silent blocks inside the tail are kept.
    const maxTailBlocks = Math.ceil((TAIL_MAX_DURATION_SEC * sampleRate) / BLOCK_SIZE);
    const silenceBlocks = Math.ceil((TAIL_SILENCE_DURATION_SEC * sampleRate) / BLOCK_SIZE);
    let consecutiveSilentBlocks = 0;
    const pendingSilentBlocks: Float32Array[][] = [];

    for (let tailBlock = 0; tailBlock < maxTailBlocks; tailBlock++) {
      const silenceInput: Float32Array[] = clipSamples.map(() => new Float32Array(BLOCK_SIZE));
      const blockData = processBlock(silenceInput, processors);

      const rms = computeRms(blockData);
      if (rms < TAIL_SILENCE_THRESHOLD) {
        consecutiveSilentBlocks++;
        pendingSilentBlocks.push(blockData);
        if (consecutiveSilentBlocks >= silenceBlocks) {
          break;
        }
      } else {
        // Signal above threshold — flush buffered silent blocks (they were
        // part of the decaying tail, not trailing silence)
        for (const pending of pendingSilentBlocks) {
          outputBlocks.push(pending);
        }
        pendingSilentBlocks.length = 0;
        consecutiveSilentBlocks = 0;
        outputBlocks.push(blockData);
      }
    }

    // No tail: nothing above the threshold after the clip, neither in the
    // zero-padded end of its last block nor in the tail phase. Keep exactly the
    // clip length (a filter's sub-threshold decay is not a tail).
    const paddedStart = clipLength % BLOCK_SIZE;
    const paddedRms = paddedStart === 0 || clipBlocks === 0
      ? 0
      : computeRms(outputBlocks[clipBlocks - 1]!.map((ch) => ch.subarray(paddedStart)));
    if (outputBlocks.length === clipBlocks && paddedRms < TAIL_SILENCE_THRESHOLD) {
      return {
        samples: assembleOutput(outputBlocks, outputChannels, clipLength),
        sampleRate,
      };
    }

    // Tail: assemble all blocks, then trim trailing exact zeros, never below the clip length.
    const totalSamples = outputBlocks.length * BLOCK_SIZE;
    const assembled = assembleOutput(outputBlocks, outputChannels, totalSamples);
    return {
      samples: trimTrailingSilence(assembled, clipLength),
      sampleRate,
    };
  } finally {
    for (const proc of processors) {
      proc.destroy();
    }
  }
}

/**
 * Purpose: Remove trailing zero samples from multi-channel audio, keeping at least `minLength`.
 * How: Scan backwards from the end across all channels to find the last
 *      non-zero sample, then return sub-arrays trimmed to that length (or `minLength`).
 */
function trimTrailingSilence(channels: Float32Array[], minLength = 0): Float32Array[] {
  if (channels.length === 0) return channels;
  const length = channels[0]!.length;
  let lastNonZero = -1;
  for (let i = length - 1; i >= 0; i--) {
    for (const ch of channels) {
      if (ch[i] !== 0) {
        lastNonZero = i;
        break;
      }
    }
    if (lastNonZero >= 0) break;
  }
  const trimmedLength = Math.min(length, Math.max(lastNonZero + 1, minLength));
  if (trimmedLength === length) return channels;
  return channels.map((ch) => ch.subarray(0, trimmedLength));
}

/**
 * Purpose: Assemble accumulated output blocks into per-channel Float32Arrays.
 * How: Concatenate blocks in order, then trim to the requested sample count.
 */
function assembleOutput(
  outputBlocks: Float32Array[][],
  outputChannels: number,
  trimToSamples: number,
): Float32Array[] {
  const totalBlockSamples = outputBlocks.length * BLOCK_SIZE;
  const finalLength = Math.min(trimToSamples, totalBlockSamples);
  const result: Float32Array[] = [];
  for (let ch = 0; ch < outputChannels; ch++) {
    result.push(new Float32Array(finalLength));
  }
  for (let i = 0; i < outputBlocks.length; i++) {
    const block = outputBlocks[i]!;
    const blockOffset = i * BLOCK_SIZE;
    const copyLen = Math.min(BLOCK_SIZE, finalLength - blockOffset);
    if (copyLen <= 0) break;
    for (let ch = 0; ch < outputChannels; ch++) {
      const src = block[ch % block.length]!;
      result[ch]!.set(src.subarray(0, copyLen), blockOffset);
    }
  }
  return result;
}
