/******************************* trajectory-logger.ts *************************
 *
 * Purpose: In-memory log of one effect instance's trajectoire, persisted to
 *          IndexedDB on every commit. Corresponds to the « Représentation
 *          opérationnelle » section of PRESETSPEC.md: an append-only event
 *          log with HEAD and cursor indices, bounded by FIFO eviction.
 * How: Created empty at attach time (synchronously) so the caller can start
 *      using it immediately; hydrated asynchronously from IndexedDB in the
 *      background. If commits have already happened when the hydration
 *      resolves, the in-memory state wins (we skip the rehydration).
 *      On every `recordCommit`, the log grows (evicted from the front when
 *      above capacity) and is fire-and-forget persisted.
 *
 ******************************************************************************/
import {
  loadTrajectory,
  saveTrajectory,
  type TrajectoryEvent,
  type TrajectoryRecord,
} from "./preset-storage.js";

/** Maximum number of events kept per instance (FIFO eviction beyond this). */
export const TRAJECTORY_CAPACITY = 500;

export class TrajectoryLogger {
  readonly #sessionId: string;
  readonly #effectInstanceId: string;
  readonly #codeHash: string;
  #events: TrajectoryEvent[];
  #headIndex: number;
  #cursorIndex: number;

  private constructor(
    sessionId: string,
    effectInstanceId: string,
    codeHash: string,
  ) {
    this.#sessionId = sessionId;
    this.#effectInstanceId = effectInstanceId;
    this.#codeHash = codeHash;
    this.#events = [];
    this.#headIndex = -1;
    this.#cursorIndex = -1;
  }

  /**
   * Purpose: Attach a logger for one (session, effect-instance, code) triple.
   * How: Create the logger synchronously with an empty in-memory log, then
   *      kick off async hydration from IndexedDB. The caller receives the
   *      logger ready to record commits immediately ; the persisted events
   *      will merge in when hydration completes (unless commits have already
   *      happened in the meantime).
   */
  static attach(
    sessionId: string,
    effectInstanceId: string,
    codeHash: string,
  ): TrajectoryLogger {
    const logger = new TrajectoryLogger(sessionId, effectInstanceId, codeHash);
    void logger.#hydrate();
    return logger;
  }

  /**
   * Purpose: Append a new commit event to the log and persist, tracing the
   *          return path from HEAD to the detached cursor first when the
   *          user modifies from a detached cursor — PRESETSPEC.md §101-115.
   * How: Build the event with the current timestamp and the provided
   *      configuration snapshot (defensive clone). When the cursor is
   *      strictly behind HEAD, append fresh events replaying the
   *      configurations of `e_{h-1}, …, e_k` (all timestamped `now`) before
   *      the new event — this preserves the real detour in the history.
   *      Advance HEAD to the new event and realign the cursor. Evict from
   *      the front when capacity is exceeded. Fire-and-forget persistence.
   */
  recordCommit(
    configuration: Readonly<Record<string, number>>,
    metadata: Partial<Pick<TrajectoryEvent, "transitionTime" | "transitionLevel" | "loopContext">> = {},
  ): void {
    const now = Date.now();
    if (this.#cursorIndex >= 0 && this.#cursorIndex < this.#headIndex) {
      for (let i = this.#headIndex - 1; i >= this.#cursorIndex; i--) {
        const priorEvent = this.#events[i];
        if (!priorEvent) continue;
        this.#events.push({
          timestamp: now,
          configuration: { ...priorEvent.configuration },
        });
      }
    }
    const event: TrajectoryEvent = {
      timestamp: now,
      configuration: { ...configuration },
      ...(metadata.transitionTime !== undefined ? { transitionTime: metadata.transitionTime } : {}),
      ...(metadata.transitionLevel !== undefined ? { transitionLevel: metadata.transitionLevel } : {}),
      ...(metadata.loopContext !== undefined ? { loopContext: metadata.loopContext } : {}),
    };
    this.#events.push(event);
    if (this.#events.length > TRAJECTORY_CAPACITY) {
      this.#events.splice(0, this.#events.length - TRAJECTORY_CAPACITY);
    }
    this.#headIndex = this.#events.length - 1;
    this.#cursorIndex = this.#headIndex;
    void this.#persist();
  }

  /**
   * Purpose: Move the cursor one event back, detaching from HEAD if needed.
   * How: Clamp at 0. Returns true when the cursor moved ; false when already
   *      at the start. Fires persistence so the cursor position survives a
   *      reload.
   */
  moveCursorBackward(): boolean {
    if (this.#cursorIndex <= 0) return false;
    this.#cursorIndex -= 1;
    void this.#persist();
    return true;
  }

  /**
   * Purpose: Move the cursor one event forward, up to HEAD.
   * How: Clamp at HEAD. Returns true when the cursor moved ; false when
   *      already aligned on HEAD.
   */
  moveCursorForward(): boolean {
    if (this.#cursorIndex >= this.#headIndex) return false;
    this.#cursorIndex += 1;
    void this.#persist();
    return true;
  }

  /** Snapshot of the current log (read-only). */
  get events(): readonly TrajectoryEvent[] {
    return this.#events;
  }

  get headIndex(): number {
    return this.#headIndex;
  }

  get cursorIndex(): number {
    return this.#cursorIndex;
  }

  get codeHash(): string {
    return this.#codeHash;
  }

  async #hydrate(): Promise<void> {
    const existing = await loadTrajectory(this.#sessionId, this.#effectInstanceId);
    if (this.#events.length > 0) return;
    if (!existing || existing.codeHash !== this.#codeHash) return;
    this.#events = [...existing.events];
    this.#headIndex = existing.headIndex;
    this.#cursorIndex = existing.cursorIndex;
  }

  async #persist(): Promise<void> {
    const record: TrajectoryRecord = {
      sessionId: this.#sessionId,
      effectInstanceId: this.#effectInstanceId,
      codeHash: this.#codeHash,
      events: this.#events,
      headIndex: this.#headIndex,
      cursorIndex: this.#cursorIndex,
      updatedAt: Date.now(),
    };
    try {
      await saveTrajectory(record);
    } catch (error) {
      console.warn("[webdaw] trajectory persist failed", error);
    }
  }
}
