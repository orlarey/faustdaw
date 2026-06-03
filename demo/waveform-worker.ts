/****************************** waveform-worker.ts *****************************
 *
 * Purpose: Build waveform pyramids off the main thread during large imports.
 * How: Receive copied channel buffers from the UI thread, compute the exact
 *      min/max pyramid, then post the result back to the caller.
 *
 ******************************************************************************/
import { buildWaveformLevelFromChannels, getPrioritizedWaveformBucketSizesSamples } from "./waveform.js";
import type { WaveformLevel } from "./waveform-view/waveform-types.js";

type WaveformWorkerRequest = {
  requestId: number;
  channels: ArrayBuffer[];
  length: number;
  prioritizedBucketSizeSamples: number | null;
};

type WaveformWorkerResponse =
  | { requestId: number; level: WaveformLevel }
  | { requestId: number; done: true }
  | { requestId: number; error: string };

self.addEventListener("message", (event: MessageEvent<WaveformWorkerRequest>) => {
  const { requestId, channels, length, prioritizedBucketSizeSamples } = event.data;
  try {
    const channelViews = channels.map((channelBuffer) => new Float32Array(channelBuffer));
    for (const samplesPerBucket of getPrioritizedWaveformBucketSizesSamples(prioritizedBucketSizeSamples)) {
      const level = buildWaveformLevelFromChannels(channelViews, length, samplesPerBucket);
      const response: WaveformWorkerResponse = { requestId, level };
      self.postMessage(response);
    }
    self.postMessage({ requestId, done: true } satisfies WaveformWorkerResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const response: WaveformWorkerResponse = { requestId, error: message };
    self.postMessage(response);
  }
});
