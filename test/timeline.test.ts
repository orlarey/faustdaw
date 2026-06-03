/****************************** timeline.test.ts ******************************
 *
 * Purpose: Verify the demo timeline entity API exposed by the Timeline class.
 * How: Resolve one immutable project snapshot, inspect the contained tracks, and collect
 *      one visible slice into a model-collecting surface without touching the scene runtime.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { importAudioResource } from "../src/domain/audio-resource.js";
import { initProject } from "../src/domain/project.js";
import { placeClip } from "../src/domain/clip.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS } from "../demo/clip/clip-presentation-inputs.js";
import { Timeline } from "../demo/timeline/timeline.js";
import { collectTimelineDomModels, TimelineDomModelSurface } from "../demo/timeline/timeline-dom-models.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";

const resource = {
  id: "timeline-test",
  sampleRate: 48_000,
  channels: 2,
  length: 96_000,
};

test("Timeline exposes one ordered track hierarchy from the immutable project snapshot", () => {
  const timeline = Timeline.fromProject(initProject("timeline-entity"));

  assert.equal(timeline.tracks().length, 8);
  assert.equal(timeline.tracks()[0]?.id(), "track-1");
  assert.equal(timeline.tracks()[7]?.id(), "track-8");
});

test("timeline DOM collection follows the ordered track hierarchy only", () => {
  const imported = importAudioResource(initProject("timeline-entity-render"), resource);
  const first = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1), "track-2");
  const project = placeClip(first, "clip-2", resource, imported.timebase.toTimeCoord(4), "track-4");
  const projection = TimelineProjection.fromCanvas({
    canvasStartCoord: 0,
    canvasEndCoord: project.timebase.toTimeCoord(8),
    canvasHeightPx: 240,
    pixelsPerCoord: 0.002,
    trackCount: 5,
  });
  const surface = new TimelineDomModelSurface();

  collectTimelineDomModels(project, surface, projection, null, EMPTY_CLIP_PRESENTATION_INPUTS);

  assert.deepEqual(surface.models().map((model) => model.id), ["clip-1", "clip-2"]);
  assert.equal(surface.models()[0]?.topPx, 56);
  assert.equal(surface.models()[1]?.topPx, 152);
});
