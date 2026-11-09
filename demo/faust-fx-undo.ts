/****************************** faust-fx-undo.ts ******************************
 *
 * Purpose: Niveau-2 undo / redo scope per Faust effect — implements the
 *          faust-fx scope of UNDOREDOSPEC-WEBDAW. Each effect instance
 *          (track FX or Transform Chain) owns its own past / future
 *          stack. The op recorded here is the orbit-ui parameter
 *          gesture commit ; future variants (code edits) can be added
 *          to the discriminated union without changing the scope key.
 * How: A `FaustFxUndoScope` per `FaustFxScopeKey`, kept in a registry.
 *      Bridges (FxChainGestureBridge / TransformGestureBridge) capture
 *      the parameter values at gesture begin, then on gesture end
 *      record a `params` op with before / after snapshots, and persist
 *      the document without pushing the project history. The Cmd+Z
 *      handler routes by focus : when the focused element is inside
 *      `.fx-panel-effect-orbit` (no calque active for that effect),
 *      the effect's faust-fx scope handles the keystroke ; otherwise
 *      we fall through to the chain scope earlier in the keydown chain.
 *      Apply / revert mutate the right slice of demoState (track
 *      effect parameters or transform-chain effect parameters), then
 *      emit a `faustFxChanged` event so the orbit-ui + Faust node
 *      can resync.
 *
 ******************************************************************************/

import type { Elements } from "./bind-elements.js";
import type { FxEffectId, FxParam } from "../src/domain/fx-chain.js";
import { updateEffectParameters } from "../src/fx-chain.js";
import { demoState } from "./state.js";
import { persistCurrentSessionDocument } from "./session-history.js";

// ---------------------------------------------------------------------------
// Scope keys + ops
// ---------------------------------------------------------------------------

export type FaustFxScopeKey = {
  readonly kind: "faustFx";
  readonly effectId: FxEffectId;
};

export type FaustFxOp = {
  readonly kind: "params";
  readonly before: ReadonlyArray<FxParam>;
  readonly after: ReadonlyArray<FxParam>;
};

function serializeKey(key: FaustFxScopeKey): string {
  return `faustFx:${key.effectId}`;
}

/**
 * Purpose: Compare two parameter snapshots for value-equality.
 * How: We assume they have the same shape (address list) — they
 *      come from the same effect bracketed by a single gesture, so
 *      only `value` can vary. A no-op gesture (released without any
 *      drag) is then filtered out by the bridge.
 */
export function paramsEqual(
  a: ReadonlyArray<FxParam>,
  b: ReadonlyArray<FxParam>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.value !== b[i]!.value) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Scope class — past / future of FaustFxOp
// ---------------------------------------------------------------------------

export class FaustFxUndoScope {
  readonly key: FaustFxScopeKey;
  #past: FaustFxOp[] = [];
  #future: FaustFxOp[] = [];

  constructor(key: FaustFxScopeKey) {
    this.key = key;
  }

  record(op: FaustFxOp): void {
    this.#past.push(op);
    this.#future.length = 0;
  }

  canUndo(): boolean {
    return this.#past.length > 0;
  }

  canRedo(): boolean {
    return this.#future.length > 0;
  }

  popUndo(): FaustFxOp | null {
    const op = this.#past.pop();
    if (op) this.#future.push(op);
    return op ?? null;
  }

  popRedo(): FaustFxOp | null {
    const op = this.#future.pop();
    if (op) this.#past.push(op);
    return op ?? null;
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const scopes = new Map<string, FaustFxUndoScope>();

/**
 * Purpose: Drop every scope when another session is loaded in this tab.
 * How: Scope keys (chain ids, effect ids) repeat across sessions, so stale
 *      ops from the previous session must not be replayed against the new one.
 */
export function clearFaustFxUndoScopes(): void {
  scopes.clear();
}

export function getFaustFxUndoScope(key: FaustFxScopeKey): FaustFxUndoScope {
  const id = serializeKey(key);
  let scope = scopes.get(id);
  if (!scope) {
    scope = new FaustFxUndoScope(key);
    scopes.set(id, scope);
  }
  return scope;
}

export function recordFaustFxOp(key: FaustFxScopeKey, op: FaustFxOp): void {
  getFaustFxUndoScope(key).record(op);
}

// ---------------------------------------------------------------------------
// Change listeners — fired after undo / redo so panels can resync the
// Faust node + orbit-ui display from the post-undo domain model.
// ---------------------------------------------------------------------------

export type FaustFxChangeListener = (key: FaustFxScopeKey) => void;
const listeners = new Set<FaustFxChangeListener>();

export function addFaustFxChangeListener(listener: FaustFxChangeListener): void {
  listeners.add(listener);
}

export function removeFaustFxChangeListener(listener: FaustFxChangeListener): void {
  listeners.delete(listener);
}

function emitFaustFxChanged(key: FaustFxScopeKey): void {
  for (const listener of listeners) {
    try {
      listener(key);
    } catch (error) {
      console.warn("[webdaw] faust-fx change listener failed", error);
    }
  }
}

// ---------------------------------------------------------------------------
// Apply / revert — write the params snapshot to the right slice of
// demoState, persist, and notify panels.
// ---------------------------------------------------------------------------

/**
 * Purpose: Locate where an effectId lives (track FX vs transform
 *          chain) and write the given parameter snapshot into the
 *          domain model. We don't store the host in the scope key
 *          because effectIds are globally unique — a lookup is fast
 *          enough and keeps the key minimal.
 */
function writeParamsForEffect(
  effectId: FxEffectId,
  params: ReadonlyArray<FxParam>,
): void {
  for (const track of demoState.project.timeline.tracks) {
    const chain = demoState.project.chains.get(track.chainId);
    if (chain?.effects.some((e) => e.id === effectId)) {
      demoState.project = updateEffectParameters(
        demoState.project,
        track.chainId,
        effectId,
        params,
      );
      return;
    }
  }
  const idx = demoState.transformChain.findIndex((e) => e.id === effectId);
  if (idx >= 0) {
    const eff = demoState.transformChain[idx]!;
    demoState.transformChain = [
      ...demoState.transformChain.slice(0, idx),
      { ...eff, parameters: [...params] },
      ...demoState.transformChain.slice(idx + 1),
    ];
  }
}

async function applyOp(
  key: FaustFxScopeKey,
  op: FaustFxOp,
  elements: Elements,
): Promise<void> {
  writeParamsForEffect(key.effectId, op.after);
  persistCurrentSessionDocument(elements);
  emitFaustFxChanged(key);
}

async function revertOp(
  key: FaustFxScopeKey,
  op: FaustFxOp,
  elements: Elements,
): Promise<void> {
  writeParamsForEffect(key.effectId, op.before);
  persistCurrentSessionDocument(elements);
  emitFaustFxChanged(key);
}

// ---------------------------------------------------------------------------
// Cmd+Z routing — focus inside `.fx-panel-effect-orbit` (no calque
// active) routes to the effect's faust-fx scope. Layered between the
// library handler (3b) and the chain handler (1).
// ---------------------------------------------------------------------------

/**
 * Purpose: Locate the focused effect, if any, and return its key.
 * How: Walk up from `document.activeElement` to find a
 *      `.fx-panel-effect-orbit` ancestor. If the orbit's calque is
 *      active, return null — the library scope owns it. Otherwise
 *      read the effectId from the parent `.fx-panel-effect`.
 */
export function focusedFaustFxScopeKey(): FaustFxScopeKey | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const orbit = active.closest<HTMLElement>(".fx-panel-effect-orbit");
  if (!orbit) return null;
  // Calque-active short-circuit — both the legacy PresetOverlay flag
  // (fx-chain) and the OrbitUI wrapper's CSS class (faust-transform).
  if (orbit.dataset.overlayActive === "true") return null;
  // OrbitUI's wrapper mirrors the active flag onto its host element's
  // classList — querySelector cannot pierce shadow boundaries.
  if (orbit.classList.contains("orbit-ui-overlay-active")) return null;
  const effectRoot = orbit.closest<HTMLElement>(".fx-panel-effect");
  const effectId = effectRoot?.dataset.effectId;
  if (!effectId) return null;
  return { kind: "faustFx", effectId };
}

/**
 * Purpose: Install the global Cmd+Z / Cmd+Shift+Z handler for the
 *          faust-fx scope. Capture-phase on `window`, registered
 *          AFTER the library handler and BEFORE the chain handler so
 *          the routing chain is library > faust-fx > chain > project.
 */
export function wireFaustFxUndoKeyboard(elements: Elements): void {
  window.addEventListener(
    "keydown",
    (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && !(key === "y" && !event.metaKey)) return;
      if (event.repeat) return;
      const scopeKey = focusedFaustFxScopeKey();
      if (!scopeKey) return;
      // Scope is in focus — consume the keystroke even if empty, so it
      // does not fall through to a parent scope. The footer label is
      // the contract : "what the user sees is what Cmd+Z affects".
      event.preventDefault();
      event.stopPropagation();
      const scope = getFaustFxUndoScope(scopeKey);
      const isRedo = key === "y" || (key === "z" && event.shiftKey);
      if (isRedo ? !scope.canRedo() : !scope.canUndo()) return;
      void (async () => {
        if (isRedo) {
          const op = scope.popRedo();
          if (op) await applyOp(scopeKey, op, elements);
        } else {
          const op = scope.popUndo();
          if (op) await revertOp(scopeKey, op, elements);
        }
      })();
    },
    { capture: true },
  );
}
