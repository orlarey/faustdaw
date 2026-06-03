/*************************** timeline-track.test.ts ***************************
 *
 * Purpose: Verify the demo track API exposed by the Track class.
 * How: Resolve deterministic tracks from small projects, then assert lane ordering
 *      and activity estimation through the new class facade.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { importAudioResource } from "../src/domain/audio-resource.js";
import { initProject } from "../src/domain/project.js";
import { play, seek } from "../src/domain/transport.js";
import { placeClip } from "../src/domain/clip.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS } from "../demo/clip/clip-presentation-inputs.js";
import { demoState } from "../demo/state.js";
import { Track } from "../demo/track/track.js";
import { TrackAudio } from "../demo/track/track-audio.js";
import { TrackCanvasPixmap } from "../demo/track/track-pixmap.js";
import { Timeline, TimelineCanvasPixmap } from "../demo/timeline/timeline.js";
import { collectTimelineDomModels, collectTrackDomModels, TimelineDomModelSurface } from "../demo/timeline/timeline-dom-models.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";

const resource = {
  id: "hat",
  sampleRate: 48_000,
  channels: 2,
  length: 96_000,
};

const geometry = TimelineProjection.fromCanvas({
  canvasStartCoord: 0,
  canvasEndCoord: initProject("track-geometry").timebase.toTimeCoord(8),
  canvasHeightPx: 240,
  pixelsPerCoord: 0.002,
  trackCount: 3,
});

// Purpose: Run one track assertion block with isolated waveform and track-player demo state.
// How: Replace the mutable maps used by visual activity estimation for the duration of the callback, then restore them.
function withTrackState(run: () => void): void {
  const previousTrackPlayers = demoState.trackPlayers;
  const previousWaveformPyramids = demoState.resources.waveformPyramids;
  const previousDragState = demoState.dragState;

  demoState.trackPlayers = new Map(previousTrackPlayers);
  demoState.resources.waveformPyramids = new Map();
  demoState.dragState = null;

  try {
    run();
  } finally {
    demoState.trackPlayers = previousTrackPlayers;
    demoState.resources.waveformPyramids = previousWaveformPyramids;
    demoState.dragState = previousDragState;
  }
}

test("Track resolves one track and exposes its canonical lane index", () => {
  const project = initProject("timeline-track");

  const track = Track.fromProject(project, "track-3");

  assert.ok(track);
  assert.equal(track.id(), "track-3");
  assert.equal(track.laneIndex(), 2);
  assert.equal(Track.laneIndex("track-5"), 4);
});

test("Track.activityLevel reflects waveform energy and live track gain", () => {
  const imported = importAudioResource(initProject("timeline-track-activity"), resource);
  const placed = placeClip(imported, "clip-1", resource, 0, "track-2");
  const playing = seek(play(placed), placed.timebase.toTimeCoord(0.5));

  withTrackState(() => {
    const trackPlayer = demoState.trackPlayers.get("track-2");
    assert.ok(trackPlayer);
    trackPlayer.level = 0.5;
    demoState.resources.waveformPyramids.set(resource.id, {
      levels: [{
        samplesPerBucket: 24_000,
        mins: new Float32Array([-0.5, -0.8, -0.6]),
        maxs: new Float32Array([0.4, 0.9, 0.5]),
        means: new Float32Array([0.2, 0.7, 0.3]),
      }],
    });

    const activityLevel = Track.activityLevel(playing, "track-2");

    assert.ok(activityLevel > 0);
    assert.ok(activityLevel <= 1);
  });
});

test("Track runtime helpers apply solo rules and reset players without losing mix controls", () => {
  withTrackState(() => {
    const trackTwo = demoState.trackPlayers.get("track-2");
    const trackThree = demoState.trackPlayers.get("track-3");
    assert.ok(trackTwo);
    assert.ok(trackThree);

    trackTwo.level = 0.6;
    trackTwo.pan = -0.25;
    trackTwo.solo = true;
    trackThree.level = 0.9;
    trackThree.muted = false;

    assert.equal(TrackAudio.effectiveGain("track-2"), 0.6);
    assert.equal(TrackAudio.effectiveGain("track-3"), 0);

    TrackAudio.resetPlayers();

    const resetTrackTwo = demoState.trackPlayers.get("track-2");
    assert.ok(resetTrackTwo);
    assert.equal(resetTrackTwo.level, 0.6);
    assert.equal(resetTrackTwo.pan, -0.25);
    assert.equal(resetTrackTwo.solo, true);
    assert.equal(resetTrackTwo.outputGain, null);
    assert.equal(resetTrackTwo.outputPanner, null);
    assert.equal(resetTrackTwo.activePlan, null);
    assert.equal(resetTrackTwo.nextPlan, null);
    assert.deepEqual(resetTrackTwo.retiringPlans, []);
  });
});

test("timeline DOM collection walks tracks and projects their clips in order", () => {
  const imported = importAudioResource(initProject("timeline-track-visible-clips"), resource);
  const first = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-1");
  const project = placeClip(first, "clip-2", resource, imported.timebase.toTimeCoord(4), "track-2");

  withTrackState(() => {
    const surface = new TimelineDomModelSurface();
    collectTimelineDomModels(project, surface, geometry, null, EMPTY_CLIP_PRESENTATION_INPUTS);
    const models = [...surface.models()];

    assert.deepEqual(models.map((model) => model.id), ["clip-1", "clip-2"]);
    assert.equal(models[0]?.topPx, 8);
    assert.equal(models[1]?.topPx, 88);
  });
});

test("track DOM collection projects one track through one render surface", () => {
  const imported = importAudioResource(initProject("timeline-track-render"), resource);
  const first = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-2");
  const project = placeClip(first, "clip-2", resource, imported.timebase.toTimeCoord(4), "track-2");
  const track = Track.fromProject(project, "track-2");

  assert.ok(track);

  withTrackState(() => {
    const surface = new TimelineDomModelSurface();
    collectTrackDomModels(project, track.track(), surface, {
      projection: geometry,
      dragState: null,
      presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    });

    assert.deepEqual(surface.models().map((model) => model.id), ["clip-1", "clip-2"]);
    assert.equal(surface.models()[0]?.topPx, 88);
    assert.equal(surface.models()[1]?.topPx, 88);
  });
});

function createRecordingContext() {
  const commands: Array<{ type: string; x?: number; y?: number; text?: string }> = [];
  const context = {
    beginPath() { commands.push({ type: "beginPath" }); },
    moveTo(x: number, y: number) { commands.push({ type: "moveTo", x, y }); },
    lineTo(x: number, y: number) { commands.push({ type: "lineTo", x, y }); },
    quadraticCurveTo() { commands.push({ type: "quadraticCurveTo" }); },
    closePath() { commands.push({ type: "closePath" }); },
    fill() { commands.push({ type: "fill" }); },
    stroke() { commands.push({ type: "stroke" }); },
    save() { commands.push({ type: "save" }); },
    clip() { commands.push({ type: "clip" }); },
    fillText(text: string) { commands.push({ type: "fillText", text }); },
    restore() { commands.push({ type: "restore" }); },
    clearRect() {},
    rect() {},
  } as Partial<CanvasRenderingContext2D>;
  return { context: context as CanvasRenderingContext2D, commands };
}

test("Track renders its contained clips directly into one canvas pixmap", () => {
  const imported = importAudioResource(initProject("timeline-track-render-canvas"), resource);
  const first = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-2");
  const project = placeClip(first, "clip-2", resource, imported.timebase.toTimeCoord(4), "track-2");
  const track = Track.fromProject(project, "track-2");

  assert.ok(track);

  withTrackState(() => {
    const { context, commands } = createRecordingContext();
    track.render(new TrackCanvasPixmap(context), {
      projection: geometry,
      dragState: null,
      presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    });

    assert.equal(commands.filter((command) => command.type === "fillText").length >= 2, true);
    assert.equal(commands.some((command) => command.type === "moveTo" && command.y === 88), true);
  });
});

test("Track hit-testing resolves one visible clip from one track-local point", () => {
  const imported = importAudioResource(initProject("timeline-track-hit-test"), resource);
  const first = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-2");
  const project = placeClip(first, "clip-2", resource, imported.timebase.toTimeCoord(4), "track-2");
  const track = Track.fromProject(project, "track-2");

  assert.ok(track);

  withTrackState(() => {
    const hit = track.hitTestClip({
      projection: geometry,
      timeCoord: project.timebase.toTimeCoord(1.5),
      localYPx: 20,
      dragState: null,
      presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    });
    const miss = track.hitTestClip({
      projection: geometry,
      timeCoord: project.timebase.toTimeCoord(1.5),
      localYPx: 2,
      dragState: null,
      presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    });

    assert.equal(hit?.id(), "clip-1");
    assert.equal(miss, null);
  });
});

test("Timeline renders the drag overlay directly into one canvas pixmap", () => {
  const imported = importAudioResource(initProject("timeline-track-drag-overlay"), resource);
  const first = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-2");
  const project = placeClip(first, "clip-2", resource, imported.timebase.toTimeCoord(4), "track-3");
  const timeline = Timeline.fromProject(project);

  withTrackState(() => {
    const { context, commands } = createRecordingContext();
    timeline.renderDragOverlay(new TimelineCanvasPixmap(context), geometry, {
      clipId: "clip-1",
      clipIds: ["clip-1", "clip-2"],
      previewClipId: "clip-1",
      previewClipIds: new Map(),
      previewDetachedFromBackground: true,
      duplicateOnDrag: false,
      pointerId: 1,
      grabTime: 0,
      pointerOffsetCoord: 0,
      pointerOffsetTrack: 0,
      lastPointerX: 0,
      lastDeltaX: 0,
      lastNonZeroDeltaX: 0,
      lastPointerY: 0,
      gridLeftPx: 0,
      gridRightPx: 640,
      gridTopPx: 0,
      gridWidthPx: 640,
      gridHeightPx: 240,
      sourceGroupStart: project.timebase.toTimeCoord(1),
      sourceGroupDurationCoord: project.timebase.toTimeCoord(5),
      sourceGroupMinTrackIndex: 1,
      sourceGroupMaxTrackIndex: 2,
      dragRasterStartCoord: 0,
      dragRasterEndCoord: geometry.canvasEndCoord,
      alignmentGuideWindowStartCoord: 0,
      alignmentGuideWindowEndCoord: geometry.canvasEndCoord,
      rawPreviewStart: project.timebase.toTimeCoord(1),
      previewStart: project.timebase.toTimeCoord(1),
      previewTrackId: "track-2",
      previewPlacements: new Map(),
      sourcePlacements: new Map([
        ["clip-1", { start: project.timebase.toTimeCoord(1), trackId: "track-2" }],
        ["clip-2", { start: project.timebase.toTimeCoord(4), trackId: "track-3" }],
      ]),
      alignmentGuideCoords: [],
    }, EMPTY_CLIP_PRESENTATION_INPUTS);

    assert.equal(commands.filter((command) => command.type === "fillText").length >= 2, true);
    assert.equal(commands.some((command) => command.type === "moveTo" && command.y === 8), true);
    assert.equal(commands.some((command) => command.type === "moveTo" && command.y === 88), true);
  });
});

test("Timeline hit-testing resolves one visible clip through the track hierarchy", () => {
  const imported = importAudioResource(initProject("timeline-hit-test"), resource);
  const first = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-1");
  const project = placeClip(first, "clip-2", resource, imported.timebase.toTimeCoord(4), "track-3");
  const timeline = Timeline.fromProject(project);

  withTrackState(() => {
    const hit = timeline.hitTestClip({
      projection: geometry,
      timeCoord: project.timebase.toTimeCoord(4.5),
      trackId: "track-3",
      localTrackYPx: 20,
      dragState: null,
      presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    });
    const miss = timeline.hitTestClip({
      projection: geometry,
      timeCoord: project.timebase.toTimeCoord(4.5),
      trackId: "track-3",
      localTrackYPx: 2,
      dragState: null,
      presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    });

    assert.equal(hit?.id(), "clip-2");
    assert.equal(miss, null);
  });
});

test("Timeline renders one visible slice by delegating to its contained tracks", () => {
  const imported = importAudioResource(initProject("timeline-render-hierarchy"), resource);
  const first = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-1");
  const project = placeClip(first, "clip-2", resource, imported.timebase.toTimeCoord(4), "track-3");

  withTrackState(() => {
    const surface = new TimelineDomModelSurface();
    collectTimelineDomModels(project, surface, geometry, null, EMPTY_CLIP_PRESENTATION_INPUTS);

    assert.deepEqual(surface.models().map((model) => model.id), ["clip-1", "clip-2"]);
    assert.equal(surface.models()[0]?.topPx, 8);
    assert.equal(surface.models()[1]?.topPx, 168);
  });
});

test("Timeline renders one visible slice directly into one canvas pixmap", () => {
  const imported = importAudioResource(initProject("timeline-render-hierarchy-canvas"), resource);
  const first = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-1");
  const project = placeClip(first, "clip-2", resource, imported.timebase.toTimeCoord(4), "track-3");
  const timeline = Timeline.fromProject(project);

  withTrackState(() => {
    const { context, commands } = createRecordingContext();
    timeline.render(new TimelineCanvasPixmap(context), geometry, null, EMPTY_CLIP_PRESENTATION_INPUTS);

    assert.equal(commands.filter((command) => command.type === "fillText").length >= 2, true);
    assert.equal(commands.some((command) => command.type === "moveTo" && command.y === 8), true);
    assert.equal(commands.some((command) => command.type === "moveTo" && command.y === 168), true);
  });
});
