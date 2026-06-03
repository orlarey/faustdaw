/********************************* menu-operation.ts **************************
 *
 * Purpose: Uniform shape of a context-menu operation and the helper that
 *          commits a selection/project transition as one atomic undo entry.
 * How: Each operation is a self-contained record `{ name, shortcut?, applies,
 *      execute }` taking `(Selection, MenuEnv)` and returning either the new
 *      Selection (which carries the new Project) or the `"cancelled"` sentinel
 *      when the user aborted. The menu dispatcher interrogates `applies` to
 *      gate the button, runs `execute` on click, and re-renders on completion.
 *      `commitSelectionTransition` is the shared commit helper: it atomically
 *      mirrors the new selection into demoState, invalidates waveform caches,
 *      and wraps the project update in `applySessionDocumentTransition` so the
 *      whole transition becomes one history step.
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import type { Selection } from "../src/domain/selection/selection.js";
import type { TimeCoord } from "../src/domain/timebase.js";
import { demoState } from "./state.js";
import { applySessionDocumentTransition } from "./session-history.js";
import { writeSelectionToDemoState } from "./selection-state.js";
import { invalidateWaveformSlidingBuffers } from "./daw-render/daw-render-runtime.js";

/**
 * Purpose: Ambient context a menu operation may read during applies/execute.
 * How: Carry the cut marker coordinate (needed by Split) and the DOM element
 *      bundle (needed by committing ops for render / autosave).
 */
export type MenuEnv = {
  readonly cutCoord: TimeCoord;
  readonly elements: Elements;
};

/** Return value of `execute`: the new Selection when applied, else the abort sentinel. */
export type MenuExecuteResult = Selection | "cancelled";

/**
 * Purpose: Contract implemented by every context-menu entry.
 * How: `applies` gates the button in the DOM; `execute` runs on click (or
 *      shortcut). `needsWriteAccess` (default true) lets the dispatcher skip
 *      the op in read-only sessions before even calling execute. Concrete
 *      operations live as classes in `menu-operations/` that `implements`
 *      this contract.
 */
export interface MenuOperation {
  readonly name: string;
  readonly shortcut?: string | readonly string[];
  readonly needsWriteAccess?: boolean;
  applies(sel: Selection, env: MenuEnv): boolean;
  execute(sel: Selection, env: MenuEnv): Promise<MenuExecuteResult>;
}

/**
 * Purpose: Atomically commit one selection/project transition as a single
 *          undo entry, returning the Selection the transition produced, or
 *          `null` if the transition threw (already logged by the caller).
 * How: Invalidate waveform caches and mark the clip-render pipeline dirty so
 *      the upcoming render re-derives from the new project. Then run the
 *      caller's transition inside `applySessionDocumentTransition`, writing
 *      the new Selection into demoState before the commit reads it — so the
 *      session-document snapshot captures (new project, new selection)
 *      together.
 */
export function commitSelectionTransition(
  label: string,
  transition: () => Selection,
  elements: Elements,
): Selection | null {
  demoState.clipRenderStable.dirty = true;
  invalidateWaveformSlidingBuffers();
  let result: Selection | null = null;
  applySessionDocumentTransition(
    label,
    () => {
      result = transition();
      writeSelectionToDemoState(result);
      return result.project;
    },
    elements,
  );
  return result;
}
