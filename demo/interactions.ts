/***************************** interactions.ts *********************************
 *
 * Purpose: Wire all user interactions (forms, drag gestures, auto-scroll) to
 *          domain transitions and re-renders.
 * How: Register DOM event listeners that read form values, invoke domain
 *      operations, manage clip/cursor/ruler drag state machines, drive edge
 *      auto-scroll via requestAnimationFrame, and trigger render passes.
 *
 ******************************************************************************/
import { TRACK_IDS, type TrackId } from "../src/domain/track-id.js";
import { Timebase, type TimeCoord } from "../src/domain/timebase.js";
import { assertValidProject, getProjectMixEndCoord, initProject, type Project } from "../src/domain/project.js";
import { importAudioResource, type AudioResource } from "../src/domain/audio-resource.js";
import { play, seek, stop } from "../src/domain/transport.js";
import type { Clip } from "../src/domain/clip.js";
import { addEffect } from "../src/fx-chain.js";
import {
  getClip,
  getClipSourceLengthSamples,
  getClipSourceStartSample,
  placeClip,
  placeClipInstance,
  removeClip,
} from "../src/domain/clip.js";
import { wireClipContextMenu } from "./clip-context-menu.js";
import { renameOperation } from "./menu-operations/rename.js";
import { splitOperation } from "./menu-operations/split.js";
import { mergeOperation } from "./menu-operations/merge.js";
import { crossfadeOperation } from "./menu-operations/crossfade.js";
import { reverseOperation } from "./menu-operations/reverse.js";
import { deleteOperation } from "./menu-operations/delete.js";
import { playSelectionOperation } from "./menu-operations/play.js";
import { openSourceOperation } from "./menu-operations/open-source.js";
import { openTransformPanelOperation } from "./menu-operations/open-transform-panel.js";
import {
  registerUpdateSourceHandler,
  updateSourceOperation,
} from "./menu-operations/update-source.js";
import { registerOnsetEditorCloseHook } from "./onset-annotations.js";
import type { Elements } from "./bind-elements.js";
import { initMarkerManager, markerManager } from "./marker/marker-manager.js";
import { demoState, type ImportedResourceSource } from "./state.js";
import { EDGE_SCROLL_ZONE_PX, RULER_PAN_COMMIT_THRESHOLD_PX } from "./gesture/gesture-state.js";
import { wireRulerDragging } from "./gesture/ruler-gesture.js";
import {
  getHitClipIdFromGridPointer,
  stopClipAutoScroll,
  wireClipDragging,
} from "./gesture/clip-drag-gesture.js";
import {
  clearSelectedClips,
  getCurrentSelection,
  setSelectedClipIds,
} from "./selection-state.js";
import {
  downloadBlob,
  getMixdownFileName,
  getNormalizedProjectIdSlug,
  getSessionArchiveFileName,
  getSessionRenderAudioFileName,
} from "./download.js";
import { createNextClipId } from "./clip-id.js";
import { canCurrentTabWriteSession } from "./session-permissions.js";
import {
  cancelWorkingSessionAutosave,
  flushPendingWorkingSessionAutosave,
  isWorkingSessionAutosavePending,
  markPersistedSessionViewState,
  queueCurrentSessionViewStateAutosave,
  scheduleWorkingSessionAutosave,
  startSessionViewStateAutosaveInterval,
  stopSessionViewStateAutosaveInterval,
} from "./session-autosave.js";
import {
  commitCurrentSessionDocumentChange,
  createCurrentSessionDocument,
  syncCurrentSessionRevision,
  syncSessionDragHandleState,
} from "./session-history.js";
import {
  broadcastWorkspaceSyncMessage,
  closeWorkspaceSyncChannel,
  openWorkspaceSyncChannel,
  type WorkspaceSyncMessage,
} from "./session-broadcast.js";
import {
  trackPendingMaterialization,
  waitForAllPendingMaterializations,
} from "./session-render-materializations.js";
import { isFileDrag } from "./drag-predicates.js";
import { normalizeErrorMessage } from "./error-message.js";
import { getClipDisplayName } from "./clip-display-name.js";
import {
  bindClipContextMenuElement,
  closeClipContextMenu,
  getClipContextTargetClipId,
  getClipContextTargetSessionRenderState,
  setClipContextTarget,
} from "./clip-context-target.js";
import {
  closeSessionMenu,
  getSessionNavigationUrl,
  openSessionMenu,
  refreshSessionWorkspaceControls,
  setSessionAccessMode,
  syncSessionNameChrome,
  syncSessionUrl,
} from "./session-chrome.js";
import { cancelRealtimeExport, toggleRealtimeExport } from "./realtime-export.js";
import { CLIP_ALIGNMENT_GUIDE_MAGNETISM_PX } from "./magnetism.js";
import type { WaveformPyramid } from "./waveform-view/waveform-types.js";
import {
  wireFxPanel,
  startRecompilation,
  compileAndAttachEffect,
  refreshFxPanelIfOpen,
} from "./fx-chain/fx-chain-panel.js";
import {
  importDspFileAsEffect,
  getEffectName,
  getFirstDspFile,
} from "./fx-chain/faust-resource.js";
import { wireTransformPanel, recompileTransformChainEffects } from "./faust-transform/faust-transform-panel.js";
import { wireFaustEditor } from "./faust-editor/faust-editor.js";
import { applyClipMagnetism } from "./magnetism.js";
import { resolveClipAlignmentTarget } from "./placement.js";
import { formatCurrentAbsoluteTimeLabel, parseAbsoluteTimeLabel } from "./format.js";
import {
  applySessionDocument,
  applySessionDocumentToTrackPlayers,
  areSessionDocumentsEqual,
  computeSessionDocumentRevision,
  createSessionDocument,
  extractClipOnsetAnnotations,
  extractTransformChain,
  type SessionDocument,
} from "./session-document.js";
import {
  audioBufferToWavBytes,
  parseSessionArchive,
  type LoadedSessionArchive,
  type SessionArchiveResource,
  type SessionRenderResourceLink,
} from "./session-archive.js";
import {
  buildCurrentSessionArchiveBytes,
  buildFxResourceCodeMap,
  collectUsedSessionResourceIds,
} from "./session-archive-payload.js";
import {
  claimLocalSessionWriter,
  claimLocalSessionView,
  createSessionRenderTransfer,
  createLocalSessionId,
  DEFAULT_SESSION_NAME,
  deleteLocalSession,
  ensureLocalSessionMetadata,
  getLocalSessionMetadata,
  getSessionRenderTransfer,
  listLocalSessions,
  loadWorkingSessionArchive,
  releaseLocalSessionWriter,
  releaseLocalSessionView,
  rejectSessionRenderTransfer,
  renewLocalSessionView,
  renewLocalSessionWriter,
  resolveSessionRenderTransfer,
  saveWorkingSessionViewState,
  type SessionRenderTransfer,
  touchLocalSessionOpened,
} from "./session-workspace.js";
import {
  areSessionViewStatesEqual,
  captureSessionViewState,
  restoreSessionViewState,
  type SessionViewState,
} from "./session-view-state.js";
import {
  applyTransition,
  invalidateWaveformSlidingBuffers,
  pushRenderLog,
  render,
  renderClipDragFrame,
  renderFrame,
  renderWaveformPreviewFrame,
} from "./daw-render/daw-render-runtime.js";
import { captureClipPresentationInputs } from "./clip/clip-presentation-inputs.js";
import { TrackAudio } from "./track/track-audio.js";
import { Timeline } from "./timeline/timeline.js";
import { TimelineProjection } from "./timeline/timeline-projection.js";
import { View } from "./view/view.js";
import {
  detectClipOnsets,
  normalizeClipOnsetDetectionSettings,
  type ClipOnsetAnnotation,
  type ClipOnsetDetectionSettings,
} from "./onsets.js";
import { buildWaveformPyramid, buildWaveformPyramidInBackground, buildWaveformTextureBank, getExactWaveformBucketSizeSamples } from "./waveform.js";
import { getVisibleClipRangeCached } from "./visible-range-cache.js";
import { getIndexedClip } from "./project-index.js";

const {
  getTimeFromGridClientX,
  getTrackIdFromGridClientY,
  panTimelineFromRuler,
  syncExactTimelineViewport,
  setTimelineZoomLevelIndexAnchored,
} = View;

// ---------------------------------------------------------------------------
// Real-time transport
// ---------------------------------------------------------------------------

const SEEK_CROSSFADE_SECONDS = 0.03;
const MASTER_SLIDER_MIN_DB = -72;
const MASTER_SLIDER_MAX_DB = 12;
const MAX_IMPORTED_AUDIO_FILE_BYTES = 128 * 1024 * 1024;
const MAX_IMPORTED_AUDIO_DECODED_BYTES = 256 * 1024 * 1024;
const SESSION_RENDER_TRANSFER_MIME = "application/x-webdaw-session-render";
const SESSION_RENDER_TRANSFER_POLL_INTERVAL_MS = 120;
const SESSION_RENDER_TRANSFER_TIMEOUT_MS = 45_000;
const SESSION_WRITER_RENEW_INTERVAL_MS = 2_500;
const SESSION_VIEW_RENEW_INTERVAL_MS = 5_000;
const CLIP_ONSET_PREVIEW_DEBOUNCE_MS = 90;
let latestImportStatusJobId = 0;
let syncCurrentSessionWriterLeaseRef: (() => Promise<void>) | null = null;
let syncCurrentSessionViewLeaseRef: (() => Promise<void>) | null = null;

type ImportStatusReporter = (message: string | null, tone?: "neutral" | "error") => void;
type ImportedAudioPayload = {
  file: File;
  fileBytes?: Uint8Array;
};
type SessionRenderMaterializationPayload = {
  fileName: string;
  wavBytes: Uint8Array;
  sessionRender: SessionRenderResourceLink;
};
type ExplodedClipDerivedResource = {
  resource: AudioResource;
  buffer: AudioBuffer;
  source: ImportedResourceSource;
  waveformPyramid: WaveformPyramid;
};
type BrowserFFmpeg = {
  load: (config?: {
    coreURL?: string;
    wasmURL?: string;
    classWorkerURL?: string;
  }) => Promise<boolean>;
  writeFile: (path: string, data: Uint8Array) => Promise<boolean>;
  exec: (args: string[], timeout?: number) => Promise<number>;
  readFile: (path: string, encoding?: string) => Promise<Uint8Array | string>;
  deleteFile: (path: string) => Promise<boolean>;
};
let browserFFmpeg: BrowserFFmpeg | null = null;
let browserFFmpegLoadPromise: Promise<BrowserFFmpeg> | null = null;
const dynamicImportModule = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<unknown>;

function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function readFileBytesWithFileReader(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (!(result instanceof ArrayBuffer)) {
        reject(new Error("FileReader did not return an ArrayBuffer"));
        return;
      }
      resolve(new Uint8Array(result));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("FileReader failed"));
    });
    reader.readAsArrayBuffer(file);
  });
}

async function readImportedFileBytes(file: Blob): Promise<Uint8Array> {
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch (arrayBufferError) {
    try {
      return await readFileBytesWithFileReader(file);
    } catch (fileReaderError) {
      const arrayBufferMessage = normalizeErrorMessage(arrayBufferError);
      const fileReaderMessage = normalizeErrorMessage(fileReaderError);
      throw new Error(`${arrayBufferMessage}; FileReader fallback failed: ${fileReaderMessage}`);
    }
  }
}


function createImportStatusReporter(elements: Elements): ImportStatusReporter {
  latestImportStatusJobId += 1;
  const jobId = latestImportStatusJobId;
  return (message, tone = "neutral") => {
    if (jobId !== latestImportStatusJobId) {
      return;
    }
    demoState.footer.setStatus(message, tone);
    demoState.footer.sync(elements);
  };
}

function ensureImportableFileSize(file: File): void {
  if (file.size <= MAX_IMPORTED_AUDIO_FILE_BYTES) {
    return;
  }
  throw new Error(
    `Refused "${file.name}": ${formatByteSize(file.size)} exceeds the ${formatByteSize(MAX_IMPORTED_AUDIO_FILE_BYTES)} import limit`,
  );
}

function ensureImportableDecodedSize(fileName: string, audioBuffer: AudioBuffer): void {
  const decodedBytes = audioBuffer.length * audioBuffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
  if (decodedBytes <= MAX_IMPORTED_AUDIO_DECODED_BYTES) {
    return;
  }
  throw new Error(
    `Refused "${fileName}": decoded audio would use ${formatByteSize(decodedBytes)} of memory, above the ${formatByteSize(MAX_IMPORTED_AUDIO_DECODED_BYTES)} safety limit`,
  );
}

/**
 * Purpose: Remove the trailing extension from a file name so imported resources get a readable default id.
 * How: Trim the final dot-suffix when present and fall back to the original name if stripping would produce an empty id.
 */
function stripFileExtension(fileName: string): string {
  const baseName = fileName.replace(/\.[^.]+$/, "").trim();
  return baseName || fileName.trim();
}

/**
 * Purpose: Create a unique resource identifier derived from a suggested base name.
 * How: Reuse the base name when available and append an incrementing numeric suffix until the project resource map no longer contains it.
 */
function createUniqueResourceId(baseName: string): string {
  const normalizedBaseName = baseName.trim() || `resource-${demoState.project.resources.size + 1}`;
  if (!demoState.project.resources.has(normalizedBaseName)) {
    return normalizedBaseName;
  }

  let suffix = 2;
  while (demoState.project.resources.has(`${normalizedBaseName}-${suffix}`)) {
    suffix += 1;
  }
  return `${normalizedBaseName}-${suffix}`;
}



function sliceAudioBuffer(
  sourceBuffer: AudioBuffer,
  sourceStartSample: number,
  sourceLengthSamples: number,
): AudioBuffer {
  const audioContext = demoState.audio.context ?? demoState.audio.ensureContext();
  if (!audioContext) {
    throw new Error("Web Audio is not available in this browser");
  }
  const slicedBuffer = audioContext.createBuffer(
    sourceBuffer.numberOfChannels,
    sourceLengthSamples,
    sourceBuffer.sampleRate,
  );
  for (let channelIndex = 0; channelIndex < sourceBuffer.numberOfChannels; channelIndex += 1) {
    const sourceChannel = sourceBuffer.getChannelData(channelIndex).subarray(
      sourceStartSample,
      sourceStartSample + sourceLengthSamples,
    );
    slicedBuffer.copyToChannel(sourceChannel, channelIndex, 0);
  }
  return slicedBuffer;
}

/**
 * Purpose: Return the first dropped file that looks like an audio asset.
 * How: Prefer browser-provided audio MIME types and fall back to common audio filename extensions.
 */
function getFirstAudioFile(fileList: FileList | null): File | null {
  if (!fileList) {
    return null;
  }

  for (const file of Array.from(fileList)) {
    if (file.type.startsWith("audio/") || /\.(wav|aif|aiff|mp3|ogg|flac|m4a)$/i.test(file.name)) {
      return file;
    }
  }
  return null;
}

/**
 * Purpose: Decide whether a drag payload contains one or more local files, even when Safari omits MIME details during dragover.
 * How: Inspect DataTransfer.types first, then fall back to file-kind items or the Files payload length.
 */
/**
 * Purpose: Decide whether a drag payload looks like an audio file drop before the files are fully available.
 * How: Inspect the DataTransfer items when present and fall back to the Files payload otherwise.
 */
function isAudioFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }

  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") {
      continue;
    }
    if (item.type.startsWith("audio/")) {
      return true;
    }
  }

  return getFirstAudioFile(dataTransfer.files) !== null;
}

function getSessionRenderTransferToken(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) {
    return null;
  }
  const token = dataTransfer.getData(SESSION_RENDER_TRANSFER_MIME).trim();
  return token || null;
}

function isSessionRenderTransferDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }
  return Array.from(dataTransfer.types).includes(SESSION_RENDER_TRANSFER_MIME);
}

/**
 * Purpose: Derive a stable key for one imported local audio file so repeated imports can share the same decoded resource.
 * How: Combine the browser-exposed metadata that stays stable for the same local file within one session.
 */
function getAudioFileSignature(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}::${file.type}`;
}

function createImportedResourceSource(
  file: File,
  fileBytes: Uint8Array,
): ImportedResourceSource {
  return {
    fileName: file.name,
    mimeType: file.type,
    lastModified: file.lastModified,
    bytes: fileBytes,
  };
}

function createGeneratedWavResourceSource(
  fileName: string,
  fileBytes: Uint8Array,
  lastModified = Date.now(),
): ImportedResourceSource {
  return {
    fileName,
    mimeType: "audio/wav",
    lastModified,
    bytes: fileBytes,
  };
}

function getImportedResourceSourceSignature(source: ImportedResourceSource): string {
  return `${source.fileName}::${source.bytes.length}::${source.lastModified}::${source.mimeType}`;
}

function getArchiveResourceSourceSignature(resource: SessionArchiveResource): string {
  return `${resource.fileName}::${resource.fileBytes.length}::${resource.lastModified}::${resource.mimeType}`;
}

function areSessionRenderLinksEqual(
  left: SessionRenderResourceLink | null,
  right: SessionRenderResourceLink | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }
  return left.sourceSessionId === right.sourceSessionId
    && left.sourceSessionName === right.sourceSessionName
    && left.sourceSessionRevision === right.sourceSessionRevision
    && left.renderedAt === right.renderedAt
    && left.renderSampleRate === right.renderSampleRate
    && left.renderLengthSamples === right.renderLengthSamples
    && left.channelCount === right.channelCount;
}

function canReuseLoadedArchiveResource(
  resourceId: string,
  archiveResource: SessionArchiveResource,
  expectedSampleRate: number,
  previousResourceAudioBuffers: ReadonlyMap<string, AudioBuffer>,
  previousResourceSourceFiles: ReadonlyMap<string, ImportedResourceSource>,
  previousSessionRenderResources: ReadonlyMap<string, SessionRenderResourceLink>,
): boolean {
  const previousBuffer = previousResourceAudioBuffers.get(resourceId);
  const previousSource = previousResourceSourceFiles.get(resourceId);
  const previousSessionRender = previousSessionRenderResources.get(resourceId) ?? null;
  if (!previousBuffer || !previousSource) {
    return false;
  }
  if (previousBuffer.sampleRate !== expectedSampleRate) {
    return false;
  }
  if (getImportedResourceSourceSignature(previousSource) !== getArchiveResourceSourceSignature(archiveResource)) {
    return false;
  }
  return areSessionRenderLinksEqual(previousSessionRender, archiveResource.sessionRender ?? null);
}


async function getBrowserFFmpeg(): Promise<BrowserFFmpeg> {
  if (browserFFmpeg) {
    return browserFFmpeg;
  }
  if (browserFFmpegLoadPromise) {
    return browserFFmpegLoadPromise;
  }

  browserFFmpegLoadPromise = (async () => {
    const vendor = (rel: string): string => new URL(rel, document.baseURI).href;
    const ffmpegModule = await dynamicImportModule(vendor("./vendor/ffmpeg/index.js")) as {
      FFmpeg: new () => BrowserFFmpeg;
    };
    const ffmpeg = new ffmpegModule.FFmpeg();
    await ffmpeg.load({
      classWorkerURL: vendor("./vendor/ffmpeg/worker.js"),
      coreURL: vendor("./vendor/ffmpeg-core/ffmpeg-core.js"),
      wasmURL: vendor("./vendor/ffmpeg-core/ffmpeg-core.wasm"),
    });
    browserFFmpeg = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await browserFFmpegLoadPromise;
  } finally {
    browserFFmpegLoadPromise = null;
  }
}

async function transcodeAudioFileToWavBytes(file: File, fileBytes: Uint8Array): Promise<ArrayBuffer> {
  const ffmpeg = await getBrowserFFmpeg();
  const jobId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fileExtensionMatch = file.name.match(/\.[^.]+$/);
  const inputFileName = `input-${jobId}${fileExtensionMatch?.[0] ?? ""}`;
  const outputFileName = `output-${jobId}.wav`;

  try {
    await ffmpeg.writeFile(inputFileName, fileBytes);
    const exitCode = await ffmpeg.exec([
      "-i",
      inputFileName,
      "-vn",
      "-c:a",
      "pcm_s16le",
      outputFileName,
    ]);
    if (exitCode !== 0) {
      throw new Error(`ffmpeg exited with code ${exitCode}`);
    }

    const outputBytes = await ffmpeg.readFile(outputFileName);
    if (!(outputBytes instanceof Uint8Array)) {
      throw new Error("ffmpeg returned an unexpected output type");
    }

    return outputBytes.buffer.slice(
      outputBytes.byteOffset,
      outputBytes.byteOffset + outputBytes.byteLength,
    );
  } finally {
    await ffmpeg.deleteFile(inputFileName).catch(() => undefined);
    await ffmpeg.deleteFile(outputFileName).catch(() => undefined);
  }
}

/**
 * Purpose: Convert one normalized linear track level to a compact DAW-style readout.
 * How: Express mute as negative infinity and all other levels as decibels derived from the linear gain.
 */
function formatTrackLevel(level: number): string {
  if (level <= 0.0001) {
    return "-inf dB";
  }
  return `${(20 * Math.log10(level)).toFixed(1)} dB`;
}

function gainFromDb(decibels: number): number {
  return 10 ** (decibels / 20);
}

function dbFromGain(gain: number): number {
  if (gain <= 0.0001) {
    return MASTER_SLIDER_MIN_DB;
  }
  return 20 * Math.log10(gain);
}

/**
 * Purpose: Convert one normalized pan value to a compact left/center/right readout.
 * How: Express zero as center and scale signed offsets to integer percentages for the left and right extremes.
 */
function formatTrackPan(pan: number): string {
  if (Math.abs(pan) < 0.01) {
    return "C";
  }
  const direction = pan < 0 ? "L" : "R";
  return `${direction}${Math.round(Math.abs(pan) * 100)}`;
}


function getSessionNameFromArchiveFileName(fileName: string): string | null {
  const withoutZip = fileName.replace(/\.zip$/i, "").trim();
  if (!withoutZip) {
    return null;
  }
  const exportedName = withoutZip.replace(/-\d{4}-\d{2}-\d{2}-\d{6}-session$/i, "");
  const normalized = exportedName.trim();
  return normalized || null;
}

function areSessionDocumentListsEqual(
  left: readonly SessionDocument[],
  right: readonly SessionDocument[],
): boolean {
  return left.length === right.length
    && left.every((document, index) => areSessionDocumentsEqual(document, right[index]!));
}

function syncNextClipOrdinalFromProject(project: Project): void {
  let nextOrdinal = 1;
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      const match = /^clip-(\d+)$/.exec(clip.id);
      if (!match) {
        continue;
      }
      nextOrdinal = Math.max(nextOrdinal, Number(match[1]) + 1);
    }
  }
  demoState.nextClipOrdinal = nextOrdinal;
}

function createSessionDecodeContext(sampleRate: number): OfflineAudioContext | AudioContext {
  if (typeof OfflineAudioContext !== "undefined") {
    return new OfflineAudioContext(1, 1, sampleRate);
  }
  if (typeof AudioContext !== "undefined") {
    return new AudioContext({ sampleRate });
  }
  throw new Error("Web Audio is not available in this browser");
}

function queueLoadedSessionWaveforms(
  resources: readonly { resource: AudioResource; buffer: AudioBuffer }[],
  elements: Elements,
  reportStatus: ImportStatusReporter,
): void {
  if (resources.length === 0) {
    reportStatus(null);
    return;
  }

  const currentRenderScale = demoState.viewport.timeScale.getScale();
  const preferredWaveformBucketSizeSamples = getExactWaveformBucketSizeSamples(
    currentRenderScale.zoomPixels,
    currentRenderScale.zoomSamples,
  );
  let pendingResourceCount = resources.length;
  const updateStatus = (): void => {
    if (pendingResourceCount <= 0) {
      reportStatus(null);
      return;
    }
    reportStatus(
      pendingResourceCount === 1
        ? "Building 1 session waveform..."
        : `Building ${pendingResourceCount} session waveforms...`,
    );
  };

  updateStatus();
  for (const { resource, buffer } of resources) {
    void buildWaveformPyramidInBackground(
      buffer,
      preferredWaveformBucketSizeSamples,
      (partialPyramid) => {
        demoState.resources.cacheWaveformPyramid(resource.id, partialPyramid);
        if (
          demoState.dragState === null
          && demoState.rulerDragState === null
          && demoState.project.timeline.transport !== "Playing"
        ) {
          renderWaveformPreviewFrame(elements);
        }
      },
    )
      .then((pyramid) => {
        demoState.resources.cacheWaveformPyramid(resource.id, pyramid);
      })
      .catch((error) => {
        pushRenderLog(`ERROR: Unable to build waveform for "${resource.id}": ${normalizeErrorMessage(error)}`);
      })
      .finally(() => {
        pendingResourceCount -= 1;
        updateStatus();
        if (
          pendingResourceCount === 0
          && demoState.dragState === null
          && demoState.rulerDragState === null
          && demoState.project.timeline.transport !== "Playing"
        ) {
          renderWaveformPreviewFrame(elements);
        }
      });
  }
}

async function saveSessionArchive(elements: Elements): Promise<void> {
  const button = elements.saveSessionButton;
  const defaultLabel = button.textContent ?? "Save Session";
  button.disabled = true;
  button.textContent = "Saving...";

  try {
    await waitForAllPendingMaterializations();
    const sessionArchiveBytes = buildCurrentSessionArchiveBytes();
    const fileName = getSessionArchiveFileName(demoState.session.name);
    downloadBlob(new Blob([sessionArchiveBytes], { type: "application/zip" }), fileName);
    pushRenderLog(`Save session "${fileName}"`);
  } catch (error) {
    pushRenderLog(`ERROR: ${normalizeErrorMessage(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = defaultLabel;
    render(elements);
  }
}

function getSessionDocumentSoloTrackId(sessionDocument: SessionDocument): TrackId | null {
  for (const track of sessionDocument.tracks) {
    if (track.solo) {
      return track.id;
    }
  }
  return null;
}

function getSessionDocumentTrackEffectiveGain(sessionDocument: SessionDocument, trackId: TrackId): number {
  const trackDocument = sessionDocument.tracks.find((track) => track.id === trackId);
  if (!trackDocument) {
    return 0;
  }
  const soloTrackId = getSessionDocumentSoloTrackId(sessionDocument);
  if (soloTrackId !== null) {
    return soloTrackId === trackId ? trackDocument.gain : 0;
  }
  return trackDocument.mute ? 0 : trackDocument.gain;
}

async function renderSessionArchiveMixdown(
  archive: LoadedSessionArchive,
  sessionId: string,
  sessionName: string,
  sessionRevision: string | null,
): Promise<{
  renderedBuffer: AudioBuffer;
  fileName: string;
  wavBytes: Uint8Array;
  renderedAt: number;
  sourceSessionRevision: string;
  renderSampleRate: number;
  renderLengthSamples: number;
  channelCount: number;
}> {
  if (typeof OfflineAudioContext === "undefined") {
    throw new Error("Offline audio rendering is not available in this browser");
  }

  const usedResourceIds = new Set(collectUsedSessionResourceIds(archive.sessionDocument));
  const decodeContext = createSessionDecodeContext(archive.sessionDocument.sampleRate);
  const decodedResourceEntries = new Map<string, AudioBuffer>();
  try {
    for (const archiveResource of archive.resources) {
      if (!usedResourceIds.has(archiveResource.resourceId)) {
        continue;
      }
      const decodedBuffer = await decodeContext.decodeAudioData(archiveResource.fileBytes.slice().buffer);
      ensureImportableDecodedSize(archiveResource.fileName, decodedBuffer);
      decodedResourceEntries.set(archiveResource.resourceId, decodedBuffer);
    }
  } finally {
    if (decodeContext instanceof AudioContext) {
      await decodeContext.close().catch(() => undefined);
    }
  }

  let renderProject = initProject(sessionId);
  renderProject.timebase = new Timebase(archive.sessionDocument.sampleRate);
  for (const [resourceId, decodedBuffer] of decodedResourceEntries) {
    renderProject = importAudioResource(renderProject, {
      id: resourceId,
      sampleRate: decodedBuffer.sampleRate,
      channels: decodedBuffer.numberOfChannels,
      length: decodedBuffer.length,
    });
  }
  renderProject = applySessionDocument(renderProject, archive.sessionDocument, buildFxResourceCodeMap(archive.fxResources));

  const mixEndCoord = getProjectMixEndCoord(renderProject);
  if (mixEndCoord <= 0) {
    throw new Error("nothing to render");
  }

  const durationSeconds = renderProject.timebase.fromTimeCoord(mixEndCoord);
  const frameCount = Math.max(1, Math.ceil(durationSeconds * renderProject.timebase.sampleRate));
  const offlineAudioContext = new OfflineAudioContext(2, frameCount, renderProject.timebase.sampleRate);
  const masterGain = offlineAudioContext.createGain();
  masterGain.gain.value = archive.sessionDocument.masterGain;
  masterGain.connect(offlineAudioContext.destination);

  for (const track of renderProject.timeline.tracks) {
    const effectiveGain = getSessionDocumentTrackEffectiveGain(archive.sessionDocument, track.id);
    if (effectiveGain <= 0 || track.clips.length === 0) {
      continue;
    }
    const trackDocument = archive.sessionDocument.tracks.find((candidate) => candidate.id === track.id);
    const trackGain = offlineAudioContext.createGain();
    const trackPanner = offlineAudioContext.createStereoPanner();
    trackGain.gain.value = effectiveGain;
    trackPanner.pan.value = trackDocument?.pan ?? 0;
    trackGain.connect(trackPanner);
    trackPanner.connect(masterGain);

    for (const clip of track.clips) {
      const audioBuffer = decodedResourceEntries.get(clip.resource.id);
      if (!audioBuffer) {
        throw new Error(`Missing session resource "${clip.resource.id}"`);
      }
      const startSeconds = renderProject.timebase.fromTimeCoord(clip.start);
      if (startSeconds >= durationSeconds) {
        continue;
      }
      const source = offlineAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(trackGain);
      source.start(
        startSeconds,
        getClipSourceStartSample(clip) / audioBuffer.sampleRate,
        getClipSourceLengthSamples(clip) / audioBuffer.sampleRate,
      );
    }
  }

  const renderedBuffer = await offlineAudioContext.startRendering();
  const renderedAt = Date.now();
  return {
    renderedBuffer,
    fileName: getSessionRenderAudioFileName(sessionName),
    wavBytes: audioBufferToWavBytes(renderedBuffer),
    renderedAt,
    sourceSessionRevision: sessionRevision ?? computeSessionDocumentRevision(archive.sessionDocument),
    renderSampleRate: renderedBuffer.sampleRate,
    renderLengthSamples: renderedBuffer.length,
    channelCount: renderedBuffer.numberOfChannels,
  };
}

async function renderCurrentSessionMixdownBuffer(): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext === "undefined") {
    throw new Error("Offline audio rendering is not available in this browser");
  }
  await waitForAllPendingMaterializations();

  const mixEndCoord = getProjectMixEndCoord(demoState.project);
  if (mixEndCoord <= 0) {
    throw new Error("nothing to export");
  }

  demoState.audio.ensureContext();
  const timebase = demoState.project.timebase;
  const durationSeconds = timebase.fromTimeCoord(mixEndCoord);
  const frameCount = Math.max(1, Math.ceil(durationSeconds * timebase.sampleRate));
  const offlineAudioContext = new OfflineAudioContext(2, frameCount, timebase.sampleRate);
  const masterGain = offlineAudioContext.createGain();
  masterGain.gain.value = demoState.masterLevel;
  masterGain.connect(offlineAudioContext.destination);

  for (const track of demoState.project.timeline.tracks) {
    const trackPlayer = demoState.trackPlayers.get(track.id);
    const trackGain = offlineAudioContext.createGain();
    const trackPanner = offlineAudioContext.createStereoPanner();
    trackGain.gain.value = TrackAudio.effectiveGain(track.id);
    trackPanner.pan.value = trackPlayer?.pan ?? 0;
    trackGain.connect(trackPanner);
    trackPanner.connect(masterGain);

    for (const clip of track.clips) {
      const audioBuffer = demoState.resources.getOrCreateAudioBuffer(clip.resource);
      if (!audioBuffer) {
        throw new Error(`audio buffer "${clip.resource.id}" is unavailable`);
      }

      const startSeconds = timebase.fromTimeCoord(clip.start);
      if (startSeconds >= durationSeconds) {
        continue;
      }

      const source = offlineAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(trackGain);
      source.start(
        startSeconds,
        getClipSourceStartSample(clip) / audioBuffer.sampleRate,
        getClipSourceLengthSamples(clip) / audioBuffer.sampleRate,
      );
    }
  }

  return offlineAudioContext.startRendering();
}

async function renderCurrentSessionMixdown(): Promise<{
  renderedBuffer: AudioBuffer;
  fileName: string;
  wavBytes: Uint8Array;
  renderedAt: number;
}> {
  const renderedBuffer = await renderCurrentSessionMixdownBuffer();
  return {
    renderedBuffer,
    fileName: getMixdownFileName(demoState.session.name),
    wavBytes: audioBufferToWavBytes(renderedBuffer),
    renderedAt: Date.now(),
  };
}

async function waitForSessionRenderTransferReady(token: string): Promise<SessionRenderTransfer> {
  const deadline = performance.now() + SESSION_RENDER_TRANSFER_TIMEOUT_MS;
  while (true) {
    const transfer = await getSessionRenderTransfer(token);
    if (!transfer) {
      if (performance.now() >= deadline) {
        throw new Error("Session render transfer is unavailable");
      }
    } else if (transfer.status === "ready" && transfer.wavBytes) {
      return transfer;
    } else if (transfer.status === "error") {
      throw new Error(transfer.errorMessage ?? "Session render transfer failed");
    }
    if (performance.now() >= deadline) {
      throw new Error("Timed out while waiting for the session render");
    }
    await new Promise((resolve) => window.setTimeout(resolve, SESSION_RENDER_TRANSFER_POLL_INTERVAL_MS));
  }
}

async function waitForSessionRenderTransferMetadata(token: string): Promise<SessionRenderTransfer> {
  const deadline = performance.now() + SESSION_RENDER_TRANSFER_TIMEOUT_MS;
  while (true) {
    const transfer = await getSessionRenderTransfer(token);
    if (transfer) {
      return transfer;
    }
    if (performance.now() >= deadline) {
      throw new Error("Session render transfer metadata is unavailable");
    }
    await new Promise((resolve) => window.setTimeout(resolve, SESSION_RENDER_TRANSFER_POLL_INTERVAL_MS));
  }
}

function getSessionRenderLinkFromTransfer(transfer: SessionRenderTransfer): SessionRenderResourceLink {
  return {
    sourceSessionId: transfer.sourceSessionId,
    sourceSessionName: transfer.sourceSessionName,
    sourceSessionRevision: transfer.sourceSessionRevision,
    renderedAt: transfer.renderedAt,
    renderSampleRate: transfer.renderSampleRate,
    renderLengthSamples: transfer.renderLengthSamples,
    channelCount: transfer.channelCount,
  };
}

function replaceClipResourceAndPushFollowingClips(
  project: Project,
  clipId: string,
  nextResource: AudioResource,
): Project {
  const withImportedResource = importAudioResource(project, nextResource);
  const importedResource = withImportedResource.resources.get(nextResource.id);
  if (!importedResource) {
    throw new Error(`Updated resource "${nextResource.id}" is unavailable`);
  }
  const targetClip = getClip(withImportedResource, clipId);
  const targetClipRef = getIndexedClip(withImportedResource, clipId);
  if (!targetClipRef) {
    throw new Error(`Missing clip "${clipId}"`);
  }
  const newClipEndCoord = targetClip.start + Math.round(
    (importedResource.length / importedResource.sampleRate) * withImportedResource.timebase.internalTimeRate,
  );
  const nextTracks = withImportedResource.timeline.tracks.map((track) => {
    if (track.id !== targetClipRef.trackId) {
      return track;
    }
    let sawTarget = false;
    let pushDelta = 0;
    const nextClips = track.clips.map((clip) => {
      if (clip.id === clipId) {
        sawTarget = true;
        return {
          ...clip,
          resource: importedResource,
        };
      }
      if (!sawTarget) {
        return clip;
      }
      if (pushDelta === 0) {
        pushDelta = Math.max(0, newClipEndCoord - clip.start);
      }
      return pushDelta > 0
        ? {
          ...clip,
          start: clip.start + pushDelta,
        }
        : clip;
    });
    return {
      ...track,
      clips: nextClips,
    };
  });
  const nextProject: Project = {
    ...withImportedResource,
    timeline: {
      ...withImportedResource.timeline,
      tracks: nextTracks,
    },
  };
  assertValidProject(nextProject);
  return nextProject;
}

function publishCurrentSessionRenderTransfer(): SessionRenderTransfer {
  const currentSessionDocument = createCurrentSessionDocument();
  const sourceSessionRevision = syncCurrentSessionRevision(currentSessionDocument);
  const mixEndCoord = getProjectMixEndCoord(demoState.project);
  if (mixEndCoord <= 0) {
    throw new Error("nothing to drag");
  }
  const renderSampleRate = demoState.project.timebase.sampleRate;
  const renderDurationSeconds = demoState.viewport.timeScale.fromTimeCoord(mixEndCoord);
  const renderLengthSamples = Math.max(1, Math.ceil(renderDurationSeconds * renderSampleRate));
  const renderedAt = Date.now();
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const transfer: SessionRenderTransfer = {
    token,
    createdAt: renderedAt,
    fileName: getSessionRenderAudioFileName(demoState.session.name),
    sourceSessionId: demoState.session.id,
    sourceSessionName: demoState.session.name,
    sourceSessionRevision,
    renderedAt,
    renderSampleRate,
    renderLengthSamples,
    channelCount: 2,
    status: "pending",
    wavBytes: null,
    errorMessage: null,
  };

  void (async () => {
    try {
      await createSessionRenderTransfer({
        token,
        createdAt: renderedAt,
        fileName: transfer.fileName,
        sourceSessionId: transfer.sourceSessionId,
        sourceSessionName: transfer.sourceSessionName,
        sourceSessionRevision: transfer.sourceSessionRevision,
        renderedAt: transfer.renderedAt,
        renderSampleRate: transfer.renderSampleRate,
        renderLengthSamples: transfer.renderLengthSamples,
        channelCount: transfer.channelCount,
      });
      const { wavBytes } = await renderCurrentSessionMixdown();
      await resolveSessionRenderTransfer(token, wavBytes);
    } catch (error) {
      await rejectSessionRenderTransfer(token, normalizeErrorMessage(error));
      console.warn("[webdaw] session-render transfer failed", normalizeErrorMessage(error));
    }
  })();

  return transfer;
}

function queueSessionRenderWaveformBuild(
  resourceId: string,
  buffer: AudioBuffer,
  elements: Elements,
  reportStatus: ImportStatusReporter,
  statusLabel: string,
): void {
  const currentRenderScale = demoState.viewport.timeScale.getScale();
  const preferredWaveformBucketSizeSamples = getExactWaveformBucketSizeSamples(
    currentRenderScale.zoomPixels,
    currentRenderScale.zoomSamples,
  );
  reportStatus(statusLabel);
  void buildWaveformPyramidInBackground(
    buffer,
    preferredWaveformBucketSizeSamples,
    (partialPyramid) => {
      demoState.resources.cacheWaveformPyramid(resourceId, partialPyramid);
      reportStatus(demoState.footer.message ?? statusLabel, demoState.footer.tone);
      if (
        demoState.dragState === null
        && demoState.rulerDragState === null
        && demoState.project.timeline.transport !== "Playing"
      ) {
        renderWaveformPreviewFrame(elements);
      }
    },
  )
    .then((pyramid) => {
      demoState.resources.cacheWaveformPyramid(resourceId, pyramid);
      reportStatus(null);
      if (
        demoState.dragState === null
        && demoState.rulerDragState === null
        && demoState.project.timeline.transport !== "Playing"
      ) {
        renderWaveformPreviewFrame(elements);
      }
    })
    .catch((error) => {
      const message = normalizeErrorMessage(error);
      pushRenderLog(`ERROR: Unable to build waveform for "${resourceId}": ${message}`);
      reportStatus(`Unable to build waveform for "${resourceId}": ${message}`, "error");
    });
}

async function materializeSessionRenderResource(
  resourceId: string,
  transferToken: string,
  elements: Elements,
  reportStatus: ImportStatusReporter,
): Promise<void> {
  const transfer = await waitForSessionRenderTransferReady(transferToken);
  const audioContext = demoState.audio.ensureContext();
  if (!audioContext) {
    throw new Error("Web Audio is not available in this browser");
  }
  if (!transfer.wavBytes) {
    throw new Error("Session render transfer is missing audio data");
  }

  reportStatus(`Decoding "${transfer.fileName}"...`);
  const decodedBuffer = await audioContext.decodeAudioData(transfer.wavBytes.slice().buffer);
  ensureImportableDecodedSize(transfer.fileName, decodedBuffer);
  demoState.resources.audioBuffers.set(resourceId, decodedBuffer);
  demoState.resources.sourceFiles.set(resourceId, {
    fileName: transfer.fileName,
    mimeType: "audio/wav",
    lastModified: transfer.renderedAt,
    bytes: transfer.wavBytes,
  });
  demoState.resources.retainedIds.add(resourceId);
  demoState.resources.sessionRenders.set(resourceId, {
    sourceSessionId: transfer.sourceSessionId,
    sourceSessionName: transfer.sourceSessionName,
    sourceSessionRevision: transfer.sourceSessionRevision,
    renderedAt: transfer.renderedAt,
    renderSampleRate: transfer.renderSampleRate,
    renderLengthSamples: transfer.renderLengthSamples,
    channelCount: transfer.channelCount,
  });
  queueSessionRenderWaveformBuild(
    resourceId,
    decodedBuffer,
    elements,
    reportStatus,
    `Building waveform for "${transfer.sourceSessionName}"...`,
  );
  scheduleWorkingSessionAutosave(elements);
  render(elements);
}

async function applyLoadedSessionArchive(
  archive: LoadedSessionArchive,
  elements: Elements,
  reportStatus: ImportStatusReporter,
  options: {
    targetSessionId: string;
    targetSessionName: string;
    targetSessionRevision: string | null;
    sessionViewState: SessionViewState | null;
    retainedResources: readonly {
      resourceId: string;
      fileName: string;
      mimeType: string;
      lastModified: number;
      fileBytes: Uint8Array;
      sessionRender: SessionRenderResourceLink | null;
    }[];
    undoPast: readonly SessionDocument[];
    undoFuture: readonly SessionDocument[];
    successLogMessage: string | null;
    scheduleAutosaveAfterLoad: boolean;
    preserveViewState?: boolean;
  },
): Promise<void> {
  const usedResourceIds = collectUsedSessionResourceIds(archive.sessionDocument);
  const retainedResources = options.retainedResources.length > 0 ? options.retainedResources : archive.resources;
  const retainedResourceEntries = new Map(retainedResources.map((resource) => [resource.resourceId, resource]));
  if (retainedResourceEntries.size !== retainedResources.length) {
    throw new Error("Duplicate session resource id in archive");
  }
  for (const resourceId of usedResourceIds) {
    if (!retainedResourceEntries.has(resourceId)) {
      throw new Error(`Missing session resource "${resourceId}"`);
    }
  }

  const previousResourceAudioBuffers = demoState.resources.audioBuffers;
  const previousResourceSourceFiles = demoState.resources.sourceFiles;
  const previousSessionRenderResources = demoState.resources.sessionRenders;
  const previousWaveformPyramids = demoState.resources.waveformPyramids;
  const previousWaveformTextureBanks = demoState.resources.waveformTextureBanks;
  const decodedResources: {
    resource: AudioResource;
    buffer: AudioBuffer;
    source: ImportedResourceSource;
    sessionRender: SessionRenderResourceLink | null;
    reusedWaveform: boolean;
  }[] = [];
  let decodeContext: OfflineAudioContext | AudioContext | null = null;
  try {
    for (const [resourceId, archiveResource] of retainedResourceEntries) {
      if (canReuseLoadedArchiveResource(
        resourceId,
        archiveResource,
        archive.sessionDocument.sampleRate,
        previousResourceAudioBuffers,
        previousResourceSourceFiles,
        previousSessionRenderResources,
      )) {
        const reusableBuffer = previousResourceAudioBuffers.get(resourceId);
        const reusableSource = previousResourceSourceFiles.get(resourceId);
        if (reusableBuffer && reusableSource) {
          decodedResources.push({
            resource: {
              id: resourceId,
              sampleRate: reusableBuffer.sampleRate,
              channels: reusableBuffer.numberOfChannels,
              length: reusableBuffer.length,
            },
            buffer: reusableBuffer,
            source: reusableSource,
            sessionRender: previousSessionRenderResources.get(resourceId) ?? null,
            reusedWaveform: previousWaveformPyramids.has(resourceId),
          });
          continue;
        }
      }
      if (!decodeContext) {
        decodeContext = createSessionDecodeContext(archive.sessionDocument.sampleRate);
      }
      reportStatus(`Decoding "${archiveResource.fileName}"...`);
      const decodedBuffer = await decodeContext.decodeAudioData(archiveResource.fileBytes.slice().buffer);
      ensureImportableDecodedSize(archiveResource.fileName, decodedBuffer);
      decodedResources.push({
        resource: {
          id: resourceId,
          sampleRate: decodedBuffer.sampleRate,
          channels: decodedBuffer.numberOfChannels,
          length: decodedBuffer.length,
        },
        buffer: decodedBuffer,
        source: {
          fileName: archiveResource.fileName,
          mimeType: archiveResource.mimeType,
          lastModified: archiveResource.lastModified,
          bytes: archiveResource.fileBytes,
        },
        sessionRender: archiveResource.sessionRender ?? null,
        reusedWaveform: false,
      });
    }
  } finally {
    if (decodeContext instanceof AudioContext) {
      await decodeContext.close().catch(() => undefined);
    }
  }

  stopClipAutoScroll();
  demoState.transportLoop.stop(elements);
  await demoState.audio.releaseIfSampleRateChanged(archive.sessionDocument.sampleRate);
  const preservedViewState = options.preserveViewState
    ? captureSessionViewState(demoState.project)
    : null;

  let nextProject = initProject(options.targetSessionId);
  nextProject.timebase = new Timebase(archive.sessionDocument.sampleRate);
  for (const { resource } of decodedResources) {
    nextProject = importAudioResource(nextProject, resource);
  }
  nextProject = applySessionDocument(nextProject, archive.sessionDocument, buildFxResourceCodeMap(archive.fxResources));
  const restoredViewState = restoreSessionViewState(
    preservedViewState ?? options.sessionViewState,
    nextProject.timebase,
    demoState.viewport.timeScale.zoomLevelIndex,
  );
  nextProject = seek(nextProject, restoredViewState.cursorCoord);

  demoState.session.id = options.targetSessionId;
  demoState.session.name = options.targetSessionName;
  demoState.session.revision = options.targetSessionRevision ?? computeSessionDocumentRevision(archive.sessionDocument);
  demoState.session.inWorkspace = true;
  demoState.project = nextProject;
  demoState.transformChain = extractTransformChain(archive.sessionDocument);
  restoredViewState.applyToDemoState(nextProject.timebase);
  demoState.transportLoop.resetTimingCounters();
  demoState.activeFxTrackId = null;
  demoState.dragState = null;
  demoState.selectionRectState = null;
  demoState.rulerDragState = null;
  demoState.lastTimelinePointerClientX = null;
  demoState.geometryWindow.keepWarm = false;
  demoState.resources.audioBuffers = new Map(decodedResources.map(({ resource, buffer }) => [resource.id, buffer]));
  demoState.resources.sourceFiles = new Map(decodedResources.map(({ resource, source }) => [resource.id, source]));
  demoState.resources.sessionRenders = new Map(
    decodedResources.flatMap(({ resource, sessionRender }) => sessionRender ? [[resource.id, sessionRender] as const] : []),
  );
  demoState.clipOnsetAnnotations = extractClipOnsetAnnotations(archive.sessionDocument);
  demoState.resources.waveformPyramids = new Map(
    decodedResources.flatMap(({ resource, reusedWaveform }) => {
      if (!reusedWaveform) {
        return [];
      }
      const pyramid = previousWaveformPyramids.get(resource.id);
      return pyramid ? [[resource.id, pyramid] as const] : [];
    }),
  );
  demoState.resources.waveformTextureBanks = new Map(
    decodedResources.flatMap(({ resource, reusedWaveform }) => {
      if (!reusedWaveform) {
        return [];
      }
      const pyramid = previousWaveformPyramids.get(resource.id);
      if (!pyramid) {
        return [];
      }
      const textureBank = previousWaveformTextureBanks.get(resource.id) ?? buildWaveformTextureBank(pyramid);
      return [[resource.id, textureBank] as const];
    }),
  );
  demoState.resources.retainedIds = new Set(retainedResources.map((resource) => resource.resourceId));
  demoState.resources.importedBySignature = new Map(
    decodedResources.flatMap(({ resource, source, sessionRender }) => (
      sessionRender ? [] : [[getImportedResourceSourceSignature(source), resource.id] as const]
    )),
  );
  invalidateWaveformSlidingBuffers();
  TrackAudio.resetMix();
  demoState.audio.resetMasterLevel();
  demoState.masterLevel = applySessionDocumentToTrackPlayers(archive.sessionDocument, demoState.trackPlayers);
  TrackAudio.syncAllOutputs();
  demoState.audio.syncMasterGain();
  demoState.clipOnsetEditorState = null;
  clearSelectedClips();
  syncNextClipOrdinalFromProject(nextProject);
  markPersistedSessionViewState(options.targetSessionId, captureSessionViewState(nextProject));
  syncExactTimelineViewport(elements);
  demoState.session.historyPast = [...options.undoPast];
  demoState.session.historyFuture = [...options.undoFuture];
  syncTrackVolumeViews(elements);
  syncSessionDragHandleState(elements);
  elements.clipContextMenu.hidden = true;
  elements.clipOnsetPanel.hidden = true;
  elements.fxPanel.hidden = true;
  for (const btn of elements.trackFxButtons) {
    btn.setAttribute("aria-pressed", "false");
  }
  syncSessionUrl(options.targetSessionId);
  void touchLocalSessionOpened(options.targetSessionId).catch(() => undefined);
  reportStatus(null);
  if (options.successLogMessage) {
    pushRenderLog(options.successLogMessage);
  }
  render(elements);
  startRecompilation(elements);
  void recompileTransformChainEffects(elements);
  void refreshSessionWorkspaceControls(elements);
  void syncCurrentSessionViewLeaseRef?.();
  void syncCurrentSessionWriterLeaseRef?.();
  queueLoadedSessionWaveforms(
    decodedResources
      .filter(({ reusedWaveform }) => !reusedWaveform)
      .map(({ resource, buffer }) => ({ resource, buffer })),
    elements,
    reportStatus,
  );
  if (options.scheduleAutosaveAfterLoad) {
    scheduleWorkingSessionAutosave(elements);
  }
}

async function loadSessionArchive(file: File, elements: Elements): Promise<void> {
  const loadButton = elements.loadSessionButton;
  const defaultLabel = loadButton.textContent ?? "Load Session";
  const reportStatus = createImportStatusReporter(elements);
  loadButton.disabled = true;
  elements.saveSessionButton.disabled = true;
  loadButton.textContent = "Loading...";

  try {
    reportStatus(`Loading session "${file.name}"...`);
    await flushPendingWorkingSessionAutosave();
    const archiveBytes = await readImportedFileBytes(file);
    const archive = parseSessionArchive(archiveBytes);
    const targetMetadata = await ensureLocalSessionMetadata(
      createLocalSessionId(),
      getSessionNameFromArchiveFileName(file.name) ?? demoState.session.name,
    );
    await applyLoadedSessionArchive(archive, elements, reportStatus, {
      successLogMessage: `Load session "${file.name}"`,
      targetSessionId: targetMetadata.sessionId,
      targetSessionName: targetMetadata.sessionName,
      targetSessionRevision: computeSessionDocumentRevision(archive.sessionDocument),
      sessionViewState: null,
      retainedResources: archive.resources,
      undoPast: [],
      undoFuture: [],
      scheduleAutosaveAfterLoad: true,
    });
  } catch (error) {
    reportStatus(normalizeErrorMessage(error), "error");
    pushRenderLog(`ERROR: ${normalizeErrorMessage(error)}`);
    render(elements);
  } finally {
    elements.loadSessionInput.value = "";
    loadButton.disabled = false;
    elements.saveSessionButton.disabled = false;
    loadButton.textContent = defaultLabel;
  }
}

export async function restoreWorkingSessionIfAvailable(elements: Elements): Promise<boolean> {
  try {
    const workingSession = await loadWorkingSessionArchive(demoState.session.id);
    if (!workingSession) {
      return false;
    }
    await applyLoadedSessionArchive(workingSession.archive, elements, () => {}, {
      successLogMessage: null,
      targetSessionId: demoState.session.id,
      targetSessionName: demoState.session.name,
      targetSessionRevision: workingSession.sessionRevision,
      sessionViewState: workingSession.sessionViewState,
      retainedResources: workingSession.retainedResources,
      undoPast: workingSession.undoPast,
      undoFuture: workingSession.undoFuture,
      scheduleAutosaveAfterLoad: false,
    });
    demoState.footer.setStatus("Restored previous working session");
    render(elements);
    return true;
  } catch (error) {
    console.warn("[webdaw] working-session restore failed", normalizeErrorMessage(error));
    return false;
  }
}

async function renameCurrentSession(elements: Elements): Promise<void> {
  if (!demoState.session.inWorkspace) {
    demoState.session.name = elements.sessionNameInput.value.trim() || DEFAULT_SESSION_NAME;
    elements.sessionNameInput.value = demoState.session.name;
    syncSessionNameChrome();
    return;
  }
  const metadata = await ensureLocalSessionMetadata(demoState.session.id, elements.sessionNameInput.value);
  demoState.session.name = metadata.sessionName;
  elements.sessionNameInput.value = metadata.sessionName;
  syncSessionNameChrome();
  await refreshSessionWorkspaceControls(elements);
}

async function switchToSession(elements: Elements, sessionId: string): Promise<void> {
  closeSessionMenu(elements);
  if (sessionId === "__new__") {
    await createSessionAndNavigate();
    return;
  }
  if (!sessionId || sessionId === demoState.session.id) {
    elements.sessionNameInput.value = demoState.session.name;
    return;
  }
  try {
    await flushPendingWorkingSessionAutosave(elements);
  } catch (error) {
    console.warn("[webdaw] working-session flush failed", normalizeErrorMessage(error));
  }
  const targetMetadata = await getLocalSessionMetadata(sessionId);
  if (!targetMetadata) {
    window.location.assign(getSessionNavigationUrl(sessionId));
    return;
  }
  const workingSession = await loadWorkingSessionArchive(sessionId);
  if (!workingSession) {
    window.location.assign(getSessionNavigationUrl(sessionId));
    return;
  }
  const reportStatus = createImportStatusReporter(elements);
  try {
    reportStatus(`Opening session "${targetMetadata.sessionName}"...`);
    await applyLoadedSessionArchive(workingSession.archive, elements, reportStatus, {
      successLogMessage: `Open session "${targetMetadata.sessionName}"`,
      targetSessionId: targetMetadata.sessionId,
      targetSessionName: targetMetadata.sessionName,
      targetSessionRevision: workingSession.sessionRevision,
      sessionViewState: workingSession.sessionViewState,
      retainedResources: workingSession.retainedResources,
      undoPast: workingSession.undoPast,
      undoFuture: workingSession.undoFuture,
      scheduleAutosaveAfterLoad: false,
    });
  } catch (error) {
    reportStatus(normalizeErrorMessage(error), "error");
    pushRenderLog(`ERROR: ${normalizeErrorMessage(error)}`);
    render(elements);
  }
}

async function createSessionAndNavigate(): Promise<void> {
  const metadata = await ensureLocalSessionMetadata(createLocalSessionId());
  const sessionUrl = getSessionNavigationUrl(metadata.sessionId);
  try {
    await flushPendingWorkingSessionAutosave();
  } catch (error) {
    console.warn("[webdaw] working-session flush failed", normalizeErrorMessage(error));
  }
  window.location.assign(sessionUrl);
}

async function isCurrentSessionDirty(): Promise<boolean> {
  if (!demoState.session.inWorkspace) {
    return demoState.session.historyPast.length > 0
      || demoState.session.historyFuture.length > 0
      || collectUsedSessionResourceIds(createCurrentSessionDocument()).length > 0
      || demoState.session.name.trim() !== DEFAULT_SESSION_NAME
      || isWorkingSessionAutosavePending();
  }
  const workingSession = await loadWorkingSessionArchive(demoState.session.id);
  if (!workingSession) {
    return true;
  }
  const currentSessionDocument = createCurrentSessionDocument();
  const currentSessionViewState = captureSessionViewState(demoState.project);
  return !areSessionDocumentsEqual(currentSessionDocument, workingSession.archive.sessionDocument)
    || !areSessionViewStatesEqual(currentSessionViewState, workingSession.sessionViewState)
    || !areSessionDocumentListsEqual(demoState.session.historyPast, workingSession.undoPast)
    || !areSessionDocumentListsEqual(demoState.session.historyFuture, workingSession.undoFuture);
}

async function closeCurrentSession(): Promise<void> {
  const closingSessionId = demoState.session.id;
  const closingSessionName = demoState.session.name;
  const sessionMetadata = demoState.session.inWorkspace
    ? await getLocalSessionMetadata(closingSessionId)
    : null;
  const otherOpenViewCount = sessionMetadata
    ? sessionMetadata.viewLeases.filter((lease) => lease.tabId !== demoState.session.tabId).length
    : 0;
  const isLastWorkspaceView = !demoState.session.inWorkspace || otherOpenViewCount === 0;
  if (isLastWorkspaceView) {
    const dirty = await isCurrentSessionDirty();
    if (dirty) {
      const confirmed = window.confirm(`Close session "${closingSessionName}" and discard unsaved workspace changes?`);
      if (!confirmed) {
        return;
      }
    }
  }
  await cancelWorkingSessionAutosave();
  if (demoState.session.inWorkspace) {
    await releaseLocalSessionWriter(closingSessionId, demoState.session.tabId).catch(() => undefined);
    await releaseLocalSessionView(closingSessionId, demoState.session.tabId).catch(() => undefined);
    if (isLastWorkspaceView) {
      await deleteLocalSession(closingSessionId);
      broadcastWorkspaceSyncMessage({
        type: "workspace-changed",
        sessionId: closingSessionId,
        fromTabId: demoState.session.tabId,
      });
    }
  }
  const remainingSessions = await listLocalSessions();
  const nextSession = remainingSessions.find((session) => session.sessionId !== closingSessionId) ?? null;
  window.location.assign(getSessionNavigationUrl(nextSession?.sessionId ?? null, nextSession === null));
}

function showTrackSliderOverlay(slider: HTMLInputElement): void {
  slider.closest(".track-slider")?.classList.add("show-overlay");
}

function hideTrackSliderOverlay(slider: HTMLInputElement): void {
  slider.closest(".track-slider")?.classList.remove("show-overlay");
}

function releaseTrackSliderFocus(slider: HTMLInputElement): void {
  slider.blur();
}

function syncTrackVolumeSliderFill(slider: HTMLInputElement): void {
  const minimum = Number(slider.min || "0");
  const maximum = Number(slider.max || "100");
  const value = Number(slider.value || "0");
  const ratio = maximum <= minimum ? 0 : (value - minimum) / (maximum - minimum);
  const fillRatio = String(Math.max(0, Math.min(ratio, 1)));
  slider.style.setProperty("--track-fill-ratio", fillRatio);
  const sliderContainer = slider.closest<HTMLElement>(".track-slider");
  sliderContainer?.style.setProperty("--track-fill-ratio", fillRatio);
}

/**
 * Purpose: Synchronize the track-strip volume readouts with the current track-player levels.
 * How: Write the formatted level into each output element and keep the sliders aligned with the stored normalized gain.
 */
function syncTrackVolumeViews(elements: Elements): void {
  elements.masterVolumeSlider.value = String(
    Math.max(MASTER_SLIDER_MIN_DB, Math.min(dbFromGain(demoState.masterLevel), MASTER_SLIDER_MAX_DB)),
  );
  syncTrackVolumeSliderFill(elements.masterVolumeSlider);
  elements.masterVolumeValue.value = `MASTER ${formatTrackLevel(demoState.masterLevel)}`;
  elements.masterVolumeValue.textContent = elements.masterVolumeValue.value;

  for (const slider of elements.trackVolumeSliders) {
    const trackId = slider.dataset.trackId as TrackId | undefined;
    if (!trackId) {
      continue;
    }
    const trackPlayer = demoState.trackPlayers.get(trackId);
    if (!trackPlayer) {
      continue;
    }
    slider.value = String(trackPlayer.level * 100);
    syncTrackVolumeSliderFill(slider);
  }

  for (const slider of elements.trackPanSliders) {
    const trackId = slider.dataset.trackId as TrackId | undefined;
    if (!trackId) {
      continue;
    }
    const trackPlayer = demoState.trackPlayers.get(trackId);
    if (!trackPlayer) {
      continue;
    }
    slider.value = String(Math.round(-trackPlayer.pan * 100));
  }

  for (const button of elements.trackMuteButtons) {
    const trackId = button.dataset.trackId as TrackId | undefined;
    if (!trackId) {
      continue;
    }
    const trackPlayer = demoState.trackPlayers.get(trackId);
    if (!trackPlayer) {
      continue;
    }
    button.setAttribute("aria-pressed", String(trackPlayer.muted));
    button.setAttribute("aria-label", `${trackPlayer.muted ? "Unmute" : "Mute"} ${trackId}`);
  }

  for (const button of elements.trackSoloButtons) {
    const trackId = button.dataset.trackId as TrackId | undefined;
    if (!trackId) {
      continue;
    }
    const trackPlayer = demoState.trackPlayers.get(trackId);
    if (!trackPlayer) {
      continue;
    }
    button.setAttribute("aria-pressed", String(trackPlayer.solo));
    button.setAttribute("aria-label", `${trackPlayer.solo ? "Disable solo" : "Solo"} ${trackId}`);
  }

  for (const output of elements.trackVolumeValues) {
    const trackId = output.dataset.trackId as TrackId | undefined;
    if (!trackId) {
      continue;
    }
    const trackPlayer = demoState.trackPlayers.get(trackId);
    if (!trackPlayer) {
      continue;
    }
    output.value = `GAIN ${formatTrackLevel(trackPlayer.level)}`;
    output.textContent = output.value;
  }

  for (const output of elements.trackPanValues) {
    const trackId = output.dataset.trackId as TrackId | undefined;
    if (!trackId) {
      continue;
    }
    const trackPlayer = demoState.trackPlayers.get(trackId);
    if (!trackPlayer) {
      continue;
    }
    output.value = `PAN ${formatTrackPan(trackPlayer.pan)}`;
    output.textContent = output.value;
  }
}


function restoreSessionDocument(
  sessionDocument: SessionDocument,
  label: string,
  elements: Elements,
): boolean {
  try {
    demoState.transportLoop.stop(elements);
    demoState.project = stop(demoState.project);
    demoState.project = applySessionDocument(demoState.project, sessionDocument);
    // Clip structure may have changed (undo/redo of cut, delete, move, …), so the
    // shared grid sliding buffers must be refilled from the restored project model.
    invalidateWaveformSlidingBuffers();
    demoState.clipOnsetAnnotations = extractClipOnsetAnnotations(sessionDocument);
    demoState.clipOnsetEditorState = null;
    demoState.transformChain = extractTransformChain(sessionDocument);
    demoState.masterLevel = applySessionDocumentToTrackPlayers(sessionDocument, demoState.trackPlayers);
    syncCurrentSessionRevision(sessionDocument);
    TrackAudio.syncAllOutputs();
    demoState.audio.syncMasterGain();
    clearSelectedClips();
    syncTrackVolumeViews(elements);
    syncSessionDragHandleState(elements);
    pushRenderLog(label);
    elements.clipOnsetPanel.hidden = true;
    render(elements);
    startRecompilation(elements);
    void recompileTransformChainEffects(elements);
    scheduleWorkingSessionAutosave(elements);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushRenderLog(`ERROR: ${message}`);
    render(elements);
    return false;
  }
}

function undoSessionDocument(elements: Elements): void {
  const previousSessionDocument = demoState.session.historyPast.at(-1);
  if (!previousSessionDocument) {
    return;
  }
  const currentSessionDocument = createCurrentSessionDocument();
  if (!restoreSessionDocument(previousSessionDocument, "Undo", elements)) {
    return;
  }
  demoState.session.historyPast = demoState.session.historyPast.slice(0, -1);
  demoState.session.historyFuture = [...demoState.session.historyFuture, currentSessionDocument];
}

function redoSessionDocument(elements: Elements): void {
  const nextSessionDocument = demoState.session.historyFuture.at(-1);
  if (!nextSessionDocument) {
    return;
  }
  const currentSessionDocument = createCurrentSessionDocument();
  if (!restoreSessionDocument(nextSessionDocument, "Redo", elements)) {
    return;
  }
  demoState.session.historyFuture = demoState.session.historyFuture.slice(0, -1);
  demoState.session.historyPast = [...demoState.session.historyPast, currentSessionDocument];
}



/**
 * Purpose: Decode one user-provided audio file into the project's runtime sample rate and derive its AudioResource descriptor.
 * How: Read the file bytes, decode them through the shared AudioContext, then expose the decoded buffer metadata as an immutable resource.
 */
async function decodeImportedAudioFile(
  resourceId: string,
  importedAudio: ImportedAudioPayload,
  reportStatus: ImportStatusReporter,
): Promise<{ resource: AudioResource; buffer: AudioBuffer; sourceBytes: Uint8Array }> {
  const { file } = importedAudio;
  const audioContext = demoState.audio.ensureContext();
  if (!audioContext) {
    throw new Error("Web Audio is not available in this browser");
  }

  ensureImportableFileSize(file);
  let fileBytes = importedAudio.fileBytes;
  if (!fileBytes) {
    try {
      fileBytes = await readImportedFileBytes(file);
    } catch (error) {
      throw new Error(`Unable to read "${file.name}": ${normalizeErrorMessage(error)}`);
    }
  }
  reportStatus(`Importing "${file.name}" (${formatByteSize(file.size)})...`);
  let decodedBuffer: AudioBuffer;

  try {
    decodedBuffer = await audioContext.decodeAudioData(fileBytes.slice().buffer);
  } catch (nativeDecodeError) {
    pushRenderLog(`Native decode failed for "${file.name}", trying ffmpeg.wasm`);
    reportStatus(`Converting "${file.name}" via ffmpeg.wasm...`);
    try {
      const transcodedWavBytes = await transcodeAudioFileToWavBytes(file, fileBytes);
      decodedBuffer = await audioContext.decodeAudioData(transcodedWavBytes);
      pushRenderLog(`Import "${file.name}" via ffmpeg.wasm fallback`);
    } catch (ffmpegDecodeError) {
      throw new Error(
        `Unable to decode "${file.name}" natively or via ffmpeg.wasm: ${normalizeErrorMessage(ffmpegDecodeError)}`,
      );
    }
  }

  ensureImportableDecodedSize(file.name, decodedBuffer);

  const resource: AudioResource = {
    id: resourceId,
    sampleRate: decodedBuffer.sampleRate,
    channels: decodedBuffer.numberOfChannels,
    length: decodedBuffer.length,
  };
  return { resource, buffer: decodedBuffer, sourceBytes: fileBytes };
}

/**
 * Purpose: Reflect imported audio metadata back into the inspector form.
 * How: Copy the decoded buffer dimensions into the numeric inputs so the form mirrors the real runtime resource.
 */
/**
 * Purpose: Import one decoded audio file into the project and cache its playback buffer.
 * How: Decode the file, create a unique resource id, import the immutable resource, then retain the decoded AudioBuffer by resource id.
 */
async function importAudioFile(
  importedAudio: ImportedAudioPayload,
  preferredResourceId?: string,
  elements?: Elements,
  reportStatus: ImportStatusReporter = () => {},
): Promise<AudioResource> {
  const { file } = importedAudio;
  const fileSignature = getAudioFileSignature(file);
  const existingResourceId = demoState.resources.importedBySignature.get(fileSignature);
  if (existingResourceId) {
    const existingResource = demoState.project.resources.get(existingResourceId);
    if (existingResource) {
      demoState.resources.retainedIds.add(existingResource.id);
      reportStatus(null);
      return existingResource;
    }
    demoState.resources.importedBySignature.delete(fileSignature);
  }

  const resourceId = createUniqueResourceId(preferredResourceId ?? stripFileExtension(file.name));
  const decodedImport = await decodeImportedAudioFile(resourceId, importedAudio, reportStatus);
  demoState.project = importAudioResource(demoState.project, decodedImport.resource);
  demoState.resources.audioBuffers.set(decodedImport.resource.id, decodedImport.buffer);
  demoState.resources.sourceFiles.set(
    decodedImport.resource.id,
    createImportedResourceSource(file, decodedImport.sourceBytes),
  );
  demoState.resources.retainedIds.add(decodedImport.resource.id);
  demoState.resources.importedBySignature.set(fileSignature, decodedImport.resource.id);
  reportStatus(`Building waveform for "${file.name}"...`);
  const currentRenderScale = demoState.viewport.timeScale.getScale();
  const preferredWaveformBucketSizeSamples = getExactWaveformBucketSizeSamples(
    currentRenderScale.zoomPixels,
    currentRenderScale.zoomSamples,
  );
  void buildWaveformPyramidInBackground(
    decodedImport.buffer,
    preferredWaveformBucketSizeSamples,
    (partialPyramid) => {
      demoState.resources.cacheWaveformPyramid(decodedImport.resource.id, partialPyramid);
      reportStatus(
        demoState.footer.message ?? `Building waveform for "${file.name}"...`,
        demoState.footer.tone,
      );
      if (
        elements
        && demoState.dragState === null
        && demoState.rulerDragState === null
        && demoState.project.timeline.transport !== "Playing"
      ) {
        renderWaveformPreviewFrame(elements);
      }
    },
  )
    .then((pyramid) => {
      demoState.resources.cacheWaveformPyramid(decodedImport.resource.id, pyramid);
      reportStatus(null);
      if (
        elements
        && demoState.dragState === null
        && demoState.rulerDragState === null
        && demoState.project.timeline.transport !== "Playing"
      ) {
        renderWaveformPreviewFrame(elements);
      }
    })
    .catch((error) => {
      const message = normalizeErrorMessage(error);
      pushRenderLog(`ERROR: Unable to build waveform for "${file.name}": ${message}`);
      reportStatus(`Unable to build waveform for "${file.name}": ${message}`, "error");
    });
  return decodedImport.resource;
}


// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

/**
 * Purpose: Parse a numeric value from an input element with validation.
 * How: Read valueAsNumber and throw if the result is not finite.
 */
function readNumber(input: HTMLInputElement): number {
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid number for "${input.name}"`);
  }
  return value;
}

/**
 * Purpose: Parse a time value from an input and convert to internal time coordinate.
 * How: Read the number and delegate to toTimeCoord.
 */
function readTimeCoord(input: HTMLInputElement, timebase: Timebase) {
  return timebase.toTimeCoord(readNumber(input));
}

/**
 * Purpose: Produce a deterministic varying duration between a configured minimum and maximum.
 * How: Map the clip ordinal through a small modular sequence so generated test clips differ without randomness.
 */
function getGeneratedLengthSeconds(index: number, minLengthSeconds: number, maxLengthSeconds: number): number {
  if (maxLengthSeconds <= minLengthSeconds) {
    return minLengthSeconds;
  }

  const ratio = ((index * 37) % 101) / 100;
  return minLengthSeconds + ratio * (maxLengthSeconds - minLengthSeconds);
}

/**
 * Purpose: Populate one track with many generated resources and clips for rendering and scrolling tests.
 * How: Chain immutable resource imports and clip placements while advancing a running start cursor by generated clip length plus gap.
 */
function generateClips(
  prefix: string,
  count: number,
  minLengthSeconds: number,
  maxLengthSeconds: number,
  gapSeconds: number,
  mode: "single" | "round-robin",
  trackId: TrackId,
): Project {
  const safePrefix = prefix.trim() || "stress";
  const sampleRate = demoState.project.timebase.sampleRate;
  const gapCoord = demoState.viewport.timeScale.toTimeCoord(gapSeconds);
  let current = demoState.project;
  let nextStart = 0;
  const nextStartsByTrack = new Map<TrackId, number>(TRACK_IDS.map((candidateTrackId) => [candidateTrackId, 0]));
  let lastClipId: string | null = null;

  for (let index = 0; index < count; index += 1) {
    const clipOrdinal = demoState.nextClipOrdinal++;
    const clipId = `clip-${clipOrdinal}`;
    const resourceId = `${safePrefix}-res-${clipOrdinal}`;
    const lengthSeconds = getGeneratedLengthSeconds(index, minLengthSeconds, maxLengthSeconds);
    const targetTrackId =
      mode === "round-robin"
        ? TRACK_IDS[index % TRACK_IDS.length]!
        : trackId;
    const resource: AudioResource = {
      id: resourceId,
      sampleRate,
      channels: 2,
      length: Math.max(1, Math.round(lengthSeconds * sampleRate)),
    };

    current = importAudioResource(current, resource);
    const clipStart = mode === "round-robin" ? (nextStartsByTrack.get(targetTrackId) ?? 0) : nextStart;
    current = placeClip(current, clipId, resource, clipStart, targetTrackId);
    lastClipId = clipId;
    const nextTrackStart = clipStart + current.timebase.toTimeCoord(lengthSeconds) + gapCoord;
    if (mode === "round-robin") {
      nextStartsByTrack.set(targetTrackId, nextTrackStart);
    } else {
      nextStart = nextTrackStart;
    }
  }

  setSelectedClipIds(lastClipId ? [lastClipId] : []);
  return current;
}

/**
 * Purpose: Execute a domain transition, log it, and re-render.
 * How: Run the transition callback, catch errors to the log, and trigger a render pass.
 */

// ---------------------------------------------------------------------------
// Drag: cursor
// ---------------------------------------------------------------------------

/**
 * Purpose: Initialize the marker manager with all services and domain callbacks.
 * How: Creates markers, wires coord conversion, snap, and render services.
 *      Cursor drag triggers seek; cut marker drag just re-renders.
 */
function wireMarkerManager(elements: Elements): void {
  const vp = demoState.viewport;
  initMarkerManager({
    container: elements.markerLayer,
    pixelToCoord: (clientX) => getTimeFromGridClientX(clientX, elements),
    coordToPixel: (coord) => vp.coordToPixel(coord),
    snapToGrid: (coord) => applyClipMagnetism(coord),
    renderFrame: () => renderFrame(elements),
    getGridRect: () => elements.timelineGrid.getBoundingClientRect(),
    viewport: {
      get viewStartCoord() { return vp.viewStartCoord; },
      get viewDurationCoord() { return vp.viewDurationCoord; },
      get timebase() { return vp.timeScale.timebase; },
      setViewStartCoord(coord: number) {
        vp.viewStartCoord = coord;
      },
      clampViewStartCoord: (start) => vp.clampStartCoord(start),
      getEdgeScrollMaxSpeed: () => vp.getEdgeScrollMaxSpeed(),
    },
    cursorOnStep: (_marker, coord) => {
      demoState.project = seek(demoState.project, coord);
      demoState.viewport.ensureCursorVisible(demoState.project.timeline.cursor);
    },
    cursorOnDragEnd: (_marker) => {
      demoState.viewport.ensureCursorVisible(demoState.project.timeline.cursor);
      pushRenderLog(`Seek to ${demoState.viewport.timeScale.fromTimeCoord(demoState.project.timeline.cursor).toFixed(2)} s`);
      render(elements);
      demoState.playbackSession.restartIfNeeded();
    },
  });
}

// ---------------------------------------------------------------------------
// Drag: ruler (pan / zoom)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Form event wiring
// ---------------------------------------------------------------------------

/**
 * Purpose: Register all form submit handlers, button clicks, and drag gesture wiring.
 * How: Attach listeners for project init, resource import, clip placement/removal, cursor seek,
 *      transport controls, tick, reset, and the three drag subsystems (clip, cursor, ruler).
 */
export function wireEvents(elements: Elements): void {
  syncTrackVolumeViews(elements);

  const trackSliderSessionBaselines = new WeakMap<HTMLInputElement, SessionDocument>();
  const workspaceSyncChannel = openWorkspaceSyncChannel();
  let currentSessionViewLeaseId: string | null = null;
  let sessionViewRenewIntervalId: number | null = null;
  let sessionWriterRenewIntervalId: number | null = null;
  let sessionWriterRetryTimeoutId: number | null = null;
  let remoteSessionRefreshPromise: Promise<void> | null = null;

  const getReadOnlySessionMessage = (): string =>
    `Session "${demoState.session.name}" is open read-only in this tab`;

  const notifyReadOnlySession = (): boolean => {
    if (canCurrentTabWriteSession()) {
      return true;
    }
    demoState.footer.setStatus(getReadOnlySessionMessage(), "error");
    render(elements);
    return false;
  };

  const claimCurrentSessionWriterForDirectInteraction = async (): Promise<boolean> => {
    if (!demoState.session.inWorkspace) {
      return true;
    }
    const metadata = await claimLocalSessionWriter(demoState.session.id, demoState.session.tabId).catch(() => null);
    const isWriter = !metadata || metadata.writerTabId === demoState.session.tabId;
    if (isWriter) {
      stopSessionWriterRetry();
      setSessionAccessMode("writer", elements, null);
      startSessionWriterHeartbeat();
      return true;
    }
    stopSessionWriterHeartbeat();
    setSessionAccessMode("follower", elements, getReadOnlySessionMessage());
    scheduleSessionWriterRetry();
    return false;
  };

  const stopSessionWriterHeartbeat = (): void => {
    if (sessionWriterRenewIntervalId !== null) {
      window.clearInterval(sessionWriterRenewIntervalId);
      sessionWriterRenewIntervalId = null;
    }
  };

  const stopSessionViewHeartbeat = (): void => {
    if (sessionViewRenewIntervalId !== null) {
      window.clearInterval(sessionViewRenewIntervalId);
      sessionViewRenewIntervalId = null;
    }
  };

  const stopSessionViewStateAutosave = stopSessionViewStateAutosaveInterval;

  const stopSessionWriterRetry = (): void => {
    if (sessionWriterRetryTimeoutId !== null) {
      window.clearTimeout(sessionWriterRetryTimeoutId);
      sessionWriterRetryTimeoutId = null;
    }
  };

  const scheduleSessionWriterRetry = (): void => {
    if (sessionWriterRetryTimeoutId !== null || document.hidden || !document.hasFocus() || !demoState.session.inWorkspace) {
      return;
    }
    sessionWriterRetryTimeoutId = window.setTimeout(() => {
      sessionWriterRetryTimeoutId = null;
      void syncCurrentSessionWriterLease();
    }, 300);
  };

  const startSessionWriterHeartbeat = (): void => {
    if (sessionWriterRenewIntervalId !== null || !demoState.session.inWorkspace || demoState.session.accessMode !== "writer") {
      return;
    }
    sessionWriterRenewIntervalId = window.setInterval(() => {
      if (!demoState.session.inWorkspace || demoState.session.accessMode !== "writer") {
        stopSessionWriterHeartbeat();
        return;
      }
      void renewLocalSessionWriter(demoState.session.id, demoState.session.tabId).catch(() => undefined);
    }, SESSION_WRITER_RENEW_INTERVAL_MS);
  };

  const startSessionViewHeartbeat = (): void => {
    if (sessionViewRenewIntervalId !== null || !demoState.session.inWorkspace) {
      return;
    }
    sessionViewRenewIntervalId = window.setInterval(() => {
      if (!demoState.session.inWorkspace) {
        stopSessionViewHeartbeat();
        return;
      }
      void renewLocalSessionView(demoState.session.id, demoState.session.tabId).catch(() => undefined);
    }, SESSION_VIEW_RENEW_INTERVAL_MS);
  };

  const startSessionViewStateAutosave = startSessionViewStateAutosaveInterval;

  const syncCurrentSessionViewLease = async (): Promise<void> => {
    if (!demoState.session.inWorkspace) {
      if (currentSessionViewLeaseId !== null) {
        await releaseLocalSessionView(currentSessionViewLeaseId, demoState.session.tabId).catch(() => undefined);
        currentSessionViewLeaseId = null;
      }
      stopSessionViewHeartbeat();
      return;
    }
    if (currentSessionViewLeaseId !== null && currentSessionViewLeaseId !== demoState.session.id) {
      await releaseLocalSessionView(currentSessionViewLeaseId, demoState.session.tabId).catch(() => undefined);
      currentSessionViewLeaseId = null;
    }
    await claimLocalSessionView(demoState.session.id, demoState.session.tabId).catch(() => null);
    currentSessionViewLeaseId = demoState.session.id;
    startSessionViewHeartbeat();
  };
  syncCurrentSessionViewLeaseRef = syncCurrentSessionViewLease;

  const syncCurrentSessionWriterLease = async (): Promise<void> => {
    if (!demoState.session.inWorkspace) {
      stopSessionWriterHeartbeat();
      stopSessionWriterRetry();
      stopSessionViewStateAutosave();
      setSessionAccessMode("writer", elements, null);
      return;
    }
    if (document.hidden || !document.hasFocus()) {
      stopSessionWriterHeartbeat();
      stopSessionWriterRetry();
      stopSessionViewStateAutosave();
      const releasedSessionId = demoState.session.id;
      if (demoState.session.accessMode === "writer") {
        let shouldFlushWorkingSession = isWorkingSessionAutosavePending();
        if (!shouldFlushWorkingSession) {
          try {
            shouldFlushWorkingSession = await isCurrentSessionDirty();
          } catch (error) {
            console.warn("[webdaw] working-session dirty check failed", normalizeErrorMessage(error));
            shouldFlushWorkingSession = true;
          }
        }
        if (shouldFlushWorkingSession) {
          try {
            await flushPendingWorkingSessionAutosave(elements);
          } catch (error) {
            console.warn("[webdaw] working-session flush failed", normalizeErrorMessage(error));
          }
        }
      }
      if (demoState.session.id === releasedSessionId && demoState.session.inWorkspace) {
        await releaseLocalSessionWriter(releasedSessionId, demoState.session.tabId).catch(() => undefined);
      }
      if (demoState.session.id === releasedSessionId) {
        setSessionAccessMode("follower", elements, null);
      }
      return;
    }
    const metadata = await claimLocalSessionWriter(demoState.session.id, demoState.session.tabId).catch(() => null);
    const isWriter = !metadata || metadata.writerTabId === demoState.session.tabId;
    if (isWriter) {
      stopSessionWriterRetry();
      setSessionAccessMode("writer", elements, null);
      startSessionWriterHeartbeat();
      startSessionViewStateAutosave();
      return;
    }
    stopSessionWriterHeartbeat();
    stopSessionViewStateAutosave();
    setSessionAccessMode("follower", elements, getReadOnlySessionMessage());
    scheduleSessionWriterRetry();
  };
  syncCurrentSessionWriterLeaseRef = syncCurrentSessionWriterLease;

  const refreshCurrentSessionFromWorkspace = async (): Promise<void> => {
    if (!demoState.session.inWorkspace) {
      return;
    }
    // Flush any pending local autosave so the workspace has the latest state
    // before we reload from it — prevents losing in-flight changes.
    await flushPendingWorkingSessionAutosave(elements);
    const currentSessionId = demoState.session.id;
    const workingSession = await loadWorkingSessionArchive(currentSessionId);
    if (!workingSession || demoState.session.id !== currentSessionId) {
      return;
    }
    await applyLoadedSessionArchive(workingSession.archive, elements, () => {}, {
      successLogMessage: null,
      targetSessionId: currentSessionId,
      targetSessionName: demoState.session.name,
      targetSessionRevision: workingSession.sessionRevision,
      sessionViewState: workingSession.sessionViewState,
      retainedResources: workingSession.retainedResources,
      undoPast: workingSession.undoPast,
      undoFuture: workingSession.undoFuture,
      scheduleAutosaveAfterLoad: false,
      preserveViewState: true,
    });
  };

  const queueRemoteSessionRefresh = (): void => {
    if (remoteSessionRefreshPromise) {
      return;
    }
    remoteSessionRefreshPromise = (async () => {
      try {
        await refreshCurrentSessionFromWorkspace();
      } finally {
        remoteSessionRefreshPromise = null;
      }
    })();
  };

  workspaceSyncChannel?.addEventListener("message", (event: MessageEvent<WorkspaceSyncMessage>) => {
    const message = event.data;
    if (!message || message.fromTabId === demoState.session.tabId) {
      return;
    }
    void refreshSessionWorkspaceControls(elements).then(() => {
      syncClipOnsetPanel();
      if (message.sessionId === demoState.session.id && demoState.session.accessMode === "follower") {
        queueRemoteSessionRefresh();
        return;
      }
      if (demoState.resources.sessionRenders.size > 0) {
        render(elements);
      }
    });
  });

  const beginTrackSliderSessionEdit = (slider: HTMLInputElement): void => {
    if (!notifyReadOnlySession()) {
      return;
    }
    if (!trackSliderSessionBaselines.has(slider)) {
      trackSliderSessionBaselines.set(slider, createCurrentSessionDocument());
    }
    showTrackSliderOverlay(slider);
  };

  const commitTrackSliderSessionEdit = (slider: HTMLInputElement, label: string): void => {
    const previousSessionDocument = trackSliderSessionBaselines.get(slider);
    trackSliderSessionBaselines.delete(slider);
    if (!previousSessionDocument) {
      return;
    }
    commitCurrentSessionDocumentChange(label, previousSessionDocument, elements);
  };

  for (const slider of elements.trackVolumeSliders) {
    slider.addEventListener("pointerdown", () => {
      beginTrackSliderSessionEdit(slider);
    });
    slider.addEventListener("focus", () => {
      beginTrackSliderSessionEdit(slider);
    });
    slider.addEventListener("input", () => {
      const trackId = slider.dataset.trackId as TrackId | undefined;
      if (!trackId) {
        return;
      }
      const trackPlayer = demoState.trackPlayers.get(trackId);
      if (!trackPlayer) {
        return;
      }
      trackPlayer.level = Math.max(0, Math.min(readNumber(slider) / 100, 1));
      TrackAudio.ensureOutputGain(trackId, (ctx) => demoState.audio.ensureMasterGain(ctx));
      TrackAudio.syncOutput(trackId);
      syncTrackVolumeSliderFill(slider);
      syncTrackVolumeViews(elements);
      showTrackSliderOverlay(slider);
    });
    slider.addEventListener("change", () => {
      const trackId = slider.dataset.trackId as TrackId | undefined;
      hideTrackSliderOverlay(slider);
      if (!trackId) {
        trackSliderSessionBaselines.delete(slider);
        return;
      }
      commitTrackSliderSessionEdit(slider, `Set ${trackId} gain to ${formatTrackLevel(readNumber(slider) / 100)}`);
    });
    slider.addEventListener("blur", () => {
      trackSliderSessionBaselines.delete(slider);
      hideTrackSliderOverlay(slider);
    });
    slider.addEventListener("pointerup", () => releaseTrackSliderFocus(slider));
    slider.addEventListener("pointercancel", () => releaseTrackSliderFocus(slider));
  }

  for (const slider of elements.trackPanSliders) {
    slider.addEventListener("pointerdown", () => {
      beginTrackSliderSessionEdit(slider);
    });
    slider.addEventListener("focus", () => {
      beginTrackSliderSessionEdit(slider);
    });
    slider.addEventListener("input", () => {
      const trackId = slider.dataset.trackId as TrackId | undefined;
      if (!trackId) {
        return;
      }
      const trackPlayer = demoState.trackPlayers.get(trackId);
      if (!trackPlayer) {
        return;
      }
      trackPlayer.pan = Math.max(-1, Math.min(-readNumber(slider) / 100, 1));
      TrackAudio.ensureOutputGain(trackId, (ctx) => demoState.audio.ensureMasterGain(ctx));
      TrackAudio.syncOutput(trackId);
      syncTrackVolumeViews(elements);
      showTrackSliderOverlay(slider);
    });
    slider.addEventListener("change", () => {
      const trackId = slider.dataset.trackId as TrackId | undefined;
      hideTrackSliderOverlay(slider);
      if (!trackId) {
        trackSliderSessionBaselines.delete(slider);
        return;
      }
      commitTrackSliderSessionEdit(slider, `Set ${trackId} pan to ${formatTrackPan(Math.max(-1, Math.min(-readNumber(slider) / 100, 1)))}`);
    });
    slider.addEventListener("blur", () => {
      trackSliderSessionBaselines.delete(slider);
      hideTrackSliderOverlay(slider);
    });
    slider.addEventListener("pointerup", () => releaseTrackSliderFocus(slider));
    slider.addEventListener("pointercancel", () => releaseTrackSliderFocus(slider));
  }

  elements.masterVolumeSlider.addEventListener("pointerdown", () => {
    beginTrackSliderSessionEdit(elements.masterVolumeSlider);
  });
  elements.masterVolumeSlider.addEventListener("focus", () => {
    beginTrackSliderSessionEdit(elements.masterVolumeSlider);
  });
  elements.masterVolumeSlider.addEventListener("input", () => {
    const masterDb = Math.max(MASTER_SLIDER_MIN_DB, Math.min(readNumber(elements.masterVolumeSlider), MASTER_SLIDER_MAX_DB));
    demoState.masterLevel = gainFromDb(masterDb);
    demoState.audio.syncMasterGain();
    syncTrackVolumeSliderFill(elements.masterVolumeSlider);
    syncTrackVolumeViews(elements);
    showTrackSliderOverlay(elements.masterVolumeSlider);
  });
  elements.masterVolumeSlider.addEventListener("change", () => {
    hideTrackSliderOverlay(elements.masterVolumeSlider);
    const masterDb = Math.max(MASTER_SLIDER_MIN_DB, Math.min(readNumber(elements.masterVolumeSlider), MASTER_SLIDER_MAX_DB));
    commitTrackSliderSessionEdit(
      elements.masterVolumeSlider,
      `Set master gain to ${masterDb.toFixed(1)} dB`,
    );
  });
  elements.masterVolumeSlider.addEventListener("blur", () => {
    trackSliderSessionBaselines.delete(elements.masterVolumeSlider);
    hideTrackSliderOverlay(elements.masterVolumeSlider);
  });
  elements.masterVolumeSlider.addEventListener("pointerup", () => releaseTrackSliderFocus(elements.masterVolumeSlider));
  elements.masterVolumeSlider.addEventListener("pointercancel", () => releaseTrackSliderFocus(elements.masterVolumeSlider));

  for (const button of elements.trackMuteButtons) {
    button.addEventListener("click", () => {
      const trackId = button.dataset.trackId as TrackId | undefined;
      if (!trackId) {
        return;
      }
      const trackPlayer = demoState.trackPlayers.get(trackId);
      if (!trackPlayer) {
        return;
      }
      const previousSessionDocument = createCurrentSessionDocument();
      trackPlayer.muted = !trackPlayer.muted;
      TrackAudio.syncAllOutputs();
      syncTrackVolumeViews(elements);
      commitCurrentSessionDocumentChange(
        `${trackPlayer.muted ? "Mute" : "Unmute"} ${trackId}`,
        previousSessionDocument,
        elements,
      );
    });
  }

  for (const button of elements.trackSoloButtons) {
    button.addEventListener("click", () => {
      const trackId = button.dataset.trackId as TrackId | undefined;
      if (!trackId) {
        return;
      }
      const trackPlayer = demoState.trackPlayers.get(trackId);
      if (!trackPlayer) {
        return;
      }
      const previousSessionDocument = createCurrentSessionDocument();
      const enableSolo = !trackPlayer.solo;
      for (const [candidateTrackId, candidateTrackPlayer] of demoState.trackPlayers.entries()) {
        candidateTrackPlayer.solo = enableSolo && candidateTrackId === trackId;
      }
      TrackAudio.syncAllOutputs();
      syncTrackVolumeViews(elements);
      commitCurrentSessionDocumentChange(
        `${enableSolo ? "Solo" : "Disable solo"} ${trackId}`,
        previousSessionDocument,
        elements,
      );
    });
  }

  // --- FX panel (delegated to fx-chain module) ---
  wireFxPanel(elements, {});

  // --- Transform panel (delegated to faust-transform module) ---
  wireTransformPanel(elements, {});

  // Refresh the footer's "Undo scope" zone whenever the focus moves —
  // the scope is computed from the focused element (calque > chain >
  // project), so any focus shift can change which scope Cmd+Z would
  // affect. We use the bubbling `focusin` event to catch all moves.
  window.addEventListener("focusin", () => {
    demoState.footer.sync(elements);
  });

  wireFaustEditor(elements);

  const preventBrowserFileDrop = (event: DragEvent): void => {
    if (!isFileDrag(event.dataTransfer) && !isSessionRenderTransferDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  };

  document.addEventListener("dragenter", preventBrowserFileDrop, true);
  document.addEventListener("dragover", preventBrowserFileDrop, true);
  document.addEventListener("drop", preventBrowserFileDrop, true);
  window.addEventListener("dragenter", preventBrowserFileDrop);
  window.addEventListener("dragover", preventBrowserFileDrop);
  window.addEventListener("drop", preventBrowserFileDrop);

  let clipOnsetPreviewTimeoutId: number | null = null;
  let clipOnsetPreviewJobId = 0;

  const getClipOnsetAnnotation = (clipId: string | null): ClipOnsetAnnotation | null => (
    clipId ? demoState.clipOnsetAnnotations.get(clipId) ?? null : null
  );

  const cancelClipOnsetPreview = (): void => {
    clipOnsetPreviewJobId += 1;
    if (clipOnsetPreviewTimeoutId !== null) {
      window.clearTimeout(clipOnsetPreviewTimeoutId);
      clipOnsetPreviewTimeoutId = null;
    }
  };

  const syncClipOnsetPanel = (): void => {
    const editorState = demoState.clipOnsetEditorState;
    if (!editorState) {
      elements.clipOnsetPanel.hidden = true;
      return;
    }

    let clip: Clip;
    try {
      clip = getClip(demoState.project, editorState.clipId);
    } catch {
      demoState.clipOnsetEditorState = null;
      elements.clipOnsetPanel.hidden = true;
      return;
    }

    const previewAnnotation = editorState.previewAnnotation;
    const previewCount = previewAnnotation?.onsetSamples.length ?? 0;
    elements.clipOnsetPanel.hidden = false;
    elements.clipOnsetTitle.textContent = `${clip.id} · ${clip.resource.id}`;
    elements.clipOnsetSensitivity.value = String(editorState.settings.sensitivity);
    elements.clipOnsetSensitivityValue.value = String(editorState.settings.sensitivity);
    elements.clipOnsetSensitivityValue.textContent = String(editorState.settings.sensitivity);
    elements.clipOnsetSpacing.value = String(editorState.settings.minSpacingMs);
    elements.clipOnsetSpacingValue.value = `${editorState.settings.minSpacingMs} ms`;
    elements.clipOnsetSpacingValue.textContent = `${editorState.settings.minSpacingMs} ms`;
    elements.clipOnsetRefine.checked = editorState.settings.refineCuts;

    const bufferReady = demoState.resources.audioBuffers.has(clip.resource.id);
    if (!bufferReady) {
      elements.clipOnsetStatus.textContent = "Audio is not ready for onset detection yet.";
    } else if (editorState.busy) {
      elements.clipOnsetStatus.textContent = "Detecting onsets…";
    } else if (previewAnnotation) {
      elements.clipOnsetStatus.textContent = previewCount > 0
        ? `${previewCount} onset${previewCount > 1 ? "s" : ""} detected`
        : "No onset candidates detected with the current settings.";
    } else {
      elements.clipOnsetStatus.textContent = "Previewing detected onsets…";
    }

    const canWrite = canCurrentTabWriteSession();
    const canInteract = bufferReady && !editorState.busy;
    elements.clipOnsetSensitivity.disabled = !bufferReady;
    elements.clipOnsetSpacing.disabled = !bufferReady;
    elements.clipOnsetRefine.disabled = !bufferReady;
    elements.clipOnsetApply.disabled = !canWrite || !canInteract || !previewAnnotation;
    elements.clipOnsetExplode.disabled = !canWrite || !canInteract || !previewAnnotation || previewCount === 0;
  };

  const closeClipOnsetEditor = (): void => {
    if (!demoState.clipOnsetEditorState) {
      elements.clipOnsetPanel.hidden = true;
      return;
    }
    demoState.lastClipOnsetDetectionSettings = demoState.clipOnsetEditorState.settings;
    cancelClipOnsetPreview();
    demoState.clipOnsetEditorState = null;
    syncClipOnsetPanel();
    render(elements);
  };

  const scheduleClipOnsetPreviewAnalysis = (delayMs = CLIP_ONSET_PREVIEW_DEBOUNCE_MS): void => {
    const editorState = demoState.clipOnsetEditorState;
    if (!editorState) {
      return;
    }
    let clip: Clip;
    try {
      clip = getClip(demoState.project, editorState.clipId);
    } catch {
      closeClipOnsetEditor();
      return;
    }
    const audioBuffer = demoState.resources.audioBuffers.get(clip.resource.id) ?? null;
    if (!audioBuffer) {
      demoState.clipOnsetEditorState = {
        ...editorState,
        busy: false,
        previewAnnotation: null,
      };
      syncClipOnsetPanel();
      render(elements);
      return;
    }

    cancelClipOnsetPreview();
    const jobId = clipOnsetPreviewJobId;
    demoState.clipOnsetEditorState = {
      ...editorState,
      busy: true,
    };
    syncClipOnsetPanel();
    render(elements);

    clipOnsetPreviewTimeoutId = window.setTimeout(() => {
      clipOnsetPreviewTimeoutId = null;
      const activeEditorState = demoState.clipOnsetEditorState;
      if (!activeEditorState || activeEditorState.clipId !== clip.id || jobId !== clipOnsetPreviewJobId) {
        return;
      }

      try {
        const previewAnnotation = detectClipOnsets(
          audioBuffer,
          getClipSourceStartSample(clip),
          getClipSourceLengthSamples(clip),
          activeEditorState.settings,
        );
        const latestEditorState = demoState.clipOnsetEditorState;
        if (!latestEditorState || latestEditorState.clipId !== clip.id || jobId !== clipOnsetPreviewJobId) {
          return;
        }
        demoState.clipOnsetEditorState = {
          ...latestEditorState,
          busy: false,
          previewAnnotation,
        };
      } catch (error) {
        const latestEditorState = demoState.clipOnsetEditorState;
        if (!latestEditorState || latestEditorState.clipId !== clip.id || jobId !== clipOnsetPreviewJobId) {
          return;
        }
        demoState.clipOnsetEditorState = {
          ...latestEditorState,
          busy: false,
          previewAnnotation: null,
        };
        demoState.footer.setStatus(normalizeErrorMessage(error), "error");
      }
      syncClipOnsetPanel();
      render(elements);
    }, delayMs);
  };

  const clearClipOnsetAnnotationsForClipIds = (clipIds: readonly string[]): void => {
    for (const clipId of clipIds) {
      demoState.clipOnsetAnnotations.delete(clipId);
    }
    if (demoState.clipOnsetEditorState && clipIds.includes(demoState.clipOnsetEditorState.clipId)) {
      cancelClipOnsetPreview();
      demoState.clipOnsetEditorState = null;
      syncClipOnsetPanel();
    }
  };

  const commitClipOnsetAnnotation = (): void => {
    if (!notifyReadOnlySession()) {
      return;
    }
    const editorState = demoState.clipOnsetEditorState;
    if (!editorState || editorState.busy || !editorState.previewAnnotation) {
      return;
    }
    const previousSessionDocument = createCurrentSessionDocument();
    demoState.lastClipOnsetDetectionSettings = editorState.settings;
    demoState.clipOnsetAnnotations.set(editorState.clipId, editorState.previewAnnotation);
    demoState.clipOnsetEditorState = null;
    cancelClipOnsetPreview();
    syncClipOnsetPanel();
    commitCurrentSessionDocumentChange(
      `Annotate clip "${editorState.clipId}" with detected onsets`,
      previousSessionDocument,
      elements,
    );
  };

  const buildExplodedClipSegments = (
    clip: Clip,
    annotation: ClipOnsetAnnotation,
  ): {
    replacementClips: Clip[];
    replacementClipIds: string[];
    derivedResources: ExplodedClipDerivedResource[];
  } => {
    const clipSourceStartSample = getClipSourceStartSample(clip);
    const clipSourceLengthSamples = getClipSourceLengthSamples(clip);
    const internalTimeRate = demoState.project.timebase.internalTimeRate;
    const clipSampleRate = clip.resource.sampleRate;
    const sourceBuffer = demoState.resources.audioBuffers.get(clip.resource.id);
    if (!sourceBuffer) {
      throw new Error(`Audio for "${clip.id}" is not ready to explode`);
    }
    const boundaries = [
      0,
      ...annotation.onsetSamples.filter((sample, index, onsetSamples) => (
        sample > 0
        && sample < clipSourceLengthSamples
        && (index === 0 || sample > onsetSamples[index - 1]!)
      )),
      clipSourceLengthSamples,
    ];
    if (boundaries.length <= 2) {
      return { replacementClips: [], replacementClipIds: [], derivedResources: [] };
    }

    const replacementClips: Clip[] = [];
    const replacementClipIds: string[] = [];
    const derivedResources: ExplodedClipDerivedResource[] = [];
    const sourceClipName = getClipDisplayName(clip).trim() || clip.resource.id;
    for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex += 1) {
      const relativeStartSample = boundaries[boundaryIndex]!;
      const relativeEndSample = boundaries[boundaryIndex + 1]!;
      const sourceLengthSamples = relativeEndSample - relativeStartSample;
      if (sourceLengthSamples <= 0) {
        continue;
      }
      const sourceStartSample = clipSourceStartSample + relativeStartSample;
      const clipName = `${sourceClipName} ${String(replacementClips.length + 1).padStart(2, "0")}`;
      const resourceId = createUniqueResourceId(clipName);
      const resourceBuffer = sliceAudioBuffer(sourceBuffer, sourceStartSample, sourceLengthSamples);
      const resource: AudioResource = {
        id: resourceId,
        sampleRate: resourceBuffer.sampleRate,
        channels: resourceBuffer.numberOfChannels,
        length: resourceBuffer.length,
      };
      const clipId = createNextClipId();
      const replacementClip: Clip = {
        id: clipId,
        resource,
        start: clip.start + Math.round((relativeStartSample / clipSampleRate) * internalTimeRate),
        name: clipName,
      };
      const resourceSource = createGeneratedWavResourceSource(
        `${resourceId}.wav`,
        audioBufferToWavBytes(resourceBuffer),
      );
      replacementClips.push(replacementClip);
      replacementClipIds.push(clipId);
      derivedResources.push({
        resource,
        buffer: resourceBuffer,
        source: resourceSource,
        waveformPyramid: buildWaveformPyramid(resourceBuffer),
      });
    }
    return { replacementClips, replacementClipIds, derivedResources };
  };

  const explodeClipAtAnnotation = (clipId: string, annotation: ClipOnsetAnnotation): boolean => {
    const previousSessionDocument = createCurrentSessionDocument();
    try {
      const targetClip = getClip(demoState.project, clipId);
      const targetClipRef = getIndexedClip(demoState.project, clipId);
      if (!targetClipRef) {
        throw new Error(`Missing clip "${clipId}"`);
      }
      const { replacementClips, replacementClipIds, derivedResources } = buildExplodedClipSegments(
        targetClip,
        annotation,
      );
      if (replacementClips.length === 0) {
        demoState.footer.setStatus(`Clip "${clipId}" has no detected onsets to explode`, "error");
        render(elements);
        return false;
      }
      let nextProject = demoState.project;
      for (const { resource } of derivedResources) {
        nextProject = importAudioResource(nextProject, resource);
      }
      demoState.project = {
        ...nextProject,
        timeline: {
          ...nextProject.timeline,
          tracks: nextProject.timeline.tracks.map((track) => (
            track.id !== targetClipRef.trackId
              ? track
              : {
                ...track,
                clips: track.clips.flatMap((clip) => (clip.id === clipId ? replacementClips : [clip])),
              }
          )),
        },
      };
      for (const { resource, buffer, source, waveformPyramid } of derivedResources) {
        demoState.resources.audioBuffers.set(resource.id, buffer);
        demoState.resources.sourceFiles.set(resource.id, source);
        demoState.resources.sessionRenders.delete(resource.id);
        demoState.resources.retainedIds.add(resource.id);
        demoState.resources.cacheWaveformPyramid(resource.id, waveformPyramid);
      }
      assertValidProject(demoState.project);
      clearClipOnsetAnnotationsForClipIds([clipId, ...replacementClipIds]);
      setSelectedClipIds(replacementClipIds);
      const changeCommitted = commitCurrentSessionDocumentChange(
        `Explode clip "${clipId}" at detected onsets`,
        previousSessionDocument,
        elements,
      );
      if (changeCommitted) {
        demoState.playbackSession.restartIfNeeded();
      }
      return changeCommitted;
    } catch (error) {
      const message = normalizeErrorMessage(error);
      demoState.footer.setStatus(message, "error");
      pushRenderLog(`ERROR: ${message}`);
      render(elements);
      return false;
    }
  };

  const explodeClipFromOnsetEditor = (): void => {
    if (!notifyReadOnlySession()) {
      return;
    }
    const editorState = demoState.clipOnsetEditorState;
    if (!editorState || editorState.busy || !editorState.previewAnnotation) {
      return;
    }
    const didExplode = explodeClipAtAnnotation(editorState.clipId, editorState.previewAnnotation);
    if (didExplode) {
      cancelClipOnsetPreview();
      demoState.clipOnsetEditorState = null;
      syncClipOnsetPanel();
    }
  };


  const updateClipFromSourceSession = async (): Promise<void> => {
    if (!notifyReadOnlySession()) {
      closeClipContextMenu();
      return;
    }
    const sessionRenderState = getClipContextTargetSessionRenderState();
    if (!sessionRenderState?.isLinked || !sessionRenderState.isStale) {
      closeClipContextMenu();
      return;
    }
    closeClipContextMenu();

    const currentSessionDocument = createCurrentSessionDocument();
    const currentSessionRevision = computeSessionDocumentRevision(currentSessionDocument);
    const targetSessionId = demoState.session.id;
    const sourceSessionId = sessionRenderState.sessionRender.sourceSessionId;
    const sourceSessionName = sessionRenderState.sessionRender.sourceSessionName;
    const reportStatus = createImportStatusReporter(elements);

    try {
      reportStatus(`Updating "${sourceSessionName}"...`);
      const workingSession = await loadWorkingSessionArchive(sourceSessionId);
      if (!workingSession) {
        throw new Error(`Source session "${sourceSessionName}" is unavailable`);
      }
      const renderedMixdown = await renderSessionArchiveMixdown(
        workingSession.archive,
        sourceSessionId,
        sourceSessionName,
        workingSession.sessionRevision,
      );
      if (demoState.session.id !== targetSessionId) {
        throw new Error("Current session changed while updating from the source session");
      }
      if (computeSessionDocumentRevision(createCurrentSessionDocument()) !== currentSessionRevision) {
        throw new Error("Current session changed while updating from the source session");
      }

      const audioContext = demoState.audio.ensureContext();
      if (!audioContext) {
        throw new Error("Web Audio is not available in this browser");
      }
      reportStatus(`Decoding "${renderedMixdown.fileName}"...`);
      const decodedBuffer = await audioContext.decodeAudioData(renderedMixdown.wavBytes.slice().buffer);
      ensureImportableDecodedSize(renderedMixdown.fileName, decodedBuffer);

      if (demoState.session.id !== targetSessionId) {
        throw new Error("Current session changed while updating from the source session");
      }
      if (computeSessionDocumentRevision(createCurrentSessionDocument()) !== currentSessionRevision) {
        throw new Error("Current session changed while updating from the source session");
      }

      const previousSessionDocument = currentSessionDocument;
      const resourceId = createUniqueResourceId(`${getNormalizedProjectIdSlug(sourceSessionName)}-session`);
      const nextResource: AudioResource = {
        id: resourceId,
        sampleRate: decodedBuffer.sampleRate,
        channels: decodedBuffer.numberOfChannels,
        length: decodedBuffer.length,
      };
      demoState.project = replaceClipResourceAndPushFollowingClips(
        demoState.project,
        sessionRenderState.clipId,
        nextResource,
      );
      demoState.resources.audioBuffers.set(resourceId, decodedBuffer);
      demoState.resources.sourceFiles.set(resourceId, {
        fileName: renderedMixdown.fileName,
        mimeType: "audio/wav",
        lastModified: renderedMixdown.renderedAt,
        bytes: renderedMixdown.wavBytes,
      });
      demoState.resources.sessionRenders.set(resourceId, {
        sourceSessionId,
        sourceSessionName,
        sourceSessionRevision: renderedMixdown.sourceSessionRevision,
        renderedAt: renderedMixdown.renderedAt,
        renderSampleRate: renderedMixdown.renderSampleRate,
        renderLengthSamples: renderedMixdown.renderLengthSamples,
        channelCount: renderedMixdown.channelCount,
      });
      demoState.resources.retainedIds.add(resourceId);
      clearClipOnsetAnnotationsForClipIds([sessionRenderState.clipId]);
      setSelectedClipIds([sessionRenderState.clipId]);
      commitCurrentSessionDocumentChange(
        `Update clip "${sessionRenderState.clipId}" from source session "${sourceSessionName}"`,
        previousSessionDocument,
        elements,
      );
      demoState.playbackSession.restartIfNeeded();
      queueSessionRenderWaveformBuild(
        resourceId,
        decodedBuffer,
        elements,
        reportStatus,
        `Building waveform for "${sourceSessionName}"...`,
      );
    } catch (error) {
      const message = normalizeErrorMessage(error);
      reportStatus(message, "error");
      pushRenderLog(`ERROR: ${message}`);
      render(elements);
    }
  };

  const closeShortcutsPanel = (): void => {
    elements.shortcutsPanel.hidden = true;
    elements.shortcutsButton.setAttribute("aria-expanded", "false");
  };

  const pauseOverlayTutorialVideos = (): void => {
    elements.overlayTutorialLeft.pause();
    elements.overlayTutorialRight.pause();
  };

  const playOverlayTutorialVideo = (targetVideo: HTMLVideoElement): void => {
    pauseOverlayTutorialVideos();
    elements.overlayTutorialLeft.muted = false;
    elements.overlayTutorialRight.muted = false;
    targetVideo.muted = false;
    void targetVideo.play().catch((error) => {
      console.debug("[webdaw] tutorial video play failed", {
        targetId: targetVideo.id,
        message: normalizeErrorMessage(error),
      });
    });
  };

  const closeTutorialOverlay = (): void => {
    if (elements.tutorialOverlay.hidden) {
      return;
    }
    console.debug("[webdaw] tutorial overlay close", {
      hiddenBefore: elements.tutorialOverlay.hidden,
      classList: Array.from(elements.tutorialOverlay.classList),
    });
    elements.tutorialOverlay.classList.remove("is-open");
    elements.tutorialOverlay.setAttribute("aria-hidden", "true");
    pauseOverlayTutorialVideos();
    window.setTimeout(() => {
      if (!elements.tutorialOverlay.classList.contains("is-open")) {
        elements.tutorialOverlay.hidden = true;
      }
    }, 220);
  };

  const openTutorialOverlay = (targetVideo: HTMLVideoElement): void => {
    console.debug("[webdaw] tutorial overlay open", {
      targetId: targetVideo.id,
      hiddenBefore: elements.tutorialOverlay.hidden,
      classListBefore: Array.from(elements.tutorialOverlay.classList),
    });
    elements.tutorialOverlay.hidden = false;
    elements.tutorialOverlay.setAttribute("aria-hidden", "false");
    targetVideo.currentTime = 0;
    playOverlayTutorialVideo(targetVideo);
    requestAnimationFrame(() => {
      elements.tutorialOverlay.classList.add("is-open");
      console.debug("[webdaw] tutorial overlay opened", {
        targetId: targetVideo.id,
        hiddenAfter: elements.tutorialOverlay.hidden,
        classListAfter: Array.from(elements.tutorialOverlay.classList),
      });
    });
  };

  const toggleShortcutsPanel = (): void => {
    const nextHidden = !elements.shortcutsPanel.hidden;
    elements.shortcutsPanel.hidden = nextHidden;
    elements.shortcutsButton.setAttribute("aria-expanded", String(!nextHidden));
  };

  const openClipContextMenu = (clientX: number, clientY: number): void => {
    clipContextMenu.sync(getCurrentSelection());
    elements.clipContextMenu.hidden = false;
    const menuWidth = elements.clipContextMenu.offsetWidth || 160;
    const menuHeight = elements.clipContextMenu.offsetHeight || 44;
    const left = Math.max(8, Math.min(clientX, window.innerWidth - menuWidth - 8));
    const top = Math.max(8, Math.min(clientY, window.innerHeight - menuHeight - 8));
    elements.clipContextMenu.style.left = `${left}px`;
    elements.clipContextMenu.style.top = `${top}px`;
  };

  bindClipContextMenuElement(elements.clipContextMenu);
  registerUpdateSourceHandler(updateClipFromSourceSession);
  registerOnsetEditorCloseHook(() => {
    cancelClipOnsetPreview();
    syncClipOnsetPanel();
  });
  const clipContextMenu = wireClipContextMenu(elements, [
    { operation: renameOperation, button: elements.clipContextRename },
    { operation: splitOperation, button: elements.clipContextSplit },
    { operation: mergeOperation, button: elements.clipContextMerge },
    { operation: crossfadeOperation, button: elements.clipContextCrossfade },
    { operation: reverseOperation, button: elements.clipContextReverse },
    { operation: openTransformPanelOperation, button: elements.clipContextFaustTransform },
    { operation: playSelectionOperation, button: elements.clipContextPlay },
    { operation: deleteOperation, button: elements.clipContextDelete },
    { operation: openSourceOperation, button: elements.clipContextOpenSource },
    { operation: updateSourceOperation, button: elements.clipContextUpdateSource },
  ]);

  elements.timelineGrid.addEventListener("dragover", (event) => {
    if (!isFileDrag(event.dataTransfer) && !isSessionRenderTransferDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  });

  elements.timelineGrid.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event.dataTransfer) && !isSessionRenderTransferDrag(event.dataTransfer)) {
      return;
    }
    void claimCurrentSessionWriterForDirectInteraction();
  });

  elements.timelineGrid.addEventListener("drop", async (event) => {
    const isDroppedFileDrag = isFileDrag(event.dataTransfer);
    const isDroppedSessionRenderDrag = isSessionRenderTransferDrag(event.dataTransfer);
    const droppedSessionRenderToken = getSessionRenderTransferToken(event.dataTransfer);
    const droppedAudioFile = getFirstAudioFile(event.dataTransfer?.files ?? null);
    const dropClientX = event.clientX;
    const dropClientY = event.clientY;

    if (isDroppedFileDrag || isDroppedSessionRenderDrag) {
      event.preventDefault();
    }
    if (isDroppedFileDrag || isDroppedSessionRenderDrag) {
      await claimCurrentSessionWriterForDirectInteraction();
    }
    if ((isDroppedFileDrag || isDroppedSessionRenderDrag) && !notifyReadOnlySession()) {
      return;
    }
    if (droppedSessionRenderToken) {
      const reportImportStatus = createImportStatusReporter(elements);
      const dropTrackId = getTrackIdFromGridClientY(dropClientY, elements);
      const dropStart = applyClipMagnetism(getTimeFromGridClientX(dropClientX, elements));
      try {
        const transfer = await waitForSessionRenderTransferMetadata(droppedSessionRenderToken);
        const previousSessionDocument = createCurrentSessionDocument();
        const resourceId = createUniqueResourceId(`${getNormalizedProjectIdSlug(transfer.sourceSessionName)}-session`);
        const sessionRenderLink = getSessionRenderLinkFromTransfer(transfer);
        const resource: AudioResource = {
          id: resourceId,
          sampleRate: transfer.renderSampleRate,
          channels: transfer.channelCount,
          length: transfer.renderLengthSamples,
        };
        demoState.project = importAudioResource(demoState.project, resource);
        demoState.resources.sessionRenders.set(resource.id, sessionRenderLink);
        demoState.resources.retainedIds.add(resource.id);
        const clipId = createNextClipId();
        demoState.project = placeClip(demoState.project, clipId, resource, dropStart, dropTrackId);
        setSelectedClipIds([clipId]);
        reportImportStatus(`Rendering "${transfer.sourceSessionName}"...`);
        commitCurrentSessionDocumentChange(
          `Drop session "${transfer.sourceSessionName}" on ${dropTrackId}`,
          previousSessionDocument,
          elements,
        );
        demoState.playbackSession.restartIfNeeded();
        const materializationPromise = materializeSessionRenderResource(
          resource.id,
          droppedSessionRenderToken,
          elements,
          reportImportStatus,
        )
          .catch((error) => {
            const message = normalizeErrorMessage(error);
            reportImportStatus(message, "error");
            pushRenderLog(`ERROR: ${message}`);
            render(elements);
          });
        trackPendingMaterialization(resource.id, materializationPromise);
      } catch (error) {
        const message = normalizeErrorMessage(error);
        demoState.footer.setStatus(message, "error");
        pushRenderLog(`ERROR: ${message}`);
        render(elements);
      }
      return;
    }
    const droppedDspFile = getFirstDspFile(event.dataTransfer?.files ?? null);
    if (droppedDspFile) {
      try {
        const code = await droppedDspFile.text();
        const dropTrackId = getTrackIdFromGridClientY(dropClientY, elements);
        const previousSessionDocument = createCurrentSessionDocument();
        const { effect } = importDspFileAsEffect(droppedDspFile, code);
        demoState.project = addEffect(demoState.project, dropTrackId, effect);
        const effectName = getEffectName(effect);
        commitCurrentSessionDocumentChange(
          `Add effect "${effectName}" on ${dropTrackId}`,
          previousSessionDocument,
          elements,
        );
        refreshFxPanelIfOpen(elements);
        await compileAndAttachEffect(effect, dropTrackId, elements);
      } catch (error) {
        const message = normalizeErrorMessage(error);
        demoState.footer.setStatus(message, "error");
        pushRenderLog(`ERROR: ${message}`);
        render(elements);
      }
      return;
    }
    if (!droppedAudioFile) {
      return;
    }
    let droppedAudioFileBytes: Uint8Array;
    try {
      droppedAudioFileBytes = await readImportedFileBytes(droppedAudioFile);
    } catch (error) {
      const message = `Unable to read "${droppedAudioFile.name}": ${normalizeErrorMessage(error)}`;
      demoState.footer.setStatus(message, "error");
      pushRenderLog(`ERROR: ${message}`);
      render(elements);
      return;
    }
    const dropTrackId = getTrackIdFromGridClientY(dropClientY, elements);
    const dropStart = applyClipMagnetism(getTimeFromGridClientX(dropClientX, elements));
    const reportImportStatus = createImportStatusReporter(elements);

    try {
      const previousSessionDocument = createCurrentSessionDocument();
      const importedResource = await importAudioFile(
        {
          file: droppedAudioFile,
          fileBytes: droppedAudioFileBytes,
        },
        undefined,
        elements,
        reportImportStatus,
      );
      const clipId = createNextClipId();
      demoState.project = placeClip(demoState.project, clipId, importedResource, dropStart, dropTrackId);
      setSelectedClipIds([clipId]);
      commitCurrentSessionDocumentChange(`Drop audio "${importedResource.id}" on ${dropTrackId}`, previousSessionDocument, elements);
      demoState.playbackSession.restartIfNeeded();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      demoState.footer.setStatus(message, "error");
      pushRenderLog(`ERROR: ${message}`);
      render(elements);
    }
  });

  const updateClipOnsetEditorSettings = (
    patch: Partial<ClipOnsetDetectionSettings>,
    shouldRefreshPreview = true,
  ): void => {
    const editorState = demoState.clipOnsetEditorState;
    if (!editorState) {
      return;
    }
    demoState.clipOnsetEditorState = {
      ...editorState,
      settings: normalizeClipOnsetDetectionSettings({
        ...editorState.settings,
        ...patch,
      }),
    };
    demoState.lastClipOnsetDetectionSettings = demoState.clipOnsetEditorState.settings;
    syncClipOnsetPanel();
    render(elements);
    if (shouldRefreshPreview) {
      scheduleClipOnsetPreviewAnalysis();
    }
  };

  elements.clipOnsetSensitivity.addEventListener("input", () => {
    updateClipOnsetEditorSettings({
      sensitivity: Number(elements.clipOnsetSensitivity.value),
    });
  });
  elements.clipOnsetSpacing.addEventListener("input", () => {
    updateClipOnsetEditorSettings({
      minSpacingMs: Number(elements.clipOnsetSpacing.value),
    });
  });
  elements.clipOnsetRefine.addEventListener("change", () => {
    updateClipOnsetEditorSettings({
      refineCuts: elements.clipOnsetRefine.checked,
    });
  });
  elements.clipOnsetApply.addEventListener("click", commitClipOnsetAnnotation);
  elements.clipOnsetExplode.addEventListener("click", explodeClipFromOnsetEditor);
  elements.clipOnsetCancel.addEventListener("click", closeClipOnsetEditor);

  elements.cursorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applyTransition(
      `Seek to ${elements.cursorTime.value.trim()}`,
      () => {
        const next = seek(
          demoState.project,
          Math.max(0, demoState.viewport.timeScale.snapToSample(parseAbsoluteTimeLabel(elements.cursorTime.value, demoState.project.timebase))),
        );
        demoState.viewport.ensureCursorVisible(next.timeline.cursor);
        return next;
      },
      elements,
    );
    const resolvedTimecode = formatCurrentAbsoluteTimeLabel(
      demoState.project.timeline.cursor,
      demoState.project.timebase,
      demoState.viewport.timeScale.pixelsPerSample,
    );
    elements.cursorTime.value = resolvedTimecode;
    demoState.playbackSession.restartIfNeeded();
  });

  const returnCursorToZero = (): void => {
    demoState.project = seek(demoState.project, 0);
    demoState.viewport.ensureCursorVisible(demoState.project.timeline.cursor);
    elements.cursorTime.value = formatCurrentAbsoluteTimeLabel(
      0,
      demoState.project.timebase,
      demoState.viewport.timeScale.pixelsPerSample,
    );
    pushRenderLog("Return to zero");
    render(elements);
    demoState.playbackSession.restartIfNeeded();
  };

  const returnCursorToLastPlayStart = (): void => {
    if (demoState.lastPlayStartCoord === null) {
      return;
    }
    demoState.project = seek(demoState.project, demoState.lastPlayStartCoord);
    demoState.viewport.ensureCursorVisible(demoState.project.timeline.cursor);
    const lastPlayStartLabel = formatCurrentAbsoluteTimeLabel(
      demoState.lastPlayStartCoord,
      demoState.project.timebase,
      demoState.viewport.timeScale.pixelsPerSample,
    );
    elements.cursorTime.value = lastPlayStartLabel;
    pushRenderLog(`Return to last play start ${lastPlayStartLabel}`);
    render(elements);
    demoState.playbackSession.restartIfNeeded();
  };

  elements.transportReturnButton.addEventListener("click", () => {
    returnCursorToZero();
  });

  elements.shortcutsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleShortcutsPanel();
  });
  elements.overlayTutorialLeft.addEventListener("click", () => {
    playOverlayTutorialVideo(elements.overlayTutorialLeft);
  });
  elements.overlayTutorialRight.addEventListener("click", () => {
    playOverlayTutorialVideo(elements.overlayTutorialRight);
  });
  elements.overlayTutorialLeft.addEventListener("ended", () => {
    if (elements.tutorialOverlay.hidden) {
      return;
    }
    elements.overlayTutorialRight.currentTime = 0;
    playOverlayTutorialVideo(elements.overlayTutorialRight);
  });
  elements.tutorialOverlayBackdrop.addEventListener("click", closeTutorialOverlay);
  elements.tutorialOverlayClose.addEventListener("click", closeTutorialOverlay);

  const toggleTransportPlayback = async (): Promise<void> => {
    if (demoState.project.timeline.transport === "Playing") {
      // If exporting, cancel the export on Play click.
      if (demoState.realtimeExport) {
        cancelRealtimeExport(elements);
      }
      demoState.transportLoop.stop(elements);
      demoState.playSelection.clipFilter = null;
      demoState.playSelection.loopRange = null;
      demoState.clipRenderStable.dirty = true;
      invalidateWaveformSlidingBuffers();
      applyTransition("Stop", () => stop(demoState.project), elements);
      return;
    }
    try {
      await demoState.audio.startSilent();
      demoState.playSelection.clipFilter = null;
      demoState.playSelection.loopRange = null;
      demoState.clipRenderStable.dirty = true;
      invalidateWaveformSlidingBuffers();
      demoState.lastPlayStartCoord = demoState.project.timeline.cursor;
      demoState.project = play(demoState.project);
      demoState.playbackSession.start();
      pushRenderLog("Play");
      render(elements);
      demoState.transportLoop.startIfNeeded(elements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushRenderLog(`ERROR: ${message}`);
      render(elements);
    }
  };

  elements.playButton.addEventListener("click", () => {
    void toggleTransportPlayback();
  });

  syncSessionNameChrome();
  void refreshSessionWorkspaceControls(elements);

  elements.sessionMenuButton.addEventListener("click", () => {
    if (elements.sessionMenu.hidden) {
      openSessionMenu(elements);
      return;
    }
    closeSessionMenu(elements);
  });

  elements.sessionMenu.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".session-combo-item") : null;
    const sessionId = target?.dataset.sessionId;
    if (!sessionId) {
      return;
    }
    void switchToSession(elements, sessionId);
  });

  elements.sessionNameInput.addEventListener("change", () => {
    void renameCurrentSession(elements);
  });

  elements.sessionNameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    elements.sessionNameInput.blur();
  });

  elements.deleteSessionButton.addEventListener("click", () => {
    void closeCurrentSession();
  });

  elements.loadSessionButton.addEventListener("click", () => {
    elements.loadSessionInput.value = "";
    elements.loadSessionInput.click();
  });

  elements.loadSessionInput.addEventListener("change", () => {
    const file = elements.loadSessionInput.files?.[0];
    if (!file) {
      return;
    }
    void loadSessionArchive(file, elements);
  });

  elements.saveSessionButton.addEventListener("click", () => {
    void saveSessionArchive(elements);
  });

  elements.exportMixdownButton.addEventListener("click", () => {
    toggleRealtimeExport(elements);
  });

  elements.sessionDragHandle.addEventListener("dragstart", (event) => {
    if (!event.dataTransfer) {
      event.preventDefault();
      return;
    }
    try {
      const transfer = publishCurrentSessionRenderTransfer();
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(SESSION_RENDER_TRANSFER_MIME, transfer.token);
      event.dataTransfer.setData("text/plain", `${transfer.sourceSessionName} (${transfer.renderLengthSamples} samples)`);
      demoState.footer.setStatus(`Rendering "${transfer.sourceSessionName}" for drag...`);
      render(elements);
    } catch (error) {
      event.preventDefault();
      const message = normalizeErrorMessage(error);
      demoState.footer.setStatus(message, "error");
      pushRenderLog(`ERROR: ${message}`);
      render(elements);
    }
  });

  elements.sessionDragHandle.addEventListener("dragend", () => {
    if (demoState.footer.message?.startsWith("Rendering \"")) {
      demoState.footer.setStatus(null);
      render(elements);
    }
  });

  wireClipDragging(elements);
  wireMarkerManager(elements);
  wireRulerDragging(elements);

  void refreshSessionWorkspaceControls(elements).then(async () => {
    await syncCurrentSessionViewLease();
    await syncCurrentSessionWriterLease();
    syncClipOnsetPanel();
  });

  window.addEventListener("focus", () => {
    void refreshSessionWorkspaceControls(elements).then(async () => {
      void syncCurrentSessionViewLease();
      await syncCurrentSessionWriterLease();
      syncClipOnsetPanel();
      const currentWorkspaceSession = demoState.workspaceSessions.get(demoState.session.id) ?? null;
      if (
        demoState.session.inWorkspace
        && demoState.session.accessMode === "follower"
        && currentWorkspaceSession !== null
        && currentWorkspaceSession.sessionRevision !== demoState.session.revision
      ) {
        queueRemoteSessionRefresh();
        return;
      }
      if (demoState.resources.sessionRenders.size > 0) {
        render(elements);
      }
    });
  });

  elements.timelineGrid.addEventListener("contextmenu", (event) => {
    const clipId = getHitClipIdFromGridPointer(event.clientX, event.clientY, elements);
    if (!clipId) {
      closeClipContextMenu();
      return;
    }
    event.preventDefault();
    if (!demoState.selection.ids.has(clipId)) {
      setSelectedClipIds([clipId]);
    }
    setClipContextTarget(clipId);
    render(elements);
    openClipContextMenu(event.clientX, event.clientY);
  });

  document.addEventListener("pointerdown", (event) => {
    if (
      !elements.sessionMenu.hidden
      && event.target instanceof Node
      && !elements.sessionCombo.contains(event.target)
    ) {
      closeSessionMenu(elements);
    }
    if (!elements.shortcutsPanel.hidden) {
      if (
        event.target instanceof Node
        && !elements.shortcutsPanel.contains(event.target)
        && !elements.shortcutsButton.contains(event.target)
      ) {
        closeShortcutsPanel();
      }
    }
    if (elements.clipContextMenu.hidden) {
      return;
    }
    if (event.target instanceof Node && elements.clipContextMenu.contains(event.target)) {
      return;
    }
    closeClipContextMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeClipOnsetEditor();
      closeShortcutsPanel();
      closeTutorialOverlay();
      closeClipContextMenu();
    }
  });

  window.addEventListener("blur", closeClipContextMenu);
  window.addEventListener("resize", closeClipContextMenu);
  window.addEventListener("blur", closeTutorialOverlay);
  window.addEventListener("blur", () => {
    void syncCurrentSessionWriterLease();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      queueCurrentSessionViewStateAutosave();
      void flushPendingWorkingSessionAutosave(elements).catch((error) => {
        console.warn("[webdaw] working-session flush failed", normalizeErrorMessage(error));
      });
    }
    void syncCurrentSessionWriterLease();
  });
  window.addEventListener("pagehide", () => {
    queueCurrentSessionViewStateAutosave();
    void flushPendingWorkingSessionAutosave(elements).catch((error) => {
      console.warn("[webdaw] working-session flush failed", normalizeErrorMessage(error));
    });
    stopSessionViewHeartbeat();
    stopSessionWriterHeartbeat();
    stopSessionWriterRetry();
    stopSessionViewStateAutosave();
    if (currentSessionViewLeaseId !== null) {
      void releaseLocalSessionView(currentSessionViewLeaseId, demoState.session.tabId).catch(() => undefined);
      currentSessionViewLeaseId = null;
    }
    void releaseLocalSessionWriter(demoState.session.id, demoState.session.tabId).catch(() => undefined);
    workspaceSyncChannel?.close();
    closeWorkspaceSyncChannel();
    syncCurrentSessionWriterLeaseRef = null;
    syncCurrentSessionViewLeaseRef = null;
  });

  const syncRulerShiftSeekCursor = (active: boolean): void => {
    elements.timelineRuler.classList.toggle("shift-seek", active);
  };

  document.addEventListener("keydown", (event) => {
    if (event.key === "Shift") {
      syncRulerShiftSeekCursor(true);
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.key === "Shift") {
      syncRulerShiftSeekCursor(false);
    }
  });

  window.addEventListener("blur", () => {
    syncRulerShiftSeekCursor(false);
  });

  const rememberTimelinePointerX = (clientX: number): void => {
    demoState.lastTimelinePointerClientX = clientX;
  };

  elements.timelineGrid.addEventListener("pointermove", (event) => {
    rememberTimelinePointerX(event.clientX);
  });
  elements.timelineGrid.addEventListener("pointerdown", (event) => {
    rememberTimelinePointerX(event.clientX);
  });
  elements.timelineRuler.addEventListener("pointermove", (event) => {
    rememberTimelinePointerX(event.clientX);
  });
  elements.timelineRuler.addEventListener("pointerdown", (event) => {
    rememberTimelinePointerX(event.clientX);
  });

  // Input types that behave as text entry (Space and Enter carry text-editing
  // semantics, so global transport shortcuts must stand down while they are
  // focused). Everything else — range, checkbox, radio, button, file, color,
  // image, submit, reset, hidden — leaves Space/Enter free for the DAW.
  const TEXT_ENTRY_INPUT_TYPES = new Set([
    "text",
    "search",
    "url",
    "tel",
    "email",
    "password",
    "number",
    "date",
    "time",
    "datetime-local",
    "month",
    "week",
  ]);

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    if (target.isContentEditable) {
      return true;
    }
    if (target instanceof HTMLTextAreaElement) {
      return true;
    }
    if (target instanceof HTMLSelectElement) {
      // Space opens the native dropdown, keep transport shortcuts off it.
      return true;
    }
    if (target instanceof HTMLInputElement) {
      return TEXT_ENTRY_INPUT_TYPES.has(target.type);
    }
    // Events inside FX panel, Transform panel, or Faust editor should not
    // trigger DAW shortcuts (e.g. arrow keys for pan, Space for transport).
    if (target.closest(".fx-panel-list, .transform-panel-content, .faust-editor-content")) {
      return true;
    }
    return false;
  }

  function getZoomAnchorClientX(): number {
    return (
      demoState.dragState?.lastPointerX
      ?? markerManager().getMarkerDragPointerX()
      ?? demoState.lastTimelinePointerClientX
      ?? (() => {
        const gridRect = elements.timelineGrid.getBoundingClientRect();
        return gridRect.left + gridRect.width / 2;
      })()
    );
  }

  function panViewportBy(direction: -1 | 1, multiplier = 1): void {
    const vp = demoState.viewport;
    const basePanStepCoord = Math.max(
      vp.timeScale.timebase.internalTimeFactor,
      Math.round(vp.viewDurationCoord * 0.12),
    );
    const panStepCoord = Math.max(
      vp.timeScale.timebase.internalTimeFactor,
      Math.round(basePanStepCoord * multiplier),
    );
    const newStart = vp.clampStartCoord(vp.viewStartCoord + direction * panStepCoord);
    vp.viewStartCoord = newStart;
    renderFrame(elements);
  }

  function zoomViewportBy(direction: -1 | 1): void {
    const anchorClientX = getZoomAnchorClientX();
    if (setTimelineZoomLevelIndexAnchored(demoState.viewport.timeScale.zoomLevelIndex + direction, anchorClientX, elements)) {
      renderFrame(elements);
    }
  }

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && !isEditableTarget(event.target)) {
      const normalizedKey = event.key.toLowerCase();
      if (normalizedKey === "z" && !event.repeat) {
        event.preventDefault();
        if (!notifyReadOnlySession()) {
          return;
        }
        if (event.shiftKey) {
          redoSessionDocument(elements);
        } else {
          undoSessionDocument(elements);
        }
        return;
      }
      if (!event.metaKey && normalizedKey === "y" && !event.shiftKey && !event.repeat) {
        event.preventDefault();
        if (!notifyReadOnlySession()) {
          return;
        }
        redoSessionDocument(elements);
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "a" && !isEditableTarget(event.target)) {
      event.preventDefault();
      setSelectedClipIds(demoState.project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
      render(elements);
      return;
    }
    if (event.code === "Space" && !event.repeat && !isEditableTarget(event.target)) {
      event.preventDefault();
      void toggleTransportPlayback();
      return;
    }
    if (event.key === "ArrowLeft" && !isEditableTarget(event.target)) {
      event.preventDefault();
      panViewportBy(-1, event.shiftKey ? 3 : 1);
      return;
    }
    if (event.key === "ArrowRight" && !isEditableTarget(event.target)) {
      event.preventDefault();
      panViewportBy(1, event.shiftKey ? 3 : 1);
      return;
    }
    if (event.key === "Home" && !event.repeat && !isEditableTarget(event.target)) {
      event.preventDefault();
      returnCursorToZero();
      return;
    }
    if (event.key === "Enter" && !event.repeat && !isEditableTarget(event.target)) {
      event.preventDefault();
      returnCursorToLastPlayStart();
      return;
    }
    if (
      !event.metaKey && !event.ctrlKey && !event.altKey
      && !event.repeat && !isEditableTarget(event.target)
      && clipContextMenu.handleShortcut(event.key, getCurrentSelection())
    ) {
      event.preventDefault();
      return;
    }
    if ((event.key === "+" || event.key === "=" || event.code === "NumpadAdd") && !event.repeat && !isEditableTarget(event.target)) {
      event.preventDefault();
      zoomViewportBy(-1);
      return;
    }
    if ((event.key === "-" || event.code === "NumpadSubtract") && !event.repeat && !isEditableTarget(event.target)) {
      event.preventDefault();
      zoomViewportBy(1);
      return;
    }
  });

  window.addEventListener("pointerup", () => {
    for (const slider of elements.trackVolumeSliders) {
      hideTrackSliderOverlay(slider);
    }
    for (const slider of elements.trackPanSliders) {
      hideTrackSliderOverlay(slider);
    }
    hideTrackSliderOverlay(elements.masterVolumeSlider);
  });
}
