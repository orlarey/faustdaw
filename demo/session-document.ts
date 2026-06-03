import { DEFAULT_MASTER_LEVEL, DEFAULT_TRACK_LEVEL } from "./track/track-playback.js";
import { TRACK_IDS, type TrackId } from "../src/domain/track-id.js";
import { initProject, type Project } from "../src/domain/project.js";
import type { TimeCoord } from "../src/domain/timebase.js";
import type { Clip } from "../src/domain/clip.js";
import type { FxEffect, FxParam, FxResource } from "../src/domain/fx-chain.js";
import { importFxResource } from "../src/fx-chain.js";
import { clipEnd } from "../src/domain/clip.js";
import type { TrackPlayerState } from "./track/track-playback.js";
import type { ClipOnsetAnnotation } from "./onsets.js";

export type SessionClipDocument = {
  clipId: string;
  resourceId: string;
  deltaTime: TimeCoord;
  name?: string;
  sourceStartSample?: number;
  sourceLengthSamples?: number;
  onsetAnnotation?: ClipOnsetAnnotation | null;
};

export type SessionEffectParamDocument = {
  address: string;
  value: number;
  min?: number;
  max?: number;
  default?: number;
  step?: number;
  label?: string;
};

export type SessionFxResourceDocument = {
  id: string;
  name: string;
};

export type SessionEffectDocument = {
  id: string;
  fxResourceId: string;
  bypassed: boolean;
  parameters: SessionEffectParamDocument[];
};

export type SessionTrackDocument = {
  id: TrackId;
  gain: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  clips: SessionClipDocument[];
  effects: SessionEffectDocument[];
};

export type SessionDocument = {
  version: 1;
  sampleRate: number;
  masterGain: number;
  fxResources: SessionFxResourceDocument[];
  tracks: SessionTrackDocument[];
  /** Persistent Transform Chain for Faust Transform workflow. */
  transformChain?: SessionEffectDocument[];
};

function serializeSessionDocument(sessionDocument: SessionDocument): string {
  return JSON.stringify(sessionDocument);
}

function hashSessionDocumentString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

/**
 * Purpose: Snapshot the current editable session document from the runtime project and track settings.
 * How: Serialize track gain/pan plus each track clip list as ordered delta-time/resource references.
 */
export function createSessionDocument(
  project: Project,
  trackPlayers: Map<TrackId, TrackPlayerState>,
  masterLevel: number,
  clipOnsetAnnotations: ReadonlyMap<string, ClipOnsetAnnotation>,
  transformChain: readonly FxEffect[] = [],
): SessionDocument {
  const fxResources: SessionFxResourceDocument[] = Array.from(project.fxResources.values()).map((r) => ({
    id: r.id,
    name: r.name,
  }));
  return {
    version: 1,
    sampleRate: project.timebase.sampleRate,
    masterGain: masterLevel,
    fxResources,
    tracks: project.timeline.tracks.map((track) => {
      let previousEnd = 0;
      const chainEffects = project.chains.get(track.chainId)?.effects ?? [];
      return {
        id: track.id,
        gain: trackPlayers.get(track.id)?.level ?? DEFAULT_TRACK_LEVEL,
        pan: trackPlayers.get(track.id)?.pan ?? 0,
        mute: trackPlayers.get(track.id)?.muted ?? false,
        solo: trackPlayers.get(track.id)?.solo ?? false,
        effects: chainEffects.map((effect: FxEffect) => ({
          id: effect.id,
          fxResourceId: effect.fxResourceId,
          bypassed: effect.bypassed,
          parameters: effect.parameters.map((param: FxParam) => ({
            address: param.address,
            value: param.value,
            min: param.min,
            max: param.max,
            default: param.default,
            step: param.step,
            label: param.label,
          })),
        })),
        clips: track.clips.map((clip) => {
          const deltaTime = clip.start - previousEnd;
          previousEnd = clipEnd(project, clip);
          const clipDocument: SessionClipDocument = {
            clipId: clip.id,
            resourceId: clip.resource.id,
            deltaTime,
            onsetAnnotation: clipOnsetAnnotations.get(clip.id) ?? null,
          };
          if (clip.name) {
            clipDocument.name = clip.name;
          }
          const sourceStartSample = clip.sourceStartSample;
          if (sourceStartSample !== undefined && sourceStartSample > 0) {
            clipDocument.sourceStartSample = sourceStartSample;
          }
          const sourceLengthSamples = clip.sourceLengthSamples;
          if (sourceLengthSamples !== undefined && sourceLengthSamples !== clip.resource.length) {
            clipDocument.sourceLengthSamples = sourceLengthSamples;
          }
          return {
            ...clipDocument,
          };
        }),
      };
    }),
    ...(transformChain.length > 0 ? {
      transformChain: transformChain.map((effect) => ({
        id: effect.id,
        fxResourceId: effect.fxResourceId,
        bypassed: effect.bypassed,
        parameters: effect.parameters.map((param) => ({
          address: param.address,
          value: param.value,
          min: param.min,
          max: param.max,
          default: param.default,
          step: param.step,
          label: param.label,
        })),
      })),
    } : {}),
  };
}

/**
 * Purpose: Compare two serialized session documents for undo/redo boundary decisions.
 * How: Rely on the stable ordering of tracks and clips, then compare their JSON representation.
 */
export function areSessionDocumentsEqual(left: SessionDocument, right: SessionDocument): boolean {
  return serializeSessionDocument(left) === serializeSessionDocument(right);
}

/**
 * Purpose: Derive one deterministic revision identifier from the serialized editable session state.
 * How: Canonically stringify the SessionDocument and hash that string so identical content always yields the same revision.
 */
export function computeSessionDocumentRevision(sessionDocument: SessionDocument): string {
  return hashSessionDocumentString(serializeSessionDocument(sessionDocument));
}

/**
 * Purpose: Rebuild one project timeline from a serialized session document while preserving runtime-only state.
 * How: Keep the current resources, project id, and cursor/transport, but replace track clip content from the serialized document.
 */
export function applySessionDocument(
  baseProject: Project,
  sessionDocument: SessionDocument,
  fxResourceCode: ReadonlyMap<string, string> = new Map(),
): Project {
  if (sessionDocument.sampleRate !== baseProject.timebase.sampleRate) {
    throw new Error(
      `Session sample rate mismatch: expected ${baseProject.timebase.sampleRate}, got ${sessionDocument.sampleRate}`,
    );
  }

  let nextProject = initProject(baseProject.id);
  nextProject.resources = new Map(baseProject.resources);
  nextProject.timebase = baseProject.timebase;
  nextProject.timeline.cursor = baseProject.timeline.cursor;
  nextProject.timeline.transport = baseProject.timeline.transport;
  // Restore FX resources from the session document catalog + archive .dsp files
  for (const resourceDoc of sessionDocument.fxResources ?? []) {
    const code = fxResourceCode.get(resourceDoc.id) ?? baseProject.fxResources.get(resourceDoc.id)?.code ?? "";
    const resource: FxResource = { id: resourceDoc.id, name: resourceDoc.name, code };
    nextProject = importFxResource(nextProject, resource);
  }
  const nextChains = new Map(nextProject.chains);
  nextProject.timeline.tracks = TRACK_IDS.map((trackId) => {
    const sourceTrack = sessionDocument.tracks.find((track) => track.id === trackId);
    const baseTrack = baseProject.timeline.tracks.find((track) => track.id === trackId) ?? nextProject.timeline.tracks[0]!;
    if (!sourceTrack) {
      // Empty track : ensure its chain exists but is empty.
      nextChains.set(trackId, { id: trackId, effects: [] });
      return {
        ...baseTrack,
        clips: [],
        chainId: trackId,
      };
    }

    let previousEnd = 0;
    const clips = sourceTrack.clips.map((clipDocument) => {
      const resource = nextProject.resources.get(clipDocument.resourceId);
      if (!resource) {
        throw new Error(`Missing session resource "${clipDocument.resourceId}"`);
      }
      const start = previousEnd + clipDocument.deltaTime;
      const clip: Clip = {
        id: clipDocument.clipId,
        resource,
        start,
      };
      if (clipDocument.name) {
        clip.name = clipDocument.name;
      }
      if (clipDocument.sourceStartSample !== undefined) {
        clip.sourceStartSample = clipDocument.sourceStartSample;
      }
      if (clipDocument.sourceLengthSamples !== undefined) {
        clip.sourceLengthSamples = clipDocument.sourceLengthSamples;
      }
      previousEnd = clipEnd(nextProject, clip);
      return clip;
    });

    const effects: FxEffect[] = (sourceTrack.effects ?? []).map((effectDoc) => {
      // Backwards compatibility: migrate legacy effects with inline name+code
      const legacy = effectDoc as Record<string, unknown>;
      let fxResourceId = effectDoc.fxResourceId;
      if (!fxResourceId && typeof legacy.name === "string" && typeof legacy.code === "string") {
        fxResourceId = `fxr-legacy-${effectDoc.id}`;
        if (!nextProject.fxResources.has(fxResourceId)) {
          nextProject = importFxResource(nextProject, {
            id: fxResourceId,
            name: legacy.name as string,
            code: legacy.code as string,
          });
        }
      }
      return {
        id: effectDoc.id,
        fxResourceId: fxResourceId ?? "",
        bypassed: effectDoc.bypassed,
        parameters: effectDoc.parameters.map((paramDoc): FxParam => ({
          address: paramDoc.address,
          value: paramDoc.value,
          min: paramDoc.min ?? 0,
          max: paramDoc.max ?? 1,
          default: paramDoc.default ?? paramDoc.value,
          step: paramDoc.step ?? 0.01,
          label: paramDoc.label ?? paramDoc.address,
        })),
      };
    });

    nextChains.set(trackId, { id: trackId, effects });
    return {
      ...baseTrack,
      id: trackId,
      clips,
      chainId: trackId,
    };
  });
  nextProject.chains = nextChains;
  return nextProject;
}

/**
 * Purpose: Recover the persisted clip-local onset annotations from one session document.
 * How: Traverse every serialized clip and collect only the non-null annotation payloads keyed by clip id.
 */
export function extractClipOnsetAnnotations(
  sessionDocument: SessionDocument,
): Map<string, ClipOnsetAnnotation> {
  const annotations = new Map<string, ClipOnsetAnnotation>();
  for (const track of sessionDocument.tracks) {
    for (const clip of track.clips) {
      if (clip.onsetAnnotation) {
        annotations.set(clip.clipId, clip.onsetAnnotation);
      }
    }
  }
  return annotations;
}

/**
 * Purpose: Extract the persisted Transform Chain from a session document.
 * How: Deserialize the optional `transformChain` array into `FxEffect[]`.
 */
export function extractTransformChain(sessionDocument: SessionDocument): FxEffect[] {
  return (sessionDocument.transformChain ?? []).map((effectDoc): FxEffect => ({
    id: effectDoc.id,
    fxResourceId: effectDoc.fxResourceId,
    bypassed: effectDoc.bypassed,
    parameters: effectDoc.parameters.map((paramDoc): FxParam => ({
      address: paramDoc.address,
      value: paramDoc.value,
      min: paramDoc.min ?? 0,
      max: paramDoc.max ?? 1,
      default: paramDoc.default ?? paramDoc.value,
      step: paramDoc.step ?? 0.01,
      label: paramDoc.label ?? paramDoc.address,
    })),
  }));
}

/**
 * Purpose: Apply serialized track gain/pan values back to the runtime track-player map.
 * How: Update the stored controls in-place and mirror the values to any existing live audio nodes.
 */
export function applySessionDocumentToTrackPlayers(
  sessionDocument: SessionDocument,
  trackPlayers: Map<TrackId, TrackPlayerState>,
): number {
  let soloTrackId: TrackId | null = null;
  for (const trackDocument of sessionDocument.tracks) {
    const trackPlayer = trackPlayers.get(trackDocument.id);
    if (!trackPlayer) {
      continue;
    }
    trackPlayer.level = trackDocument.gain;
    trackPlayer.pan = trackDocument.pan;
    trackPlayer.muted = trackDocument.mute;
    trackPlayer.solo = trackDocument.solo && soloTrackId === null;
    if (trackPlayer.solo) {
      soloTrackId = trackDocument.id;
    }
    if (trackPlayer.outputPanner) {
      trackPlayer.outputPanner.pan.value = trackPlayer.pan;
    }
  }
  return sessionDocument.masterGain ?? DEFAULT_MASTER_LEVEL;
}
