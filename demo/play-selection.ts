/****************************** play-selection.ts *****************************
 *
 * Purpose: Group the two fields that together describe "Play Selection" mode —
 *          playing only a specific subset of clips, optionally looping inside
 *          a time range. These two fields are always set/cleared as a pair
 *          (in startPreviewPlayback / stopPreviewPlayback) and read by the
 *          scheduler (to filter clips during plan build) and the transport
 *          loop (to loop the cursor).
 * How: Pure type, plus `followClipFilter`, the pure rule an edit applies to
 *      the filter. Operations that mutate the pair live in interactions.ts
 *      (preview-playback lifecycle); readers in playback-scheduler,
 *      transport-loop, track-render, track-activity, clip-presentation-inputs,
 *      timeline-scene.
 *
 ******************************************************************************/
import { clipEnd, getAllClips, getClipTrackId, type Clip } from "../src/domain/clip.js";
import type { Project } from "../src/domain/project.js";

/**
 * Purpose: Play-Selection mode state. Both fields are null when the mode is
 *          off; both are set together when it turns on.
 */
export type PlaySelectionState = {
  /** When non-null, only clips whose id is in this set are scheduled. */
  clipFilter: ReadonlySet<string> | null;
  /** When non-null, the transport loops between startCoord and endCoord. */
  loopRange: { startCoord: number; endCoord: number } | null;
};

export function createInitialPlaySelectionState(): PlaySelectionState {
  return {
    clipFilter: null,
    loopRange: null,
  };
}

/**
 * Purpose: Keep Play Selection on the clips an edit made from the filtered
 *          ones. Reverse, split, merge, crossfade, Transform Apply and explode
 *          replace a clip by clips with new ids; a filter left on the old ids
 *          lets no clip through, and the loop goes on in silence.
 * How: When a filtered clip is gone from `next`, admit every clip of `next`
 *      that did not exist in `previous`, lies on the same track and overlaps
 *      the gone clip's span in `previous` [start, end); keep the filtered
 *      clips that still exist. An edit that removes no filtered clip leaves
 *      the filter as it is (same Set), and so does a mode that is off (null).
 */
export function followClipFilter(
  filter: ReadonlySet<string> | null,
  previous: Project,
  next: Project,
): ReadonlySet<string> | null {
  if (filter === null) return null;
  const previousIds = new Set(getAllClips(previous).map((clip) => clip.id));
  const nextClips = getAllClips(next);
  const nextIds = new Set(nextClips.map((clip) => clip.id));
  const gone: { trackId: string; start: number; end: number }[] = [];
  for (const clip of getAllClips(previous)) {
    if (filter.has(clip.id) && !nextIds.has(clip.id)) {
      gone.push({ trackId: getClipTrackId(previous, clip.id), start: clip.start, end: clipEnd(previous, clip) });
    }
  }
  if (gone.length === 0) return filter;
  const followed = new Set([...filter].filter((id) => nextIds.has(id)));
  const overlapsGone = (clip: Clip): boolean => {
    const trackId = getClipTrackId(next, clip.id);
    const end = clipEnd(next, clip);
    return gone.some((g) => g.trackId === trackId && clip.start < g.end && g.start < end);
  };
  for (const clip of nextClips) {
    if (!previousIds.has(clip.id) && overlapsGone(clip)) followed.add(clip.id);
  }
  return followed;
}
