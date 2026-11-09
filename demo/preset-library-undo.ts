/****************************** preset-library-undo.ts ************************
 *
 * Purpose: Niveau-1 undo / redo scope of the preset library — implements the
 *          rule from `UNDOREDOSPEC-WEBDAW.md` : actions that mutate the
 *          library (Add / Rename / Delete / Trash batch) live in their own
 *          stack, scoped per `uiHash`, persisting through the session.
 *          Routing of Cmd+Z to this scope happens when a calque is focused.
 * Note (2026-11-09, UNDOREDOSPEC-WEBDAW 3b): the library undo is per effect.
 *          `wireLibraryUndoKeyboard` routes Cmd+Z to the focused effect's
 *          OrbitUI (its own library undo stack). The per-uiHash
 *          `LibraryUndoScope` below is only reached by `PresetOverlay`,
 *          which nothing instantiates any more.
 * How: A `LibraryUndoScope` class wraps `past` and `future` stacks of
 *      operations. Each operation carries enough information to be
 *      re-applied (redo) or inverted (undo) — typically the full record
 *      affected. A module-level registry hands out one scope per uiHash.
 *      Operations are recorded by the calque after each user-driven IDB
 *      mutation ; undo pops from past, applies the inverse (IDB write +
 *      tracking-system library-change notification), and pushes to future.
 *
 ******************************************************************************/

import {
  deletePreset,
  loadPreset,
  savePreset,
  setPresetName,
  type PresetRecord,
} from "./preset-storage.js";
import { presetTrackingSystem } from "./preset-tracking.js";
import { getOrbitUI } from "./orbit-ui-registry.js";

/**
 * Purpose: Discriminated union of the library-mutating operations.
 * How: Each variant carries the full information needed to apply (redo) or
 *      invert (undo) the change. We keep snapshots of the affected
 *      `PresetRecord` rather than a reference, so undoing a delete fully
 *      restores the preset (config, timestamps, name) bit-for-bit.
 */
export type LibraryOp =
  | { readonly kind: "add"; readonly record: PresetRecord }
  | {
      readonly kind: "rename";
      readonly uiHash: string;
      readonly configHash: string;
      readonly prevName: string | undefined;
      readonly nextName: string | undefined;
    }
  | { readonly kind: "delete"; readonly record: PresetRecord }
  | { readonly kind: "deleteBatch"; readonly records: ReadonlyArray<PresetRecord> };

/**
 * Purpose: Per-uiHash undo / redo scope for the preset library.
 * How: Two stacks (`past`, `future`) of `LibraryOp`. Recording a new op
 *      pushes to past and clears future (rule 7 of UNDOREDOSPEC : a fresh
 *      action invalidates the redo path of the current branch).
 */
export class LibraryUndoScope {
  readonly uiHash: string;
  #past: LibraryOp[] = [];
  #future: LibraryOp[] = [];

  constructor(uiHash: string) {
    this.uiHash = uiHash;
  }

  record(op: LibraryOp): void {
    this.#past.push(op);
    this.#future.length = 0;
  }

  canUndo(): boolean {
    return this.#past.length > 0;
  }

  canRedo(): boolean {
    return this.#future.length > 0;
  }

  /** Pop the most recent op from past. Caller must apply its inverse. */
  popUndo(): LibraryOp | null {
    const op = this.#past.pop();
    if (op) this.#future.push(op);
    return op ?? null;
  }

  /** Pop the most recent op from future. Caller must re-apply it forward. */
  popRedo(): LibraryOp | null {
    const op = this.#future.pop();
    if (op) this.#past.push(op);
    return op ?? null;
  }
}

// ---------------------------------------------------------------------------
// Registry — one scope per uiHash, lives the whole session
// ---------------------------------------------------------------------------

const scopes = new Map<string, LibraryUndoScope>();

export function getLibraryUndoScope(uiHash: string): LibraryUndoScope {
  let scope = scopes.get(uiHash);
  if (!scope) {
    scope = new LibraryUndoScope(uiHash);
    scopes.set(uiHash, scope);
  }
  return scope;
}

// ---------------------------------------------------------------------------
// Op apply / revert — IDB writes + library-change broadcast
// ---------------------------------------------------------------------------

/**
 * Purpose: Apply the **inverse** of an op (used on undo).
 * How: For every op kind, perform the IDB write that brings the library
 *      back to the state before the op was recorded, then broadcast a
 *      library-change event so badges and calques refresh.
 */
async function revertOp(op: LibraryOp): Promise<void> {
  switch (op.kind) {
    case "add":
      await deletePreset(op.record.uiHash, op.record.configHash);
      presetTrackingSystem.notifyLibraryChange(op.record.uiHash);
      return;
    case "delete":
      await savePreset(op.record);
      presetTrackingSystem.notifyLibraryChange(op.record.uiHash);
      return;
    case "deleteBatch":
      for (const record of op.records) {
        await savePreset(record);
      }
      if (op.records.length > 0) {
        presetTrackingSystem.notifyLibraryChange(op.records[0]!.uiHash);
      }
      return;
    case "rename":
      await setPresetName(op.uiHash, op.configHash, op.prevName ?? "");
      presetTrackingSystem.notifyLibraryChange(op.uiHash);
      return;
  }
}

/**
 * Purpose: Apply the op forward (used on redo).
 * How: Mirror of `revertOp` in the opposite direction.
 */
async function applyOp(op: LibraryOp): Promise<void> {
  switch (op.kind) {
    case "add":
      await savePreset(op.record);
      presetTrackingSystem.notifyLibraryChange(op.record.uiHash);
      return;
    case "delete":
      await deletePreset(op.record.uiHash, op.record.configHash);
      presetTrackingSystem.notifyLibraryChange(op.record.uiHash);
      return;
    case "deleteBatch":
      for (const record of op.records) {
        await deletePreset(record.uiHash, record.configHash);
      }
      if (op.records.length > 0) {
        presetTrackingSystem.notifyLibraryChange(op.records[0]!.uiHash);
      }
      return;
    case "rename":
      await setPresetName(op.uiHash, op.configHash, op.nextName ?? "");
      presetTrackingSystem.notifyLibraryChange(op.uiHash);
      return;
  }
}

/**
 * Purpose: Public entry points for the keyboard handler. Returns true
 *          when something was undone / redone — the caller uses this to
 *          decide whether to consume the keystroke.
 */
export async function undoLibrary(uiHash: string): Promise<boolean> {
  const scope = getLibraryUndoScope(uiHash);
  const op = scope.popUndo();
  if (!op) return false;
  await revertOp(op);
  return true;
}

export async function redoLibrary(uiHash: string): Promise<boolean> {
  const scope = getLibraryUndoScope(uiHash);
  const op = scope.popRedo();
  if (!op) return false;
  await applyOp(op);
  return true;
}

// ---------------------------------------------------------------------------
// Cmd+Z / Cmd+Shift+Z routing — fires only when a calque has focus
// ---------------------------------------------------------------------------

/**
 * Purpose: Locate the focused calque, if any, and return its uiHash.
 * How: Two visibility contracts coexist :
 *      - Legacy `PresetOverlay` (still used by fx-chain) sets
 *        `dataset.overlayActive="true"` on the orbit container and
 *        publishes the uiHash on `.fx-panel-effect-presets[data-ui-hash]`.
 *      - The OrbitUI wrapper (used by faust-transform after migration)
 *        adds an `.orbit-ui-overlay-active` element under the orbit
 *        container, and the panel writes the uiHash on the orbit
 *        container's `data-ui-hash` itself.
 *      We try both ; mismatched calques short-circuit before reading.
 */
export function focusedCalqueUIHash(): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const effectRoot = active.closest<HTMLElement>(".fx-panel-effect");
  if (!effectRoot) return null;
  const orbitContainer = effectRoot.querySelector<HTMLElement>(
    ".fx-panel-effect-orbit",
  );
  if (!orbitContainer) return null;
  const legacyActive = orbitContainer.dataset.overlayActive === "true";
  // OrbitUI mirrors the calque-active state onto its host element via
  // classList.toggle('orbit-ui-overlay-active'). The legacy PresetOverlay
  // path attached the same class to a descendant element. With shadow
  // DOM, `querySelector` no longer pierces into the wrapper's shadow
  // tree, so we read it directly from the host's classList instead.
  const wrapperActive = orbitContainer.classList.contains("orbit-ui-overlay-active");
  if (!legacyActive && !wrapperActive) return null;
  if (wrapperActive && orbitContainer.dataset.uiHash) {
    return orbitContainer.dataset.uiHash;
  }
  const span = effectRoot.querySelector<HTMLElement>(
    ".fx-panel-effect-presets[data-ui-hash]",
  );
  return span?.dataset.uiHash ?? null;
}

/**
 * Purpose: Locate the focused effectId when its calque is active.
 *          Used by the Cmd+Z router to detect whether the focused
 *          calque belongs to an OrbitUI-wrapped instance (faust-transform)
 *          and should route to the wrapper's internal library scope
 *          instead of webdaw's `LibraryUndoScope`.
 */
function focusedCalqueEffectId(): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const effectRoot = active.closest<HTMLElement>(".fx-panel-effect");
  if (!effectRoot) return null;
  const orbitContainer = effectRoot.querySelector<HTMLElement>(
    ".fx-panel-effect-orbit",
  );
  if (!orbitContainer?.classList.contains("orbit-ui-overlay-active")) return null;
  return effectRoot.dataset.effectId ?? null;
}

/**
 * Purpose: Install the global Cmd+Z / Cmd+Shift+Z handler. Capture-phase
 *          on `window` so it pre-empts the DAW's project-undo handler
 *          when (and only when) a calque is focused AND its library
 *          scope has something to undo / redo. Otherwise fall through —
 *          the project-undo handler runs normally.
 * How: One handler covers both directions ; routing on `event.shiftKey`.
 *      `event.preventDefault()` + `stopPropagation()` only when we
 *      consume the event, so the fall-through path is genuine.
 */
export function wireLibraryUndoKeyboard(): void {
  window.addEventListener(
    "keydown",
    (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && !(key === "y" && !event.metaKey)) return;
      if (event.repeat) return;
      const uiHash = focusedCalqueUIHash();
      if (!uiHash) return;
      // Consume the keystroke even when the scope is empty, so it does
      // not fall through to the chain / project scope. Strict isolation :
      // the footer label is the contract. stopImmediatePropagation: the
      // faust-fx and chain handlers are capture listeners on the same target.
      event.preventDefault();
      event.stopImmediatePropagation();
      const isRedo = key === "y" || (key === "z" && event.shiftKey);

      // Route to the OrbitUI wrapper's internal library scope when the
      // focused calque is owned by a wrapper instance — its own
      // library-undo machinery emits the right onLibraryChange events
      // back to the host (which already persists to IDB and broadcasts
      // via presetTrackingSystem.notifyLibraryChange). The legacy
      // PresetOverlay path falls through to webdaw's LibraryUndoScope.
      const effectId = focusedCalqueEffectId();
      const orbit = effectId ? getOrbitUI(effectId) : undefined;
      if (orbit) {
        if (isRedo) orbit.redoLibrary();
        else orbit.undoLibrary();
        return;
      }

      const scope = getLibraryUndoScope(uiHash);
      if (isRedo ? !scope.canRedo() : !scope.canUndo()) return;
      void (isRedo ? redoLibrary(uiHash) : undoLibrary(uiHash));
    },
    { capture: true },
  );
}

// ---------------------------------------------------------------------------
// Helper to capture the « before » state of a rename so the undo path can
// restore it. Loads the existing record, then returns its name (possibly
// undefined). Falls back to undefined when the preset doesn't exist.
// ---------------------------------------------------------------------------

export async function loadPresetName(
  uiHash: string,
  configHash: string,
): Promise<string | undefined> {
  const record = await loadPreset(uiHash, configHash);
  return record?.name;
}
