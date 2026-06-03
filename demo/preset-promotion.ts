/****************************** preset-promotion.ts ***************************
 *
 * Purpose: Background mechanism that memorises a configuration as a preset
 *          once it has « tenu » assez longtemps pour compter comme un choix
 *          délibéré. Corresponds to the « Mémorisation » section of
 *          PRESETSPEC.md: a committed configuration becomes a library entry
 *          after X seconds of dwell during active playback with the effect
 *          not bypassed.
 * How: A stateful tracker per effect instance. The caller signals gesture
 *      commits with `recordCommit` and periodically ticks with `evaluate`.
 *      When the dwell conditions are simultaneously satisfied, the tracker
 *      calls `promotePreset` to persist the library entry. Content dedup
 *      (same (uiHash, configHash) → single entry) is handled by updating
 *      `lastSeenAt` on revisite.
 *
 ******************************************************************************/
import {
  computeConfigHash,
  loadPreset,
  savePreset,
  type PresetRecord,
} from "./preset-storage.js";

export const DEFAULT_DWELL_SECONDS = 3;

/**
 * Purpose: Promote a configuration into the workspace library.
 * How: Compute (uiHash, configHash) identity, load any existing preset,
 *      preserve `firstSeenAt` if present, update `lastSeenAt` to now, and
 *      save. Returns the persisted record for callers that want to surface
 *      the promotion in UI feedback.
 */
export async function promotePreset(
  uiHash: string,
  configuration: Readonly<Record<string, number>>,
  now: number = Date.now(),
): Promise<PresetRecord> {
  const configHash = await computeConfigHash(configuration);
  const existing = await loadPreset(uiHash, configHash);
  const record: PresetRecord = {
    uiHash,
    configHash,
    configuration,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    ...(existing?.name !== undefined ? { name: existing.name } : {}),
  };
  await savePreset(record);
  return record;
}

/**
 * Purpose: Snapshot of the state the tracker reads at each evaluation.
 * How: Caller-supplied bundle describing the current DSP hash, the current
 *      parameter configuration, and the playback / bypass conditions that
 *      gate promotion. Kept as a plain data shape so the tracker has no
 *      implicit coupling to demoState.
 */
export type PromotionEvaluationInputs = {
  readonly uiHash: string;
  readonly configuration: Readonly<Record<string, number>>;
  readonly isPlaybackActive: boolean;
  readonly isEffectBypassed: boolean;
};

/**
 * Purpose: Result of one tracker evaluation — did a promotion happen, and
 *          what was the content hash considered.
 * How: `promoted` is true only when `promotePreset` was called during the
 *      evaluation. `configHash` is set when a hash was computed; it is null
 *      when the evaluation short-circuited before the hash computation
 *      (typical for dwell-not-reached).
 */
export type PromotionEvaluationResult = {
  readonly promoted: boolean;
  readonly configHash: string | null;
};

/**
 * Purpose: Per-instance state of the dwell-based promotion mechanism.
 * How: `recordCommit(now)` anchors the dwell timer at a new gesture commit;
 *      `evaluate(inputs, now)` checks the dwell + playback + bypass
 *      conditions and performs the promotion when satisfied. `lastPromoted
 *      ConfigHash` suppresses repeated promotions of the exact same content
 *      across successive ticks — a preset is only re-promoted when the
 *      configuration has changed and dwelt again.
 */
/**
 * Purpose: Dependency-injected promotion function, typed identically to
 *          `promotePreset`. Lets tests substitute a spy without touching
 *          IndexedDB, and lets production code stay on the default path.
 */
export type PromoteFn = (
  uiHash: string,
  configuration: Readonly<Record<string, number>>,
  now?: number,
) => Promise<PresetRecord>;

export class PresetPromotionTracker {
  readonly #dwellMs: number;
  readonly #promote: PromoteFn;
  #lastCommitAt: number | null = null;
  #lastPromotedConfigHash: string | null = null;

  constructor(options: { dwellSeconds?: number; promote?: PromoteFn } = {}) {
    const dwellSeconds = options.dwellSeconds ?? DEFAULT_DWELL_SECONDS;
    this.#dwellMs = Math.max(0, dwellSeconds) * 1000;
    this.#promote = options.promote ?? promotePreset;
  }

  /**
   * Purpose: Signal the end of a gesture — the dwell timer restarts.
   * How: Record the timestamp. Any prior promotion is invalidated: after a
   *      new commit, the user must dwell again before we re-memorise.
   */
  recordCommit(now: number = Date.now()): void {
    this.#lastCommitAt = now;
    this.#lastPromotedConfigHash = null;
  }

  /**
   * Purpose: Release all state (e.g. when the effect instance is destroyed).
   * How: Forget the last commit and the last promoted hash. Subsequent
   *      evaluations will not promote until a new commit is recorded.
   */
  reset(): void {
    this.#lastCommitAt = null;
    this.#lastPromotedConfigHash = null;
  }

  /**
   * Purpose: Evaluate whether the dwell conditions are currently satisfied
   *          and, if so, promote the configuration.
   * How: Short-circuit when any of the gating conditions fails. Compute the
   *      content hash only when all conditions are satisfied. Skip promotion
   *      when the same content was promoted since the last commit.
   */
  async evaluate(
    inputs: PromotionEvaluationInputs,
    now: number = Date.now(),
  ): Promise<PromotionEvaluationResult> {
    if (this.#lastCommitAt === null) {
      return { promoted: false, configHash: null };
    }
    if (now - this.#lastCommitAt < this.#dwellMs) {
      return { promoted: false, configHash: null };
    }
    if (!inputs.isPlaybackActive) {
      return { promoted: false, configHash: null };
    }
    if (inputs.isEffectBypassed) {
      return { promoted: false, configHash: null };
    }

    const configHash = await computeConfigHash(inputs.configuration);
    if (this.#lastPromotedConfigHash === configHash) {
      return { promoted: false, configHash };
    }

    await this.#promote(inputs.uiHash, inputs.configuration, now);
    this.#lastPromotedConfigHash = configHash;
    return { promoted: true, configHash };
  }

  /** Read-only accessor for UI feedback and tests. */
  get lastPromotedConfigHash(): string | null {
    return this.#lastPromotedConfigHash;
  }

  /** Read-only accessor for UI feedback and tests. */
  get isArmed(): boolean {
    return this.#lastCommitAt !== null;
  }
}
