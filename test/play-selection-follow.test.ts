/************************ play-selection-follow.test.ts ************************
 *
 * Purpose: Verify that Play Selection follows the clips an edit made from the
 *          filtered ones (reverse, split, merge, crossfade, explode give new
 *          ids), and only those.
 * How: Build two projects with the domain primitives (before / after the
 *      edit) and check `followClipFilter` on them: replaced clip, split
 *      halves, merge with an unfiltered neighbour, an edit of an unfiltered
 *      clip, a deleted filtered clip, and the mode off.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { importAudioResource, type AudioResource } from "../src/domain/audio-resource.js";
import { placeClip, removeClip } from "../src/domain/clip.js";
import { initProject, type Project } from "../src/domain/project.js";
import { Timebase } from "../src/domain/timebase.js";
import { followClipFilter } from "../demo/play-selection.js";

const SR = 48_000;
const resource: AudioResource = { id: "r", sampleRate: SR, channels: 1, length: SR * 2 };

/** Clip A at 0 s on track 1, B at 2 s on track 1, C at 0 s on track 2 (2 s each). */
function base(): Project {
  let project = importAudioResource({ ...initProject("p"), timebase: new Timebase(SR) }, resource);
  project = placeClip(project, "A", resource, 0, "track-1");
  project = placeClip(project, "B", resource, project.timebase.toTimeCoord(2), "track-1");
  project = placeClip(project, "C", resource, 0, "track-2");
  return project;
}

/** Replace clip `id` by clips `ids` placed at the given seconds on the same track. */
function replace(project: Project, ids: readonly string[], by: readonly [string, number][], trackId = "track-1"): Project {
  let next = project;
  for (const id of ids) next = removeClip(next, id);
  for (const [id, at] of by) {
    next = placeClip(next, id, resource, next.timebase.toTimeCoord(at), trackId as "track-1");
  }
  return next;
}

test("a reversed filtered clip (new id, same span) stays in Play Selection", () => {
  const before = base();
  const after = replace(before, ["A"], [["A2", 0]]);
  assert.deepEqual([...followClipFilter(new Set(["A"]), before, after)!].sort(), ["A2"]);
});

test("both halves of a split filtered clip stay in Play Selection", () => {
  const before = base();
  const half: AudioResource = { id: "h", sampleRate: SR, channels: 1, length: SR };
  let after = importAudioResource(removeClip(before, "A"), half);
  after = placeClip(after, "A1", half, 0, "track-1");
  after = placeClip(after, "A2", half, after.timebase.toTimeCoord(1), "track-1");
  assert.deepEqual([...followClipFilter(new Set(["A"]), before, after)!].sort(), ["A1", "A2"]);
});

test("a new clip next to the gone clip, not over it, is not admitted", () => {
  const before = base();
  let after = removeClip(removeClip(before, "A"), "B");
  after = placeClip(after, "A2", resource, 0, "track-1");
  after = placeClip(after, "B2", resource, after.timebase.toTimeCoord(2), "track-1");
  assert.deepEqual([...followClipFilter(new Set(["A"]), before, after)!], ["A2"]);
});

test("a merge of a filtered clip with its neighbour keeps the merged clip", () => {
  const before = base();
  const longResource: AudioResource = { id: "r4", sampleRate: SR, channels: 1, length: SR * 4 };
  let after = importAudioResource(before, longResource);
  after = removeClip(removeClip(after, "A"), "B");
  after = placeClip(after, "AB", longResource, 0, "track-1");
  assert.deepEqual([...followClipFilter(new Set(["A"]), before, after)!], ["AB"]);
});

test("editing an unfiltered clip leaves the filter as it is", () => {
  const before = base();
  const after = replace(before, ["C"], [["C2", 0]], "track-2");
  const filter = new Set(["A"]);
  assert.equal(followClipFilter(filter, before, after), filter);
});

test("a new clip on another track over the same span is not admitted", () => {
  const before = base();
  let after = replace(before, ["A"], [["A2", 0]]);
  after = replace(after, ["C"], [["C2", 0]], "track-2");
  assert.deepEqual([...followClipFilter(new Set(["A"]), before, after)!], ["A2"]);
});

test("a deleted filtered clip leaves the other filtered clips", () => {
  const before = base();
  const after = removeClip(before, "A");
  assert.deepEqual([...followClipFilter(new Set(["A", "B"]), before, after)!], ["B"]);
});

test("Play Selection off stays off", () => {
  const before = base();
  const after = replace(before, ["A"], [["A2", 0]]);
  assert.equal(followClipFilter(null, before, after), null);
});
