/************************** visible-range-cache.ts *****************************
 *
 * Purpose: Cache and incrementally update the visible clip range of each track.
 * How: Reuse the previous [first, last] range while the track structure and
 *      timebase remain stable, and adjust the bounds locally as the view window
 *      translates or zooms.
 *
 ******************************************************************************/
import type { Clip } from "../src/domain/clip.js";
import type { Project } from "../src/domain/project.js";
import type { TimeCoord } from "../src/domain/timebase.js";
import type { Track } from "../src/domain/track.js";
import { clipEnd, findVisibleClipRange } from "../src/domain/clip.js";

/**
 * Purpose: Represent the contiguous visible subrange of one sorted track.
 * How: Store the inclusive first and last visible indices, with an empty range
 *      encoded as { first: 0, last: -1 }.
 */
export type VisibleRange = {
  first: number;
  last: number;
};

type CachedTrackRange = {
  clipsRef: readonly Clip[];
  viewStart: TimeCoord;
  viewEnd: TimeCoord;
  first: number;
  last: number;
};

let cachedTracksRef: Project["timeline"]["tracks"] | null = null;
let cachedInternalTimeRate: number | null = null;
const cachedRanges = new Map<Track["id"], CachedTrackRange>();

/**
 * Purpose: Reset the per-track visible range cache when the track structure changes.
 * How: Clear the track cache whenever the tracks array or timebase differs from the one used previously.
 */
function ensureProjectCache(project: Project): void {
  if (
    cachedTracksRef === project.timeline.tracks
    && cachedInternalTimeRate === project.timebase.internalTimeRate
  ) {
    return;
  }
  cachedTracksRef = project.timeline.tracks;
  cachedInternalTimeRate = project.timebase.internalTimeRate;
  cachedRanges.clear();
}

/**
 * Purpose: Update a previously known non-empty visible range after a small view change.
 * How: Shrink or expand the cached first/last bounds until they match the new half-open view window exactly.
 */
function translateVisibleRange(
  project: Project,
  clips: readonly Clip[],
  viewStart: TimeCoord,
  viewEnd: TimeCoord,
  cached: CachedTrackRange,
): VisibleRange {
  let first = cached.first;
  let last = cached.last;

  while (first <= last && clipEnd(project, clips[first]!) <= viewStart) {
    first += 1;
  }

  while (first > 0 && clipEnd(project, clips[first - 1]!) > viewStart) {
    first -= 1;
  }

  while (last >= first && clips[last]!.start >= viewEnd) {
    last -= 1;
  }

  while (last + 1 < clips.length && clips[last + 1]!.start < viewEnd) {
    last += 1;
  }

  if (first > last) {
    return { first: 0, last: -1 };
  }

  return { first, last };
}

/**
 * Purpose: Return the visible clip range for one track with incremental reuse when possible.
 * How: Reuse and locally adjust the previous range when the same clip array is still valid; otherwise fall back to the binary-search implementation.
 */
export function getVisibleClipRangeCached(
  project: Project,
  track: Track,
  viewStart: TimeCoord,
  viewEnd: TimeCoord,
): VisibleRange {
  ensureProjectCache(project);

  if (track.clips.length === 0 || viewStart >= viewEnd) {
    const empty = { first: 0, last: -1 };
    cachedRanges.set(track.id, { clipsRef: track.clips, viewStart, viewEnd, ...empty });
    return empty;
  }

  const cached = cachedRanges.get(track.id);
  let range: VisibleRange;

  if (!cached || cached.clipsRef !== track.clips || cached.last < cached.first) {
    range = findVisibleClipRange(project, track.clips, viewStart, viewEnd);
  } else {
    range = translateVisibleRange(project, track.clips, viewStart, viewEnd, cached);
  }

  cachedRanges.set(track.id, {
    clipsRef: track.clips,
    viewStart,
    viewEnd,
    first: range.first,
    last: range.last,
  });
  return range;
}
