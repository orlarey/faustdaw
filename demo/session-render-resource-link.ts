/************************ session-render-resource-link.ts *********************
 *
 * Purpose: Query helpers for the session-render link attached to an imported
 *          audio resource. A session-render link records that a resource was
 *          produced by mixing down another workspace session, so the UI can
 *          surface an "open source session" / "update from source" affordance.
 * How: All three helpers are pure reads over the demoState caches
 *      (`resources.sessionRenders`, `workspaceSessions`). Centralised so
 *      consumers never duplicate the same Map lookups.
 *
 ******************************************************************************/
import type { SessionRenderResourceLink } from "./session-archive.js";
import { demoState } from "./state.js";

/** Look up the session-render link for a given resource id, if any. */
export function getSessionRenderResourceLink(resourceId: string): SessionRenderResourceLink | null {
  return demoState.resources.sessionRenders.get(resourceId) ?? null;
}

/**
 * Purpose: Resolve the workspace session that a session-render link points at.
 * How: Look up the linked session by id in `demoState.workspaceSessions`. Returns
 *      `null` when the source session is no longer in the workspace.
 */
export function getLinkedWorkspaceSessionForSessionRender(
  sessionRender: SessionRenderResourceLink,
): { sessionName: string; sessionRevision: string | null } | null {
  return demoState.workspaceSessions.get(sessionRender.sourceSessionId) ?? null;
}

/**
 * Purpose: Decide whether a session-render link is out of date compared to its
 *          source session (i.e. the source has advanced past the recorded revision).
 * How: The link is stale only when the source session is still linked AND its
 *      current revision differs from the one recorded on the render link.
 */
export function isSessionRenderLinkStale(sessionRender: SessionRenderResourceLink): boolean {
  const linkedWorkspaceSession = getLinkedWorkspaceSessionForSessionRender(sessionRender);
  return linkedWorkspaceSession !== null
    && linkedWorkspaceSession.sessionRevision !== sessionRender.sourceSessionRevision;
}
