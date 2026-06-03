/***************************** clip-context-menu.ts ***************************
 *
 * Purpose: Bind a list of MenuOperation records to the clip context-menu
 *          buttons and dispatch click / shortcut events. The menu is dumb:
 *          it asks each op for its `applies(sel, env)`, enables / disables
 *          the button, and runs `execute(sel, env)` when triggered.
 * How: `wireClipContextMenu(elements, ops)` pairs each operation with its
 *      button (by position — operations are given in the same order as the
 *      buttons) and attaches click + keyboard handlers. `sync(sel)` updates
 *      button disabled state. `handleShortcut(key, sel)` matches the first
 *      operation whose shortcut claim covers the key.
 *
 ******************************************************************************/
import type { Selection } from "../src/domain/selection/selection.js";
import type { Elements } from "./bind-elements.js";
import { getCurrentSelection } from "./selection-state.js";
import { markerManager } from "./marker/marker-manager.js";
import { closeClipContextMenu } from "./clip-context-target.js";
import { notifyReadOnlySession } from "./notify-read-only.js";
import { render } from "./daw-render/daw-render-runtime.js";
import type { MenuEnv, MenuOperation } from "./menu-operation.js";

/**
 * Purpose: Pair each op with the DOM button it drives so the generic menu
 *          does not need to know operation-specific element ids.
 */
type MenuBinding = {
  readonly operation: MenuOperation;
  readonly button: HTMLButtonElement;
};

export class ClipContextMenu {
  private readonly bindings: readonly MenuBinding[];
  private readonly elements: Elements;

  constructor(elements: Elements, bindings: readonly MenuBinding[]) {
    this.bindings = bindings;
    this.elements = elements;
    for (const binding of bindings) {
      binding.button.addEventListener("click", () => {
        void this.dispatch(binding.operation);
      });
    }
  }

  /**
   * Purpose: Update each button's disabled state given the current selection.
   * How: Read the menu env once, then ask every operation if it applies.
   */
  sync(sel: Selection): void {
    const env = this.makeEnv();
    for (const binding of this.bindings) {
      binding.button.disabled = !binding.operation.applies(sel, env);
    }
  }

  /**
   * Purpose: Resolve a keyboard shortcut to an operation and run it.
   * How: Find the first binding whose op claims this key and whose op applies
   *      to the current selection; run it. Return true iff a handler matched.
   */
  handleShortcut(key: string, sel: Selection): boolean {
    const lower = key.toLowerCase();
    const env = this.makeEnv();
    for (const binding of this.bindings) {
      const shortcut = binding.operation.shortcut;
      if (!shortcut) continue;
      const matches = typeof shortcut === "string"
        ? shortcut === lower
        : shortcut.includes(lower);
      if (!matches) continue;
      if (!binding.operation.applies(sel, env)) return false;
      void this.dispatch(binding.operation);
      return true;
    }
    return false;
  }

  /**
   * Purpose: Run one operation: close the menu, guard write access, execute,
   *          and re-render.
   * How: Every committing op uses `commitSelectionTransition` internally, so
   *      demoState is already up to date by the time `execute` resolves.
   */
  private async dispatch(operation: MenuOperation): Promise<void> {
    const sel = getCurrentSelection();
    const env = this.makeEnv();
    if (!operation.applies(sel, env)) return;
    closeClipContextMenu();
    if (operation.needsWriteAccess !== false && !notifyReadOnlySession(this.elements)) {
      return;
    }
    await operation.execute(sel, env);
    render(this.elements);
  }

  private makeEnv(): MenuEnv {
    return {
      cutCoord: markerManager().getCutPosition(),
      elements: this.elements,
    };
  }
}

/**
 * Purpose: Wire the clip context menu from a list of operations paired with
 *          their DOM buttons (positional).
 * How: Build the bindings, construct the menu, and return it so callers can
 *      run `sync` and `handleShortcut` from wireEvents.
 */
export function wireClipContextMenu(
  elements: Elements,
  entries: readonly { operation: MenuOperation; button: HTMLButtonElement }[],
): ClipContextMenu {
  return new ClipContextMenu(elements, entries);
}
