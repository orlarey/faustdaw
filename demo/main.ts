/********************************** main.ts ************************************
 *
 * Purpose: Bootstrap the demo harness by wiring DOM elements to the DAW domain.
 * How: Bind known HTML elements, register all user interaction handlers, and
 *      trigger the first render pass.
 *
 ******************************************************************************/
import { bindElements } from "./bind-elements.js";
import { installBenchHooks } from "./bench-hooks.js";
import { restoreWorkingSessionIfAvailable, wireEvents } from "./interactions.js";
import { pushRenderLog, render, renderFrame } from "./daw-render/daw-render-runtime.js";
import { computeSessionDocumentRevision, createSessionDocument } from "./session-document.js";
import {
  createLocalSessionId,
  DEFAULT_SESSION_NAME,
  ensureLocalSessionMetadata,
  getLocalSessionMetadata,
  getMostRecentlyOpenedLocalSession,
  touchLocalSessionOpened,
} from "./session-workspace.js";
import { DEFAULT_TIMELINE_VIEW_DURATION, DEFAULT_TIMELINE_ZOOM_LEVEL_INDEX } from "./timeline/render-constants.js";
import { demoState } from "./state.js";
import { clearTabIdReleased, getTabIdentityStorage, markTabIdReleased, resolveTabId } from "./tab-identity.js";
import { initProject } from "../src/domain/project.js";
import { TimelineViewport } from "./view/timeline-viewport.js";


function setApplicationReadyState(isReady: boolean): void {
  document.body.dataset.appReady = isReady ? "true" : "false";
}

function readRequestedSessionId(): string | null {
  const requestedSessionId = new URL(window.location.href).searchParams.get("session")?.trim() ?? "";
  return requestedSessionId || null;
}

function readRequestedDraftMode(): boolean {
  return new URL(window.location.href).searchParams.get("draft") === "1";
}

function syncSessionUrl(sessionId: string | null, draft = false): void {
  const url = new URL(window.location.href);
  const currentSessionId = url.searchParams.get("session");
  const currentDraft = url.searchParams.get("draft") === "1";
  if (currentSessionId === sessionId && currentDraft === draft) {
    return;
  }
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
  window.history.replaceState(null, "", url);
}

async function resolveInitialSession(): Promise<{ sessionId: string; sessionName: string; sessionInWorkspace: boolean; draftMode: boolean }> {
  if (readRequestedDraftMode()) {
    return {
      sessionId: createLocalSessionId(),
      sessionName: DEFAULT_SESSION_NAME,
      sessionInWorkspace: false,
      draftMode: true,
    };
  }
  const requestedSessionId = readRequestedSessionId();
  if (requestedSessionId) {
    const metadata = await getLocalSessionMetadata(requestedSessionId);
    if (metadata) {
      return {
        sessionId: metadata.sessionId,
        sessionName: metadata.sessionName,
        sessionInWorkspace: true,
        draftMode: false,
      };
    }
  }

  const mostRecentSession = await getMostRecentlyOpenedLocalSession();
  if (mostRecentSession) {
    return {
      sessionId: mostRecentSession.sessionId,
      sessionName: mostRecentSession.sessionName,
      sessionInWorkspace: true,
      draftMode: false,
    };
  }

  return {
    sessionId: createLocalSessionId(),
    sessionName: DEFAULT_SESSION_NAME,
    sessionInWorkspace: false,
    draftMode: false,
  };
}

/**
 * Purpose: Initialize the demo application.
 * How: Resolve DOM elements, log readiness, wire event handlers, and render.
 */
async function main(): Promise<void> {
  setApplicationReadyState(false);
  const initialSession = await resolveInitialSession();
  const tabIdentityStorage = getTabIdentityStorage();
  demoState.session.tabId = resolveTabId(
    tabIdentityStorage,
    () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );
  // A reload keeps this id (and so its writer lease); see tab-identity.ts.
  window.addEventListener("pagehide", () => markTabIdReleased(tabIdentityStorage, demoState.session.tabId));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      clearTabIdReleased(tabIdentityStorage);
    }
  });
  demoState.session.id = initialSession.sessionId;
  demoState.session.name = initialSession.sessionName;
  demoState.session.inWorkspace = initialSession.sessionInWorkspace;
  demoState.project = initProject(initialSession.sessionId);
  demoState.viewport = new TimelineViewport({
    viewStartCoord: 0,
    viewDurationCoord: demoState.project.timebase.toTimeCoord(DEFAULT_TIMELINE_VIEW_DURATION),
    zoomLevelIndex: DEFAULT_TIMELINE_ZOOM_LEVEL_INDEX,
    timebase: demoState.project.timebase,
    gridWidthPx: 0,
    gridHeightPx: 0,
  });
  demoState.session.revision = computeSessionDocumentRevision(
    createSessionDocument(demoState.project, demoState.trackPlayers, demoState.masterLevel, demoState.clipOnsetAnnotations),
  );
  syncSessionUrl(initialSession.sessionInWorkspace ? initialSession.sessionId : null, initialSession.draftMode);
  if (initialSession.sessionInWorkspace) {
    void touchLocalSessionOpened(initialSession.sessionId).catch(() => undefined);
  }

  const elements = bindElements();
  let resizeFrameId: number | null = null;
  let previousTimelineWidthPx = 0;

  /**
   * Purpose: Redraw the timeline geometry after the browser viewport changes size.
   * How: Coalesce successive resize events into one animation-frame render so ruler and grid widths are recomputed once per frame.
   */
  function scheduleResizeRender(): void {
    if (resizeFrameId !== null) {
      return;
    }
    resizeFrameId = requestAnimationFrame(() => {
      resizeFrameId = null;
      const vp = demoState.viewport;
      const gridRect = elements.timelineGrid.getBoundingClientRect();
      const nextTimelineWidthPx = gridRect.width;
      vp.updateGridDimensions(gridRect.width, gridRect.height);
      if (previousTimelineWidthPx > 0 && nextTimelineWidthPx > 0 && nextTimelineWidthPx !== previousTimelineWidthPx) {
        const widthRatio = nextTimelineWidthPx / previousTimelineWidthPx;
        const newDuration = vp.clampDurationCoord(Math.round(vp.viewDurationCoord * widthRatio));
        vp.viewDurationCoord = newDuration;
        const newStart = vp.clampStartCoord(vp.viewStartCoord);
        vp.viewStartCoord = newStart;
      }
      renderFrame(elements);
      previousTimelineWidthPx = nextTimelineWidthPx;
    });
  }

  pushRenderLog("Harness ready for SPEC.md version 0");
  wireEvents(elements);
  installBenchHooks(elements);
  window.addEventListener("resize", scheduleResizeRender);
  {
    const gridRect = elements.timelineGrid.getBoundingClientRect();
    demoState.viewport.updateGridDimensions(gridRect.width, gridRect.height);
    previousTimelineWidthPx = gridRect.width;
  }
  const restoredWorkingSession = await restoreWorkingSessionIfAvailable(elements);
  if (!restoredWorkingSession) {
    render(elements);
  }
  setApplicationReadyState(true);
}

void main().catch((error) => {
  console.error("[webdaw] bootstrap failed", error);
  setApplicationReadyState(true);
});
