/************************ play-start-robustness.test.ts ***********************
 *
 * Purpose: Check that Play never leaves the transport "Playing" over silence:
 *          neither when it lands while a Stop's deferred suspend is still in
 *          flight, nor when starting the playback session throws.
 * How: Drive AudioEngine with a fake AudioContext whose suspend settles on
 *      demand, and TransportLoop.abortFailedPlay on a playing project.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

(globalThis as { window?: unknown }).window ??= globalThis;

// state.js first: it and audio-engine.js import each other.
const { demoState } = await import("../demo/state.js");
const { AudioEngine } = await import("../demo/audio-engine.js");
const { initProject } = await import("../src/domain/project.js");
const { play } = await import("../src/domain/transport.js");

/** A fake AudioContext: resume is immediate, suspend settles only when `settleSuspend` is called. */
class FakeAudioContext {
  state: "running" | "suspended" | "closed" = "suspended";
  readonly sampleRate: number;
  readonly destination = {};
  suspendCalls = 0;
  #settle: (() => void) | null = null;
  constructor(options?: { sampleRate?: number }) {
    this.sampleRate = options?.sampleRate ?? 48_000;
  }
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls += 1;
    return new Promise((resolve) => {
      this.#settle = () => {
        this.state = "suspended";
        resolve();
      };
    });
  }
  settleSuspend(): void {
    this.#settle?.();
    this.#settle = null;
  }
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  createConstantSource() {
    return { offset: { value: 0 }, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a Play landing while a Stop's suspend is in flight still ends with a running context", async (t) => {
  const savedAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
  t.after(() => {
    (globalThis as { AudioContext?: unknown }).AudioContext = savedAudioContext;
  });
  const engine = new AudioEngine();
  await engine.startSilent();
  const context = engine.context as unknown as FakeAudioContext;
  assert.equal(context.state, "running");

  engine.stopSilent();
  await sleep(20); // the deferred suspend has been requested, not settled
  assert.equal(context.suspendCalls, 1);
  assert.equal(context.state, "running");

  const playing = engine.startSilent(); // Play during the suspend
  context.settleSuspend();
  await playing;
  assert.equal(context.state, "running");
});

test("a Play before the deferred suspend fires cancels it", async (t) => {
  const savedAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
  t.after(() => {
    (globalThis as { AudioContext?: unknown }).AudioContext = savedAudioContext;
  });
  const engine = new AudioEngine();
  await engine.startSilent();
  const context = engine.context as unknown as FakeAudioContext;
  engine.stopSilent();
  await engine.startSilent(); // within the 5 ms delay
  await sleep(20);
  assert.equal(context.suspendCalls, 0);
  assert.equal(context.state, "running");
});

test("abortFailedPlay returns a playing transport to Stopped and clears the session", (t) => {
  const savedProject = demoState.project;
  t.after(() => {
    demoState.project = savedProject;
  });
  demoState.project = play(initProject("p"));
  assert.equal(demoState.project.timeline.transport, "Playing");
  demoState.transportLoop.abortFailedPlay();
  assert.equal(demoState.project.timeline.transport, "Stopped");
  assert.equal(demoState.playbackSession.isActive, false);
});
