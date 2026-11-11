/************************ time-label-roundtrip.test.ts ************************
 *
 * Purpose: Verify that the cursor timecode field reads back what it shows,
 *          including at rates where a millisecond is not a whole number of
 *          samples (44.1 kHz: 44.1 samples per millisecond).
 * How: Format every sample position of two seconds, parse the label, and
 *      expect the same sample; type every millisecond label of ten seconds
 *      and expect the field (residue hidden) to show it unchanged.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { formatAbsoluteTimeLabel, parseAbsoluteTimeLabel } from "../demo/format.js";
import { Timebase } from "../src/domain/timebase.js";

const RATES = [11_025, 22_050, 44_100, 48_000, 88_200, 96_000];

function snapToSample(coord: number, timebase: Timebase): number {
  const sampleCoord = timebase.internalTimeFactor;
  return Math.round(coord / sampleCoord) * sampleCoord;
}

for (const sampleRate of RATES) {
  test(`timecode at ${sampleRate} Hz: parsing a shown label gives back the same sample`, () => {
    const timebase = new Timebase(sampleRate);
    const sampleCoord = timebase.internalTimeFactor;
    for (let sample = 0; sample < 2 * sampleRate; sample += 1) {
      const coord = sample * sampleCoord;
      const label = formatAbsoluteTimeLabel(coord, timebase, { showExtraSamples: true });
      const parsed = parseAbsoluteTimeLabel(label, timebase);
      if (parsed !== coord) {
        assert.fail(`sample ${sample}: "${label}" parsed to sample ${parsed / sampleCoord}`);
      }
    }
  });

  test(`timecode at ${sampleRate} Hz: a typed millisecond label is shown unchanged after seek`, () => {
    const timebase = new Timebase(sampleRate);
    for (let ms = 0; ms < 10_000; ms += 1) {
      const typed = `00:00:${String(Math.floor(ms / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
      const cursor = Math.max(0, snapToSample(parseAbsoluteTimeLabel(typed, timebase), timebase));
      const shown = formatAbsoluteTimeLabel(cursor, timebase, { showExtraSamples: false });
      if (shown !== typed) {
        assert.fail(`typed "${typed}", field shows "${shown}"`);
      }
    }
  });
}

test("timecode parse lands on the sample lattice and never before the millisecond", () => {
  const timebase = new Timebase(44_100);
  // 1 ms = 44.1 samples: the first sample at or after it is sample 45.
  assert.equal(parseAbsoluteTimeLabel("00:00:00.001", timebase), 45 * timebase.internalTimeFactor);
  assert.equal(parseAbsoluteTimeLabel("00:00:00.001+01", timebase), 46 * timebase.internalTimeFactor);
  assert.equal(parseAbsoluteTimeLabel("00:00:01.000", timebase), 44_100 * timebase.internalTimeFactor);
  assert.equal(parseAbsoluteTimeLabel("-00:00:00.001", timebase), -45 * timebase.internalTimeFactor);
  // 48 kHz: one millisecond is exactly 48 samples, as before.
  assert.equal(parseAbsoluteTimeLabel("00:00:00.001+05", new Timebase(48_000)), 53);
});
