/**************************** realtime-export.ts ******************************
 *
 * Purpose: Real-time WAV export — start/stop a capture pipeline that taps the
 *          master output through a ScriptProcessorNode, accumulates Float32
 *          chunks during playback, assembles them into a 16-bit PCM WAV blob,
 *          and triggers a browser download.
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

/**
 * Purpose: Describe the capture pipeline of one in-flight real-time WAV export.
 * How: Hold the ScriptProcessorNode pulling samples, the accumulated chunks,
 *      and the fixed sample rate and channel count used to render the WAV.
 */
export type RealtimeExportState = {
  scriptNode: ScriptProcessorNode;
  chunks: Float32Array[];
  sampleRate: number;
  channelCount: number;
};

/**
 * Purpose: Start or stop a real-time WAV export that captures the live audio output (including effects).
 * How: On start — return to zero, start playback, attach a ScriptProcessorNode to the master output to collect PCM chunks.
 *      On stop — disconnect the capture node, assemble chunks into a WAV blob, and trigger a download.
 */
export function toggleRealtimeExport(elements: Elements): void {
  if (demoState.realtimeExport) {
    finishRealtimeExport(elements);
    return;
  }
  void startRealtimeExport(elements);
}

async function startRealtimeExport(elements: Elements): Promise<void> {
  if (demoState.project.timeline.transport === "Playing") {
    demoState.transportLoop.stop(elements);
    applyTransition("Stop", () => stop(demoState.project), elements);
  }

  await demoState.audio.startSilent();

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
  const bufferSize = 4096;
  const scriptNode = audioContext.createScriptProcessor(bufferSize, channelCount, channelCount);
  const chunks: Float32Array[] = [];

  scriptNode.onaudioprocess = (event: AudioProcessingEvent): void => {
    const left = event.inputBuffer.getChannelData(0);
    const right = event.inputBuffer.getChannelData(1);
    chunks.push(new Float32Array(left));
    chunks.push(new Float32Array(right));
  };

  masterGain.connect(scriptNode);
  scriptNode.connect(audioContext.destination);

  demoState.realtimeExport = { scriptNode, chunks, sampleRate: audioContext.sampleRate, channelCount };

  demoState.lastPlayStartCoord = demoState.project.timeline.cursor;
  demoState.project = play(demoState.project);
  demoState.playbackSession.start();
  demoState.transportLoop.startIfNeeded(elements);

  elements.exportMixdownButton.textContent = "Stop Export";
  pushRenderLog("Real-time export started");
  render(elements);
}

export function finishRealtimeExport(elements: Elements): void {
  const exportState = demoState.realtimeExport;
  if (!exportState) {
    return;
  }

  if (demoState.project.timeline.transport === "Playing") {
    demoState.transportLoop.stop(elements);
    applyTransition("Stop", () => stop(demoState.project), elements);
  }

  exportState.scriptNode.onaudioprocess = null;
  exportState.scriptNode.disconnect();
  if (demoState.audio.masterGain) {
    try { demoState.audio.masterGain.disconnect(exportState.scriptNode); } catch { /* already disconnected */ }
  }

  const { chunks, sampleRate, channelCount } = exportState;
  const framesPerChunk = chunks.length > 0 ? chunks[0]!.length : 0;
  const totalChunkPairs = chunks.length / channelCount;
  const totalFrames = totalChunkPairs * framesPerChunk;

  if (totalFrames > 0) {
    const left = new Float32Array(totalFrames);
    const right = new Float32Array(totalFrames);
    for (let i = 0; i < totalChunkPairs; i++) {
      left.set(chunks[i * channelCount]!, i * framesPerChunk);
      right.set(chunks[i * channelCount + 1]!, i * framesPerChunk);
    }
    const wavBlob = float32ChannelsToWavBlob([left, right], sampleRate);
    const fileName = getMixdownFileName(demoState.session.name);
    downloadBlob(wavBlob, fileName);
    pushRenderLog(`Export WAV "${fileName}"`);
  } else {
    pushRenderLog("Export cancelled — no audio captured");
  }

  demoState.realtimeExport = null;
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
  exportState.scriptNode.onaudioprocess = null;
  exportState.scriptNode.disconnect();
  if (demoState.audio.masterGain) {
    try { demoState.audio.masterGain.disconnect(exportState.scriptNode); } catch { /* already disconnected */ }
  }
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
