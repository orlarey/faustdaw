/****************************** tab-identity.ts ********************************
 *
 * Purpose: Give the tab an identity that survives a reload, so the reloaded
 *          page is recognised as the writer it was (no 8 s read-only wait for
 *          its own, unreleased writer lease).
 * How: The writer lease is keyed by tab id and released in `pagehide` through
 *      an IndexedDB transaction that does not complete while the page unloads.
 *      `sessionStorage` is per tab, survives a reload and is written
 *      synchronously, so `pagehide` records "this id was released"; the next
 *      page of the same tab reuses the id only when that mark is present. A
 *      duplicated tab copies `sessionStorage` while its source page is still
 *      alive (no mark): it gets a fresh id, never a second writer with the
 *      same identity. `pageshow` from the back-forward cache clears the mark.
 *
 ******************************************************************************/

/** The subset of Storage this module needs (sessionStorage in the browser). */
export type TabIdentityStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const TAB_ID_KEY = "webdaw.tabId";
const TAB_ID_RELEASED_KEY = "webdaw.tabId.released";

/**
 * Purpose: Resolve this page's tab id at startup.
 * How: Reuse the stored id when the previous page of this tab marked it
 *      released (a reload); otherwise create one. The mark is consumed either way.
 */
export function resolveTabId(storage: TabIdentityStorage | null, createId: () => string): string {
  if (!storage) {
    return createId();
  }
  try {
    const previousId = storage.getItem(TAB_ID_KEY);
    const releasedId = storage.getItem(TAB_ID_RELEASED_KEY);
    storage.removeItem(TAB_ID_RELEASED_KEY);
    if (previousId && releasedId === previousId) {
      return previousId;
    }
    const tabId = createId();
    storage.setItem(TAB_ID_KEY, tabId);
    return tabId;
  } catch {
    return createId();
  }
}

/** Purpose: Mark the tab id released when the page goes away (pagehide). */
export function markTabIdReleased(storage: TabIdentityStorage | null, tabId: string): void {
  try {
    storage?.setItem(TAB_ID_RELEASED_KEY, tabId);
  } catch {
    // Storage unavailable: the next page gets a fresh id (previous behaviour).
  }
}

/** Purpose: The page came back from the back-forward cache: it is alive again. */
export function clearTabIdReleased(storage: TabIdentityStorage | null): void {
  try {
    storage?.removeItem(TAB_ID_RELEASED_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The tab's sessionStorage, or null when unavailable (privacy mode, tests). */
export function getTabIdentityStorage(): TabIdentityStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
