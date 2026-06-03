/****************************** session-history.ts ****************************
 *
 * Purpose: Snapshot, commit, and transition the editable session document for
 *          undo/redo. Owns the past/future history arrays and exposes the
 *          operations that push/pop them plus a small UI helper that keeps
 *          the session drag handle in sync with the current project. Does
 *          NOT handle the replay path (undo/redo apply) — that stays in
 *          interactions.ts for now because it orchestrates transport, FX
 *          recompilation, track audio, and waveform invalidation.
 * How: The history lives on `demoState.session.historyPast` /
 *      `demoState.session.historyFuture`. Callers obtain a snapshot of the
 *      current state via `createCurrentSessionDocument`, mutate the project,
 *      then commit with `commitCurrentSessionDocumentChange` which pushes
 *      the previous snapshot to `past`, clears `future`, and triggers a
 *      render + autosave. `applySessionDocumentTransition` wraps that flow
 *      for pure-function transitions.
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import type { Project } from "../src/domain/project.js";
import { getProjectMixEndCoord } from "../src/domain/project.js";
import { demoState } from "./state.js";
import {
  areSessionDocumentsEqual,
  computeSessionDocumentRevision,
  createSessionDocument,
  type SessionDocument,
} from "./session-document.js";
import { pushRenderLog, render } from "./daw-render/daw-render-runtime.js";
import { scheduleWorkingSessionAutosave } from "./session-autosave.js";

/**
 * Purpose: Snapshot the current project + track state + transform chain into a SessionDocument.
 * How: Forward the relevant demoState slices to createSessionDocument.
 */
export function createCurrentSessionDocument(): SessionDocument {
  return createSessionDocument(
    demoState.project,
    demoState.trackPlayers,
    demoState.masterLevel,
    demoState.clipOnsetAnnotations,
    demoState.transformChain,
  );
}

/**
 * Purpose: Drop the entire undo/redo history.
 * How: Reset both past and future arrays. Used when a fresh session is loaded.
 */
export function clearSessionHistory(): void {
  demoState.session.historyPast = [];
  demoState.session.historyFuture = [];
}

/**
 * Purpose: Derive and cache the current session revision hash into demoState.
 * How: Call computeSessionDocumentRevision on the given document (or the
 *      current snapshot if omitted) and store the result in demoState.session.revision.
 */
export function syncCurrentSessionRevision(
  sessionDocument: SessionDocument = createCurrentSessionDocument(),
): string {
  const revision = computeSessionDocumentRevision(sessionDocument);
  demoState.session.revision = revision;
  return revision;
}

/**
 * Purpose: Keep the session drag handle enabled only when the project has
 *          audible content.
 * How: Disable the handle when `getProjectMixEndCoord` returns zero.
 */
export function syncSessionDragHandleState(elements: Elements): void {
  elements.sessionDragHandle.disabled = getProjectMixEndCoord(demoState.project) <= 0;
}

/**
 * Purpose: Commit a change between `previousSessionDocument` and the current state.
 * How: Compare before/after; if unchanged, just re-render. Otherwise push the
 *      previous snapshot to `past`, clear `future`, sync the revision, log the
 *      label, update the session drag handle state, re-render, and schedule
 *      the working-session autosave. Returns whether the document actually
 *      changed so callers can skip follow-up work.
 */
export function commitCurrentSessionDocumentChange(
  label: string,
  previousSessionDocument: SessionDocument,
  elements: Elements,
): boolean {
  const nextSessionDocument = createCurrentSessionDocument();
  if (areSessionDocumentsEqual(previousSessionDocument, nextSessionDocument)) {
    render(elements);
    return false;
  }
  demoState.session.historyPast = [...demoState.session.historyPast, previousSessionDocument];
  demoState.session.historyFuture = [];
  syncCurrentSessionRevision(nextSessionDocument);
  pushRenderLog(label);
  syncSessionDragHandleState(elements);
  render(elements);
  scheduleWorkingSessionAutosave(elements);
  return true;
}

/**
 * Purpose: Persist the current document state without pushing an undo entry.
 * How: Same side effects as `commitCurrentSessionDocumentChange` (revision
 *      sync, UI affordances, re-render, autosave) but skips the
 *      `historyPast` push. Used by sub-tools that own their own undo
 *      scope and shouldn't pollute the project-level pile (e.g. chain
 *      ops, library ops). The caller is responsible for tracking the
 *      change in its own scope ; this function only handles persistence.
 */
export function persistCurrentSessionDocument(elements: Elements): void {
  syncCurrentSessionRevision();
  syncSessionDragHandleState(elements);
  render(elements);
  scheduleWorkingSessionAutosave(elements);
}

/**
 * Purpose: Apply a pure project transition atomically and commit it as one history step.
 * How: Snapshot the current document, run the transition to produce the next
 *      project, then commit. On error, log and re-render without committing.
 */
export function applySessionDocumentTransition(
  label: string,
  transition: () => Project,
  elements: Elements,
): boolean {
  const previousSessionDocument = createCurrentSessionDocument();
  try {
    demoState.project = transition();
    return commitCurrentSessionDocumentChange(label, previousSessionDocument, elements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushRenderLog(`ERROR: ${message}`);
    render(elements);
    return false;
  }
}
