/******************************** crossfade.ts ********************************
 *
 * Purpose: Smooth every pair of contiguous selected clips with a linear
 *          crossfade of `CROSSFADE_DURATION_SECONDS` seconds at the project
 *          sample rate.
 * How: Applies when at least one selection run has ≥ 2 clips whose junction
 *      can host the ramp. Execute left-folds `crossfadeClips` across each
 *      eligible run; runs that cannot host the ramp pass through unchanged.
 *
 ******************************************************************************/
import type { Selection } from "../../src/domain/selection/selection.js";
import { Selection as SelectionNS } from "../../src/domain/selection/selection.js";
import type { Clip } from "../../src/domain/clip.js";
import { getClipSourceLengthSamples } from "../../src/domain/clip.js";
import type { ClipId } from "../../src/domain/identifiers.js";
import type { Project } from "../../src/domain/project.js";
import { crossfadeClips } from "../../src/domain/clip-operations.js";
import { findContiguousRuns } from "../../src/domain/selection/contiguous-runs.js";
import { commitSelectionTransition, type MenuEnv, type MenuOperation } from "../menu-operation.js";
import { createNextClipId } from "../clip-id.js";
import { makeClipSampleDeps } from "../clip-sample-deps.js";
import { demoState } from "../state.js";

const CROSSFADE_DURATION_SECONDS = 0.035;

function durationSamples(): number {
  return Math.max(1, Math.round(CROSSFADE_DURATION_SECONDS * demoState.project.timebase.sampleRate));
}

function runCanHostRamp(run: readonly Clip[], d: number): boolean {
  for (const clip of run) {
    if (getClipSourceLengthSamples(clip) < d) return false;
  }
  return true;
}

function countJunctions(sel: Selection, d: number): number {
  if (!Number.isFinite(d) || d <= 0) return 0;
  let junctions = 0;
  for (const run of findContiguousRuns(sel)) {
    if (run.length < 2) continue;
    if (runCanHostRamp(run, d)) junctions += run.length - 1;
  }
  return junctions;
}

class CrossfadeOperation implements MenuOperation {
  readonly name = "Crossfade";
  readonly shortcut = "x";

  applies(sel: Selection): boolean {
    return countJunctions(sel, durationSamples()) > 0;
  }

  async execute(sel: Selection, env: MenuEnv) {
    const d = durationSamples();
    const junctions = countJunctions(sel, d);
    const label = `Crossfade ${junctions} ${junctions === 1 ? "junction" : "junctions"}`;
    const deps = makeClipSampleDeps();
    const runs = findContiguousRuns(sel);

    return commitSelectionTransition(
      label,
      () => {
        let project: Project = sel.project;
        const survivorIds: ClipId[] = [];
        for (const run of runs) {
          if (run.length < 2) {
            if (run.length === 1) survivorIds.push(run[0]!.id);
            continue;
          }
          if (!runCanHostRamp(run, d)) {
            for (const clip of run) survivorIds.push(clip.id);
            continue;
          }
          let mergedClip = run[0]!;
          for (let i = 1; i < run.length; i += 1) {
            const next = run[i]!;
            const result = crossfadeClips(project, mergedClip, next, d, deps, createNextClipId);
            project = result.project;
            mergedClip = result.clip;
          }
          survivorIds.push(mergedClip.id);
        }
        return SelectionNS.of(project, survivorIds);
      },
      env.elements,
      { restartPlayback: true },
    ) ?? "cancelled";
  }
}

export const crossfadeOperation = new CrossfadeOperation();
