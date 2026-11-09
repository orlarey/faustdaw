/*********************** faust-offline-bounce-tail.test.ts ********************
 *
 * Purpose: Check that the offline bounce keeps the whole tail of delay-based
 *          effects, and keeps exactly the clip length for effects without one.
 * How: Feed bounceTransformChain fake Faust processors written in JS (a gain,
 *      a one-pole low-pass, a single echo, a feedback delay) through a fake
 *      FaustMonoDspGenerator, and compare with a long reference render of the
 *      same processor.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { bounceTransformChain } from "../demo/faust-transform/faust-offline-bounce.js";
import type { FxEffect } from "../src/domain/fx-chain.js";

const SR = 48_000;
type Dsp = (x: number) => number;

/** A fake faustwasm module whose generator builds a per-sample JS DSP from `factory()`. */
const fakeFaustWasm = {
  FaustMonoDspGenerator: class {
    factory: (() => Dsp) | null = null;
    async createOfflineProcessor() {
      const dsp = this.factory!();
      return {
        start() {}, stop() {}, setParamValue() {},
        getNumInputs: () => 1, getNumOutputs: () => 1,
        compute(inputs: Float32Array[], outputs: Float32Array[]) {
          const x = inputs[0]!, y = outputs[0]!;
          for (let i = 0; i < y.length; i++) y[i] = dsp(x[i]!);
        },
      };
    }
  },
};

const gain = (k: number) => (): Dsp => (x) => k * x;
/** A one-pole low-pass: no audible tail, but its output on silence decays without ever being exactly 0. */
const onePole = (a: number) => (): Dsp => {
  let y = 0;
  return (x) => (y = (1 - a) * x + a * y);
};
const singleEcho = (delay: number, g: number) => (): Dsp => {
  const line = new Float32Array(delay); let i = 0;
  return (x) => { const y = x + g * line[i]!; line[i] = x; i = (i + 1) % delay; return y; };
};
const feedbackDelay = (delay: number, g: number) => (): Dsp => {
  const line = new Float32Array(delay); let i = 0;
  return (x) => { const y = x + g * line[i]!; line[i] = y; i = (i + 1) % delay; return y; };
};

/** An 80 ms 440 Hz burst of amplitude 0.5. */
const burst = (() => {
  const n = Math.round(0.08 * SR); const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR);
  return x;
})();

async function bounce(factory: () => Dsp, clip = burst) {
  const effect: FxEffect = { id: "fx", fxResourceId: "r", parameters: [], bypassed: false };
  const result = await bounceTransformChain([clip], SR, [effect], fakeFaustWasm, new Map([["fx", factory]]));
  return result.samples[0]!;
}

/** Reference: the same DSP run for `seconds`; returns the signal and its last index above 1e-3. */
function reference(factory: () => Dsp, seconds: number, clip = burst) {
  const dsp = factory(); const y = new Float32Array(seconds * SR); let last = -1;
  for (let i = 0; i < y.length; i++) { y[i] = dsp(clip[i] ?? 0); if (Math.abs(y[i]!) > 1e-3) last = i; }
  return { y, last };
}

const energy = (x: Float32Array) => x.reduce((sum, v) => sum + v * v, 0);

test("an effect without tail keeps exactly the clip length and samples", async () => {
  const clip = new Float32Array([...burst, 0, 0, 0]); // trailing zeros are part of the clip
  const y = await bounce(gain(0.5), clip);
  assert.equal(y.length, clip.length);
  assert.ok(y.every((v, i) => Math.abs(v - 0.5 * clip[i]!) < 1e-7));
});

test("a filter whose decay stays below -60 dB keeps exactly the clip length", async () => {
  // The clip ends with 60 samples of silence, so the filter's decay is already
  // below -60 dB (but not exactly 0) when the clip ends. Its length is not a
  // multiple of the 128-sample block: the padded end of the last block holds
  // that sub-threshold decay, which is not a tail.
  const clip = new Float32Array(burst.length + 60);
  clip.set(burst);
  assert.notEqual(clip.length % 128, 0);
  const y = await bounce(onePole(0.9), clip);
  assert.equal(y.length, clip.length);
});

test("a 250 ms single echo, silent right after the clip, is kept whole", async () => {
  const delay = 0.25 * SR;
  const y = await bounce(singleEcho(delay, 0.5));
  const ref = reference(singleEcho(delay, 0.5), 1);
  assert.ok(y.length >= ref.last + 1, `${y.length} < ${ref.last + 1}`);
  assert.ok(energy(y) / energy(ref.y) > 0.999);
});

test("a feedback delay whose repeats are 250 ms apart keeps every repeat above -60 dB", async () => {
  const delay = 0.25 * SR;
  const y = await bounce(feedbackDelay(delay, 0.5));
  const ref = reference(feedbackDelay(delay, 0.5), 6);
  assert.ok(y.length >= ref.last + 1, `${y.length} < ${ref.last + 1}`);
  assert.ok(energy(y) / energy(ref.y) > 0.999);
});

test("repeats 1.5 s apart (gap longer than the old 100 ms window) are kept", async () => {
  const delay = 1.5 * SR;
  const y = await bounce(feedbackDelay(delay, 0.5));
  const ref = reference(feedbackDelay(delay, 0.5), 20);
  assert.ok(y.length >= ref.last + 1, `${y.length} < ${ref.last + 1}`);
});
