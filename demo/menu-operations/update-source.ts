/******************************* update-source.ts *****************************
 *
 * Purpose: Re-import the targeted clip from its source workspace session when
 *          the session render link is stale (the source has been modified
 *          since the render was made). Large async flow that touches session
 *          archive loading, offline mixdown, resource replacement, and waveform
 *          building — so the actual work is registered from interactions.ts
 *          via `registerUpdateSourceHandler`; this op just invokes the hook.
 * How: Applies when the target clip has a stale session-render link. Execute
 *      defers to the registered handler and returns the (unchanged) selection
 *      — the handler itself commits the project transition it produces.
 *
 ******************************************************************************/
import type { Selection } from "../../src/domain/selection/selection.js";
import { getClipContextTargetSessionRenderState } from "../clip-context-target.js";
import type { MenuEnv, MenuOperation } from "../menu-operation.js";

type UpdateSourceHandler = (env: MenuEnv) => Promise<void>;

let handler: UpdateSourceHandler | null = null;

/**
 * Purpose: Register the wireEvents-local async flow that fetches and applies
 *          the refreshed source-session render to the targeted clip.
 * How: Called once from wireEvents. The handler closes over the many local
 *      helpers (import reporter, mixdown renderer, waveform queue) that
 *      would be costly to extract individually.
 */
export function registerUpdateSourceHandler(fn: UpdateSourceHandler): void {
  handler = fn;
}

class UpdateSourceOperation implements MenuOperation {
  readonly name = "Update From Source Session";

  applies(sel: Selection): boolean {
    const s = getClipContextTargetSessionRenderState();
    return sel.size === 1 && !!(s?.isLinked) && !!(s?.isStale);
  }

  async execute(sel: Selection, env: MenuEnv) {
    if (!handler) return "cancelled";
    await handler(env);
    return sel;
  }
}

export const updateSourceOperation = new UpdateSourceOperation();
