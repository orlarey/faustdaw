/*************************** session-permissions.ts ***************************
 *
 * Purpose: Session write-lock permission check.
 * How: A session that lives in the workspace may be opened read-only by
 *      another tab; this returns true only when the current tab is allowed
 *      to mutate the session. A standalone (non-workspace) session is
 *      always writable.
 *
 ******************************************************************************/
import { demoState } from "./state.js";

export function canCurrentTabWriteSession(): boolean {
  return !demoState.session.inWorkspace || demoState.session.accessMode === "writer";
}
