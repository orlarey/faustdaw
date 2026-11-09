/************************* session-render-resource.test.ts *********************
 *
 * Purpose: Check the length a dropped session render gets once it is decoded
 *          at the project rate (which may differ from the rate it was
 *          rendered at).
 * How: Drive sessionRenderLengthAtRate over equal rates, 44.1 kHz -> 48 kHz,
 *      48 kHz -> 44.1 kHz, rounding and the minimum length.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { sessionRenderLengthAtRate } from "../demo/session-render-resource.js";

test("equal rates keep the rendered length", () => {
  assert.equal(sessionRenderLengthAtRate(176400, 44100, 44100), 176400);
  assert.equal(sessionRenderLengthAtRate(12345, 48000, 48000), 12345);
});

test("a 44.1 kHz render decoded at 48 kHz gets its 48 kHz length", () => {
  // 4 s of audio.
  assert.equal(sessionRenderLengthAtRate(176400, 44100, 48000), 192000);
});

test("a 48 kHz render decoded at 44.1 kHz gets its 44.1 kHz length", () => {
  assert.equal(sessionRenderLengthAtRate(192000, 48000, 44100), 176400);
});

test("non-integer conversions round to the nearest frame", () => {
  // 1 frame at 44.1 kHz = 1.088... frames at 48 kHz.
  assert.equal(sessionRenderLengthAtRate(1, 44100, 48000), 1);
  // 100 frames -> 108.84 -> 109.
  assert.equal(sessionRenderLengthAtRate(100, 44100, 48000), 109);
});

test("the length is never below one frame", () => {
  assert.equal(sessionRenderLengthAtRate(1, 96000, 8000), 1);
});
