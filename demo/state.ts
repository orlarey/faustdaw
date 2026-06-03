/********************************** state.ts ***********************************
 *
 * Purpose: Centralize the mutable demo application state in one place.
 * How: Declare the DemoState record aggregating every runtime field the UI
 *      reads and writes, then expose the single mutable `demoState` instance.
 *      Types and tuning constants live in their respective concept modules
 *      (gesture-state.ts, track-playback.ts, waveform-types.ts, magnetism.ts,
 *      time-scale.ts, onsets.ts, render-constants.ts, faust-transform-state.ts).
 *
 ******************************************************************************/
import { initProject, type Project } from "../src/domain/project.js";
import type { TimeCoord } from "../src/domain/timebase.js";
import { TRACK_IDS, type TrackId } from "../src/domain/track-id.js";
import type { FxEffect } from "../src/domain/fx-chain.js";
import { TRANSFORM_CHAIN_ID } from "../src/domain/fx-chain.js";
import type { TimelineViewport } from "./view/timeline-viewport.js";
import { createInitialSessionState, type SessionState } from "./session-state.js";
import { createInitialGeometryWindowState, type GeometryWindowState } from "./timeline/geometry-window.js";
import { createInitialClipRenderStableState, type ClipRenderStableState } from "./timeline/clip-render-stable.js";
import { AudioEngine } from "./audio-engine.js";
import { PlaybackScheduler } from "./playback-scheduler.js";
import { ResourceStorage } from "./resource-storage.js";
import { createInitialPlaySelectionState, type PlaySelectionState } from "./play-selection.js";
import { createInitialDevFlags, type DevFlags } from "./dev-flags.js";
import { createInitialSelectionState, type SelectionState } from "./selection-state.js";
import { FooterView } from "./footer-view.js";
import type { DragState, RulerDragState, SelectionRectState } from "./gesture/gesture-state.js";
import {
  DEFAULT_MASTER_LEVEL,
  DEFAULT_TRACK_LEVEL,
  type TrackPlayerState,
} from "./track/track-playback.js";
import { PlaybackSession } from "./playback-session.js";
import { TransportLoop } from "./transport-loop.js";
import {
  DEFAULT_CLIP_ONSET_DETECTION_SETTINGS,
  type ClipOnsetAnnotation,
  type ClipOnsetDetectionSettings,
  type ClipOnsetEditorState,
} from "./onsets.js";
import type { FaustTransformPreviewState } from "./faust-transform/faust-transform-state.js";
import type { RealtimeExportState } from "./realtime-export.js";

/**
 * Purpose: Retain the original imported file payload for one audio resource.
 * How: Store the source file metadata together with the exact bytes so session persistence can round-trip the original asset.
 */
export type ImportedResourceSource = {
  fileName: string;
  mimeType: string;
  lastModified: number;
  bytes: Uint8Array;
};

/**
 * Purpose: Hold the full mutable state of the demo application in one place.
 * How: Group the domain project, timeline view parameters, drag states, and UI bookkeeping fields.
 */
export type DemoState = {
  session: SessionState;
  project: Project;
  viewport: TimelineViewport;
  lastPlayStartCoord: TimeCoord | null;
  logEntries: string[];
  footer: FooterView;
  devFlags: DevFlags;
  audio: AudioEngine;
  scheduler: PlaybackScheduler;
  resources: ResourceStorage;
  clipOnsetAnnotations: Map<string, ClipOnsetAnnotation>;
  workspaceSessions: Map<string, { sessionName: string; sessionRevision: string | null }>;
  masterLevel: number;
  playbackSession: PlaybackSession;
  playSelection: PlaySelectionState;
  trackPlayers: Map<TrackId, TrackPlayerState>;
  transportLoop: TransportLoop;
  dragState: DragState | null;
  selectionRectState: SelectionRectState | null;
  rulerDragState: RulerDragState | null;
  lastTimelinePointerClientX: number | null;
  clipAutoScrollFrameId: number | null;
  clipAutoScrollTimestamp: number | null;
  clipRenderStable: ClipRenderStableState;
  geometryWindow: GeometryWindowState;
  nextClipOrdinal: number;
  selection: SelectionState;
  lastClipOnsetDetectionSettings: ClipOnsetDetectionSettings;
  clipOnsetEditorState: ClipOnsetEditorState | null;
  activeFxTrackId: TrackId | null;
  /** Real-time WAV export capture state. */
  realtimeExport: RealtimeExportState | null;
  /**
   * Faust Transform Chain — alias view onto `project.chains[TRANSFORM_CHAIN_ID]`.
   * Reads return the current effects array ; assignments rebuild the
   * chain entry on `project.chains` and replace `project` immutably.
   */
  transformChain: FxEffect[];
  /** Faust Transform preview state, or null when inactive. */
  faustTransformPreview: FaustTransformPreviewState | null;
};

export const demoState: DemoState = {
  session: createInitialSessionState("demo-v0", "Untitled Session"),
  project: initProject("demo-v0"),
  viewport: null! as TimelineViewport, // Created in main.ts before any use
  lastPlayStartCoord: null,
  logEntries: [],
  footer: new FooterView(),
  devFlags: createInitialDevFlags(),
  audio: new AudioEngine(),
  scheduler: new PlaybackScheduler(),
  resources: new ResourceStorage(),
  clipOnsetAnnotations: new Map(),
  workspaceSessions: new Map(),
  masterLevel: DEFAULT_MASTER_LEVEL,
  playbackSession: new PlaybackSession(),
  playSelection: createInitialPlaySelectionState(),
  trackPlayers: new Map(TRACK_IDS.map((trackId) => [trackId, { level: DEFAULT_TRACK_LEVEL, pan: 0, muted: false, solo: false, effectInputGain: null, outputGain: null, outputPanner: null, silentKeepAlive: null, activePlan: null, nextPlan: null, retiringPlans: [] }])),
  transportLoop: new TransportLoop(),
  dragState: null,
  selectionRectState: null,
  rulerDragState: null,
  lastTimelinePointerClientX: null,
  clipAutoScrollFrameId: null,
  clipAutoScrollTimestamp: null,
  clipRenderStable: createInitialClipRenderStableState(),
  geometryWindow: createInitialGeometryWindowState(),
  nextClipOrdinal: 1,
  selection: createInitialSelectionState(),
  lastClipOnsetDetectionSettings: DEFAULT_CLIP_ONSET_DETECTION_SETTINGS,
  clipOnsetEditorState: null,
  activeFxTrackId: null,
  realtimeExport: null,
  // `transformChain` is a derived view onto `project.chains[TRANSFORM_CHAIN_ID]`.
  // Defined below via Object.defineProperty so reads / writes go through the
  // chain map. Initialised to a placeholder here for TypeScript completeness.
  transformChain: [],
  faustTransformPreview: null,
};

Object.defineProperty(demoState, "transformChain", {
  get(): FxEffect[] {
    return [...(demoState.project.chains.get(TRANSFORM_CHAIN_ID)?.effects ?? [])];
  },
  set(effects: readonly FxEffect[]): void {
    const chains = new Map(demoState.project.chains);
    chains.set(TRANSFORM_CHAIN_ID, { id: TRANSFORM_CHAIN_ID, effects: [...effects] });
    demoState.project = { ...demoState.project, chains };
  },
  enumerable: true,
  configurable: true,
});
