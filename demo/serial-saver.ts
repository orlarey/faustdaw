/****************************** serial-saver.ts *******************************
 *
 * Purpose: The scheduling of a debounced, single-flight save, apart from what
 *          is saved: the working-session autosave (session-autosave.ts) uses
 *          it, and the tests drive it with fake timers and fake saves.
 * How: A debounce timer starts `run`; `run` keeps at most one save in flight
 *      and, when asked again meanwhile, queues one more pass that captures
 *      the newest state; `flush` saves a pending edit now (one more pass if a
 *      save is already running, since that save snapshotted its state before
 *      the edit); `cancel` drops the timer and waits for the running saves.
 *
 ******************************************************************************/

/**
 * Purpose: The clock the saver schedules with (the window's, or a fake one in the tests).
 * How: The two calls the debounce needs.
 */
export type SaverTimers = {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
};

/**
 * Purpose: Debounced, single-flight saves, so that the last save always captures the newest state and two saves
 *          never run at once.
 * How: `timeoutId` is the pending debounce, `loop` the running sequence of saves, `queued` one more pass asked for
 *      while it runs. `save` receives the argument of the latest request.
 */
export class SerialSaver<A> {
  #timeoutId: number | null = null;
  #loop: Promise<void> | null = null;
  #queued = false;
  #arg: A | undefined = undefined;

  constructor(
    private readonly save: (arg: A | undefined) => Promise<void>,
    private readonly delayMs: number,
    private readonly timers: SaverTimers,
    private readonly onError: (error: unknown) => void,
  ) {}

  /**
   * Purpose: True iff a save is debounced or running.
   * How: The timer or the loop is set.
   */
  get pending(): boolean {
    return this.#timeoutId !== null || this.#loop !== null;
  }

  /**
   * Purpose: Ask for a save after the delay (an edit happened).
   * How: Replace the pending timer; when it fires, `run`, reporting a failure to `onError`.
   */
  schedule(arg?: A): void {
    this.#arg = arg;
    if (this.#timeoutId !== null) {
      this.timers.clearTimeout(this.#timeoutId);
    }
    this.#timeoutId = this.timers.setTimeout(() => {
      this.#timeoutId = null;
      this.run().catch(this.onError);
    }, this.delayMs);
  }

  /**
   * Purpose: Save now, at most one save at a time.
   * How: If a save runs, queue one more pass and return the running loop. Otherwise start the loop; the promise
   *      returned settles with the first pass (its caller sees its error), the queued passes drain in the loop,
   *      their failures reported to `onError`.
   */
  run(arg?: A): Promise<void> {
    if (arg !== undefined) this.#arg = arg;
    if (this.#loop) {
      this.#queued = true;
      return this.#loop;
    }
    this.#queued = false;
    const firstPass = this.save(this.#arg);
    this.#loop = (async () => {
      try {
        await firstPass;
      } catch {
        // reported by the caller of run
      }
      while (this.#queued) {
        this.#queued = false;
        try {
          await this.save(this.#arg);
        } catch (error) {
          this.onError(error);
        }
      }
    })().finally(() => {
      this.#loop = null;
    });
    return firstPass;
  }

  /**
   * Purpose: Save a pending edit now (the session is left, the page hidden).
   * How: Drop the timer; if a save runs and an edit was pending, queue one more pass, and wait for the loop to
   *      drain; otherwise, if `shouldSave()`, run one save now.
   */
  async flush(shouldSave: () => boolean, arg?: A): Promise<void> {
    if (arg !== undefined) this.#arg = arg;
    const hadPendingEdit = this.#timeoutId !== null;
    if (this.#timeoutId !== null) {
      this.timers.clearTimeout(this.#timeoutId);
      this.#timeoutId = null;
    }
    if (this.#loop) {
      if (hadPendingEdit) {
        this.#queued = true;
      }
      await this.#loop;
      return;
    }
    if (!shouldSave()) {
      return;
    }
    await this.run();
  }

  /**
   * Purpose: Stop saving (the session is closed).
   * How: Drop the timer and wait for the running saves, their failures ignored.
   */
  async cancel(): Promise<void> {
    if (this.#timeoutId !== null) {
      this.timers.clearTimeout(this.#timeoutId);
      this.#timeoutId = null;
    }
    if (this.#loop) {
      try {
        await this.#loop;
      } catch {
        // ignored on close
      }
    }
  }
}
