/**************************** open-transform-panel.ts *************************
 *
 * Purpose: Open the Faust Transform overlay for the single selected clip. Pure
 *          UI action — the panel handles preview, apply, and close itself.
 * How: Applies when exactly one clip is selected. Execute calls
 *      `openTransformPanel`; no project change, no history entry.
 *
 ******************************************************************************/
import type { Selection } from "../../src/domain/selection/selection.js";
import { openTransformPanel } from "../faust-transform/faust-transform-panel.js";
import type { MenuOperation } from "../menu-operation.js";

class OpenTransformPanelOperation implements MenuOperation {
  readonly name = "Transform with Faust";
  readonly shortcut = "t";
  readonly needsWriteAccess = false;

  applies(sel: Selection): boolean {
    return sel.size === 1;
  }

  async execute(sel: Selection) {
    openTransformPanel();
    return sel;
  }
}

export const openTransformPanelOperation = new OpenTransformPanelOperation();
