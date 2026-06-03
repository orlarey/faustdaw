/********************************* merge.ts ***********************************
 *
 * Purpose: Fuse every maximal run of contiguous selected clips into one clip
 *          per run via `concatenateClips`, reusing the primitive's fast path
 *          (re-slice when the second clip is a direct sample continuation of
 *          the first) or its general path (PCM concatenation into a fresh
 *          resource).
 * How: Applies when at least one selection run has ≥ 2 clips. Execute
 *      left-folds `concatenateClips` across every mergable run and returns
 *      a Selection bound to the one id per run that survived the fold.
 *
 ******************************************************************************/
import type { Selection } from "../../src/domain/selection/selection.js";
import { Selection as SelectionNS } from "../../src/domain/selection/selection.js";
import type { Clip } from "../../src/domain/clip.js";
import type { ClipId } from "../../src/domain/identifiers.js";
import type { Project } from "../../src/domain/project.js";
import { concatenateClips } from "../../src/domain/clip-operations.js";
import { findContiguousRuns } from "../../src/domain/selection/contiguous-runs.js";
import { commitSelectionTransition, type MenuEnv, type MenuOperation } from "../menu-operation.js";
import { createNextClipId } from "../clip-id.js";
import { makeClipSampleDeps } from "../clip-sample-deps.js";

function mergableRuns(sel: Selection): readonly Clip[][] {
  return findContiguousRuns(sel).filter((run) => run.length >= 2);
}

class MergeOperation implements MenuOperation {
  readonly name = "Merge";
  readonly shortcut = "m";

  applies(sel: Selection): boolean {
    return mergableRuns(sel).length > 0;
  }

  async execute(sel: Selection, env: MenuEnv) {
    const runs = mergableRuns(sel);
    const label = runs.length <= 1 ? "Merge clips" : `Merge ${runs.length} contiguous groups`;
    const deps = makeClipSampleDeps();

    return commitSelectionTransition(
      label,
      () => {
        let project: Project = sel.project;
        const survivorIds: ClipId[] = [];
        for (const run of runs) {
          let mergedClip = run[0]!;
          for (let i = 1; i < run.length; i += 1) {
            const next = run[i]!;
            const result = concatenateClips(project, mergedClip, next, deps, createNextClipId);
            project = result.project;
            mergedClip = result.clip;
          }
          survivorIds.push(mergedClip.id);
        }
        return SelectionNS.of(project, survivorIds);
      },
      env.elements,
    ) ?? "cancelled";
  }
}

export const mergeOperation = new MergeOperation();
