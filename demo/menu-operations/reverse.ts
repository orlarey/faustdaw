/******************************** reverse.ts **********************************
 *
 * Purpose: Replace every selected clip with a time-reversed copy at the same
 *          timeline position via `reverseClip`.
 * How: Applies when the selection is non-empty. Execute iterates the
 *      selected clips, delegates PCM work to `reverseClip`, and returns a
 *      Selection bound to the newly-created reversed clip ids.
 *
 ******************************************************************************/
import type { Selection } from "../../src/domain/selection/selection.js";
import { Selection as SelectionNS } from "../../src/domain/selection/selection.js";
import type { ClipId } from "../../src/domain/identifiers.js";
import type { Project } from "../../src/domain/project.js";
import { reverseClip } from "../../src/domain/clip-operations.js";
import { commitSelectionTransition, type MenuEnv, type MenuOperation } from "../menu-operation.js";
import { createNextClipId } from "../clip-id.js";
import { makeClipSampleDeps } from "../clip-sample-deps.js";

class ReverseOperation implements MenuOperation {
  readonly name = "Reverse";
  readonly shortcut = "r";

  applies(sel: Selection): boolean {
    return !sel.isEmpty;
  }

  async execute(sel: Selection, env: MenuEnv) {
    const label = sel.size === 1 ? "Reverse clip" : `Reverse ${sel.size} clips`;
    const deps = makeClipSampleDeps();

    return commitSelectionTransition(
      label,
      () => {
        let project: Project = sel.project;
        const reversedIds: ClipId[] = [];
        for (const clip of sel.clips()) {
          const result = reverseClip(project, clip, deps, createNextClipId);
          project = result.project;
          reversedIds.push(result.clip.id);
        }
        return SelectionNS.of(project, reversedIds);
      },
      env.elements,
    ) ?? "cancelled";
  }
}

export const reverseOperation = new ReverseOperation();
