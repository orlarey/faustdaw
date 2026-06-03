/************************ clip-drag-preview.test.ts ************************
 *
 * Purpose: Verify how drag preview state alters the set of rendered clip models.
 * How: Build deterministic drag states, override the relevant mutable demo
 *      state, then assert source suppression and duplicate preview synthesis.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { importAudioResource } from "../src/domain/audio-resource.js";
import { initProject, type Project } from "../src/domain/project.js";
import { placeClip } from "../src/domain/clip.js";
import {
  TimelineClip,
} from "../demo/clip/clip.js";
import { hasEffectiveDragPreview } from "../demo/clip/clip-drag-preview.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS } from "../demo/clip/clip-presentation-inputs.js";
import type { DragState } from "../demo/gesture/gesture-state.js";
import { collectTimelineDomModels, TimelineDomModelSurface } from "../demo/timeline/timeline-dom-models.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";

const resource = {
  id: "kick",
  sampleRate: 48_000,
  channels: 2,
  length: 96_000,
};

const geometry = TimelineProjection.fromCanvas({
  canvasStartCoord: 0,
  canvasEndCoord: initProject("geometry").timebase.toTimeCoord(8),
  canvasHeightPx: 240,
  pixelsPerCoord: 0.002,
  trackCount: 3,
});

// Purpose: Build one imported project with two visible clips on adjacent tracks.
// How: Import a fixed resource, place one clip on track-1 and one on track-2, then return the project and both clip references.
function buildTwoClipProject(): {
  project: Project;
  clipOne: NonNullable<Project["timeline"]["tracks"][number]["clips"][number]>;
  clipTwo: NonNullable<Project["timeline"]["tracks"][number]["clips"][number]>;
  clipOneTrackId: "track-1";
  clipTwoTrackId: "track-2";
} {
  const imported = importAudioResource(initProject("clip-drag-preview"), resource);
  const first = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-1");
  const project = placeClip(first, "clip-2", resource, imported.timebase.toTimeCoord(4), "track-2");
  const clipOne = project.timeline.tracks[0]?.clips[0];
  const clipTwo = project.timeline.tracks[1]?.clips[0];
  assert.ok(clipOne);
  assert.ok(clipTwo);
  return { project, clipOne, clipTwo, clipOneTrackId: "track-1", clipTwoTrackId: "track-2" };
}

// Purpose: Build one complete drag state with defaults suitable for preview rendering tests.
// How: Fill every required `DragState` field from one source clip and allow focused overrides per scenario.
function buildDragState(
  project: Project,
  clip: NonNullable<Project["timeline"]["tracks"][number]["clips"][number]>,
  trackId: "track-1" | "track-2",
  overrides: Partial<DragState>,
): DragState {
  const clipDurationCoord = project.timebase.toTimeCoord(resource.length / resource.sampleRate);
  return {
    clipId: clip.id,
    clipIds: [clip.id],
    previewClipId: `${clip.id}-preview`,
    previewClipIds: new Map([[clip.id, `${clip.id}-preview`]]),
    previewDetachedFromBackground: false,
    duplicateOnDrag: false,
    pointerId: 1,
    grabTime: clip.start,
    pointerOffsetCoord: 0,
    pointerOffsetTrack: 0,
    lastPointerX: 0,
    lastDeltaX: 0,
    lastNonZeroDeltaX: 0,
    lastPointerY: 0,
    gridLeftPx: 0,
    gridRightPx: geometry.gridWidthPx,
    gridTopPx: 0,
    gridWidthPx: geometry.gridWidthPx,
    gridHeightPx: geometry.gridHeightPx,
    sourceGroupStart: clip.start,
    sourceGroupDurationCoord: clipDurationCoord,
    sourceGroupMinTrackIndex: 0,
    sourceGroupMaxTrackIndex: 0,
    dragRasterStartCoord: clip.start,
    dragRasterEndCoord: clip.start + clipDurationCoord,
    alignmentGuideWindowStartCoord: 0,
    alignmentGuideWindowEndCoord: 0,
    rawPreviewStart: clip.start,
    previewStart: clip.start,
    previewTrackId: trackId,
    previewPlacements: new Map(),
    sourcePlacements: new Map([[clip.id, { start: clip.start, trackId }]]),
    alignmentGuideCoords: [],
    ...overrides,
  };
}

test("hasEffectiveDragPreview detects both time and track displacements", () => {
  const { project, clipOne, clipOneTrackId } = buildTwoClipProject();
  const stable = buildDragState(project, clipOne, clipOneTrackId, {});
  const shiftedInTime = buildDragState(project, clipOne, clipOneTrackId, {
    previewStart: clipOne.start + project.timebase.toTimeCoord(1),
  });
  const shiftedInTrack = buildDragState(project, clipOne, clipOneTrackId, {
    sourceGroupMinTrackIndex: 0,
    previewTrackId: "track-2",
  });

  assert.equal(hasEffectiveDragPreview(stable), false);
  assert.equal(hasEffectiveDragPreview(shiftedInTime), true);
  assert.equal(hasEffectiveDragPreview(shiftedInTrack), true);
});

test("timeline DOM collection hides moved source clips only when the preview is effective", () => {
  const { project, clipOne, clipTwo, clipOneTrackId } = buildTwoClipProject();
  const dragState = buildDragState(project, clipOne, clipOneTrackId, {
    previewStart: clipOne.start + project.timebase.toTimeCoord(1),
    previewPlacements: new Map([[clipOne.id, { start: clipOne.start + project.timebase.toTimeCoord(1), trackId: clipOneTrackId }]]),
  });

  {
    const surface = new TimelineDomModelSurface();
    collectTimelineDomModels(project, surface, geometry, dragState, EMPTY_CLIP_PRESENTATION_INPUTS);
    assert.deepEqual(surface.models().map((model) => model.id), [clipTwo.id]);
  }

  {
    const surface = new TimelineDomModelSurface();
    collectTimelineDomModels(
      project,
      surface,
      geometry,
      { ...dragState, duplicateOnDrag: true },
      EMPTY_CLIP_PRESENTATION_INPUTS,
    );
    assert.deepEqual(surface.models().map((model) => model.id), [clipOne.id, clipTwo.id]);
  }
});

test("TimelineClip entities can synthesize duplicate preview models with preview ids", () => {
  const { project, clipOne, clipOneTrackId } = buildTwoClipProject();
  const previewStart = clipOne.start + project.timebase.toTimeCoord(0.5);
  const dragState = buildDragState(project, clipOne, clipOneTrackId, {
    duplicateOnDrag: true,
    previewStart,
    previewPlacements: new Map([[clipOne.id, { start: previewStart, trackId: "track-3" }]]),
    previewClipIds: new Map([[clipOne.id, "clip-1-copy"]]),
  });

  const models = dragState.clipIds.flatMap((clipId) => {
    const clip = TimelineClip.fromProject(project, clipId);
    const previewPlacement = dragState.previewPlacements.get(clipId) ?? null;
    const previewClipId = dragState.previewClipIds.get(clipId) ?? null;
    if (!clip || !previewPlacement || !previewClipId) {
      return [];
    }
    return [clip.buildDuplicatePreviewModel({
      previewClipId,
      previewStart: previewPlacement.start,
      previewTrackId: previewPlacement.trackId,
      projection: geometry,
      renderStartCoord: 0,
      presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    })];
  });

  assert.equal(models.length, 1);
  assert.equal(models[0]?.id, "clip-1-copy");
  assert.equal(models[0]?.isDragging, true);
  assert.equal(models[0]?.isSelected, true);
  assert.equal(models[0]?.leftPx, 144);
  assert.equal(models[0]?.topPx, 168);
});
