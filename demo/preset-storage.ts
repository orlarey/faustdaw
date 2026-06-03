/******************************* preset-storage.ts ****************************
 *
 * Purpose: Persist the FX trajectoires and the preset library in the shared
 *          workspace IndexedDB. Gateway module for everything specified in
 *          PRESETSPEC.md about persisted state.
 * How: Piggy-back on the workspace database opened by session-workspace.ts.
 *      Two new object stores (created in that file's `upgradeneeded` handler):
 *        - `effectTrajectories`  keyed by `[sessionId, effectInstanceId]`
 *        - `presetLibrary`       keyed by `[uiHash, configHash]`
 *      This module exposes typed CRUD + list helpers. No UI, no audio.
 *
 ******************************************************************************/
import {
  openWorkspaceDatabase,
  requestToPromise,
  transactionDone,
} from "./session-workspace.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Purpose: One commit of the trajectoire — a configuration frozen at a moment.
 * How: `configuration` maps a parameter address (e.g. `"/reverb/wet"`) to its
 *      numeric value at `timestamp`. The optional `transition*` fields carry
 *      the metadata of a dynamic transition whose target this event records;
 *      `loopContext` is the identifier of a boucle de presets that produced
 *      the event.
 */
export type TrajectoryEvent = {
  readonly timestamp: number;
  readonly configuration: Readonly<Record<string, number>>;
  readonly transitionTime?: number;
  readonly transitionLevel?: 0 | 1;
  readonly loopContext?: string;
};

/**
 * Purpose: Full state of a trajectoire for one effect instance in one session.
 * How: `events` is the append-only log (bounded by FIFO eviction). `headIndex`
 *      points at the last committed event (the « real » current configuration).
 *      `cursorIndex` is the persisted navigation cursor; equal to `headIndex`
 *      when not detached. `codeHash` records the Faust code this trajectoire
 *      applies to — it becomes invalid if the instance is recompiled with
 *      different source.
 */
export type TrajectoryRecord = {
  readonly sessionId: string;
  readonly effectInstanceId: string;
  readonly codeHash: string;
  readonly events: readonly TrajectoryEvent[];
  readonly headIndex: number;
  readonly cursorIndex: number;
  readonly updatedAt: number;
};

/**
 * Purpose: One entry of the workspace-wide preset library, dedup-ed by content.
 * How: `configHash` is the SHA of a canonicalised JSON of `configuration`,
 *      paired with `uiHash` (the parameter signature identity, see
 *      `computeUIHash`) to form the composite primary key. `firstSeenAt`
 *      never changes after creation ; `lastSeenAt` is updated on re-promotion
 *      (revisite d'un preset par la trajectoire).
 */
export type PresetRecord = {
  readonly uiHash: string;
  readonly configHash: string;
  readonly configuration: Readonly<Record<string, number>>;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  /**
   * Optional user-supplied label. Workspace-wide (follows the preset
   * itself, not the session that named it). An empty string or undefined
   * means the preset is in its automatic auto-promoted state.
   */
  readonly name?: string;
};

// ---------------------------------------------------------------------------
// Store constants (must match the names declared in session-workspace.ts)
// ---------------------------------------------------------------------------

const TRAJECTORY_STORE_NAME = "effectTrajectories";
const PRESET_STORE_NAME = "presetLibrary";

// Upper sentinel used to bound composite-key range queries. Any string that
// compares greater than every plausible id suffix works; `"\uffff"` is the
// conventional choice.
const KEY_RANGE_UPPER_SENTINEL = "\uffff";

// ---------------------------------------------------------------------------
// Config hash (canonicalised JSON → SHA-256 hex)
// ---------------------------------------------------------------------------

/**
 * Purpose: Derive the stable `configHash` of a configuration, identical for
 *          two configurations that assign the same values to the same
 *          parameters regardless of object-key iteration order.
 * How: Sort the parameter addresses, stringify as JSON, hash with SHA-256,
 *      return the hex digest. Async because `crypto.subtle.digest` is async.
 */
export async function computeConfigHash(
  configuration: Readonly<Record<string, number>>,
): Promise<string> {
  const sortedEntries = Object.keys(configuration)
    .sort()
    .map((key) => [key, configuration[key]!] as const);
  const canonical = JSON.stringify(sortedEntries);
  return sha256Hex(new TextEncoder().encode(canonical));
}

/**
 * Purpose: Derive the `codeHash` of a Faust DSP source — identity of the
 *          code itself, used by the trajectoire (« cohérence avec le
 *          code » invariant of PRESETSPEC). NOT used for preset library
 *          identity any longer — see `computeUIHash`.
 * How: Byte-exact SHA-256 of the UTF-8 encoded source.
 */
export async function computeCodeHash(code: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(code));
}

/**
 * Purpose: Derive the `uiHash` of a Faust DSP — identity of its
 *          **parameter signature** (the things a preset references). Two
 *          DSPs with identical UI structure have identical uiHash, even
 *          if their internal source differs (refactor, comment change,
 *          bug fix that doesn't touch sliders/buttons/...). Used as the
 *          identity of the preset library : a preset only references
 *          parameter addresses + values, so its validity depends solely
 *          on the UI signature.
 * How: Walk the raw compiled Faust UI tree (the `runtime.ui` array as
 *      returned by faustwasm), extract every input widget into a flat
 *      record `{path, type, min, max, step}`, sort by path for
 *      determinism, JSON-encode and SHA-256. The `label` is
 *      intentionally excluded — it's cosmetic and changing it shouldn't
 *      invalidate presets. `runtime.ui` is loosely typed (`any[]`) so we
 *      take `unknown` and validate defensively.
 */
const FAUST_INPUT_WIDGET_TYPES = new Set([
  "hslider", "vslider", "nentry", "button", "checkbox",
]);
const FAUST_GROUP_TYPES = new Set(["vgroup", "hgroup", "tgroup"]);

type UIHashItem = {
  readonly path: string;
  readonly type: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
};

function extractUIHashItems(node: unknown, out: UIHashItem[]): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : "";
  if (FAUST_INPUT_WIDGET_TYPES.has(type)) {
    const path = typeof obj.address === "string"
      ? obj.address
      : typeof obj.path === "string"
        ? obj.path
        : "";
    if (!path) return;
    out.push({
      path,
      type,
      min: Number.isFinite(obj.min) ? Number(obj.min) : 0,
      max: Number.isFinite(obj.max) ? Number(obj.max) : 1,
      step: Number.isFinite(obj.step) ? Number(obj.step) : 0,
    });
    return;
  }
  if (FAUST_GROUP_TYPES.has(type) && Array.isArray(obj.items)) {
    for (const child of obj.items) extractUIHashItems(child, out);
  }
}

export async function computeUIHash(rawUI: unknown): Promise<string> {
  const items: UIHashItem[] = [];
  if (Array.isArray(rawUI)) {
    for (const node of rawUI) extractUIHashItems(node, items);
  }
  items.sort((a, b) => a.path.localeCompare(b.path));
  const canonical = JSON.stringify(items);
  return sha256Hex(new TextEncoder().encode(canonical));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const digestBytes = new Uint8Array(digestBuffer);
  let hex = "";
  for (const byte of digestBytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Trajectoire CRUD
// ---------------------------------------------------------------------------

/**
 * Purpose: Load the trajectoire record for one (session, effect-instance) pair.
 * How: Composite-key get on the trajectory store. Returns `null` when the pair
 *      has no record yet, or when the browser has no IndexedDB available.
 */
export async function loadTrajectory(
  sessionId: string,
  effectInstanceId: string,
): Promise<TrajectoryRecord | null> {
  const database = await openWorkspaceDatabase();
  if (!database) return null;
  const transaction = database.transaction(TRAJECTORY_STORE_NAME, "readonly");
  const store = transaction.objectStore(TRAJECTORY_STORE_NAME);
  const record = await requestToPromise(store.get([sessionId, effectInstanceId]));
  await transactionDone(transaction);
  return isTrajectoryRecord(record) ? record : null;
}

/**
 * Purpose: Persist a trajectoire record, creating or replacing the entry
 *          keyed by `(sessionId, effectInstanceId)`.
 * How: `put` in a `readwrite` transaction. Returns when the transaction has
 *      committed, or no-ops when no IndexedDB is available.
 */
export async function saveTrajectory(record: TrajectoryRecord): Promise<void> {
  const database = await openWorkspaceDatabase();
  if (!database) return;
  const transaction = database.transaction(TRAJECTORY_STORE_NAME, "readwrite");
  const store = transaction.objectStore(TRAJECTORY_STORE_NAME);
  store.put(record);
  await transactionDone(transaction);
}

/**
 * Purpose: Delete the trajectoire record for one (session, effect-instance) pair.
 * How: Composite-key delete. Used when the effect instance is definitively
 *      removed from the session (beyond undo reach).
 */
export async function deleteTrajectory(
  sessionId: string,
  effectInstanceId: string,
): Promise<void> {
  const database = await openWorkspaceDatabase();
  if (!database) return;
  const transaction = database.transaction(TRAJECTORY_STORE_NAME, "readwrite");
  const store = transaction.objectStore(TRAJECTORY_STORE_NAME);
  store.delete([sessionId, effectInstanceId]);
  await transactionDone(transaction);
}

/**
 * Purpose: List every trajectoire record belonging to one session.
 * How: Key range over the composite primary key, bounded by
 *      `[sessionId, ""]` to `[sessionId, "\uffff"]`. Used for session deletion
 *      (cascade GC) and for loading all trajectoires on session restore.
 */
export async function listSessionTrajectories(
  sessionId: string,
): Promise<TrajectoryRecord[]> {
  const database = await openWorkspaceDatabase();
  if (!database) return [];
  const transaction = database.transaction(TRAJECTORY_STORE_NAME, "readonly");
  const store = transaction.objectStore(TRAJECTORY_STORE_NAME);
  const range = IDBKeyRange.bound(
    [sessionId, ""],
    [sessionId, KEY_RANGE_UPPER_SENTINEL],
  );
  const records = await requestToPromise(store.getAll(range));
  await transactionDone(transaction);
  return Array.isArray(records) ? records.filter(isTrajectoryRecord) : [];
}

// ---------------------------------------------------------------------------
// Preset library CRUD
// ---------------------------------------------------------------------------

/**
 * Purpose: Load one preset by content identity.
 * How: Composite-key get on the preset store. Returns `null` when absent.
 */
export async function loadPreset(
  uiHash: string,
  configHash: string,
): Promise<PresetRecord | null> {
  const database = await openWorkspaceDatabase();
  if (!database) return null;
  const transaction = database.transaction(PRESET_STORE_NAME, "readonly");
  const store = transaction.objectStore(PRESET_STORE_NAME);
  const record = await requestToPromise(store.get([uiHash, configHash]));
  await transactionDone(transaction);
  return isPresetRecord(record) ? record : null;
}

/**
 * Purpose: Create or update a preset entry.
 * How: `put` in a `readwrite` transaction. Callers are expected to preserve
 *      `firstSeenAt` across updates (only `lastSeenAt` should change on
 *      re-promotion of an existing preset).
 */
export async function savePreset(record: PresetRecord): Promise<void> {
  const database = await openWorkspaceDatabase();
  if (!database) return;
  const transaction = database.transaction(PRESET_STORE_NAME, "readwrite");
  const store = transaction.objectStore(PRESET_STORE_NAME);
  store.put(record);
  await transactionDone(transaction);
}

/**
 * Purpose: Set or clear the user label of a preset, leaving the rest of
 *          the record untouched.
 * How: Load the existing record, replace its `name` field (empty / blank
 *      string clears the name back to the auto-promoted state), and save
 *      it back. No-op when the preset doesn't exist (already deleted).
 */
export async function setPresetName(
  uiHash: string,
  configHash: string,
  name: string,
): Promise<void> {
  const existing = await loadPreset(uiHash, configHash);
  if (!existing) return;
  const trimmed = name.trim();
  const next: PresetRecord = trimmed.length > 0
    ? { ...existing, name: trimmed }
    : (() => {
        const { name: _omit, ...rest } = existing;
        return rest;
      })();
  await savePreset(next);
}

/**
 * Purpose: Delete one preset entry.
 * How: Composite-key delete. Used by manual user deletion or by workspace GC
 *      when no session references the preset anymore.
 */
export async function deletePreset(
  uiHash: string,
  configHash: string,
): Promise<void> {
  const database = await openWorkspaceDatabase();
  if (!database) return;
  const transaction = database.transaction(PRESET_STORE_NAME, "readwrite");
  const store = transaction.objectStore(PRESET_STORE_NAME);
  store.delete([uiHash, configHash]);
  await transactionDone(transaction);
}

/**
 * Purpose: List every preset for one Faust DSP signature.
 * How: Key range over the composite key bounded by the uiHash prefix. This
 *      is the list displayed in the menu / canvas of an orbit-ui niveau 1.
 */
export async function listPresetsByUIHash(
  uiHash: string,
): Promise<PresetRecord[]> {
  const database = await openWorkspaceDatabase();
  if (!database) return [];
  const transaction = database.transaction(PRESET_STORE_NAME, "readonly");
  const store = transaction.objectStore(PRESET_STORE_NAME);
  const range = IDBKeyRange.bound(
    [uiHash, ""],
    [uiHash, KEY_RANGE_UPPER_SENTINEL],
  );
  const records = await requestToPromise(store.getAll(range));
  await transactionDone(transaction);
  return Array.isArray(records) ? records.filter(isPresetRecord) : [];
}

/**
 * Purpose: List every preset in the workspace, regardless of uiHash.
 * How: Full `getAll` on the preset store. Intended for debugging / tooling ;
 *      production UI should filter by uiHash via `listPresetsByUIHash`.
 */
export async function listAllPresets(): Promise<PresetRecord[]> {
  const database = await openWorkspaceDatabase();
  if (!database) return [];
  const transaction = database.transaction(PRESET_STORE_NAME, "readonly");
  const store = transaction.objectStore(PRESET_STORE_NAME);
  const records = await requestToPromise(store.getAll());
  await transactionDone(transaction);
  return Array.isArray(records) ? records.filter(isPresetRecord) : [];
}

// ---------------------------------------------------------------------------
// Type guards (defensive reads)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isTrajectoryEvent(value: unknown): value is TrajectoryEvent {
  if (!isRecord(value)) return false;
  if (typeof value.timestamp !== "number") return false;
  if (!isRecord(value.configuration)) return false;
  for (const v of Object.values(value.configuration)) {
    if (typeof v !== "number") return false;
  }
  if (value.transitionTime !== undefined && typeof value.transitionTime !== "number") return false;
  if (value.transitionLevel !== undefined && value.transitionLevel !== 0 && value.transitionLevel !== 1) return false;
  if (value.loopContext !== undefined && typeof value.loopContext !== "string") return false;
  return true;
}

function isTrajectoryRecord(value: unknown): value is TrajectoryRecord {
  if (!isRecord(value)) return false;
  if (typeof value.sessionId !== "string") return false;
  if (typeof value.effectInstanceId !== "string") return false;
  if (typeof value.codeHash !== "string") return false;
  if (!Array.isArray(value.events)) return false;
  for (const event of value.events) {
    if (!isTrajectoryEvent(event)) return false;
  }
  if (typeof value.headIndex !== "number") return false;
  if (typeof value.cursorIndex !== "number") return false;
  if (typeof value.updatedAt !== "number") return false;
  return true;
}

function isPresetRecord(value: unknown): value is PresetRecord {
  if (!isRecord(value)) return false;
  if (typeof value.uiHash !== "string") return false;
  if (typeof value.configHash !== "string") return false;
  if (!isRecord(value.configuration)) return false;
  for (const v of Object.values(value.configuration)) {
    if (typeof v !== "number") return false;
  }
  if (typeof value.firstSeenAt !== "number") return false;
  if (typeof value.lastSeenAt !== "number") return false;
  return true;
}
