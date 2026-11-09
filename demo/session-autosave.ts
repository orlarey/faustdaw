/**************************** session-autosave.ts *****************************
 *
 * Purpose: Autosave scheduling and state for the working session archive and
 *          the session view state. Owns the debounce timer, the in-flight
 *          archive persistence promise, the view-state interval, and the
 *          last-persisted view-state cache. Delegates the archive
 *          materialization itself to `persistWorkingSessionArchiveNow` in
 *          session-persist.ts (imported directly — both modules reference each
 *          other, but ESM tolerates the cycle since values are only accessed
 *          in function bodies).
 * How: Module-private state tracks the timer, promises, and interval ids.
 *      `scheduleWorkingSessionAutosave` and `flushPendingWorkingSessionAutosave`
 *      call persistWorkingSessionArchiveNow directly — consumers no longer
 *      need to inject a persist callback. The view-state autosave is
 *      self-contained: it captures and persists the view state directly via
 *      session-view-state / session-workspace.
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import { demoState } from "./state.js";
import { canCurrentTabWriteSession } from "./session-permissions.js";
import { persistWorkingSessionArchiveNow } from "./session-persist.js";
import {
  areSessionViewStatesEqual,
  captureSessionViewState,
  type SessionViewState,
} from "./session-view-state.js";
import { saveWorkingSessionViewState } from "./session-workspace.js";
import { normalizeErrorMessage } from "./error-message.js";


const WORKING_SESSION_AUTOSAVE_DELAY_MS = 400;
const SESSION_VIEW_STATE_AUTOSAVE_INTERVAL_MS = 1_500;

// ---------------------------------------------------------------------------
// Module-private state
// ---------------------------------------------------------------------------

let workingSessionAutosaveTimeoutId: number | null = null;
let workingSessionAutosavePromise: Promise<void> | null = null;
let workingSessionAutosaveQueued = false;
let sessionViewStateAutosavePromise: Promise<void> | null = null;
let sessionViewStateAutosaveIntervalId: number | null = null;
let lastPersistedSessionViewState: SessionViewState | null = null;
let lastPersistedSessionViewStateSessionId: string | null = null;

// ---------------------------------------------------------------------------
// Working-session archive autosave
// ---------------------------------------------------------------------------

/**
 * Purpose: Schedule a debounced autosave of the working session archive.
 * How: Replace any pending timeout; after the delay, hand off to
 *      `runWorkingSessionAutosave`, which queues one more pass if a save is
 *      already in flight.
 */
export function scheduleWorkingSessionAutosave(elements?: Elements): void {
  if (workingSessionAutosaveTimeoutId !== null) {
    window.clearTimeout(workingSessionAutosaveTimeoutId);
  }
  workingSessionAutosaveTimeoutId = window.setTimeout(() => {
    workingSessionAutosaveTimeoutId = null;
    runWorkingSessionAutosave(elements).catch((error) => {
      console.warn("[webdaw] working-session autosave failed", normalizeErrorMessage(error));
    });
  }, WORKING_SESSION_AUTOSAVE_DELAY_MS);
}

/**
 * Purpose: Single entry point for every working-session archive save, so at
 *          most one save is in flight and the last one always captures the
 *          newest state.
 * How: If a save is running, flag one more pass and return the running loop.
 *      Otherwise start the loop; the returned promise settles with the first
 *      pass (so callers see its error), while queued passes keep draining in
 *      the tracked loop.
 */
function runWorkingSessionAutosave(elements?: Elements): Promise<void> {
  if (workingSessionAutosavePromise) {
    workingSessionAutosaveQueued = true;
    return workingSessionAutosavePromise;
  }
  workingSessionAutosaveQueued = false;
  const firstPass = persistWorkingSessionArchiveNow(elements);
  workingSessionAutosavePromise = (async () => {
    try {
      await firstPass;
    } catch {
      // Reported by the caller of runWorkingSessionAutosave.
    }
    while (workingSessionAutosaveQueued) {
      workingSessionAutosaveQueued = false;
      try {
        await persistWorkingSessionArchiveNow(elements);
      } catch (error) {
        console.warn("[webdaw] working-session autosave failed", normalizeErrorMessage(error));
      }
    }
  })().finally(() => {
    workingSessionAutosavePromise = null;
  });
  return firstPass;
}

export async function flushPendingWorkingSessionAutosave(elements?: Elements): Promise<void> {
  const hadPendingEdit = workingSessionAutosaveTimeoutId !== null;
  if (workingSessionAutosaveTimeoutId !== null) {
    window.clearTimeout(workingSessionAutosaveTimeoutId);
    workingSessionAutosaveTimeoutId = null;
  }
  if (workingSessionAutosavePromise) {
    // The in-flight save snapshotted its state before the pending edit:
    // request one more pass and wait for the whole loop to drain.
    if (hadPendingEdit) {
      workingSessionAutosaveQueued = true;
    }
    await workingSessionAutosavePromise;
    return;
  }
  if (!demoState.session.inWorkspace) {
    return;
  }
  await runWorkingSessionAutosave(elements);
}

/**
 * Purpose: True iff an autosave is debounced or in flight.
 * How: Check both the timeout handle and the in-flight promise.
 */
export function isWorkingSessionAutosavePending(): boolean {
  return workingSessionAutosaveTimeoutId !== null || workingSessionAutosavePromise !== null;
}

/**
 * Purpose: Stop the debounce timer and await any in-flight autosave.
 * How: Used during session close. Swallows autosave errors since the session
 *      is about to be removed.
 */
export async function cancelWorkingSessionAutosave(): Promise<void> {
  if (workingSessionAutosaveTimeoutId !== null) {
    window.clearTimeout(workingSessionAutosaveTimeoutId);
    workingSessionAutosaveTimeoutId = null;
  }
  if (workingSessionAutosavePromise) {
    try {
      await workingSessionAutosavePromise;
    } catch {
      // Ignore autosave failures during close.
    }
  }
}

// ---------------------------------------------------------------------------
// Session view-state autosave
// ---------------------------------------------------------------------------

/**
 * Purpose: Persist the current session view state if it differs from the last one persisted.
 * How: Bail if the tab is read-only, or if a working-session autosave is in
 *      flight (that autosave persists the view state too). Capture the
 *      current view state and compare to the last persisted value;
 *      persist only when changed.
 */
async function persistCurrentSessionViewStateNow(): Promise<void> {
  if (!demoState.session.inWorkspace || !canCurrentTabWriteSession()) {
    return;
  }
  if (isWorkingSessionAutosavePending()) {
    return;
  }
  const sessionId = demoState.session.id;
  const sessionViewState = captureSessionViewState(demoState.project);
  if (
    lastPersistedSessionViewStateSessionId === sessionId
    && areSessionViewStatesEqual(lastPersistedSessionViewState, sessionViewState)
  ) {
    return;
  }
  await saveWorkingSessionViewState(sessionId, sessionViewState);
  if (demoState.session.id === sessionId) {
    lastPersistedSessionViewStateSessionId = sessionId;
    lastPersistedSessionViewState = sessionViewState;
  }
}

/**
 * Purpose: Queue one view-state autosave, dropping additional requests while one is in flight.
 * How: Guard with `sessionViewStateAutosavePromise`; replay errors as warnings.
 */
export function queueCurrentSessionViewStateAutosave(): void {
  if (sessionViewStateAutosavePromise !== null) {
    return;
  }
  sessionViewStateAutosavePromise = (async () => {
    try {
      await persistCurrentSessionViewStateNow();
    } catch (error) {
      console.warn("[webdaw] session-view autosave failed", normalizeErrorMessage(error));
    }
  })().finally(() => {
    sessionViewStateAutosavePromise = null;
  });
}

/**
 * Purpose: Start the periodic session view-state autosave interval.
 * How: Run `queueCurrentSessionViewStateAutosave` every
 *      SESSION_VIEW_STATE_AUTOSAVE_INTERVAL_MS while the session is in the
 *      workspace and the tab holds writer access and is visible. No-op if
 *      an interval is already running.
 */
export function startSessionViewStateAutosaveInterval(): void {
  if (
    sessionViewStateAutosaveIntervalId !== null
    || !demoState.session.inWorkspace
    || demoState.session.accessMode !== "writer"
  ) {
    return;
  }
  sessionViewStateAutosaveIntervalId = window.setInterval(() => {
    if (!demoState.session.inWorkspace || demoState.session.accessMode !== "writer") {
      stopSessionViewStateAutosaveInterval();
      return;
    }
    if (document.hidden) {
      return;
    }
    queueCurrentSessionViewStateAutosave();
  }, SESSION_VIEW_STATE_AUTOSAVE_INTERVAL_MS);
}

/**
 * Purpose: Stop the periodic session view-state autosave interval.
 * How: Clear the interval handle if one is running.
 */
export function stopSessionViewStateAutosaveInterval(): void {
  if (sessionViewStateAutosaveIntervalId !== null) {
    window.clearInterval(sessionViewStateAutosaveIntervalId);
    sessionViewStateAutosaveIntervalId = null;
  }
}

// ---------------------------------------------------------------------------
// Persisted view-state cache (shared with the archive persist path)
// ---------------------------------------------------------------------------

/**
 * Purpose: Record the view state just written to durable storage by the
 *          archive persist path or the session restore path, so
 *          `queueCurrentSessionViewStateAutosave` can skip redundant writes.
 */
export function markPersistedSessionViewState(sessionId: string, state: SessionViewState): void {
  lastPersistedSessionViewStateSessionId = sessionId;
  lastPersistedSessionViewState = state;
}
