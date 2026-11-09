/****************************** chain-undo.ts *********************************
 *
 * Purpose: Niveau-1 undo / redo scope per FX chain — implements the Chain
 *          scope (1) of UNDOREDOSPEC-WEBDAW. Each chain instance (one per
 *          track for FX chains, plus the global Transform chain, and later
 *          one per algorithmic clip) owns its own past / future stack.
 *          Operations recorded here are : add effect, remove effect,
 *          move (reorder), toggle bypass.
 * How: Every chain is identified by a single `FxChainId` (a string). The
 *      space of ids is partitioned : track FX chains use the `TrackId` as
 *      their chain id, the Transform Chain uses the dedicated constant
 *      `TRANSFORM_CHAIN_ID`. Future hosts (algorithmic clips, master bus)
 *      will use their own disjoint id namespaces. The scope key is a thin
 *      wrapper `{ chainId }` — no discriminator, no host-specific FK.
 *
 *      A `ChainUndoScope` per `chainId`, kept in a module-level registry.
 *      Panels record chain mutations via `recordChainOp` after they have
 *      already mutated `demoState.project` and called
 *      `persistCurrentSessionDocument` (autosave-without-undo). The Cmd+Z
 *      handler routes by focus context — when the focused element is in
 *      an FX panel header (no calque, no orbit), the active chain's scope
 *      handles the keystroke ; otherwise it consumes the event silently
 *      (strict isolation, see UNDOREDOSPEC-WEBDAW rule 5).
 *
 *      Apply/revert mutate the right slice of demoState (track effects vs
 *      transform chain) by inspecting the chain id : the only place the
 *      « kind » of host still matters. After mutation a `chainChanged`
 *      event lets panels rewire audio + refresh their UI. Faust runtimes
 *      are kept alive in their cache when an effect is removed by undo,
 *      so a subsequent redo doesn't pay the recompile cost.
 *
 ******************************************************************************/

import type { Elements } from "./bind-elements.js";
import type { FxEffect, FxEffectId, FxChainId } from "../src/domain/fx-chain.js";
import { TRANSFORM_CHAIN_ID } from "../src/domain/fx-chain.js";
import {
  addEffect,
  moveEffect,
  removeEffect,
  toggleEffectBypass,
} from "../src/fx-chain.js";
import { demoState } from "./state.js";
import { persistCurrentSessionDocument } from "./session-history.js";

// Re-export for callers that imported it from this module historically.
export { TRANSFORM_CHAIN_ID };

// ---------------------------------------------------------------------------
// Scope keys + ops
// ---------------------------------------------------------------------------

export type ChainScopeKey = { readonly chainId: FxChainId };

export type ChainOp =
  | { readonly kind: "add"; readonly effect: FxEffect; readonly index: number }
  | { readonly kind: "remove"; readonly effect: FxEffect; readonly index: number }
  | {
      readonly kind: "move";
      readonly effectId: FxEffectId;
      readonly fromIndex: number;
      readonly toIndex: number;
    }
  | { readonly kind: "bypass"; readonly effectId: FxEffectId };

// ---------------------------------------------------------------------------
// Scope class — past / future of ChainOp
// ---------------------------------------------------------------------------

export class ChainUndoScope {
  readonly key: ChainScopeKey;
  #past: ChainOp[] = [];
  #future: ChainOp[] = [];

  constructor(key: ChainScopeKey) {
    this.key = key;
  }

  record(op: ChainOp): void {
    this.#past.push(op);
    this.#future.length = 0;
  }

  canUndo(): boolean {
    return this.#past.length > 0;
  }

  canRedo(): boolean {
    return this.#future.length > 0;
  }

  popUndo(): ChainOp | null {
    const op = this.#past.pop();
    if (op) this.#future.push(op);
    return op ?? null;
  }

  popRedo(): ChainOp | null {
    const op = this.#future.pop();
    if (op) this.#past.push(op);
    return op ?? null;
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const scopes = new Map<FxChainId, ChainUndoScope>();

/**
 * Purpose: Drop every scope when another session is loaded in this tab.
 * How: Scope keys (chain ids, effect ids) repeat across sessions, so stale
 *      ops from the previous session must not be replayed against the new one.
 */
export function clearChainUndoScopes(): void {
  scopes.clear();
}

export function getChainUndoScope(key: ChainScopeKey): ChainUndoScope {
  let scope = scopes.get(key.chainId);
  if (!scope) {
    scope = new ChainUndoScope(key);
    scopes.set(key.chainId, scope);
  }
  return scope;
}

export function recordChainOp(key: ChainScopeKey, op: ChainOp): void {
  getChainUndoScope(key).record(op);
}

// ---------------------------------------------------------------------------
// Chain-changed listeners — fired after undo / redo mutates the document, so
// the panels can rewire audio + refresh their UI.
// ---------------------------------------------------------------------------

export type ChainChangeListener = (key: ChainScopeKey) => void;
const listeners = new Set<ChainChangeListener>();

export function addChainChangeListener(listener: ChainChangeListener): void {
  listeners.add(listener);
}

export function removeChainChangeListener(listener: ChainChangeListener): void {
  listeners.delete(listener);
}

function emitChainChanged(key: ChainScopeKey): void {
  for (const listener of listeners) {
    try {
      listener(key);
    } catch (error) {
      console.warn("[webdaw] chain change listener failed", error);
    }
  }
}

// ---------------------------------------------------------------------------
// Apply / revert — direct mutation of demoState + persistence + event
// ---------------------------------------------------------------------------

function readChainEffects(chainId: FxChainId): readonly FxEffect[] {
  return demoState.project.chains.get(chainId)?.effects ?? [];
}

/**
 * Purpose: Apply an op forward — used on the redo path.
 * How: Mutate `demoState.project` via the chain-id-keyed operations from
 *      `src/fx-chain.ts`. Track FX chains and the Transform Chain share
 *      the same code path now that the Transform Chain lives in
 *      `project.chains[TRANSFORM_CHAIN_ID]`.
 */
async function applyOp(key: ChainScopeKey, op: ChainOp, elements: Elements): Promise<void> {
  const { chainId } = key;
  switch (op.kind) {
    case "add":
      demoState.project = addEffect(demoState.project, chainId, op.effect);
      // addEffect appends — move to the recorded index if needed.
      if (op.index < readChainEffects(chainId).length - 1) {
        demoState.project = moveEffect(demoState.project, chainId, op.effect.id, op.index);
      }
      break;
    case "remove":
      demoState.project = removeEffect(demoState.project, chainId, op.effect.id);
      break;
    case "move":
      demoState.project = moveEffect(demoState.project, chainId, op.effectId, op.toIndex);
      break;
    case "bypass":
      demoState.project = toggleEffectBypass(demoState.project, chainId, op.effectId);
      break;
  }
  persistCurrentSessionDocument(elements);
  emitChainChanged(key);
}

/**
 * Purpose: Apply an op's inverse — used on the undo path.
 * How: Express the inverse in terms of the same primitives — `add` ↔
 *      `remove`, `move(from→to)` ↔ `move(to→from)`, `bypass` is its own
 *      inverse.
 */
async function revertOp(key: ChainScopeKey, op: ChainOp, elements: Elements): Promise<void> {
  switch (op.kind) {
    case "add":
      await applyOp(key, { kind: "remove", effect: op.effect, index: op.index }, elements);
      return;
    case "remove":
      await applyOp(key, { kind: "add", effect: op.effect, index: op.index }, elements);
      return;
    case "move":
      await applyOp(
        key,
        {
          kind: "move",
          effectId: op.effectId,
          fromIndex: op.toIndex,
          toIndex: op.fromIndex,
        },
        elements,
      );
      return;
    case "bypass":
      await applyOp(key, op, elements);
      return;
  }
}

// ---------------------------------------------------------------------------
// Cmd+Z routing — focus inside an FX panel effect (no calque active, no
// orbit) routes to the active chain's scope. Calque-focused case is handled
// by the library scope earlier in the keydown chain ; orbit-focused case by
// the faust-fx scope between library and chain.
// ---------------------------------------------------------------------------

/**
 * Purpose: Locate the focused chain scope, if any, and return its key.
 * How: Walk up from `document.activeElement` to find which panel hosts
 *      the focus. We defer to the inner scopes (library 3b / faust-fx
 *      2) whenever the focus is inside `.fx-panel-effect-orbit` —
 *      those handlers run earlier in the same capture-phase and
 *      already consume the keystroke ; returning a key here would let
 *      the chain handler also act on it (capture handlers on the same
 *      target all run regardless of stopPropagation). Otherwise we
 *      accept focus anywhere inside a panel (header, list, effect
 *      shell, panel root) so that operations which destroy the
 *      focused element (e.g. delete removes the `.fx-panel-effect`
 *      carrying the focused button) don't strand the user's Cmd+Z
 *      on the project scope.
 */
export function focusedChainScopeKey(): ChainScopeKey | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  // Defer to library / faust-fx scope when focus is inside the orbit.
  if (active.closest<HTMLElement>(".fx-panel-effect-orbit")) return null;
  const transformPanel = active.closest<HTMLElement>(".transform-panel");
  if (transformPanel) return { chainId: TRANSFORM_CHAIN_ID };
  const fxPanel = active.closest<HTMLElement>(".fx-panel");
  if (!fxPanel) return null;
  const trackId = demoState.activeFxTrackId;
  if (!trackId) return null;
  return { chainId: trackId };
}

/**
 * Purpose: Install the global Cmd+Z / Cmd+Shift+Z handler for chain
 *          scopes. Capture-phase on `window`, layered AFTER the library
 *          scope handler — when the focus is in a calque, the library
 *          handler consumes the event first ; otherwise this one gets a
 *          chance.
 */
export function wireChainUndoKeyboard(elements: Elements): void {
  window.addEventListener(
    "keydown",
    (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && !(key === "y" && !event.metaKey)) return;
      if (event.repeat) return;
      const scopeKey = focusedChainScopeKey();
      if (!scopeKey) return;
      // Consume the keystroke even when the scope is empty, so it does
      // not fall through to the project scope. Strict isolation : the
      // footer label is the contract.
      event.preventDefault();
      event.stopPropagation();
      const scope = getChainUndoScope(scopeKey);
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
