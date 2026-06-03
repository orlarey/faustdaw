/**
 * Purpose: Project concept — the root aggregate of the domain, its default
 *          sample rate, its constructor (initProject), and its invariant
 *          (assertValidProject). Clips and resources live in their own
 *          concept files; this module owns the shape of the Project value
 *          and the rules that keep it globally consistent.
 * How: Expose the Project type plus the pure functions that create and
 *      validate it. Import the Clip concept to check per-clip and
 *      per-track coherence; a small module cycle with clip.ts exists
 *      because Clip mutations call back into assertValidProject as a
 *      post-check. ESM resolves it — values are only used inside function
 *      bodies, never at module initialization.
 */
import type { AudioResource } from "./audio-resource.js";
import type { Clip } from "./clip.js";
import { assertValidClip, clipEnd } from "./clip.js";
import type { FxChain, FxChainId, FxResource, FxResourceId } from "./fx-chain.js";
import { TRANSFORM_CHAIN_ID } from "./fx-chain.js";
import type { ClipId, ProjectId, ResourceId } from "./identifiers.js";
import { Timebase, type TimeCoord } from "./timebase.js";
import type { Timeline } from "./timeline.js";
import { TRACK_IDS } from "./track-id.js";

/**
 * Purpose: Represent the full DAW project state manipulated by domain operations.
 * How: Store the project identity, the imported audio catalog, the FX
 *      resource catalog, the FX chains map (keyed by chain id), the
 *      exact timebase, and the current timeline aggregate. Each track's
 *      FX chain is referenced by `Track.chainId` and lives in `chains`.
 */
export type Project = {
  id: ProjectId;
  resources: ReadonlyMap<ResourceId, AudioResource>;
  fxResources: ReadonlyMap<FxResourceId, FxResource>;
  chains: ReadonlyMap<FxChainId, FxChain>;
  timebase: Timebase;
  timeline: Timeline;
}

/**
 * Purpose: Default sample rate used when instantiating a fresh project.
 * How: Matches the fixed rate encoded in the timebase-backed specification.
 */
export const DEFAULT_SAMPLE_RATE = 48_000;

/**
 * Purpose: Build the fixed track list mandated by the current multitrack refinement.
 * How: Materialize the formal track identifiers with their display labels and
 *      empty clip sequences. By convention, each track's FX chain id equals
 *      its track id — this preserves the chain id space established by the
 *      undo scopes (chain-undo.ts step A) and avoids having to allocate a
 *      separate id for each track at boot.
 */
function createFixedTracks() {
  return TRACK_IDS.map((trackId, index) => ({
    id: trackId,
    label: `Track ${String(index + 1).padStart(2, "0")}`,
    clips: [] as readonly Clip[],
    chainId: trackId as FxChainId,
  }));
}

/**
 * Purpose: Build the initial empty FX chains map — one per fixed track,
 *          plus the project's Transform Chain.
 * How: One `FxChain` per track id, plus one for the Transform Chain
 *      under `TRANSFORM_CHAIN_ID`. All start empty.
 */
function createInitialChains(): ReadonlyMap<FxChainId, FxChain> {
  const chains = new Map<FxChainId, FxChain>();
  for (const trackId of TRACK_IDS) {
    chains.set(trackId, { id: trackId, effects: [] });
  }
  chains.set(TRANSFORM_CHAIN_ID, { id: TRANSFORM_CHAIN_ID, effects: [] });
  return chains;
}

/**
 * Purpose: Build a fresh project matching the current fixed-track multiclips initial state.
 * How: Allocate an empty resource map and fixed empty tracks with a zero cursor and stopped transport.
 */
export function initProject(id: ProjectId): Project {
  return {
    id,
    resources: new Map<ResourceId, AudioResource>(),
    fxResources: new Map(),
    chains: createInitialChains(),
    timebase: new Timebase(DEFAULT_SAMPLE_RATE),
    timeline: {
      tracks: createFixedTracks(),
      cursor: 0,
      transport: "Stopped",
    },
  };
}

/**
 * Purpose: Validate domain invariants so tests and callers can assert formal consistency.
 * How: Check scalar bounds, fixed-track structure, clip referential integrity, and non-overlap of sorted clips inside each track.
 */
/**
 * Purpose: Return the timeline coordinate of the last clip end across the project.
 * How: Walk every clip in every track and keep the maximum clipEnd.
 */
export function getProjectMixEndCoord(project: Project): TimeCoord {
  let mixEndCoord = 0;
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      mixEndCoord = Math.max(mixEndCoord, clipEnd(project, clip));
    }
  }
  return mixEndCoord;
}

export function assertValidProject(project: Project): void {
  if (!Number.isInteger(project.timeline.cursor) || project.timeline.cursor < 0) {
    throw new Error("Invariant violation: cursor must be an integer >= 0");
  }

  if (project.timeline.transport !== "Stopped" && project.timeline.transport !== "Playing") {
    throw new Error("Invariant violation: invalid transport state");
  }

  if (project.timeline.tracks.length !== TRACK_IDS.length) {
    throw new Error("Invariant violation: project must expose exactly the fixed track set");
  }

  for (const [index, track] of project.timeline.tracks.entries()) {
    if (track.id !== TRACK_IDS[index]) {
      throw new Error("Invariant violation: track order must match the fixed track set");
    }

    if (!project.chains.has(track.chainId)) {
      throw new Error(
        `Invariant violation: track "${track.id}" references missing FX chain "${track.chainId}"`,
      );
    }

    let previousEnd = 0;
    const seenIds = new Set<ClipId>();
    for (const clip of track.clips) {
      assertValidClip(project, clip);
      if (seenIds.has(clip.id)) {
        throw new Error("Invariant violation: clip ids must be unique");
      }
      if (clip.start < previousEnd) {
        throw new Error("Invariant violation: track clips must be sorted and non-overlapping");
      }

      seenIds.add(clip.id);
      previousEnd = clipEnd(project, clip);
    }
  }
}
