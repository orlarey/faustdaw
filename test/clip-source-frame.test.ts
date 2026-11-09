/************************** clip-source-frame.test.ts **************************
 *
 * Purpose: Verify the conversion from a timeline time to the resource frame a
 *          clip reads (the playback offset), shared by the domain output
 *          (observeOutput) and the Web Audio plan (PlaybackScheduler.buildPlan).
 * How: Projects at 48, 44.1, 88.2 and 22.05 kHz, so that the internal factor
 *      is 1, 10, 5 and 20; a clip started mid-way at 44.1 kHz must read
 *      44 100 frames after one second, not 441 000 (coordinates are frames
 *      only when the factor is 1). The plan is built against a fake audio
 *      context and a cached fake buffer.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { importAudioResource, type AudioResource } from "../src/domain/audio-resource.js";
import { clipSourceFrameAt, getAllClips, placeClip, type Clip } from "../src/domain/clip.js";
import { initProject, type Project } from "../src/domain/project.js";
import { Timebase } from "../src/domain/timebase.js";
import { observeOutput, play, seek } from "../src/domain/transport.js";
import { demoState } from "../demo/state.js";
import type { AudioEngine } from "../demo/audio-engine.js";

/** A project at `sampleRate`, with one resource of the same rate (10 s, mono) imported. */
function projectAt(sampleRate: number, resourceRate = sampleRate): { project: Project; resource: AudioResource } {
  const resource: AudioResource = { id: `r${resourceRate}`, sampleRate: resourceRate, channels: 1, length: resourceRate * 10 };
  const project = importAudioResource({ ...initProject("p"), timebase: new Timebase(sampleRate) }, resource);
  return { project, resource };
}

/** The only clip of a project. */
function onlyClip(project: Project): Clip {
  const clips = getAllClips(project);
  assert.equal(clips.length, 1);
  return clips[0]!;
}

test("the internal factor of the test rates is 1, 10, 5, 20", () => {
  assert.deepEqual(
    [48_000, 44_100, 88_200, 22_050].map((rate) => new Timebase(rate).internalTimeFactor),
    [1, 10, 5, 20],
  );
});

test("one second into a clip reads sampleRate frames, whatever the internal factor", () => {
  for (const rate of [48_000, 44_100, 88_200, 22_050]) {
    const { project, resource } = projectAt(rate);
    const start = project.timebase.toTimeCoord(2);
    const clip = onlyClip(placeClip(project, "c", resource, start, "track-1"));
    const oneSecondIn = start + project.timebase.internalTimeRate;
    assert.equal(clipSourceFrameAt(project, clip, oneSecondIn), rate, `at ${rate} Hz`);
  }
});

test("at 44.1 kHz a mid-clip start reads 44 100 frames per second, not 441 000", () => {
  const { project, resource } = projectAt(44_100);
  const start = project.timebase.toTimeCoord(2);
  const clip = onlyClip(placeClip(project, "c", resource, start, "track-1"));
  const at = project.timebase.toTimeCoord(3.5);
  assert.equal(clipSourceFrameAt(project, clip, at), 66_150);
  assert.notEqual(clipSourceFrameAt(project, clip, at), at - start);
});

test("the frame is exact for every frame n (coordinate n · factor), with no float floor error", () => {
  for (const rate of [48_000, 44_100, 88_200, 22_050]) {
    const { project, resource } = projectAt(rate);
    const clip = onlyClip(placeClip(project, "c", resource, 0, "track-1"));
    const factor = project.timebase.internalTimeFactor;
    for (const n of [0, 1, 27, 3_680, 44_099, rate - 1, rate, 7 * rate + 13]) {
      assert.equal(clipSourceFrameAt(project, clip, n * factor), n, `frame ${n} at ${rate} Hz`);
    }
  }
});

test("a sub-frame coordinate floors to the frame being read", () => {
  const { project, resource } = projectAt(44_100); // factor 10
  const clip = onlyClip(placeClip(project, "c", resource, 0, "track-1"));
  assert.deepEqual([0, 9, 10, 19, 20].map((coord) => clipSourceFrameAt(project, clip, coord)), [0, 0, 1, 1, 2]);
});

test("the source start of a slice is added, and a time before the clip reads its first frame", () => {
  const { project, resource } = projectAt(44_100);
  const start = project.timebase.toTimeCoord(1);
  const placed = placeClip(project, "c", resource, start, "track-1");
  const clip: Clip = { ...onlyClip(placed), sourceStartSample: 1_000, sourceLengthSamples: 44_100 };
  assert.equal(clipSourceFrameAt(project, clip, start + project.timebase.toTimeCoord(0.5)), 1_000 + 22_050);
  assert.equal(clipSourceFrameAt(project, clip, 0), 1_000);
});

test("a resource at another rate than the project's is read at its own rate", () => {
  const { project, resource } = projectAt(44_100, 48_000);
  const clip = onlyClip(placeClip(project, "c", resource, 0, "track-1"));
  assert.equal(clipSourceFrameAt(project, clip, project.timebase.toTimeCoord(1)), 48_000);
});

test("observeOutput at 44.1 kHz reports the frame offset of a clip played mid-way", () => {
  const { project, resource } = projectAt(44_100);
  const placed = placeClip(project, "c", resource, project.timebase.toTimeCoord(2), "track-1");
  const output = observeOutput(seek(play(placed), project.timebase.toTimeCoord(3)));
  assert.equal(output.type, "Mix");
  assert.equal(output.type === "Mix" ? output.signals[0]?.offset : undefined, 44_100);
});

test("buildPlan at 44.1 kHz starts the buffer at the frame offset of the anchor", (t) => {
  const { project, resource } = projectAt(44_100);
  const start = project.timebase.toTimeCoord(2);
  const placed = placeClip(project, "c", resource, start, "track-1");
  const track = placed.timeline.tracks.find((candidate) => candidate.id === "track-1")!;

  const fakeContext = {
    createBufferSource: () => ({ buffer: null }),
    createGain: () => ({ gain: { value: 1 } }),
  };
  const fakeBuffer = { sampleRate: 44_100, length: resource.length, numberOfChannels: 1 };
  const savedProject = demoState.project;
  const savedAudio = demoState.audio;
  demoState.project = placed;
  demoState.audio = { context: fakeContext } as unknown as AudioEngine;
  demoState.resources.audioBuffers.set(resource.id, fakeBuffer as unknown as AudioBuffer);
  t.after(() => {
    demoState.project = savedProject;
    demoState.audio = savedAudio;
    demoState.resources.audioBuffers.delete(resource.id);
  });

  const anchor = project.timebase.toTimeCoord(3);
  const plan = demoState.scheduler.buildPlan(track, anchor, project.timebase.toTimeCoord(2));
  assert.ok(plan);
  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0]!.offsetInBufferFrames, 44_100);
  assert.equal(plan.events[0]!.startOffsetInPlan, 0);

  // Anchored before the clip: the buffer starts at its first frame, later in the plan.
  const early = demoState.scheduler.buildPlan(track, project.timebase.toTimeCoord(1), project.timebase.toTimeCoord(2));
  assert.ok(early);
  assert.equal(early.events[0]!.offsetInBufferFrames, 0);
  assert.equal(early.events[0]!.startOffsetInPlan, project.timebase.toTimeCoord(1));
});
