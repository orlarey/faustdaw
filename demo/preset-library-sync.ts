/***************************** preset-library-sync.ts *************************
 *
 * Purpose: Write an OrbitUI instance's library changes to the shared preset
 *          store without touching what other tabs or instances wrote.
 * How: One `OrbitLibrarySync` per OrbitUI instance remembers the library the
 *      instance last synced (hydration, refresh from the store, or its own
 *      last change). Each `onLibraryChange` snapshot is diffed against it
 *      (see preset-library-delta.ts) and only that delta is written. Writes
 *      of all instances go through one queue, so two quick changes (add then
 *      undo) reach the store in order. After a write, the library-change
 *      bus refreshes every instance on the same uiHash from the store, in
 *      this tab and, through a BroadcastChannel, in the other tabs: they
 *      reload before their next change, so their own echo matches their
 *      library and their library undo history is kept.
 *
 ******************************************************************************/
import { computeLibraryDelta, indexLibrary, type LibraryDelta, type LibraryPreset } from "./preset-library-delta.js";
import { deletePreset, loadPreset, savePreset, type PresetRecord } from "./preset-storage.js";
import { presetTrackingSystem } from "./preset-tracking.js";

const LIBRARY_CHANNEL_NAME = "faustdaw-preset-library";

let writeQueue: Promise<void> = Promise.resolve();
let libraryChannel: BroadcastChannel | null = null;

/**
 * Purpose: The cross-tab channel for library changes, created on first use.
 * How: A message carries the uiHash written by another tab; it is replayed
 *      on the local library-change bus (refresh of instances and badges).
 */
function ensureLibraryChannel(): BroadcastChannel | null {
  if (libraryChannel || typeof BroadcastChannel === "undefined") {
    return libraryChannel;
  }
  libraryChannel = new BroadcastChannel(LIBRARY_CHANNEL_NAME);
  libraryChannel.onmessage = (event: MessageEvent) => {
    const uiHash = (event.data as { uiHash?: unknown } | null)?.uiHash;
    if (typeof uiHash === "string") {
      presetTrackingSystem.notifyLibraryChange(uiHash);
    }
  };
  return libraryChannel;
}

async function writeDelta(uiHash: string, delta: LibraryDelta<LibraryPreset>): Promise<void> {
  for (const record of delta.upserts) {
    // firstSeenAt never changes once stored.
    const stored = await loadPreset(uiHash, record.configHash);
    const next: PresetRecord = {
      uiHash,
      configHash: record.configHash,
      configuration: record.configuration,
      firstSeenAt: stored?.firstSeenAt ?? record.lastSeenAt,
      lastSeenAt: record.lastSeenAt,
      ...(record.name !== undefined ? { name: record.name } : {}),
    };
    await savePreset(next);
  }
  for (const configHash of delta.deletes) {
    await deletePreset(uiHash, configHash);
  }
}

export class OrbitLibrarySync {
  readonly uiHash: string;
  #synced = new Map<string, LibraryPreset>();

  constructor(uiHash: string) {
    this.uiHash = uiHash;
    ensureLibraryChannel();
  }

  /**
   * Purpose: Record the library pushed into the instance from the store
   *          (hydration, library-change refresh): later deltas start there.
   */
  markSynced(records: readonly LibraryPreset[]): void {
    this.#synced = indexLibrary(records, this.uiHash);
  }

  /**
   * Purpose: `onLibraryChange` handler: write this instance's change.
   * How: The delta is taken synchronously, so successive snapshots chain
   *      correctly even while earlier writes are pending; the write itself
   *      is queued behind every earlier one.
   */
  push(records: readonly LibraryPreset[]): Promise<void> {
    const next = indexLibrary(records, this.uiHash);
    const delta = computeLibraryDelta(this.#synced, next);
    this.#synced = next;
    if (delta.upserts.length === 0 && delta.deletes.length === 0) {
      return writeQueue;
    }
    const uiHash = this.uiHash;
    writeQueue = writeQueue
      .then(() => writeDelta(uiHash, delta))
      .then(() => {
        presetTrackingSystem.notifyLibraryChange(uiHash);
        ensureLibraryChannel()?.postMessage({ uiHash });
      })
      .catch((error) => {
        console.error("[preset-library] Failed to write library change:", error);
      });
    return writeQueue;
  }
}
