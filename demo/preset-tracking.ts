/******************************* preset-tracking.ts ***************************
 *
 * Purpose: Application-level glue that wires the promotion mechanism and the
 *          trajectoire logger to the live FxEffect instances of the project.
 *          Owns the per-instance state and is the single entry point called
 *          by panel code and the transport loop.
 * How: A class with a singleton export. `attach` is called when an orbit-ui
 *      is wired for an effect ; `detach` when it is removed. `recordCommit`
 *      is called at each gesture commit. `tick` is called from the transport
 *      loop each frame: it evaluates every tracker against live project state
 *      (read via direct imports from `state.ts` and `fx-chain-runtime.ts`),
 *      so no callback injection is needed and the DAG stays honest.
 *
 ******************************************************************************/
import { demoState } from "./state.js";
import { PresetPromotionTracker } from "./preset-promotion.js";
import { TrajectoryLogger } from "./trajectory-logger.js";
import { listPresetsByUIHash, type TrajectoryEvent } from "./preset-storage.js";
import type { FxEffect } from "../src/domain/fx-chain.js";

type InstanceState = {
  readonly sessionId: string;
  readonly effectInstanceId: string;
  /** Identity of the source code — used by the trajectoire (per-instance log). */
  readonly codeHash: string;
  /** Identity of the parameter signature — used by the preset library. Two
      instances with the same uiHash share their library, even if their
      source code differs. */
  readonly uiHash: string;
  readonly tracker: PresetPromotionTracker;
  readonly logger: TrajectoryLogger;
};

export type PromotionListener = (uiHash: string) => void;
export type TrajectoryListener = (effectInstanceId: string) => void;

/**
 * Purpose: Read-only snapshot of an instance's trajectory state, handed to
 *          the niveau-1 calque for rendering.
 * How: Plain data copy of the in-memory log ; HEAD is the index of the
 *      latest event, cursor is where navigation (PRESETSPEC.md §64-69)
 *      currently points. Empty log has headIndex = cursorIndex = -1.
 */
export type TrajectorySnapshot = {
  readonly events: ReadonlyArray<TrajectoryEvent>;
  readonly headIndex: number;
  readonly cursorIndex: number;
};

export class PresetTrackingSystem {
  readonly #instances: Map<string, InstanceState> = new Map();
  readonly #inGesture: Set<string> = new Set();
  readonly #overlayActive: Set<string> = new Set();
  readonly #promotionListeners: Set<PromotionListener> = new Set();
  readonly #trajectoryListeners: Set<TrajectoryListener> = new Set();

  /**
   * Purpose: Register a newly-wired effect instance for tracking.
   * How: Create a `PresetPromotionTracker` and a `TrajectoryLogger` and keep
   *      them in the registry keyed by `effectInstanceId`. Idempotent: a
   *      second attach with the same id is a no-op when both hashes match,
   *      and replaces the entry when either differs (code edited and
   *      recompiled, so a fresh trajectoire and tracker are needed).
   */
  attach(
    sessionId: string,
    effectInstanceId: string,
    codeHash: string,
    uiHash: string,
  ): void {
    const existing = this.#instances.get(effectInstanceId);
    if (
      existing
      && existing.codeHash === codeHash
      && existing.uiHash === uiHash
    ) return;
    const tracker = new PresetPromotionTracker();
    const logger = TrajectoryLogger.attach(sessionId, effectInstanceId, codeHash);
    this.#instances.set(effectInstanceId, {
      sessionId,
      effectInstanceId,
      codeHash,
      uiHash,
      tracker,
      logger,
    });
  }

  /**
   * Purpose: Forget the tracking state of an instance (e.g. effect removed).
   * How: Drop the entry from the registry. The in-memory logger is GC'd with
   *      it ; the persisted trajectoire stays in IndexedDB until explicit
   *      cleanup by the session / workspace GC (not MVP).
   */
  detach(effectInstanceId: string): void {
    this.#instances.delete(effectInstanceId);
    this.#inGesture.delete(effectInstanceId);
    this.#overlayActive.delete(effectInstanceId);
  }

  /**
   * Purpose: Signal that a user gesture (slider drag, etc.) has started on
   *          an instance. Evaluation is paused until `endGesture` so that
   *          transit configurations mid-drag are not promoted to the library.
   * How: Track the instance in a set consulted by `tick`.
   */
  beginGesture(effectInstanceId: string): void {
    this.#inGesture.add(effectInstanceId);
  }

  /**
   * Purpose: Signal that the user gesture on an instance has ended.
   * How: Remove from the set. The caller typically follows with
   *      `recordCommit`, which restarts the dwell timer from gesture end.
   */
  endGesture(effectInstanceId: string): void {
    this.#inGesture.delete(effectInstanceId);
  }

  /**
   * Purpose: Mark an instance as being explored at niveau 1, suppressing
   *          automatic promotion while the calque is open. The user opted
   *          into preset management explicitly via the calque, so we let
   *          them control the library by hand (selection, deletion) rather
   *          than growing it automatically under their feet.
   * How: Maintain an explicit set consulted by `tick`. Symmetric pair
   *      `setOverlayActive(id, true|false)`.
   */
  setOverlayActive(effectInstanceId: string, active: boolean): void {
    if (active) this.#overlayActive.add(effectInstanceId);
    else this.#overlayActive.delete(effectInstanceId);
  }

  /**
   * Purpose: Register a listener notified every time the library changes
   *          (auto-promotion, manual Add / Rename / Delete, etc.).
   * How: Listeners are called with the `uiHash` of the affected library
   *      after the change. Typical use is refreshing UI counters tied to
   *      a uiHash (e.g. the preset count badge in an effect header).
   */
  addPromotionListener(listener: PromotionListener): void {
    this.#promotionListeners.add(listener);
  }

  /** Symmetric to `addPromotionListener`. */
  removePromotionListener(listener: PromotionListener): void {
    this.#promotionListeners.delete(listener);
  }

  /**
   * Purpose: Re-fire the promotion listeners as a generic « library
   *          changed » signal — used by the niveau-1 calque after a
   *          deletion so any other badge sharing the same uiHash refreshes
   *          its preset count.
   * How: Iterate the same listener set used by promotions. Promotion
   *      listeners only care about which uiHash to refresh, so reusing
   *      them keeps the panel-side wiring trivial.
   */
  notifyLibraryChange(uiHash: string): void {
    for (const listener of this.#promotionListeners) {
      try {
        listener(uiHash);
      } catch (error) {
        console.warn("[webdaw] promotion listener failed", error);
      }
    }
  }

  /**
   * Purpose: Register a listener notified after each trajectory commit.
   * How: Listeners receive the `effectInstanceId` of the instance whose log
   *      grew, after the logger has appended the event. Typical use is
   *      refreshing the niveau-1 calque's polyline for that instance.
   */
  addTrajectoryListener(listener: TrajectoryListener): void {
    this.#trajectoryListeners.add(listener);
  }

  /** Symmetric to `addTrajectoryListener`. */
  removeTrajectoryListener(listener: TrajectoryListener): void {
    this.#trajectoryListeners.delete(listener);
  }

  /**
   * Purpose: Read-only snapshot of an instance's trajectoire for rendering.
   * How: Copy out the current events / HEAD / cursor from the logger. Null
   *      when the instance is not attached (caller treats as empty map).
   */
  getTrajectorySnapshot(effectInstanceId: string): TrajectorySnapshot | null {
    const state = this.#instances.get(effectInstanceId);
    if (!state) return null;
    return {
      events: state.logger.events,
      headIndex: state.logger.headIndex,
      cursorIndex: state.logger.cursorIndex,
    };
  }

  /**
   * Purpose: Step the cursor backward/forward in an instance's trajectoire.
   * How: Delegate to the logger. When the cursor actually moved, return the
   *      event now under the cursor so the caller can apply its
   *      configuration to the audio, and fire the trajectory listeners so
   *      any calque redraws its HEAD/cursor markers.
   */
  moveCursorBackward(effectInstanceId: string): TrajectoryEvent | null {
    return this.#stepCursor(effectInstanceId, (logger) => logger.moveCursorBackward());
  }

  moveCursorForward(effectInstanceId: string): TrajectoryEvent | null {
    return this.#stepCursor(effectInstanceId, (logger) => logger.moveCursorForward());
  }

  #stepCursor(
    effectInstanceId: string,
    step: (logger: TrajectoryLogger) => boolean,
  ): TrajectoryEvent | null {
    const state = this.#instances.get(effectInstanceId);
    if (!state) return null;
    if (!step(state.logger)) return null;
    const event = state.logger.events[state.logger.cursorIndex] ?? null;
    for (const listener of this.#trajectoryListeners) {
      try {
        listener(effectInstanceId);
      } catch (error) {
        console.warn("[webdaw] trajectory listener failed", error);
      }
    }
    return event;
  }

  /**
   * Purpose: Record a gesture commit for one instance.
   * How: Forward to the tracker (resets the dwell timer) and to the logger
   *      (appends the event). Silent no-op if the instance is not attached.
   *      Fire the trajectory listeners after both updates so subscribers
   *      see the new state.
   */
  recordCommit(
    effectInstanceId: string,
    configuration: Readonly<Record<string, number>>,
  ): void {
    const state = this.#instances.get(effectInstanceId);
    if (!state) return;
    state.tracker.recordCommit();
    state.logger.recordCommit(configuration);
    for (const listener of this.#trajectoryListeners) {
      try {
        listener(effectInstanceId);
      } catch (error) {
        console.warn("[webdaw] trajectory listener failed", error);
      }
    }
  }

  /**
   * Purpose: Periodic evaluation of every attached tracker.
   * How: Called from the transport loop. Read live project state via direct
   *      imports: the playback state from `demoState.project.timeline.transport`
   *      and the per-effect bypass / configuration from `demoState.project`
   *      and `demoState.transformChain`. Each tracker decides alone whether
   *      to promote based on its dwell timer and gating rules.
   */
  async tick(now: number = Date.now()): Promise<void> {
    const isPlaybackActive = demoState.project.timeline.transport === "Playing";
    if (!isPlaybackActive) return;
    if (this.#instances.size === 0) return;

    for (const state of this.#instances.values()) {
      // Skip instances currently being manipulated by the user — we do not
      // want to promote transit configurations mid-drag.
      if (this.#inGesture.has(state.effectInstanceId)) continue;
      // Skip instances whose niveau-1 calque is open — at that point the
      // user manages the library by hand (selection / deletion) and we
      // suppress automatic memorisation under their feet.
      if (this.#overlayActive.has(state.effectInstanceId)) continue;
      const effect = findEffectById(state.effectInstanceId);
      if (!effect) continue;
      const configuration = effectConfiguration(effect);
      const result = await state.tracker.evaluate(
        {
          uiHash: state.uiHash,
          configuration,
          isPlaybackActive,
          isEffectBypassed: effect.bypassed,
        },
        now,
      );
      if (result.promoted) {
        for (const listener of this.#promotionListeners) {
          try {
            listener(state.uiHash);
          } catch (error) {
            console.warn("[webdaw] preset promotion listener failed", error);
          }
        }
      }
    }
  }

  /** True when an instance is currently attached. */
  hasInstance(effectInstanceId: string): boolean {
    return this.#instances.has(effectInstanceId);
  }

  /**
   * Purpose: Count the presets currently stored for one parameter
   *          signature. Intended for UI counters displayed next to each
   *          effect header.
   * How: Proxy to `listPresetsByUIHash`.
   */
  async getPresetCount(uiHash: string): Promise<number> {
    const presets = await listPresetsByUIHash(uiHash);
    return presets.length;
  }
}

export const presetTrackingSystem = new PresetTrackingSystem();

// ---------------------------------------------------------------------------
// Helpers — read effect state from demoState via direct imports
// ---------------------------------------------------------------------------

/**
 * Purpose: Resolve an effect instance id to its FxEffect record in the live
 *          project, checking both track effects and the Transform Chain.
 * How: Linear scan of the tracks' effects followed by the transform chain.
 *      Returns null when the id is not found (e.g. during a race between
 *      detach and tick).
 */
function findEffectById(effectInstanceId: string): FxEffect | null {
  for (const chain of demoState.project.chains.values()) {
    const effect = chain.effects.find((e) => e.id === effectInstanceId);
    if (effect) return effect;
  }
  const transformEffect = demoState.transformChain.find((e) => e.id === effectInstanceId);
  return transformEffect ?? null;
}

/**
 * Purpose: Build the current parameter configuration of an effect as a
 *          `Record<address, value>` suitable for hashing and storage.
 * How: Project each `FxParam` to its `(address, value)` pair.
 */
function effectConfiguration(effect: FxEffect): Record<string, number> {
  const result: Record<string, number> = {};
  for (const param of effect.parameters) {
    result[param.address] = param.value;
  }
  return result;
}
