/********************************* delete.ts **********************************
 *
 * Purpose: Remove every clip in the selection from the project. No PCM work,
 *          no resource changes — just unbind placements from the timeline.
 * How: Applies when the selection is non-empty. Execute clears the onset
 *      annotations of the doomed clips first (the onset editor closes itself
 *      if it was pointing at one of them), then folds `removeClip` over the
 *      selection ids, and finally restarts playback if the transport was
 *      running.
 *
 ******************************************************************************/
import type { Selection } from "../../src/domain/selection/selection.js";
import { Selection as SelectionNS } from "../../src/domain/selection/selection.js";
import { removeClip } from "../../src/domain/clip.js";
import { commitSelectionTransition, type MenuEnv, type MenuOperation } from "../menu-operation.js";
import { clearClipOnsetAnnotationsForClipIds } from "../onset-annotations.js";
import { demoState } from "../state.js";

class DeleteOperation implements MenuOperation {
  readonly name = "Delete";
  readonly shortcut: readonly string[] = ["backspace", "delete"];

  applies(sel: Selection): boolean {
    return !sel.isEmpty;
  }

  async execute(sel: Selection, env: MenuEnv) {
    const label = sel.size === 1
      ? `Remove clip "${sel.primaryClipId}"`
      : `Remove ${sel.size} clips`;
    const clipIds = [...sel.clipIds];
    clearClipOnsetAnnotationsForClipIds(clipIds);

    const result = commitSelectionTransition(
      label,
      () => {
        const project = clipIds.reduce((p, id) => removeClip(p, id), sel.project);
        return SelectionNS.empty(project);
      },
      env.elements,
    );

    if (result !== null) {
      demoState.playbackSession.restartIfNeeded();
    }

    return result ?? "cancelled";
  }
}

export const deleteOperation = new DeleteOperation();
