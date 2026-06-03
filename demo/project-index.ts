/****************************** project-index.ts *******************************
 *
 * Purpose: Cache clip lookup metadata derived from the track structure of the project.
 * How: Rebuild a clip-id index only when the tracks array or timebase changes,
 *      then serve O(1) clip lookup and O(T) total clip counts during renders.
 *
 ******************************************************************************/
import type { Clip } from "../src/domain/clip.js";
import type { ClipId } from "../src/domain/identifiers.js";
import type { Project } from "../src/domain/project.js";
import type { TrackId } from "../src/domain/track-id.js";

/**
 * Purpose: Describe the exact location of one clip inside the project's track hierarchy.
 * How: Store the track identifier, the track index, the clip index within that track, and the clip object itself.
 */
type IndexedClipRef = {
  trackId: TrackId;
  trackIndex: number;
  clipIndex: number;
  clip: Clip;
};

/**
 * Purpose: Hold the derived clip index associated with one immutable project snapshot.
 * How: Cache the project reference, the total clip count, and a clip-id to location map.
 */
type ProjectClipIndex = {
  tracksRef: Project["timeline"]["tracks"] | null;
  internalTimeRate: number | null;
  totalClipCount: number;
  clipRefsById: Map<ClipId, IndexedClipRef>;
};

const projectClipIndex: ProjectClipIndex = {
  tracksRef: null,
  internalTimeRate: null,
  totalClipCount: 0,
  clipRefsById: new Map(),
};

/**
 * Purpose: Ensure that the derived clip index matches the current track structure.
 * How: Rebuild the cache only when the tracks array or timebase changes, otherwise reuse the existing index.
 */
function ensureProjectClipIndex(project: Project): ProjectClipIndex {
  if (
    projectClipIndex.tracksRef === project.timeline.tracks
    && projectClipIndex.internalTimeRate === project.timebase.internalTimeRate
  ) {
    return projectClipIndex;
  }

  const clipRefsById = new Map<ClipId, IndexedClipRef>();
  let totalClipCount = 0;

  for (const [trackIndex, track] of project.timeline.tracks.entries()) {
    totalClipCount += track.clips.length;
    for (const [clipIndex, clip] of track.clips.entries()) {
      clipRefsById.set(clip.id, {
        trackId: track.id,
        trackIndex,
        clipIndex,
        clip,
      });
    }
  }

  projectClipIndex.tracksRef = project.timeline.tracks;
  projectClipIndex.internalTimeRate = project.timebase.internalTimeRate;
  projectClipIndex.totalClipCount = totalClipCount;
  projectClipIndex.clipRefsById = clipRefsById;
  return projectClipIndex;
}

/**
 * Purpose: Return the cached total number of clips in the current project snapshot.
 * How: Ensure the cache is synchronized, then expose the stored aggregate count.
 */
export function getTotalClipCount(project: Project): number {
  return ensureProjectClipIndex(project).totalClipCount;
}

/**
 * Purpose: Find one clip by identifier without flattening every track on each render.
 * How: Resolve the identifier through the cached clip-id map built for the current project snapshot.
 */
export function getIndexedClip(project: Project, clipId: ClipId): IndexedClipRef | null {
  return ensureProjectClipIndex(project).clipRefsById.get(clipId) ?? null;
}
