/********************************* split.ts ***********************************
 *
 * Purpose: Cut every selected clip that strictly straddles the cut marker
 *          into two adjacent halves sharing the same AudioResource. Metadata
 *          only — no PCM copy, no new resource.
 * How: Applies when at least one selected clip intersects the cut coordinate.
 *      Execute walks the selection, replaces each intersected clip by two
 *      sliced halves via `removeClip` + `placeClipInstance`, and commits the
 *      result. Non-intersected clips pass through unchanged.
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

          const cutOffsetSamples = computeCutOffsetSamples(project, clip, cutCoord);
          const originalStart = getClipSourceStartSample(clip);
          const originalLength = getClipSourceLengthSamples(clip);
          if (cutOffsetSamples <= 0 || cutOffsetSamples >= originalLength) {
            nextIds.push(clip.id);
            continue;
          }

          const trackId = getClipTrackId(project, clip.id);
          const leftName = clip.name ? `${clip.name} L` : undefined;
          const rightName = clip.name ? `${clip.name} R` : undefined;
          const leftClip: Clip = {
            id: createNextClipId(),
            resource: clip.resource,
            start: clip.start,
            sourceStartSample: originalStart,
            sourceLengthSamples: cutOffsetSamples,
            ...(leftName !== undefined ? { name: leftName } : {}),
          };
          const rightClip: Clip = {
            id: createNextClipId(),
            resource: clip.resource,
            start: cutCoord,
            sourceStartSample: originalStart + cutOffsetSamples,
            sourceLengthSamples: originalLength - cutOffsetSamples,
            ...(rightName !== undefined ? { name: rightName } : {}),
          };

          project = removeClip(project, clip.id);
          project = placeClipInstance(project, leftClip, leftClip.start, trackId);
          project = placeClipInstance(project, rightClip, rightClip.start, trackId);
          nextIds.push(leftClip.id, rightClip.id);
        }

        return SelectionNS.of(project, nextIds);
      },
      env.elements,
    ) ?? "cancelled";
  }
}

export const splitOperation = new SplitOperation();
