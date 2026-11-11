/********************************* split.ts ***********************************
 *
 * Purpose: Cut every selected clip that strictly straddles the cut marker
 *          into two adjacent halves sharing the same AudioResource. Metadata
 *          only — no PCM copy, no new resource.
 * How: Applies when at least one selected clip intersects the cut coordinate.
 *      Execute walks the selection, replaces each intersected clip by two
 *      sliced halves (`splitClipAtCut`), and commits the result.
 *      Non-intersected clips pass through unchanged.
 *      The cut falls on the clip's nearest sample. The right half starts
 *      where the left half ends: each sample stays at its timeline position,
 *      and the halves stay contiguous (Merge, Crossfade). At 44.1 kHz a
 *      sample spans 10 coordinates, so a cut is usually between two samples.
 *
 ******************************************************************************/
import type { Selection } from "../../src/domain/selection/selection.js";
import { Selection as SelectionNS } from "../../src/domain/selection/selection.js";
import type { Clip } from "../../src/domain/clip.js";
import {
  clipEnd,
  getClipSourceLengthSamples,
  getClipSourceStartSample,
  getClipTrackId,
  placeClipInstance,
  removeClip,
} from "../../src/domain/clip.js";
import type { TimeCoord } from "../../src/domain/timebase.js";
import type { ClipId } from "../../src/domain/identifiers.js";
import type { Project } from "../../src/domain/project.js";
import { commitSelectionTransition, type MenuEnv, type MenuOperation } from "../menu-operation.js";
import { createNextClipId } from "../clip-id.js";

function countIntersected(sel: Selection, cutCoord: TimeCoord): number {
  const project = sel.project;
  let count = 0;
  for (const clip of sel.clips()) {
    if (clip.start < cutCoord && clipEnd(project, clip) > cutCoord) {
      count += 1;
    }
  }
  return count;
}

function computeCutOffsetSamples(project: Project, clip: Clip, cutCoord: TimeCoord): number {
  const deltaCoord = cutCoord - clip.start;
  const scaled = (deltaCoord / project.timebase.internalTimeRate) * clip.resource.sampleRate;
  return Math.round(scaled);
}

/**
 * Purpose: Split one clip at `cutCoord` into two halves of the same resource.
 * How: Cut at the clip's nearest sample; the right half starts at the left
 *      half's end (not at `cutCoord`, which may lie between two samples), so
 *      no sample moves and the halves are contiguous. Returns null when the
 *      cut leaves an empty half.
 */
export function splitClipAtCut(
  project: Project,
  clip: Clip,
  cutCoord: TimeCoord,
  nextClipId: () => ClipId,
): { project: Project; leftId: ClipId; rightId: ClipId } | null {
  const cutOffsetSamples = computeCutOffsetSamples(project, clip, cutCoord);
  const originalStart = getClipSourceStartSample(clip);
  const originalLength = getClipSourceLengthSamples(clip);
  if (cutOffsetSamples <= 0 || cutOffsetSamples >= originalLength) {
    return null;
  }

  const trackId = getClipTrackId(project, clip.id);
  const leftName = clip.name ? `${clip.name} L` : undefined;
  const rightName = clip.name ? `${clip.name} R` : undefined;
  const leftClip: Clip = {
    id: nextClipId(),
    resource: clip.resource,
    start: clip.start,
    sourceStartSample: originalStart,
    sourceLengthSamples: cutOffsetSamples,
    ...(leftName !== undefined ? { name: leftName } : {}),
  };
  const rightClip: Clip = {
    id: nextClipId(),
    resource: clip.resource,
    start: clipEnd(project, leftClip),
    sourceStartSample: originalStart + cutOffsetSamples,
    sourceLengthSamples: originalLength - cutOffsetSamples,
    ...(rightName !== undefined ? { name: rightName } : {}),
  };

  let next = removeClip(project, clip.id);
  next = placeClipInstance(next, leftClip, leftClip.start, trackId);
  next = placeClipInstance(next, rightClip, rightClip.start, trackId);
  return { project: next, leftId: leftClip.id, rightId: rightClip.id };
}

class SplitOperation implements MenuOperation {
  readonly name = "Split";
  readonly shortcut = "s";

  applies(sel: Selection, env: MenuEnv): boolean {
    if (!Number.isFinite(env.cutCoord)) return false;
    return countIntersected(sel, env.cutCoord) > 0;
  }

  async execute(sel: Selection, env: MenuEnv) {
    const { cutCoord } = env;
    const count = countIntersected(sel, cutCoord);
    const label = `Split ${count} ${count === 1 ? "clip" : "clips"} at cut`;

    return commitSelectionTransition(
      label,
      () => {
        let project: Project = sel.project;
        const nextIds: ClipId[] = [];

        for (const clip of sel.clips()) {
          const clipEndCoord = clipEnd(project, clip);
          if (clip.start >= cutCoord || clipEndCoord <= cutCoord) {
            nextIds.push(clip.id);
            continue;
          }

          const split = splitClipAtCut(project, clip, cutCoord, createNextClipId);
          if (!split) {
            nextIds.push(clip.id);
            continue;
          }
          project = split.project;
          nextIds.push(split.leftId, split.rightId);
        }

        return SelectionNS.of(project, nextIds);
      },
      env.elements,
    ) ?? "cancelled";
  }
}

export const splitOperation = new SplitOperation();
