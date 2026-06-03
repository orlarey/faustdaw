/********************************* notify-read-only.ts ************************
 *
 * Purpose: Guard helper used before any write action — return true when the
 *          current tab holds writer access, or surface a footer error and
 *          re-render when the session is read-only.
 * How: Delegate the access check to `canCurrentTabWriteSession`. On read-only,
 *      push a contextual message to the footer status and trigger a render so
 *      the user sees the explanation immediately.
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import { demoState } from "./state.js";
import { canCurrentTabWriteSession } from "./session-permissions.js";
import { render } from "./daw-render/daw-render-runtime.js";

export function notifyReadOnlySession(elements: Elements): boolean {
  if (canCurrentTabWriteSession()) {
    return true;
  }
  demoState.footer.setStatus(
    `Session "${demoState.session.name}" is open read-only in this tab`,
    "error",
  );
  render(elements);
  return false;
}
