/**
 * Purpose: Clip concept — the timeline placement record and all operations
 *          that create, query, or transform clips inside a project.
 * How: Define the Clip type and co-locate every primitive that reads or
 *      writes clips (queries, placement mutations, invariants) so that
 *      reading this file shows the complete grammar of the Clip concept.
 *
 * Dependencies: Clip operations validate the whole project after mutation
 *      via `assertValidProject` from project.ts, which in turn inspects
 *      clips via functions defined here. ESM resolves the resulting module
 *      cycle because neither side calls the other at module initialization.
 */
import type { AudioResource } from "./audio-resource.js";
import type { ClipId } from "./identifiers.js";
import type { Project } from "./project.js";
import type { TimeCoord } from "./timebase.js";
import { TRACK_IDS, type TrackId } from "./track-id.js";
import { getTrack, replaceTrack } from "./track-helpers.js";
import { assertValidProject } from "./project.js";

/**
 * Purpose: Represent one placed clip in the multitrack timeline.
 * How: Store the clip identity, the referenced audio resource, the clip start coordinate,
 *      and the optional source slice inside the resource.
 */
export type Clip = {
  id: ClipId;
  resource: AudioResource;
  name?: string;
  start: TimeCoord;
  sourceStartSample?: number;
  sourceLengthSamples?: number;
}

// ---------------------------------------------------------------------------
// Source-slice accessors
// ---------------------------------------------------------------------------

/**
 * Purpose: Return the first source sample read by one clip inside its referenced audio resource.
 * How: Default to zero for legacy full-resource clips that do not encode an explicit source slice.
 */
export function getClipSourceStartSample(clip: Clip): number {
  return clip.sourceStartSample ?? 0;
}

/**
 * Purpose: Return how many source samples of the referenced audio resource belong to one clip.
 * How: Default to the full imported resource length for legacy clips that do not encode an explicit source slice.
 */
export function getClipSourceLengthSamples(clip: Clip): number {
  return clip.sourceLengthSamples ?? clip.resource.length;
}

/**
 * Purpose: Return the exclusive source end sample of one clip inside its referenced audio resource.
 * How: Add the normalized source start and source length derived from the clip metadata.
 */
export function getClipSourceEndSample(clip: Clip): number {
  return getClipSourceStartSample(clip) + getClipSourceLengthSamples(clip);
}

/**
 * Purpose: Compute the clip end time implied by its source duration and start time.
 * How: Convert resource frame length to internal time coordinates and add the clip start.
 */
export function clipEnd(project: Project, clip: Clip): TimeCoord {
  const durationCoord = Math.round((getClipSourceLengthSamples(clip) / clip.resource.sampleRate) * project.timebase.internalTimeRate);
  return clip.start + durationCoord;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Purpose: Return every clip placed anywhere in the current timeline.
 * How: Flatten the clip sequences of the fixed tracks into one ordered list.
 */
export function getAllClips(project: Project): readonly Clip[] {
  return project.timeline.tracks.flatMap((track) => track.clips);
}

/**
 * Purpose: Recover the containing track together with one clip.
 * How: Scan the fixed track list and return the first track whose clip sequence contains the requested identifier.
 */
function getClipPlacement(project: Project, clipId: ClipId): { track: ReturnType<typeof getTrack>; clip: Clip } {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) {
      return { track, clip };
    }
  }

  throw new Error(`Precondition violation: clip "${clipId}" does not exist`);
}

/**
 * Purpose: Find one clip by identifier inside the project.
 * How: Scan the flattened clip list and throw when the requested clip does not exist.
 */
export function getClip(project: Project, clipId: ClipId): Clip {
  return getClipPlacement(project, clipId).clip;
}

/**
 * Purpose: Recover the identifier of the track hosting a given clip.
 * How: Reuse the internal placement lookup so selection-layer operations can
 *      locate the containing track without duplicating the scan logic.
 */
export function getClipTrackId(project: Project, clipId: ClipId): TrackId {
  return getClipPlacement(project, clipId).track.id;
}

/**
 * Purpose: Decide whether one specific clip is active at a given instant on the timeline.
 * How: Evaluate the formal half-open interval [start, end) for the requested clip.
 */
export function isClipActive(project: Project, clip: Clip, time: TimeCoord): boolean {
  return clip.start <= time && time < clipEnd(project, clip);
}

/**
 * Purpose: Find the first clip in one sorted non-overlapping track whose end exceeds the requested time.
 * How: Binary-search the monotone clip-end predicate to obtain the smallest matching index or the clip count when absent.
 */
function findFirstClipEndingAfter(project: Project, clips: readonly Clip[], time: TimeCoord): number {
  let lo = 0;
  let hi = clips.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (clipEnd(project, clips[mid]!) > time) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return lo;
}

/**
 * Purpose: Find the unique active clip, if any, inside one sorted non-overlapping track at a given time.
 * How: Binary-search the first clip whose end exceeds the time, then check whether its start is not after the requested time.
 */
export function findActiveClipInTrack(project: Project, clips: readonly Clip[], time: TimeCoord): Clip | null {
  const index = findFirstClipEndingAfter(project, clips, time);
  if (index >= clips.length) {
    return null;
  }

  const candidate = clips[index]!;
  return candidate.start <= time ? candidate : null;
}

/**
 * Purpose: Find the contiguous range of clips whose temporal interval intersects a view window.
 * How: Binary-search for the first clip whose end exceeds viewStart, then iterate forward while clip start is before viewEnd.
 */
export function findVisibleClipRange(
  project: Project,
  clips: readonly Clip[],
  viewStart: TimeCoord,
  viewEnd: TimeCoord,
): { first: number; last: number } {
  const n = clips.length;
  if (n === 0 || viewStart >= viewEnd) {
    return { first: 0, last: -1 };
  }

  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (clipEnd(project, clips[mid]!) > viewStart) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  const first = lo;
  if (first >= n || clips[first]!.start >= viewEnd) {
    return { first: 0, last: -1 };
  }

  let last = first;
  while (last + 1 < n && clips[last + 1]!.start < viewEnd) {
    last++;
  }

  return { first, last };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Purpose: Validate that one clip is structurally sound before it enters or stays in the timeline.
 * How: Check identifier presence, integer start, source slice bounds, and imported resource identity.
 */
export function assertValidClip(project: Project, clip: Clip): void {
  if (!clip.id) {
    throw new Error("Invariant violation: clip id must be non-empty");
  }

  if (!Number.isInteger(clip.start) || clip.start < 0) {
    throw new Error("Invariant violation: clip start must be an integer >= 0");
  }

  const sourceStartSample = getClipSourceStartSample(clip);
  const sourceLengthSamples = getClipSourceLengthSamples(clip);
  if (!Number.isInteger(sourceStartSample) || sourceStartSample < 0) {
    throw new Error("Invariant violation: clip sourceStartSample must be an integer >= 0");
  }
  if (!Number.isInteger(sourceLengthSamples) || sourceLengthSamples <= 0) {
    throw new Error("Invariant violation: clip sourceLengthSamples must be an integer > 0");
  }

  const importedResource = project.resources.get(clip.resource.id);
  if (!importedResource) {
    throw new Error("Invariant violation: clip resource must exist");
  }

  if (importedResource !== clip.resource) {
    throw new Error("Invariant violation: clip resource must be the imported resource instance");
  }
  if (sourceStartSample + sourceLengthSamples > importedResource.length) {
    throw new Error("Invariant violation: clip source slice must stay within its resource");
  }
}

// ---------------------------------------------------------------------------
// Track-level placement helpers (private)
// ---------------------------------------------------------------------------

/**
 * Purpose: Remove one clip from a track sequence without disturbing the others.
 * How: Filter by identifier and keep the original order of the remaining clips.
 */
function removeClipFromTrack(track: ReturnType<typeof getTrack>, clipId: ClipId) {
  return {
    ...track,
    clips: track.clips.filter((clip) => clip.id !== clipId),
  };
}

/**
 * Purpose: Place a clip into one track according to the current drop semantics.
 * How: Insert the clip at the requested position when possible, otherwise snap it after the previous clip and shift following clips right just enough to avoid overlap.
 */
function placeClipIntoTrack(
  project: Project,
  trackId: TrackId,
  candidateClip: Clip,
  requestedStart: TimeCoord,
): readonly Clip[] {
  const track = getTrack(project, trackId);
  const placedClips: Clip[] = [];
  let inserted = false;
  let previousEnd = 0;

  for (const clip of track.clips) {
    if (!inserted && clip.start >= requestedStart) {
      const insertionStart = Math.max(requestedStart, previousEnd);
      const insertedClip = { ...candidateClip, start: insertionStart };
      placedClips.push(insertedClip);
      previousEnd = clipEnd(project, insertedClip);
      inserted = true;
    }

    if (inserted) {
      const shiftedStart = Math.max(clip.start, previousEnd);
      const shiftedClip = { ...clip, start: shiftedStart };
      placedClips.push(shiftedClip);
      previousEnd = clipEnd(project, shiftedClip);
      continue;
    }

    placedClips.push(clip);
    previousEnd = clipEnd(project, clip);
  }

  if (!inserted) {
    const insertionStart = Math.max(requestedStart, previousEnd);
    placedClips.push({ ...candidateClip, start: insertionStart });
  }

  return placedClips;
}

/**
 * Purpose: Create a new project with one track replaced by a new clip sequence.
 * How: Copy the project and substitute the selected track after sorting its clips into canonical order.
 */
function withTrackClips(project: Project, trackId: TrackId, clips: readonly Clip[]): Project {
  const track = getTrack(project, trackId);
  const nextTrack = {
    ...track,
    clips: [...clips],
  };

  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: replaceTrack(project, nextTrack),
    },
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Purpose: Place a new clip on one track according to the placement rules under specification.
 * How: Validate the incoming clip identity and target track, then insert it into the target track sequence with local snapping and rightward shifting.
 */
export function placeClip(
  project: Project,
  clipId: ClipId,
  resource: AudioResource,
  start: TimeCoord,
  trackId: TrackId = TRACK_IDS[0],
): Project {
  if (!clipId) {
    throw new Error("Precondition violation: clip id must be non-empty");
  }
  if (!Number.isInteger(start) || start < 0) {
    throw new Error("Precondition violation: clip start must be an integer >= 0");
  }
  if (!TRACK_IDS.includes(trackId)) {
    throw new Error(`Precondition violation: track "${trackId}" does not exist`);
  }
  if (project.resources.get(resource.id) !== resource) {
    throw new Error(`Precondition violation: resource "${resource.id}" is not imported in this project`);
  }
  if (getAllClips(project).some((clip) => clip.id === clipId)) {
    throw new Error(`Precondition violation: clip "${clipId}" already exists`);
  }

  const candidateClip: Clip = { id: clipId, resource, start };
  return placeClipInstance(project, candidateClip, start, trackId);
}

/**
 * Purpose: Place an existing full clip record while preserving optional source-slice metadata.
 * How: Validate the candidate clip against imported resources and uniqueness, then insert it with the same local placement semantics as new clips.
 */
export function placeClipInstance(
  project: Project,
  clip: Clip,
  start: TimeCoord,
  trackId: TrackId,
): Project {
  if (!clip.id) {
    throw new Error("Precondition violation: clip id must be non-empty");
  }
  if (!Number.isInteger(start) || start < 0) {
    throw new Error("Precondition violation: clip start must be an integer >= 0");
  }
  if (!TRACK_IDS.includes(trackId)) {
    throw new Error(`Precondition violation: track "${trackId}" does not exist`);
  }
  if (project.resources.get(clip.resource.id) !== clip.resource) {
    throw new Error(`Precondition violation: resource "${clip.resource.id}" is not imported in this project`);
  }
  if (getAllClips(project).some((candidate) => candidate.id === clip.id)) {
    throw new Error(`Precondition violation: clip "${clip.id}" already exists`);
  }

  const candidateClip: Clip = { ...clip, start };
  const placedClips = placeClipIntoTrack(project, trackId, candidateClip, start);
  const next = withTrackClips(project, trackId, placedClips);
  assertValidProject(next);
  return next;
}

/**
 * Purpose: Remove one clip from the timeline without affecting the rest of the arrangement.
 * How: Find the containing track and rebuild only that track without the requested clip.
 */
export function removeClip(project: Project, clipId: ClipId): Project {
  const { track } = getClipPlacement(project, clipId);
  const next = withTrackClips(project, track.id, removeClipFromTrack(track, clipId).clips);
  assertValidProject(next);
  return next;
}

/**
 * Purpose: Move one existing clip in time and optionally across tracks using the same placement semantics as drop.
 * How: Remove the clip from its current track, then reinsert it on the target track at the requested time with local snapping and shifting.
 */
export function moveClip(project: Project, clipId: ClipId, start: TimeCoord, trackId?: TrackId): Project {
  if (!Number.isInteger(start) || start < 0) {
    throw new Error("Precondition violation: clip start must be an integer >= 0");
  }

  const { track: sourceTrack, clip } = getClipPlacement(project, clipId);
  const nextTrackId = trackId ?? sourceTrack.id;
  if (!TRACK_IDS.includes(nextTrackId)) {
    throw new Error(`Precondition violation: track "${nextTrackId}" does not exist`);
  }

  const withoutSource = withTrackClips(
    project,
    sourceTrack.id,
    removeClipFromTrack(sourceTrack, clipId).clips,
  );
  const candidateClip: Clip = { ...clip, start };
  const placedClips = placeClipIntoTrack(withoutSource, nextTrackId, candidateClip, start);
  const next = withTrackClips(withoutSource, nextTrackId, placedClips);
  assertValidProject(next);
  return next;
}

/**
 * Purpose: Assign or clear one user-visible name on an existing clip without changing its placement or source slice.
 * How: Rebuild only the containing track and replace the target clip with a copy whose optional name field matches the normalized input.
 */
export function renameClip(project: Project, clipId: ClipId, name: string | null): Project {
  const { track } = getClipPlacement(project, clipId);
  const normalizedName = name?.trim() || null;
  const next = withTrackClips(
    project,
    track.id,
    track.clips.map((candidate) => {
      if (candidate.id !== clipId) {
        return candidate;
      }
      if (!normalizedName) {
        const { name: _ignoredName, ...clipWithoutName } = candidate;
        return clipWithoutName;
      }
      return {
        ...candidate,
        name: normalizedName,
      };
    }),
  );
  assertValidProject(next);
  return next;
}
