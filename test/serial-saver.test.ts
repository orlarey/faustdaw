/**************************** serial-saver.test.ts *****************************
 *
 * Purpose: Verify the scheduling of the working-session autosave: debounce,
 *          at most one save in flight, a last pass that captures the newest
 *          state, flush, cancel and error reporting.
 * How: The saver is driven by a fake clock (timers fired by hand) and by fake
 *      saves that stay pending until the test settles them, so every
 *      interleaving is written out step by step.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { SerialSaver, type SaverTimers } from "../demo/serial-saver.js";

const DELAY_MS = 400;

/** A clock whose timers fire only when the test says so. */
class FakeTimers implements SaverTimers {
  #next = 1;
  readonly pending = new Map<number, { callback: () => void; delayMs: number }>();

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.#next++;
    this.pending.set(id, { callback, delayMs });
    return id;
  }

  clearTimeout(id: number): void {
    this.pending.delete(id);
  }

  /** Fire every pending timer. */
  fireAll(): void {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const { callback } of due) callback();
  }
}

type Call = { arg: string | undefined; resolve: () => void; reject: (error: unknown) => void };

/** A saver over fake saves, each one held until resolved or rejected by the test. */
function harness() {
  const timers = new FakeTimers();
  const calls: Call[] = [];
  const errors: unknown[] = [];
  let running = 0;
  let maxRunning = 0;
  const save = (arg: string | undefined) => new Promise<void>((resolve, reject) => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    const done = () => { running -= 1; };
    calls.push({
      arg,
      resolve: () => { done(); resolve(); },
      reject: (error) => { done(); reject(error); },
    });
  });
  const saver = new SerialSaver<string>(save, DELAY_MS, timers, (error) => errors.push(error));
  return { saver, timers, calls, errors, maxRunning: () => maxRunning };
}

/** Let every pending promise callback run. */
function drain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Track whether a promise has settled. */
function watch(promise: Promise<unknown>): { settled: boolean; error: unknown } {
  const state = { settled: false, error: undefined as unknown };
  promise.then(() => { state.settled = true; }, (error) => { state.settled = true; state.error = error; });
  return state;
}

test("schedule debounces: one timer of the configured delay, one save of the latest argument", async () => {
  const { saver, timers, calls } = harness();
  saver.schedule("a");
  saver.schedule("b");
  saver.schedule("c");
  assert.equal(timers.pending.size, 1);
  assert.equal([...timers.pending.values()][0]!.delayMs, DELAY_MS);
  assert.equal(calls.length, 0);

  timers.fireAll();
  assert.deepEqual(calls.map((call) => call.arg), ["c"]);
  calls[0]!.resolve();
  await drain();
  assert.equal(calls.length, 1);
});

test("pending is true while a save is debounced or running, false once drained", async () => {
  const { saver, timers, calls } = harness();
  assert.equal(saver.pending, false);
  saver.schedule("a");
  assert.equal(saver.pending, true);
  timers.fireAll();
  assert.equal(saver.pending, true);
  calls[0]!.resolve();
  await drain();
  assert.equal(saver.pending, false);
});

test("requests during a save never start a second one, and collapse into one more pass with the newest state", async () => {
  const { saver, calls, maxRunning } = harness();
  const first = watch(saver.run("v1"));
  saver.run("v2");
  saver.run("v3");
  assert.equal(calls.length, 1);

  calls[0]!.resolve();
  await drain();
  assert.equal(first.settled, true);
  assert.deepEqual(calls.map((call) => call.arg), ["v1", "v3"]);
  calls[1]!.resolve();
  await drain();
  assert.equal(calls.length, 2);
  assert.equal(maxRunning(), 1);
  assert.equal(saver.pending, false);
});

test("an edit debounced while a save runs is saved by a later pass", async () => {
  const { saver, timers, calls } = harness();
  saver.run("v1");
  saver.schedule("v2");
  timers.fireAll();
  assert.equal(calls.length, 1);
  calls[0]!.resolve();
  await drain();
  assert.deepEqual(calls.map((call) => call.arg), ["v1", "v2"]);
  calls[1]!.resolve();
  await drain();
});

test("flush with an edit pending while a save runs waits for one more pass that captures it", async () => {
  // The running save snapshotted its state before the edit: settling with it would lose the edit.
  const { saver, timers, calls } = harness();
  saver.run("before");
  saver.schedule("after");
  const flushed = watch(saver.flush(() => true));
  assert.equal(timers.pending.size, 0, "the debounce timer is dropped");

  calls[0]!.resolve();
  await drain();
  assert.equal(flushed.settled, false, "flush does not settle with the stale save");
  assert.deepEqual(calls.map((call) => call.arg), ["before", "after"]);

  calls[1]!.resolve();
  await drain();
  assert.equal(flushed.settled, true);
  assert.equal(calls.length, 2);
});

test("flush while a save runs and no edit is pending adds no pass", async () => {
  const { saver, calls } = harness();
  saver.run("v1");
  const flushed = watch(saver.flush(() => true));
  calls[0]!.resolve();
  await drain();
  assert.equal(flushed.settled, true);
  assert.equal(calls.length, 1);
});

test("flush when idle saves once if shouldSave holds, and not otherwise", async () => {
  const { saver, calls } = harness();
  await saver.flush(() => false, "x");
  assert.equal(calls.length, 0);

  const flushed = watch(saver.flush(() => true, "y"));
  assert.deepEqual(calls.map((call) => call.arg), ["y"]);
  calls[0]!.resolve();
  await drain();
  assert.equal(flushed.settled, true);
});

test("flush when idle saves a debounced edit at once and drops its timer", async () => {
  const { saver, timers, calls } = harness();
  saver.schedule("edit");
  const flushed = watch(saver.flush(() => true));
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(calls.map((call) => call.arg), ["edit"]);
  calls[0]!.resolve();
  await drain();
  assert.equal(flushed.settled, true);
  timers.fireAll();
  assert.equal(calls.length, 1);
});

test("the caller of run and of flush sees the failure of its save", async () => {
  const { saver, calls, errors } = harness();
  const ran = watch(saver.run("a"));
  calls[0]!.reject(new Error("disk full"));
  await drain();
  assert.equal((ran.error as Error).message, "disk full");

  const flushed = watch(saver.flush(() => true, "b"));
  calls[1]!.reject(new Error("quota"));
  await drain();
  assert.equal((flushed.error as Error).message, "quota");
  assert.deepEqual(errors, []);
  assert.equal(saver.pending, false);
});

test("a failed timer save or queued pass is reported to onError, and the next pass still runs", async () => {
  const { saver, timers, calls, errors } = harness();
  saver.schedule("a");
  timers.fireAll();
  saver.run("b");
  saver.run("c");
  calls[0]!.reject(new Error("first"));
  await drain();
  assert.deepEqual(errors.map((error) => (error as Error).message), ["first"]);
  assert.deepEqual(calls.map((call) => call.arg), ["a", "c"]);

  saver.run("d");
  calls[1]!.reject(new Error("second"));
  await drain();
  assert.deepEqual(errors.map((error) => (error as Error).message), ["first", "second"]);
  assert.deepEqual(calls.map((call) => call.arg), ["a", "c", "d"]);
  calls[2]!.resolve();
  await drain();
  assert.equal(saver.pending, false);
});

test("cancel drops the debounced save and waits for the running one, its failure ignored", async () => {
  const { saver, timers, calls } = harness();
  saver.schedule("dropped");
  await saver.cancel();
  timers.fireAll();
  assert.equal(calls.length, 0);
  assert.equal(saver.pending, false);

  saver.run("running").catch(() => {});
  saver.schedule("dropped too");
  const cancelled = watch(saver.cancel());
  await drain();
  assert.equal(cancelled.settled, false);
  calls[0]!.reject(new Error("closing"));
  await drain();
  assert.equal(cancelled.settled, true);
  assert.equal(cancelled.error, undefined);
  assert.equal(calls.length, 1);
});
