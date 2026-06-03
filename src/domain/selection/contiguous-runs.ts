/**
 * Purpose: Find the maximal runs of contiguous clips (same track, zero gap)
 *          inside a Selection, so merge/crossfade operations can process
 *          each run independently without duplicating the scan logic.
 * How: Walk the tracks of the bound project in timeline order; for each
 *      track, iterate its clips in order and accumulate a run of consecutive
 *      selected clips whose neighbour-to-neighbour boundary is exact
 *      (`clipEnd(project, prev) === next.start`). Runs are flushed to the
 *      output whenever the chain breaks (gap, non-selected clip, or track
 *      change).
 *
 * Design notes:
 *   - This helper is **private to the selection folder**. It is not
 *     exported from `src/domain/selection/index.ts` (no such barrel exists)
 *     and is only imported by `operations/merge-contiguous-in-selection.ts`
 *     and `operations/crossfade-contiguous-in-selection.ts`.
 *   - "Contiguous" is defined exactly as
 *     `clipEnd(project, prev) === next.start`. Any gap, even one coord,
 *     breaks the run.
 *   - Runs of length 1 are included in the output. Callers decide whether
 *     to skip them (merge/crossfade both require length ≥ 2 to do any work).
 */
import { clipEnd } from "../clip.js";
import type { Clip } from "../clip.js";
import type { Selection } from "./selection.js";

/**
 * Purpose: Group the selected clips into maximal contiguous runs.
 * How: For each track, iterate in clip order, treat a clip as "in-run" when
 *      it belongs to the selection, and end the current run whenever the
 *      previous clip's `clipEnd` differs from the current clip's `start`
 *      or the current clip is not in the selection.
 */
export function findContiguousRuns(selection: Selection): Clip[][] {
  if (selection.isEmpty) {
    return [];
  }
  const project = selection.project;
  const selectedIds = new Set(selection.clipIds);
  const runs: Clip[][] = [];

  for (const track of project.timeline.tracks) {
    let currentRun: Clip[] = [];
    for (const clip of track.clips) {
      if (!selectedIds.has(clip.id)) {
        if (currentRun.length > 0) {
          runs.push(currentRun);
          currentRun = [];
        }
        continue;
      }

      if (currentRun.length === 0) {
        currentRun.push(clip);
        continue;
      }

      const previous = currentRun[currentRun.length - 1]!;
      if (clipEnd(project, previous) === clip.start) {
        currentRun.push(clip);
      } else {
        runs.push(currentRun);
        currentRun = [clip];
      }
    }
    if (currentRun.length > 0) {
      runs.push(currentRun);
    }
  }

  return runs;
}
