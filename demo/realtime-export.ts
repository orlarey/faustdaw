/**************************** realtime-export.ts ******************************
 *
 * Purpose: Real-time WAV export — start/stop a capture pipeline that taps the
 *          master output through an AudioWorklet recorder (realtime-capture.ts),
 *          accumulates frame-dated Float32 chunks during playback, assembles
 *          them from the frame the timeline's zero plays on into a 16-bit PCM
 *          WAV blob, and triggers a browser download.
 * How: Expose four top-level operations (toggle / start / finish / cancel)
 *      that mutate `demoState.realtimeExport`. Each takes an `elements` root
 *      and calls the transport / audio-engine / playback-session APIs
 *      directly to start, stop, and resume playback around the capture. The
 *      WAV encoding helper `float32ChannelsToWavBlob` is pure and stays
 *      co-located with the export it serves.
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import { demoState } from "./state.js";
import { play, seek, stop } from "../src/domain/transport.js";
import { applyTransition, pushRenderLog, render } from "./daw-render/daw-render-runtime.js";
import { downloadBlob, getMixdownFileName } from "./download.js";
import { formatCurrentAbsoluteTimeLabel } from "./format.js";
import {
  RECORDER_PROCESSOR_NAME,
  RECORDER_PROCESSOR_SOURCE,
  assembleCapture,
  type CapturedChunk,
} from "./realtime-capture.js";

/**
 * Purpose: Describe the capture pipeline of one in-flight real-time WAV export.
 * How: Hold the recorder node, the frame-dated chunks it posted, the audio
 *      frame the timeline's zero plays on (the playback anchor), and the
 *      fixed sample rate and channel count used to render the WAV.
 */
export type RealtimeExportState = {
  recorder: AudioWorkletNode;
  chunks: CapturedChunk[];
  anchorFrame: number;
  sampleRate: number;
  channelCount: number;
};

// Contexts the recorder processor was already added to.
const recorderReadyContexts = new WeakSet<BaseAudioContext>();

async function ensureRecorderModule(audioContext: AudioContext): Promise<void> {
  if (recorderReadyContexts.has(audioContext)) {
    return;
  }
  const url = URL.createObjectURL(new Blob([RECORDER_PROCESSOR_SOURCE], { type: "application/javascript" }));
  try {
    await audioContext.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  recorderReadyContexts.add(audioContext);
}

function releaseRecorder(exportState: RealtimeExportState): void {
  exportState.recorder.port.onmessage = null;
  exportState.recorder.port.close();
  exportState.recorder.disconnect();
  if (demoState.audio.masterGain) {
    try { demoState.audio.masterGain.disconnect(exportState.recorder); } catch { /* already disconnected */ }
  }
}

// The finish in progress (waiting for the recorder's last chunk), if any.
let finishingExport: Promise<void> | null = null;

/**
 * Purpose: Start or stop a real-time WAV export that captures the live audio output (including effects).
 * How: On start — return to zero, attach the recorder to the master output, start playback.
 *      On stop — flush and release the recorder, assemble the chunks from the anchor frame
 *      into a WAV blob, and trigger a download. Clicks while a stop is flushing are ignored.
 */
export function toggleRealtimeExport(elements: Elements): void {
  if (finishingExport) {
    // The previous export is still collecting its last frames.
    return;
  }
  if (pendingExportStart) {
    // A click while the export waits for the audio engine cancels it, as a
    // click on "Stop Export" would: never start a second, orphan capture.
    pendingExportStart.cancelled = true;
    return;
  }
  if (demoState.realtimeExport) {
    void finishRealtimeExport(elements);
    return;
  }
  void startRealtimeExport(elements);
}

// The export start waiting for the audio engine, if any.
let pendingExportStart: { cancelled: boolean } | null = null;

async function startRealtimeExport(elements: Elements): Promise<void> {
  if (demoState.project.timeline.transport === "Playing") {
    demoState.transportLoop.stop(elements);
    applyTransition("Stop", () => stop(demoState.project), elements);
  }

  const attempt = { cancelled: false };
  pendingExportStart = attempt;
  try {
    await demoState.audio.startSilent();
    const startedContext = demoState.audio.context;
    if (startedContext && !attempt.cancelled) {
      await ensureRecorderModule(startedContext);
    }
  } catch (error) {
    pendingExportStart = null;
    demoState.audio.stopSilent();
    pushRenderLog(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    render(elements);
    return;
  } finally {
    pendingExportStart = null;
  }
  if (attempt.cancelled) {
    demoState.audio.stopSilent();
    pushRenderLog("Export cancelled");
    render(elements);
    return;
  }

  const audioContext = demoState.audio.context;
  if (!audioContext) {
    pushRenderLog("ERROR: audio engine not ready");
    render(elements);
    return;
  }
  const masterGain = demoState.audio.ensureMasterGain(audioContext);

  demoState.project = seek(demoState.project, 0);
  demoState.viewport.ensureCursorVisible(demoState.project.timeline.cursor);
  elements.cursorTime.value = formatCurrentAbsoluteTimeLabel(
    0,
    demoState.project.timebase,
    demoState.viewport.timeScale.pixelsPerSample,
  );

  const channelCount = 2;
  // Connected before playback starts: the capture begins before the anchor
  // (which lies PLAYBACK_START_LEAD_SECONDS ahead), so the file can start
  // exactly on it.
  const recorder = new AudioWorkletNode(audioContext, RECORDER_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [channelCount],
    channelCount,
    channelCountMode: "explicit",
    processorOptions: { channelCount },
  });
  const chunks: CapturedChunk[] = [];
  recorder.port.onmessage = (event: MessageEvent) => {
    if (event.data && typeof event.data === "object" && "startFrame" in event.data) {
      chunks.push(event.data as CapturedChunk);
    }
  };
  masterGain.connect(recorder);
  recorder.connect(audioContext.destination);

  const exportState: RealtimeExportState = { recorder, chunks, anchorFrame: 0, sampleRate: audioContext.sampleRate, channelCount };
  demoState.realtimeExport = exportState;

  demoState.lastPlayStartCoord = demoState.project.timeline.cursor;
  demoState.project = play(demoState.project);
  try {
    demoState.playbackSession.start();
  } catch (error) {
    // Same rule as Play: never leave a capture node or a Playing transport behind.
    releaseRecorder(exportState);
    demoState.realtimeExport = null;
    demoState.transportLoop.abortFailedPlay(elements);
    pushRenderLog(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    render(elements);
    return;
  }
  // The timeline's zero (the cursor, sought to 0 above) plays on this frame.
  const anchorTime = demoState.playbackSession.audioStartTime;
  exportState.anchorFrame = Math.round((anchorTime ?? audioContext.currentTime) * audioContext.sampleRate);
  demoState.transportLoop.startIfNeeded(elements);

  elements.exportMixdownButton.textContent = "Stop Export";
  pushRenderLog("Real-time export started");
  render(elements);
}

export function finishRealtimeExport(elements: Elements): Promise<void> {
  if (finishingExport) {
    return finishingExport;
  }
  const exportState = demoState.realtimeExport;
  if (!exportState) {
    return Promise.resolve();
  }
  finishingExport = finishRealtimeExportNow(exportState, elements).finally(() => {
    finishingExport = null;
  });
  return finishingExport;
}

/**
 * Purpose: Stop the transport, collect the recorder's last frames and save.
 * How: Ask the processor to flush and wait for its "flushed" reply (bounded,
 *      so a stalled audio thread cannot block the UI), then cut the capture at
 *      the anchor frame and encode it. Missing frames, if any, are reported.
 */
async function finishRealtimeExportNow(exportState: RealtimeExportState, elements: Elements): Promise<void> {
  if (demoState.project.timeline.transport === "Playing") {
    demoState.transportLoop.stop(elements);
    applyTransition("Stop", () => stop(demoState.project), elements);
  }

  await new Promise<void>((resolve) => {
    const timeoutId = window.setTimeout(resolve, 1000);
    exportState.recorder.port.onmessage = (event: MessageEvent) => {
      if (event.data === "flushed") {
        window.clearTimeout(timeoutId);
        resolve();
      } else if (event.data && typeof event.data === "object" && "startFrame" in event.data) {
        exportState.chunks.push(event.data as CapturedChunk);
      }
    };
    exportState.recorder.port.postMessage("flush");
  });
  if (demoState.realtimeExport !== exportState) {
    // Cancelled while flushing (e.g. Play): cancelRealtimeExport released it.
    return;
  }
  releaseRecorder(exportState);
  demoState.realtimeExport = null;

  const { sampleRate, channelCount } = exportState;
  const { channels, missingFrames } = assembleCapture(exportState.chunks, exportState.anchorFrame, channelCount);

  if (channels[0]!.length > 0) {
    const wavBlob = float32ChannelsToWavBlob(channels, sampleRate);
    const fileName = getMixdownFileName(demoState.session.name);
    downloadBlob(wavBlob, fileName);
    pushRenderLog(`Export WAV "${fileName}"`);
    if (missingFrames > 0) {
      pushRenderLog(`WARNING: ${missingFrames} frame(s) were not captured and are silent in the export`);
    }
  } else {
    pushRenderLog("Export cancelled — no audio captured");
  }

  elements.exportMixdownButton.textContent = "Export WAV";
  render(elements);
}

/**
 * Purpose: Cancel a real-time export without saving (e.g. when user presses Play during export).
 */
export function cancelRealtimeExport(elements: Elements): void {
  const exportState = demoState.realtimeExport;
  if (!exportState) {
    return;
  }
  releaseRecorder(exportState);
  demoState.realtimeExport = null;
  elements.exportMixdownButton.textContent = "Export WAV";
  pushRenderLog("Export cancelled");
  render(elements);
}

/**
 * Purpose: Convert raw Float32 channel arrays into a 16-bit PCM WAV blob.
 */
function float32ChannelsToWavBlob(channels: Float32Array[], sampleRate: number): Blob {
  const channelCount = channels.length;
  const frameCount = channels[0]!.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataByteLength = frameCount * blockAlign;
  const wavBytes = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(wavBytes);
  let offset = 0;
  const writeAscii = (value: string): void => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset++, value.charCodeAt(index));
    }
  };
  writeAscii("RIFF");
  view.setUint32(offset, 36 + dataByteLength, true); offset += 4;
  writeAscii("WAVE");
  writeAscii("fmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, channelCount, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, byteRate, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true); offset += 2;
  writeAscii("data");
  view.setUint32(offset, dataByteLength, true); offset += 4;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch]![frame]!));
      view.setInt16(offset, sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff), true);
      offset += bytesPerSample;
    }
  }
  return new Blob([wavBytes], { type: "audio/wav" });
}
