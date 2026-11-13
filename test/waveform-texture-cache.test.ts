/************************ waveform-texture-cache.test.ts ************************
 *
 * Purpose: Verify that a GPU waveform texture follows the audio of its
 *          resource id: reused while the min/max array is the same, uploaded
 *          again (into the same texture) when the id comes back with other
 *          audio, as after loading another session in the same tab.
 * How: Drive `resolveWaveformTexture` with a fake GPU that records creates
 *      and uploads, and read back what each texture holds.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { resolveWaveformTexture, type WaveformTextureSlot } from "../demo/waveform-texture-cache.js";

type FakeTexture = { id: number; holds: Float32Array | null };

function fakeGpu(options: { failCreate?: boolean } = {}) {
  let created = 0;
  const uploads: Float32Array[] = [];
  return {
    uploads,
    get created() {
      return created;
    },
    create(): FakeTexture | null {
      if (options.failCreate) return null;
      created += 1;
      return { id: created, holds: null };
    },
    upload(texture: FakeTexture, source: Float32Array): void {
      texture.holds = source;
      uploads.push(source);
    },
  };
}

const loud = () => new Float32Array([-0.8, 0.8, -0.8, 0.8]);
const quiet = () => new Float32Array([-0.1, 0.1, -0.1, 0.1]);

test("the same min/max array reuses the texture without a new upload", () => {
  const slots = new Map<string, WaveformTextureSlot<FakeTexture>>();
  const gpu = fakeGpu();
  const source = loud();
  const first = resolveWaveformTexture(slots, "tone;1800", source, gpu);
  const second = resolveWaveformTexture(slots, "tone;1800", source, gpu);
  assert.equal(second, first);
  assert.equal(gpu.created, 1);
  assert.equal(gpu.uploads.length, 1);
});

test("the same resource id with other audio is drawn from the new audio", () => {
  const slots = new Map<string, WaveformTextureSlot<FakeTexture>>();
  const gpu = fakeGpu();
  resolveWaveformTexture(slots, "tone;1800", loud(), gpu);
  const next = quiet();
  const texture = resolveWaveformTexture(slots, "tone;1800", next, gpu)!;
  assert.equal(texture.holds, next);
  assert.equal(gpu.created, 1, "the texture is reused, not leaked");
  assert.equal(gpu.uploads.length, 2);
});

test("other audio of another length for the same id reuses the slot too", () => {
  const slots = new Map<string, WaveformTextureSlot<FakeTexture>>();
  const gpu = fakeGpu();
  resolveWaveformTexture(slots, "tone;1800", loud(), gpu);
  const longer = new Float32Array([-0.1, 0.1, -0.1, 0.1, -0.1, 0.1]);
  assert.equal(resolveWaveformTexture(slots, "tone;1800", longer, gpu)!.holds, longer);
  assert.equal(slots.size, 1);
  assert.equal(gpu.created, 1);
});

test("different resources and bucket sizes keep their own textures", () => {
  const slots = new Map<string, WaveformTextureSlot<FakeTexture>>();
  const gpu = fakeGpu();
  const a = loud();
  const b = quiet();
  const ta = resolveWaveformTexture(slots, "a;1800", a, gpu)!;
  const tb = resolveWaveformTexture(slots, "b;1800", b, gpu)!;
  const ta2 = resolveWaveformTexture(slots, "a;32", a, gpu)!;
  assert.notEqual(ta, tb);
  assert.notEqual(ta, ta2);
  assert.equal(resolveWaveformTexture(slots, "a;1800", a, gpu)!.holds, a);
  assert.equal(resolveWaveformTexture(slots, "b;1800", b, gpu)!.holds, b);
  assert.equal(gpu.uploads.length, 3);
});

test("a texture the GPU cannot create is not cached", () => {
  const slots = new Map<string, WaveformTextureSlot<FakeTexture>>();
  assert.equal(resolveWaveformTexture(slots, "tone;1800", loud(), fakeGpu({ failCreate: true })), null);
  assert.equal(slots.size, 0);
});
