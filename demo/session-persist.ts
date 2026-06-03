/******************************* session-persist.ts ***************************
 *
 * Purpose: Persist the current session archive to the local workspace. Given
 *          the live demoState, build the archive bytes + retained resource
 *          payloads and hand them to `saveWorkingSessionArchive`; then update
 *          demoState identity fields and sync the session chrome (URL / title /
 *          workspace controls / broadcast).
 * How: Depends directly on the already-extracted concepts: session-document,
 *      session-history (document snapshot + revision sync), session-archive
 *      (serialization), session-archive-payload (demoState-aware payload
 *      gathering), session-workspace (durable save), session-autosave (mark
 *      persisted view state), session-chrome (URL / title / workspace
 *      controls), session-broadcast (cross-tab channel), session-render-
 *      materializations (in-flight tracking).
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import { demoState } from "./state.js";
import { canCurrentTabWriteSession } from "./session-permissions.js";
import { buildSessionArchiveBytes } from "./session-archive.js";
import {
  collectFxResourcePayloads,
  collectUsedSessionResourceIds,
  getArchiveResourcePayload,
  buildRetainedSessionResourcePayloads,
} from "./session-archive-payload.js";
import { createCurrentSessionDocument, syncCurrentSessionRevision } from "./session-history.js";
import { captureSessionViewState } from "./session-view-state.js";
import { saveWorkingSessionArchive } from "./session-workspace.js";
import { markPersistedSessionViewState } from "./session-autosave.js";
import { refreshSessionWorkspaceControls, syncSessionNameChrome, syncSessionUrl } from "./session-chrome.js";
import { broadcastWorkspaceSyncMessage } from "./session-broadcast.js";
import { waitForAllPendingMaterializations } from "./session-render-materializations.js";

/**
 * Purpose: Build the current session archive and save it to the local
 *          workspace; then update demoState identity fields and sync chrome.
 * How: Early-return when the tab lacks writer access. Wait for pending session
 *      render materializations so every clip that references a session render
 *      has its bytes available. Snapshot the session document, capture the
 *      view state, gather resource/FX payloads, serialize, and call
 *      saveWorkingSessionArchive. On success, mirror metadata into demoState,
 *      mark the persisted view state (so the periodic view-state autosave
 *      skips redundant writes), update the URL, refresh session controls or
 *      the document title, and broadcast so sibling tabs see the update.
 */
export async function persistWorkingSessionArchiveNow(elements?: Elements): Promise<void> {
  if (demoState.session.inWorkspace && !canCurrentTabWriteSession()) {
    return;
  }
  await waitForAllPendingMaterializations();
  const currentSessionDocument = createCurrentSessionDocument();
  const currentSessionViewState = captureSessionViewState(demoState.project);
  const usedResourceIds = collectUsedSessionResourceIds(currentSessionDocument);
  const sessionArchiveBytes = buildSessionArchiveBytes(
    currentSessionDocument,
    usedResourceIds.map((resourceId) => getArchiveResourcePayload(resourceId)),
    collectFxResourcePayloads(demoState.project),
  );
  const sessionRevision = syncCurrentSessionRevision(currentSessionDocument);
  const metadata = await saveWorkingSessionArchive(demoState.session.id, sessionArchiveBytes, demoState.session.name, {
    sessionRevision,
    sessionViewState: currentSessionViewState,
    retainedResources: buildRetainedSessionResourcePayloads(),
    undoPast: demoState.session.historyPast,
    undoFuture: demoState.session.historyFuture,
  });
  if (!metadata) {
    return;
  }
  markPersistedSessionViewState(metadata.sessionId, currentSessionViewState);
  demoState.session.id = metadata.sessionId;
  demoState.session.name = metadata.sessionName;
  demoState.session.revision = metadata.sessionRevision ?? sessionRevision;
  demoState.session.inWorkspace = true;
  demoState.session.accessMode = metadata.writerTabId === null || metadata.writerTabId === demoState.session.tabId ? "writer" : "follower";
  syncSessionUrl(metadata.sessionId);
  if (elements) {
    elements.sessionNameInput.value = metadata.sessionName;
    void refreshSessionWorkspaceControls(elements);
  } else {
    syncSessionNameChrome();
  }
  broadcastWorkspaceSyncMessage({
    type: "session-updated",
    sessionId: metadata.sessionId,
    sessionRevision: demoState.session.revision,
    fromTabId: demoState.session.tabId,
  });
}
