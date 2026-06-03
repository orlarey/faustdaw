/*********************** session-render-materializations.ts *******************
 *
 * Purpose: Track in-flight materialization promises for session-render
 *          resources so the persist path can wait for every pending decode
 *          before snapshotting the archive. Keeps the bookkeeping (a Map
 *          keyed by resource id) centralised so writers (session-render
 *          transfer flow) and readers (persist) share one import.
 * How: Module-private Map. Writers call `trackPendingMaterialization(id, p)`
 *      which self-cleans on resolution. Persist calls `waitForAllPending`
 *      which drains until the map is empty.
 *
 ******************************************************************************/

const pending = new Map<string, Promise<void>>();

/**
 * Purpose: Register a materialization promise under the given resource id
 *          and auto-clear it on resolution or rejection.
 */
export function trackPendingMaterialization(resourceId: string, promise: Promise<void>): void {
  pending.set(resourceId, promise);
  void promise.finally(() => {
    if (pending.get(resourceId) === promise) {
      pending.delete(resourceId);
    }
  });
}

/**
 * Purpose: Wait until no materialization is in flight. Used by the persist
 *          path to guarantee every clip that references a session render
 *          has its bytes available before the archive is written.
 */
export async function waitForAllPendingMaterializations(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending.values()]);
  }
}
