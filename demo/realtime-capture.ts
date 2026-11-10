/******************************* realtime-capture.ts ***************************
 *
 * Purpose: Capture the master output for the real-time WAV export with the
 *          audio frame of every sample, so the file can start exactly on the
 *          frame the timeline's zero plays on, and nothing is lost on the way.
 * How: An AudioWorklet processor (source below, loaded from a Blob URL)
 *      copies its input on the render thread into chunks of CHUNK_FRAMES
 *      frames, each tagged with the `currentFrame` of its first sample, and
 *      posts them to the main thread (messages queue, they are not dropped
 *      when the main thread is busy, unlike ScriptProcessorNode buffers).
 *      On "flush" it posts what remains, then "flushed", and stops.
 *      `assembleCapture` (pure) lays the chunks on the frame axis from a
 *      given first frame, zero-filling and counting any frame not captured.
 *
 ******************************************************************************/

export const RECORDER_PROCESSOR_NAME = "faustdaw-export-recorder";

/** Frames per posted chunk (about 85 ms at 48 kHz). */
const CHUNK_FRAMES = 4096;

/** A run of consecutive captured frames, starting at audio frame `startFrame`. */
export type CapturedChunk = {
  readonly startFrame: number;
  readonly channels: readonly Float32Array[];
};

/**
 * Source of the recorder processor. It runs in the AudioWorkletGlobalScope
 * (registerProcessor, AudioWorkletProcessor, currentFrame are globals there).
 * A chunk only holds consecutive render quanta: if a quantum ever does not
 * follow the previous one, the chunk is posted and a new one begins.
 */
export const RECORDER_PROCESSOR_SOURCE = `
class Recorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channelCount = (options && options.processorOptions && options.processorOptions.channelCount) || 2;
    this.stopped = false;
    this.begin(-1);
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        this.post();
        this.port.postMessage("flushed");
        this.stopped = true;
      }
    };
  }
  begin(startFrame) {
    this.startFrame = startFrame;
    this.fill = 0;
    this.buffers = [];
    for (let c = 0; c < this.channelCount; c++) this.buffers.push(new Float32Array(${CHUNK_FRAMES}));
  }
  post() {
    if (this.fill > 0) {
      const channels = this.buffers.map((b) => b.slice(0, this.fill));
      this.port.postMessage({ startFrame: this.startFrame, channels }, channels.map((c) => c.buffer));
    }
    this.begin(-1);
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0] || [];
    const frames = input.length > 0 ? input[0].length : 128;
    if (this.fill > 0 && this.startFrame + this.fill !== currentFrame) this.post();
    if (this.fill + frames > ${CHUNK_FRAMES}) this.post();
    if (this.fill === 0) this.startFrame = currentFrame;
    for (let c = 0; c < this.channelCount; c++) {
      const source = input.length === 0 ? null : input[Math.min(c, input.length - 1)];
      if (source) this.buffers[c].set(source, this.fill);
    }
    this.fill += frames;
    if (this.fill >= ${CHUNK_FRAMES}) this.post();
    return true;
  }
}
registerProcessor(${JSON.stringify(RECORDER_PROCESSOR_NAME)}, Recorder);
`;

/**
 * Purpose: Build the exported channels from `fromFrame` (the frame the
 *          timeline's zero plays on) to the last captured frame.
 * How: Allocate zeroed channels, copy each chunk's overlap at its frame
 *      offset, and count the frames no chunk covered (`missingFrames`):
 *      a capture that began after `fromFrame` or a gap between chunks.
 */
export function assembleCapture(
  chunks: readonly CapturedChunk[],
  fromFrame: number,
  channelCount: number,
): { channels: Float32Array[]; missingFrames: number } {
  let endFrame = fromFrame;
  for (const chunk of chunks) {
    endFrame = Math.max(endFrame, chunk.startFrame + (chunk.channels[0]?.length ?? 0));
  }
  const length = endFrame - fromFrame;
  const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
  const covered = new Uint8Array(length);
  for (const chunk of chunks) {
    const chunkLength = chunk.channels[0]?.length ?? 0;
    const from = Math.max(chunk.startFrame, fromFrame);
    const to = Math.min(chunk.startFrame + chunkLength, endFrame);
    if (to <= from) {
      continue;
    }
    for (let c = 0; c < channelCount; c++) {
      const source = chunk.channels[Math.min(c, chunk.channels.length - 1)];
      if (source) {
        channels[c]!.set(source.subarray(from - chunk.startFrame, to - chunk.startFrame), from - fromFrame);
      }
    }
    covered.fill(1, from - fromFrame, to - fromFrame);
  }
  let missingFrames = 0;
  for (let i = 0; i < length; i++) {
    if (covered[i] === 0) missingFrames++;
  }
  return { channels, missingFrames };
}
