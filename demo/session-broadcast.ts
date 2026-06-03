/***************************** session-broadcast.ts ***************************
 *
 * Purpose: Own the cross-tab BroadcastChannel used to notify sibling tabs
 *          when the working session archive is persisted or the workspace
 *          changes. Centralises the channel reference so writers (persist
 *          path, session lifecycle) can import a single post() helper
 *          instead of passing around the channel or going through a
 *          registered callback.
 * How: Module-private `channel` holds the BroadcastChannel created at
 *      wireEvents time via `openWorkspaceSyncChannel`. `close…` tears it
 *      down on unload. `broadcast…` is a no-op when the channel is missing.
 *
 ******************************************************************************/

/** The shapes of the messages posted across tabs. */
export type WorkspaceSyncMessage =
  | {
    type: "session-updated";
    sessionId: string;
    sessionRevision: string;
    fromTabId: string;
  }
  | {
    type: "workspace-changed";
    sessionId: string | null;
    fromTabId: string;
  };

const WORKSPACE_SYNC_CHANNEL_NAME = "webdaw-workspace";

let channel: BroadcastChannel | null = null;

/**
 * Purpose: Open the shared BroadcastChannel used to notify sibling tabs.
 * How: No-op when BroadcastChannel is not available. The channel is kept
 *      alive until `closeWorkspaceSyncChannel` is called.
 */
export function openWorkspaceSyncChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") {
    channel = null;
    return null;
  }
  channel = new BroadcastChannel(WORKSPACE_SYNC_CHANNEL_NAME);
  return channel;
}

/** Drop the channel reference so no further messages are posted. */
export function closeWorkspaceSyncChannel(): void {
  channel = null;
}

/** Post one message to every sibling tab; no-op when the channel is not open. */
export function broadcastWorkspaceSyncMessage(message: WorkspaceSyncMessage): void {
  channel?.postMessage(message);
}
