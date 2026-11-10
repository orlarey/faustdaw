/****************************** playback-anchor.test.ts ************************
 *
 * Purpose: Check the two properties playback timing relies on: the anchor is
 *          a whole frame at least a lead ahead of currentTime, and an event
 *          meant for a whole frame N is scheduled strictly below N, within
 *          the bias (never at N + ε, where Chromium drops the first sample).
 * How: Drive playbackAnchorTime / scheduledAudioTime over currentTime values
 *      that are not whole frames, sample rates, and offsets up to one hour.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAYBACK_START_LEAD_SECONDS,
  SCHEDULE_FRAME_BIAS,
  playbackAnchorTime,
  scheduledAudioTime,
} from "../demo/playback-anchor.js";

const RATES = [44100, 48000, 96000];
const CURRENT_TIMES = [0, 0.001, 1 / 3, 2.6666666666666665, 12.345678, 1234.5678901];

test("the anchor is a whole frame, at least the lead ahead, less than one frame more", () => {
  for (const rate of RATES) {
    for (const now of CURRENT_TIMES) {
      const anchor = playbackAnchorTime(now, rate, PLAYBACK_START_LEAD_SECONDS);
      const frames = anchor * rate;
      assert.ok(Math.abs(frames - Math.round(frames)) < 1e-6, `whole frame: ${frames}`);
      assert.ok(anchor >= now + PLAYBACK_START_LEAD_SECONDS - 1e-12);
      assert.ok(anchor < now + PLAYBACK_START_LEAD_SECONDS + 1 / rate + 1e-12);
    }
  }
});

test("a zero lead keeps the anchor on the next whole frame", () => {
  const anchor = playbackAnchorTime(2.6666666666666665, 48000, 0);
  assert.equal(Math.round(anchor * 48000), 128000);
  assert.ok(anchor >= 2.6666666666666665);
});

test("events on whole frames are scheduled strictly below them, within the bias", () => {
  for (const rate of RATES) {
    for (const now of CURRENT_TIMES) {
      const anchor = playbackAnchorTime(now, rate, PLAYBACK_START_LEAD_SECONDS);
      const anchorFrame = Math.round(anchor * rate);
      // Offsets in whole frames, from one frame to one hour, including split
      // points and odd counts.
      for (const offsetFrames of [0, 1, 127, 24000, 44100, 48000, 96001, 1234567, rate * 3600]) {
        const when = scheduledAudioTime(anchor, offsetFrames / rate, rate);
        const position = when * rate - (anchorFrame + offsetFrames);
        assert.ok(position < 0, `rate ${rate}, now ${now}, offset ${offsetFrames}: at +${position} frame`);
        assert.ok(position > -2 * SCHEDULE_FRAME_BIAS, `rate ${rate}, now ${now}, offset ${offsetFrames}: at ${position} frame`);
      }
    }
  }
});

test("relative timing is unchanged: two events keep their exact distance", () => {
  const rate = 48000;
  const anchor = playbackAnchorTime(5.4321, rate, PLAYBACK_START_LEAD_SECONDS);
  const a = scheduledAudioTime(anchor, 0.5, rate);
  const b = scheduledAudioTime(anchor, 1.0, rate);
  assert.ok(Math.abs((b - a) * rate - 24000) < 1e-6);
});
