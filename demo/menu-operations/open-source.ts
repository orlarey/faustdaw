/******************************** open-source.ts ******************************
 *
 * Purpose: Open the source workspace session that produced the targeted
 *          clip's audio in a new browser tab. Pure UI action — no project
 *          change, no history entry.
 * How: Look up the clip-context target's session-render link; if it's still
 *      linked to a workspace session, open the session navigation URL in a
 *      new tab. Surface a footer error when the browser blocks the open.
 *
 ******************************************************************************/
import type { Selection } from "../../src/domain/selection/selection.js";
import { demoState } from "../state.js";
import { render, pushRenderLog } from "../daw-render/daw-render-runtime.js";
import { getClipContextTargetSessionRenderState } from "../clip-context-target.js";
import { getSessionNavigationUrl } from "../session-chrome.js";
import type { MenuEnv, MenuOperation } from "../menu-operation.js";

class OpenSourceOperation implements MenuOperation {
  readonly name = "Open Source Session";
  readonly needsWriteAccess = false;

  applies(sel: Selection): boolean {
    const s = getClipContextTargetSessionRenderState();
    return sel.size === 1 && !!(s?.isLinked);
  }

  async execute(sel: Selection, env: MenuEnv) {
    const state = getClipContextTargetSessionRenderState();
    if (!state?.isLinked) return "cancelled";

    const openedWindow = window.open(
      getSessionNavigationUrl(state.sessionRender.sourceSessionId),
      "_blank",
      "noopener",
    );
    if (!openedWindow) {
      const message = `Unable to open source session "${state.sessionRender.sourceSessionName}"`;
      demoState.footer.setStatus(message, "error");
      pushRenderLog(`ERROR: ${message}`);
      render(env.elements);
    }
    return sel;
  }
}

export const openSourceOperation = new OpenSourceOperation();
