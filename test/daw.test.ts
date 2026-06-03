/******************************** daw.test.ts **********************************
 *
 * Purpose: Verify the DAW domain operations against the rules of SPEC.md.
 * How: Exercise each public API function (init, import, place, remove, move,
 *      seek, play, stop, tick, observeOutput) with node:test assertions that
 *      check both success paths and expected error conditions.
 *
 ******************************************************************************/
import test from "node:test";
import assert from "node:assert/strict";

import { TRACK_IDS } from "../src/domain/track-id.js";
import { Timebase } from "../src/domain/timebase.js";
import { assertValidProject, initProject } from "../src/domain/project.js";
import { importAudioResource } from "../src/domain/audio-resource.js";
import { SILENCE, isActive, observeOutput, play, seek, stop, tick } from "../src/domain/transport.js";
import {
  clipEnd,
  findVisibleClipRange,
  getAllClips,
  moveClip,
  placeClip,
  removeClip,
} from "../src/domain/clip.js";

const resource = {
  id: "kick",
  sampleRate: 48_000,
  channels: 2,
  length: 96_000,
};

const timebase = new Timebase(resource.sampleRate);

/**
 * Purpose: Extract the clips array from a specific track with an assertion that the track exists.
 * How: Find the track by id and assert it is defined before returning its clips.
 */
function trackClips(project: ReturnType<typeof initProject>, trackId: (typeof TRACK_IDS)[number]) {
  const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
  assert.ok(track);
  return track.clips;
}

test("initProject creates the formal initial state", () => {
  const project = initProject("p0");

  assert.equal(project.id, "p0");
  assert.equal(project.timeline.cursor, 0);
  assert.equal(project.timebase.sampleRate, 48_000);
  assert.equal(project.timeline.transport, "Stopped");
  assert.deepEqual(
    project.timeline.tracks.map((track) => track.id),
    [...TRACK_IDS],
  );
  assert.deepEqual(getAllClips(project), []);
  assert.equal(project.resources.size, 0);
  assertValidProject(project);
});

test("importAudioResource adds one unique resource", () => {
  const project = importAudioResource(initProject("p0"), resource);

  assert.equal(project.resources.size, 1);
  assert.deepEqual(project.resources.get("kick"), resource);
  assert.equal(project.timebase.sampleRate, 48_000);
  assert.throws(() => importAudioResource(project, resource), /already exists/);
});

test("placeClip inserts a new clip on the requested track", () => {
  const imported = importAudioResource(initProject("p0"), resource);
  const placed = placeClip(imported, "clip-1", resource, timebase.toTimeCoord(1.25), "track-2");

  assert.deepEqual(trackClips(placed, "track-2"), [
    { id: "clip-1", resource, start: timebase.toTimeCoord(1.25) },
  ]);
  assert.equal(placed.timeline.cursor, 0);
  assert.equal(placed.timeline.transport, "Stopped");
});

test("removeClip removes only the requested clip", () => {
  const imported = importAudioResource(initProject("p0"), resource);
  const first = placeClip(imported, "clip-1", resource, 0, "track-1");
  const second = placeClip(first, "clip-2", resource, timebase.toTimeCoord(3), "track-1");
  const cleared = removeClip(second, "clip-1");

  assert.deepEqual(trackClips(cleared, "track-1").map((clip) => clip.id), ["clip-2"]);
});

test("moveClip keeps the resource and updates the clip start and track", () => {
  const imported = importAudioResource(initProject("p0"), resource);
  const placed = placeClip(imported, "clip-1", resource, timebase.toTimeCoord(0.5), "track-1");
  const moved = moveClip(placed, "clip-1", timebase.toTimeCoord(2.25), "track-3");
  const trackOne = trackClips(moved, "track-1");
  const trackThree = trackClips(moved, "track-3");

  assert.deepEqual(trackOne, []);
  assert.equal(trackThree.length, 1);
  assert.equal(trackThree[0]?.resource, resource);
  assert.equal(trackThree[0]?.start, timebase.toTimeCoord(2.25));
});

test("placement blocked behind shifts following clips right", () => {
  const imported = importAudioResource(initProject("p0"), resource);
  const first = placeClip(imported, "clip-1", resource, 0, "track-1");
  const second = placeClip(first, "clip-2", resource, timebase.toTimeCoord(3), "track-1");
  const inserted = placeClip(second, "clip-3", resource, timebase.toTimeCoord(1), "track-1");
  const clips = trackClips(inserted, "track-1");

  assert.deepEqual(
    clips.map((clip) => [clip.id, timebase.fromTimeCoord(clip.start)]),
    [
      ["clip-1", 0],
      ["clip-3", 2],
      ["clip-2", 4],
    ],
  );
});

test("placement blocked ahead snaps after the previous clip when enough room exists", () => {
  const imported = importAudioResource(initProject("p0"), resource);
  const first = placeClip(imported, "clip-1", resource, 0, "track-1");
  const second = placeClip(first, "clip-2", resource, timebase.toTimeCoord(6), "track-1");
  const inserted = placeClip(second, "clip-3", resource, timebase.toTimeCoord(1), "track-1");
  const clips = trackClips(inserted, "track-1");

  assert.deepEqual(
    clips.map((clip) => [clip.id, timebase.fromTimeCoord(clip.start)]),
    [
      ["clip-1", 0],
      ["clip-3", 2],
      ["clip-2", 6],
    ],
  );
});

test("observeOutput is silence when transport is stopped", () => {
  const imported = importAudioResource(initProject("p0"), resource);
  const placed = placeClip(imported, "clip-1", resource, 0, "track-1");

  assert.deepEqual(observeOutput(placed), SILENCE);
});

test("observeOutput returns a mix of active clips across tracks", () => {
  const imported = importAudioResource(initProject("p0"), resource);
  const first = placeClip(imported, "clip-1", resource, 0, "track-1");
  const second = placeClip(first, "clip-2", resource, 0, "track-2");
  const playing = seek(play(second), timebase.toTimeCoord(0.5));

  assert.deepEqual(observeOutput(playing), {
    type: "Mix",
    signals: [
      { clipId: "clip-1", resourceId: "kick", offset: 24_000, trackId: "track-1" },
      { clipId: "clip-2", resourceId: "kick", offset: 24_000, trackId: "track-2" },
    ],
  });
});

test("clipEnd and isActive implement the half-open active interval", () => {
  const imported = importAudioResource(initProject("p0"), resource);
  const placed = placeClip(imported, "clip-1", resource, timebase.toTimeCoord(2), "track-1");
  const clip = trackClips(placed, "track-1")[0];

  assert.ok(clip);
  assert.equal(timebase.fromTimeCoord(clipEnd(placed, clip)), 4);
  assert.equal(isActive(placed, timebase.toTimeCoord(2)), true);
  assert.equal(isActive(placed, timebase.toTimeCoord(3.999)), true);
  assert.equal(isActive(placed, timebase.toTimeCoord(4)), false);
});

test("seek, play, stop, and tick follow the transport semantics", () => {
  const project = initProject("p0");
  const playing = play(project);
  const projectTimebase = project.timebase;
  const advanced = tick(playing, projectTimebase.toTimeCoord(0.5));
  const stopped = stop(advanced);
  const stable = tick(stopped, projectTimebase.toTimeCoord(2));

  assert.equal(playing.timeline.transport, "Playing");
  assert.equal(advanced.timeline.cursor, projectTimebase.toTimeCoord(0.5));
  assert.equal(stopped.timeline.transport, "Stopped");
  assert.equal(stable, stopped);
  assert.throws(() => tick(project, -1), /tick delta must be an integer >= 0/);
});

test("invalid references are rejected", () => {
  const project = initProject("p0");
  assert.throws(() => placeClip(project, "clip-1", resource, 0, "track-1"), /is not imported/);
  const imported = importAudioResource(project, resource);
  assert.throws(() => placeClip(imported, "clip-1", resource, 0, "track-9" as "track-1"), /does not exist/);
});

// ---------------------------------------------------------------------------
// findVisibleClipRange
// ---------------------------------------------------------------------------

/**
 * Purpose: Build a project with N consecutive clips on track-1 for visible-range tests.
 * How: Import the resource then place clips at 0s, 2s, 4s, … each lasting 2s.
 */
function buildNClipProject(n: number) {
  let project = importAudioResource(initProject("p0"), resource);
  for (let i = 0; i < n; i++) {
    project = placeClip(project, `c${i}`, resource, timebase.toTimeCoord(i * 2), "track-1");
  }
  return project;
}

test("findVisibleClipRange returns empty for an empty track", () => {
  const project = importAudioResource(initProject("p0"), resource);
  const clips = trackClips(project, "track-1");

  assert.deepEqual(findVisibleClipRange(project, clips, 0, timebase.toTimeCoord(10)), { first: 0, last: -1 });
});

test("findVisibleClipRange returns empty when view is before all clips", () => {
  const project = buildNClipProject(3);
  const clips = trackClips(project, "track-1");

  // View ends exactly at clip-0 start → half-open, no intersection
  assert.deepEqual(findVisibleClipRange(project, clips, timebase.toTimeCoord(-2), 0), { first: 0, last: -1 });
});

test("findVisibleClipRange returns empty when view is after all clips", () => {
  const project = buildNClipProject(3);
  const clips = trackClips(project, "track-1");

  // Clips end at 6s, view starts at 6s → no intersection (half-open)
  assert.deepEqual(findVisibleClipRange(project, clips, timebase.toTimeCoord(6), timebase.toTimeCoord(10)), { first: 0, last: -1 });
});

test("findVisibleClipRange finds all clips when view spans the entire range", () => {
  const project = buildNClipProject(5);
  const clips = trackClips(project, "track-1");

  assert.deepEqual(findVisibleClipRange(project, clips, 0, timebase.toTimeCoord(100)), { first: 0, last: 4 });
});

test("findVisibleClipRange finds a subset of clips in the middle", () => {
  const project = buildNClipProject(5);
  const clips = trackClips(project, "track-1");

  // View [3s, 7s) should see clips at 2s-4s (c1), 4s-6s (c2), 6s-8s (c3)
  const range = findVisibleClipRange(project, clips, timebase.toTimeCoord(3), timebase.toTimeCoord(7));
  assert.deepEqual(range, { first: 1, last: 3 });
});

test("findVisibleClipRange detects a clip overlapping the left edge of the view", () => {
  const project = buildNClipProject(3);
  const clips = trackClips(project, "track-1");

  // View starts at 1s, clip c0 spans [0s, 2s) → visible because clipEnd > viewStart
  const range = findVisibleClipRange(project, clips, timebase.toTimeCoord(1), timebase.toTimeCoord(3));
  assert.equal(range.first, 0);
  assert.equal(clips[range.first]!.id, "c0");
});

test("findVisibleClipRange excludes a clip whose end equals viewStart (half-open)", () => {
  const project = buildNClipProject(3);
  const clips = trackClips(project, "track-1");

  // View starts at 2s, clip c0 ends at 2s → NOT visible (half-open end)
  const range = findVisibleClipRange(project, clips, timebase.toTimeCoord(2), timebase.toTimeCoord(5));
  assert.equal(range.first, 1);
  assert.equal(clips[range.first]!.id, "c1");
});

test("findVisibleClipRange with a single clip", () => {
  const project = buildNClipProject(1);
  const clips = trackClips(project, "track-1");

  // Clip c0 spans [0s, 2s)
  assert.deepEqual(findVisibleClipRange(project, clips, 0, timebase.toTimeCoord(1)), { first: 0, last: 0 });
  assert.deepEqual(findVisibleClipRange(project, clips, timebase.toTimeCoord(2), timebase.toTimeCoord(3)), { first: 0, last: -1 });
});
