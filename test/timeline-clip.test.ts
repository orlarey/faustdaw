/*************************** timeline-clip.test.ts ***************************
 *
 * Purpose: Verify the timeline-clip entity API used by the demo clip workflows.
 * How: Resolve clips from deterministic projects, then assert clip-only behavior
 *      and preview render projection through the new class facade.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { importAudioResource } from "../src/domain/audio-resource.js";
import { initProject } from "../src/domain/project.js";
import { placeClip } from "../src/domain/clip.js";
import { ClipCanvasPixmap, TimelineClip } from "../demo/clip/clip.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS } from "../demo/clip/clip-presentation-inputs.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";

const resource = {
  id: "snare",
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

test("TimelineClip resolves one clip without storing its containing track", () => {
  const imported = importAudioResource(initProject("timeline-clip"), resource);
  const project = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-2");

  const timelineClip = TimelineClip.fromProject(project, "clip-1");

  assert.ok(timelineClip);
  assert.equal(timelineClip.id(), "clip-1");
  assert.equal(timelineClip.clip().resource.id, resource.id);
  assert.equal(timelineClip.clip().start, imported.timebase.toTimeCoord(1));
});

test("TimelineClip builds duplicate preview models at the requested placement", () => {
  const imported = importAudioResource(initProject("timeline-clip-preview"), resource);
  const project = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-1");
  const timelineClip = TimelineClip.fromProject(project, "clip-1");

  assert.ok(timelineClip);

  const model = timelineClip.buildDuplicatePreviewModel({
    previewClipId: "clip-1-copy",
    previewStart: project.timebase.toTimeCoord(1.5),
    previewTrackId: "track-3",
    projection: geometry,
    renderStartCoord: 0,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
  });

  assert.equal(model.id, "clip-1-copy");
  assert.equal(model.isDragging, true);
  assert.equal(model.isSelected, true);
  assert.equal(model.leftPx, 144);
  assert.equal(model.topPx, 168);
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

test("TimelineClip renders one local clip slice into one canvas pixmap", () => {
  const imported = importAudioResource(initProject("timeline-clip-render"), resource);
  const project = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-2");
  const timelineClip = TimelineClip.fromProject(project, "clip-1");

  assert.ok(timelineClip);

  const { context, commands } = createRecordingContext();

  timelineClip.render(new ClipCanvasPixmap(context), {
    projection: TimelineProjection.fromCanvas({
      canvasStartCoord: 0,
      canvasEndCoord: geometry.canvasEndCoord,
      canvasHeightPx: geometry.laneHeightPx,
      pixelsPerCoord: geometry.pixelsPerCoord,
      trackCount: 1,
    }),
    renderStartCoord: 0,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
  });

  assert.equal(commands.some((command) => command.type === "fill"), true);
  assert.equal(commands.some((command) => command.type === "fillText"), true);
  assert.equal(commands.some((command) => command.type === "moveTo" && typeof command.y === "number"), true);
});
