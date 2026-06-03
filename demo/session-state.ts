/******************************* session-state.ts *****************************
 *
 * Purpose: Group the fields that together identify the working session. These
 *          fields were previously scattered at the top level of `demoState`
 *          with a `session` prefix; the co-usage test revealed them as a
 *          single concept (persist, autosave, history, permissions all touch
 *          the same subset), so they now live under `demoState.session` with
 *          the redundant prefix dropped.
 * How: Pure type — operations on `SessionState` live in the concept modules
 *      that read/write its fields (session-persist, session-history,
 *      session-autosave, session-permissions, session-chrome). The only
 *      behaviour here is `createInitialSessionState`, used by state.ts to
 *      seed the default value.
 *
 ******************************************************************************/
import type { SessionDocument } from "./session-document.js";

/**
 * Purpose: Identify the working session as a single, named entity.
 */
export type SessionState = {
  /** Stable id for this browser tab, used for writer/view lease arbitration. */
  tabId: string;
  /** Unique id of the session currently open. */
  id: string;
  /** Human-readable name shown in UI / URL / window title. */
  name: string;
  /** Content revision hash, null when the session has never been persisted. */
  revision: string | null;
  /** True when the session is tracked in the local workspace (IndexedDB). */
  inWorkspace: boolean;
  /** Whether this tab holds the writer lease or is following another tab's writes. */
  accessMode: "writer" | "follower";
  /** Undo stack of session documents, most recent last. */
  historyPast: SessionDocument[];
  /** Redo stack of session documents, most recent first. */
  historyFuture: SessionDocument[];
};

/**
 * Purpose: Seed the initial SessionState used by demoState at module load.
 * How: Empty tabId (main.ts assigns one), the `demo-v0` default session id,
 *      default name, no revision yet, not in the workspace, writer access,
 *      empty undo/redo stacks.
 */
export function createInitialSessionState(
  sessionId: string,
  sessionName: string,
): SessionState {
  return {
    tabId: "",
    id: sessionId,
    name: sessionName,
    revision: null,
    inWorkspace: false,
    accessMode: "writer",
    historyPast: [],
    historyFuture: [],
  };
}
