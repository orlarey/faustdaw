/********************************* rename.ts **********************************
 *
 * Purpose: Rename the single clip in the selection, prompting the user for
 *          the new name and committing the change as one undo entry.
 * How: Applies only when exactly one clip is selected. Execute reads the
 *      current name, prompts the user with a suggested default, returns
 *      "cancelled" on dialog dismissal or no-op (same name), otherwise
 *      commits the project transition via `renameClip`.
 *
 ******************************************************************************/
import type { Selection } from "../../src/domain/selection/selection.js";
import { Selection as SelectionNS } from "../../src/domain/selection/selection.js";
import { getClip, renameClip } from "../../src/domain/clip.js";
import { commitSelectionTransition, type MenuEnv, type MenuOperation } from "../menu-operation.js";
import { getClipDisplayName } from "../clip-display-name.js";

class RenameOperation implements MenuOperation {
  readonly name = "Rename";

  applies(sel: Selection): boolean {
    return sel.size === 1;
  }

  async execute(sel: Selection, env: MenuEnv) {
    const clipId = sel.primaryClipId!;
    const clip = getClip(sel.project, clipId);
    const currentName = clip.name?.trim() ?? "";
    const suggestedName = currentName || getClipDisplayName(clip);
    const nextName = window.prompt(
      `Rename clip "${getClipDisplayName(clip)}"`,
      suggestedName,
    );
    if (nextName === null) {
      return "cancelled";
    }
    const normalizedName = nextName.trim();
    if (normalizedName === currentName) {
      return "cancelled";
    }

    const label = normalizedName
      ? `Rename clip "${clipId}" to "${normalizedName}"`
      : `Clear clip name "${clipId}"`;

    return commitSelectionTransition(
      label,
      () => {
        const project = renameClip(sel.project, clipId, normalizedName || null);
        return SelectionNS.of(project, [clipId]);
      },
      env.elements,
    ) ?? "cancelled";
  }
}

export const renameOperation = new RenameOperation();
