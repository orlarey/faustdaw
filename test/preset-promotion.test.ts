/**************************** preset-promotion.test.ts ************************
 *
 * Purpose: Verify the gating logic of PresetPromotionTracker — dwell timer,
 *          playback gate, bypass gate, content dedup — without touching
 *          IndexedDB. Promotion is injected as a spy.
 *
 ******************************************************************************/
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DWELL_SECONDS,
  PresetPromotionTracker,
  type PromoteFn,
} from "../demo/preset-promotion.js";
import { type PresetRecord } from "../demo/preset-storage.js";

type PromoteCall = {
  uiHash: string;
  configuration: Readonly<Record<string, number>>;
  now: number;
};

function makeSpyPromote(): { fn: PromoteFn; calls: PromoteCall[] } {
  const calls: PromoteCall[] = [];
  const fn: PromoteFn = async (uiHash, configuration, now) => {
    calls.push({ uiHash, configuration, now: now ?? Date.now() });
    const record: PresetRecord = {
      uiHash,
      configHash: "stub",
      configuration,
      firstSeenAt: now ?? 0,
      lastSeenAt: now ?? 0,
    };
    return record;
  };
  return { fn, calls };
}

const baseInputs = {
  uiHash: "code-1",
  configuration: { "/a": 0.5 },
  isPlaybackActive: true,
  isEffectBypassed: false,
};

test("no promotion before any commit", async () => {
  const { fn, calls } = makeSpyPromote();
  const tracker = new PresetPromotionTracker({ dwellSeconds: 1, promote: fn });
  const result = await tracker.evaluate(baseInputs, 10_000);
  assert.equal(result.promoted, false);
  assert.equal(result.configHash, null);
  assert.equal(calls.length, 0);
});

test("no promotion before dwell threshold is reached", async () => {
  const { fn, calls } = makeSpyPromote();
  const tracker = new PresetPromotionTracker({ dwellSeconds: 3, promote: fn });
  tracker.recordCommit(1_000);
  const result = await tracker.evaluate(baseInputs, 1_000 + 2_500);
  assert.equal(result.promoted, false);
  assert.equal(calls.length, 0);
});

test("promotes after dwell threshold elapsed with all gates satisfied", async () => {
  const { fn, calls } = makeSpyPromote();
  const tracker = new PresetPromotionTracker({ dwellSeconds: 3, promote: fn });
  tracker.recordCommit(1_000);
  const now = 1_000 + 3_500;
  const result = await tracker.evaluate(baseInputs, now);
  assert.equal(result.promoted, true);
  assert.equal(typeof result.configHash, "string");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.uiHash, "code-1");
  assert.deepEqual(calls[0]!.configuration, baseInputs.configuration);
  assert.equal(calls[0]!.now, now);
});

test("does not promote when playback is inactive", async () => {
  const { fn, calls } = makeSpyPromote();
  const tracker = new PresetPromotionTracker({ dwellSeconds: 3, promote: fn });
  tracker.recordCommit(1_000);
  const result = await tracker.evaluate(
    { ...baseInputs, isPlaybackActive: false },
    1_000 + 3_500,
  );
  assert.equal(result.promoted, false);
  assert.equal(calls.length, 0);
});

test("does not promote when the effect is bypassed", async () => {
  const { fn, calls } = makeSpyPromote();
  const tracker = new PresetPromotionTracker({ dwellSeconds: 3, promote: fn });
  tracker.recordCommit(1_000);
  const result = await tracker.evaluate(
    { ...baseInputs, isEffectBypassed: true },
    1_000 + 3_500,
  );
  assert.equal(result.promoted, false);
  assert.equal(calls.length, 0);
});

test("does not re-promote identical configuration across successive ticks", async () => {
  const { fn, calls } = makeSpyPromote();
  const tracker = new PresetPromotionTracker({ dwellSeconds: 3, promote: fn });
  tracker.recordCommit(1_000);
  await tracker.evaluate(baseInputs, 1_000 + 3_500);
  const secondResult = await tracker.evaluate(baseInputs, 1_000 + 4_000);
  assert.equal(secondResult.promoted, false);
  assert.equal(calls.length, 1);
});

test("a new commit re-arms the promotion", async () => {
  const { fn, calls } = makeSpyPromote();
  const tracker = new PresetPromotionTracker({ dwellSeconds: 3, promote: fn });
  tracker.recordCommit(1_000);
  await tracker.evaluate(baseInputs, 1_000 + 3_500);
  tracker.recordCommit(5_000);
  const result = await tracker.evaluate(baseInputs, 5_000 + 3_500);
  assert.equal(result.promoted, true);
  assert.equal(calls.length, 2);
});

test("different configuration after commit promotes again", async () => {
  const { fn, calls } = makeSpyPromote();
  const tracker = new PresetPromotionTracker({ dwellSeconds: 3, promote: fn });
  tracker.recordCommit(1_000);
  await tracker.evaluate(baseInputs, 1_000 + 3_500);
  tracker.recordCommit(5_000);
  const result = await tracker.evaluate(
    { ...baseInputs, configuration: { "/a": 0.7 } },
    5_000 + 3_500,
  );
  assert.equal(result.promoted, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]!.configuration, { "/a": 0.7 });
});

test("reset clears the tracker state", async () => {
  const { fn, calls } = makeSpyPromote();
  const tracker = new PresetPromotionTracker({ dwellSeconds: 3, promote: fn });
  tracker.recordCommit(1_000);
  tracker.reset();
  assert.equal(tracker.isArmed, false);
  const result = await tracker.evaluate(baseInputs, 10_000);
  assert.equal(result.promoted, false);
  assert.equal(calls.length, 0);
});

test("default dwell seconds is 3", () => {
  assert.equal(DEFAULT_DWELL_SECONDS, 3);
});
