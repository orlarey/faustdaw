/***************************** clip-context-target.ts *************************
 *
 * Purpose: Track which clip the user last right-clicked, so the context menu,
 *          and any follow-up action (open source session, update from source),
 *          can resolve what target they operate on. Also owns the close
 *          behaviour of the menu element so callers can close it without
 *          importing a callback.
 * How: Module-level `targetClipId` is set by `setClipContextTarget` when the
 *      right-click lands on a clip, and cleared by `closeClipContextMenu`
 *      (which also hides the DOM element if one has been registered).
 *      `bindClipContextMenuElement` is called once at wire-up time.
 *      `getClipContextTargetSessionRenderState` composes the query helpers
 *      from session-render-resource-link to describe the target in terms
 *      the menu needs (isLinked / isStale).
 *
 ******************************************************************************/
import type { SessionRenderResourceLink } from "./session-archive.js";
import { getClip } from "../src/domain/clip.js";
import { demoState } from "./state.js";
import {
  getSessionRenderResourceLink,
  getLinkedWorkspaceSessionForSessionRender,
  isSessionRenderLinkStale,
} from "./session-render-resource-link.js";

let targetClipId: string | null = null;
let menuElement: HTMLElement | null = null;

/**
 * Purpose: Register the DOM element used as the context menu popup.
 * How: Called once from wireEvents. `closeClipContextMenu` will hide this
 *      element alongside clearing the target clip id.
 */
export function bindClipContextMenuElement(element: HTMLElement): void {
  menuElement = element;
}

/** Record the clip id the user is about to act on through the context menu. */
export function setClipContextTarget(clipId: string): void {
  targetClipId = clipId;
}

/** Read the current target clip id (null when no context menu is active). */
export function getClipContextTargetClipId(): string | null {
  return targetClipId;
}

/**
 * Purpose: Hide the context menu and forget the target clip.
 * How: Set the registered menu element to hidden when one is bound, then
 *      clear the target id.
 */
export function closeClipContextMenu(): void {
  if (menuElement) {
    menuElement.hidden = true;
  }
  targetClipId = null;
}

/**
 * Purpose: Describe the session-render state of the target clip so the menu
 *          can decide which session-related buttons to enable.
 * How: Look up the target clip, then query the session-render link helpers.
 *      Returns `null` when no clip is targeted or the clip has no session
 *      render link.
 */
export function getClipContextTargetSessionRenderState(): {
  clipId: string;
  sessionRender: SessionRenderResourceLink;
  isLinked: boolean;
  isStale: boolean;
} | null {
  if (!targetClipId) {
    return null;
  }
  try {
    const clip = getClip(demoState.project, targetClipId);
    const sessionRender = getSessionRenderResourceLink(clip.resource.id);
    if (!sessionRender) {
      return null;
    }
    const isLinked = getLinkedWorkspaceSessionForSessionRender(sessionRender) !== null;
    return {
      clipId: clip.id,
      sessionRender,
      isLinked,
      isStale: isLinked && isSessionRenderLinkStale(sessionRender),
    };
  } catch {
    return null;
  }
}
