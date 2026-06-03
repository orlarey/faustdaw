/**
 * Purpose: Shared internal helpers for looking up and replacing tracks in a project.
 * How: Provide pure utility functions used by both the main DAW module and the FX-chain module.
 */
import type { FxEffect } from "./fx-chain.js";
import type { Project } from "./project.js";
import type { Track } from "./track.js";
import type { TrackId } from "./track-id.js";

/**
 * Purpose: Fetch one track by identifier from the fixed track set.
 * How: Search the ordered track list and fail immediately when the requested identifier is absent.
 */
export function getTrack(project: Project, trackId: TrackId) {
  const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    throw new Error(`Invariant violation: missing track "${trackId}"`);
  }
  return track;
}

/**
 * Purpose: Replace one track in the fixed track sequence while preserving order and the remaining tracks.
 * How: Map over the track list and substitute only the track whose identifier matches the replacement.
 */
export function replaceTrack(project: Project, replacement: ReturnType<typeof getTrack>): Project["timeline"]["tracks"] {
  return project.timeline.tracks.map((track) => (track.id === replacement.id ? replacement : track));
}

/**
 * Purpose: Read the effects of a track's FX chain.
 * How: Look up `Project.chains` by `track.chainId`. Returns an empty array
 *      when the chain is missing — callers wishing to enforce existence
 *      should use `getChain` from `src/fx-chain.ts` directly.
 */
export function getTrackEffects(project: Project, track: Track): readonly FxEffect[] {
  return project.chains.get(track.chainId)?.effects ?? [];
}

/**
 * Purpose: Read the effects of a track's FX chain by track id.
 * How: Resolve the track first, then delegate to `getTrackEffects`.
 */
export function getTrackEffectsById(project: Project, trackId: TrackId): readonly FxEffect[] {
  return getTrackEffects(project, getTrack(project, trackId));
}
