/************************** split-at-cut.test.ts *****************************
 *
 * Purpose: Verify that Split keeps every sample at its timeline position and
 *          leaves two contiguous halves, wherever the cut falls between two
 *          samples (44.1 kHz: 10 coordinates per sample).
 * How: Split a clip followed by a touching clip at every sub-sample residue
 *      of the cut, then check contiguity, the right half's start, the
 *      following clip, and that Merge's fast path restores the clip.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { importAudioResource } from "../src/domain/audio-resource.js";
import { clipEnd, getClip, placeClipInstance } from "../src/domain/clip.js";
import type { Clip } from "../src/domain/clip.js";
import { concatenateClips } from "../src/domain/clip-operations.js";
import type { ClipSampleDeps } from "../src/domain/clip-operations.js";
import { initProject } from "../src/domain/project.js";
import type { Project } from "../src/domain/project.js";
import { findContiguousRuns } from "../src/domain/selection/contiguous-runs.js";
import { Selection } from "../src/domain/selection/selection.js";
import { Timebase } from "../src/domain/timebase.js";
import { TRACK_IDS } from "../src/domain/track-id.js";
import { splitClipAtCut } from "../demo/menu-operations/split.js";

const noPcm: ClipSampleDeps = {
  sampleStore: { read: () => { throw new Error("the fast path reads no PCM"); } },
  resourceSink: { create: () => { throw new Error("the fast path creates no resource"); } },
};

function makeProject(sampleRate: number): { project: Project; clip: Clip; next: Clip } {
  let project: Project = { ...initProject("split"), timebase: new Timebase(sampleRate) };
  project = importAudioResource(project, { id: "r", sampleRate, channels: 1, length: 10 * sampleRate });
  const resource = project.resources.get("r")!;
  const rate = project.timebase.internalTimeRate;
  const clip: Clip = { id: "a", resource, start: rate, sourceStartSample: 0, sourceLengthSamples: 4 * sampleRate };
  project = placeClipInstance(project, clip, clip.start, TRACK_IDS[0]);
  const next: Clip = { id: "b", resource, start: clipEnd(project, clip), sourceStartSample: 0, sourceLengthSamples: sampleRate };
  project = placeClipInstance(project, next, next.start, TRACK_IDS[0]);
  return { project, clip, next };
}

for (const sampleRate of [44_100, 48_000]) {
  test(`split at ${sampleRate} Hz: contiguous halves, no sample moves, at every sub-sample cut`, () => {
    const { project, clip, next } = makeProject(sampleRate);
    const factor = project.timebase.internalTimeFactor;
    let ids = 0;
    for (let residue = 0; residue < factor; residue += 1) {
      const cut = clip.start + 2 * project.timebase.internalTimeRate + 12_345 * factor + residue;
      const split = splitClipAtCut(project, clip, cut, () => `s${ids++}`);
      assert.ok(split, `residue ${residue}`);
      const left = getClip(split.project, split.leftId);
      const right = getClip(split.project, split.rightId);

      // Each sample keeps its position: right half sample k sits where it was.
      assert.equal(right.start, clip.start + right.sourceStartSample! * factor, `residue ${residue}`);
      assert.ok(Math.abs(right.start - cut) * 2 <= factor, `cut moved by at most half a sample (residue ${residue})`);
      // Contiguous halves, and the touching clip after them does not move.
      assert.equal(clipEnd(split.project, left), right.start, `residue ${residue}`);
      assert.equal(getClip(split.project, next.id).start, next.start, `residue ${residue}`);
      const runs = findContiguousRuns(Selection.of(split.project, [left.id, right.id]));
      assert.equal(runs.length, 1, `Merge applies (residue ${residue})`);

      // Merge's fast path gives back the original slice at the same place.
      const merged = concatenateClips(split.project, left, right, noPcm, () => `m${ids++}`).clip;
      assert.equal(merged.start, clip.start);
      assert.equal(merged.sourceStartSample, clip.sourceStartSample);
      assert.equal(merged.sourceLengthSamples, clip.sourceLengthSamples);
    }
  });
}

test("a cut within half a sample of an edge leaves the clip whole", () => {
  const { project, clip } = makeProject(44_100);
  assert.equal(splitClipAtCut(project, clip, clip.start + 4, () => "x"), null);
  assert.equal(splitClipAtCut(project, clip, clipEnd(project, clip) - 5, () => "y"), null);
});
