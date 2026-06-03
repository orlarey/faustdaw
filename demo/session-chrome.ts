/******************************* session-chrome.ts ****************************
 *
 * Purpose: UI-level session chrome — the browser address bar (session URL),
 *          the tab title, the session dropdown menu, writer/follower access
 *          mode, and the session-combo list populated from the workspace.
 *          Collects the pure-UI helpers needed by session lifecycle and
 *          persist paths so they can import them directly instead of taking
 *          them as callbacks.
 * How: All functions mutate either demoState.session / demoState.workspaceSessions
 *      or the bound DOM elements. listLocalSessions is imported directly from
 *      session-workspace; the menu re-population + workspace-sessions mirror
 *      is a single refreshWorkspaceControls operation.
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import { demoState } from "./state.js";
import { listLocalSessions } from "./session-workspace.js";
import { syncSessionDragHandleState } from "./session-history.js";
import { render } from "./daw-render/daw-render-runtime.js";

/**
 * Purpose: Reflect the given session id in the address bar's `?session=` param,
 *          or remove it when sessionId is null. When `draft` is true and there
 *          is no session id, write `?draft=1` instead.
 * How: Compare current URL to target state; no-op if already matching; otherwise
 *      replace the history entry.
 */
export function syncSessionUrl(sessionId: string | null, draft = false): void {
  const url = new URL(window.location.href);
  const currentSessionId = url.searchParams.get("session");
  const currentDraft = url.searchParams.get("draft") === "1";
  if (currentSessionId === sessionId && currentDraft === draft) {
    return;
  }
  writeSessionUrlParams(url, sessionId, draft);
  window.history.replaceState({}, "", url);
}

/**
 * Purpose: Build the URL a navigation should target for the given session id.
 * How: Reuse the same URL-param logic as syncSessionUrl but return the string
 *      instead of replacing the current history entry.
 */
export function getSessionNavigationUrl(sessionId: string | null, draft = false): string {
  const url = new URL(window.location.href);
  writeSessionUrlParams(url, sessionId, draft);
  return url.toString();
}

/**
 * Purpose: Reflect the current session name in the browser tab's title.
 */
export function syncSessionNameChrome(): void {
  document.title = `${demoState.session.name} - WebDAW`;
}

/**
 * Purpose: Apply the writer/follower access mode and project it into the
 *          UI — disable the track/master sliders and the session name input
 *          in follower mode. Optionally set a footer status message and
 *          re-render when the mode actually changed.
 */
export function setSessionAccessMode(
  mode: "writer" | "follower",
  elements: Elements,
  footerMessage?: string | null,
): void {
  const previousMode = demoState.session.accessMode;
  demoState.session.accessMode = mode;
  elements.sessionNameInput.disabled = demoState.session.inWorkspace && mode === "follower";
  const editingEnabled = mode === "writer";
  for (const button of elements.trackMuteButtons) {
    button.disabled = !editingEnabled;
  }
  for (const button of elements.trackSoloButtons) {
    button.disabled = !editingEnabled;
  }
  for (const slider of elements.trackVolumeSliders) {
    slider.disabled = !editingEnabled;
  }
  for (const slider of elements.trackPanSliders) {
    slider.disabled = !editingEnabled;
  }
  elements.masterVolumeSlider.disabled = !editingEnabled;
  if (previousMode === mode && footerMessage === undefined) {
    return;
  }
  if (footerMessage !== undefined) {
    demoState.footer.setStatus(footerMessage);
  }
  render(elements);
}

/** Hide the session dropdown menu. */
export function closeSessionMenu(elements: Elements): void {
  elements.sessionMenu.hidden = true;
  elements.sessionMenuButton.setAttribute("aria-expanded", "false");
}

/** Show the session dropdown menu. */
export function openSessionMenu(elements: Elements): void {
  elements.sessionMenu.hidden = false;
  elements.sessionMenuButton.setAttribute("aria-expanded", "true");
}

/**
 * Purpose: Repopulate the session-combo dropdown from the local workspace and
 *          mirror the list into demoState.workspaceSessions. Also refreshes
 *          the session name input, delete button, drag handle, and tab title.
 */
export async function refreshSessionWorkspaceControls(elements: Elements): Promise<void> {
  const sessions = await listLocalSessions();
  const sessionOptions = !demoState.session.inWorkspace
    ? sessions
    : sessions.some((session) => session.sessionId === demoState.session.id)
    ? sessions
    : [{
      sessionId: demoState.session.id,
      sessionName: demoState.session.name,
      sessionRevision: demoState.session.revision,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastOpenedAt: Date.now(),
      writerTabId: null,
      writerLeaseExpiresAt: null,
      viewLeases: [],
    }, ...sessions];
  demoState.workspaceSessions = new Map(
    sessionOptions.map((session) => [session.sessionId, {
      sessionName: session.sessionName,
      sessionRevision: session.sessionRevision ?? null,
    }]),
  );
  elements.sessionMenu.replaceChildren(
    ...sessionOptions.map((session) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "session-combo-item";
      item.dataset.sessionId = session.sessionId;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", session.sessionId === demoState.session.id ? "true" : "false");
      item.textContent = session.sessionName;
      return item;
    }),
    (() => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "session-combo-item session-combo-item-create";
      item.dataset.sessionId = "__new__";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.textContent = "+ New Session";
      return item;
    })(),
  );
  elements.sessionNameInput.value = demoState.session.name;
  elements.sessionNameInput.disabled = demoState.session.inWorkspace && demoState.session.accessMode === "follower";
  elements.deleteSessionButton.disabled = !demoState.session.inWorkspace;
  syncSessionDragHandleState(elements);
  syncSessionNameChrome();
}

function writeSessionUrlParams(url: URL, sessionId: string | null, draft: boolean): void {
  if (sessionId) {
    url.searchParams.set("session", sessionId);
    url.searchParams.delete("draft");
  } else {
    url.searchParams.delete("session");
    if (draft) {
      url.searchParams.set("draft", "1");
    } else {
      url.searchParams.delete("draft");
    }
  }
}
