/************************ clip-render-model.test.ts ************************
 *
 * Purpose: Verify clip render-model projection and session-status derivation.
 * How: Build deterministic project snapshots, override the relevant demo-state
 *      slices, then assert the projected geometry, labels, and flags.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { importAudioResource } from "../src/domain/audio-resource.js";
import { initProject, type Project } from "../src/domain/project.js";
import { placeClip } from "../src/domain/clip.js";
import { TimelineClip } from "../demo/clip/clip.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS, type ClipPresentationInputs } from "../demo/clip/clip-presentation-inputs.js";
import { formatCurrentAbsoluteTimeLabel } from "../demo/format.js";
import type { SessionRenderResourceLink } from "../demo/session-archive.js";
import type { ClipOnsetAnnotation } from "../demo/onsets.js";
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

// Purpose: Build one imported project containing a single clip for render-model assertions.
// How: Import a fixed resource, place one clip on track-2, and return the project with the stored clip reference.
function buildSingleClipProject(): {
  project: Project;
  clip: NonNullable<Project["timeline"]["tracks"][number]["clips"][number]>;
  trackId: "track-2";
} {
  const imported = importAudioResource(initProject("clip-render-model"), resource);
  const project = placeClip(imported, "clip-1", resource, imported.timebase.toTimeCoord(1.25), "track-2");
  const clip = project.timeline.tracks[1]?.clips[0];
  assert.ok(clip);
  return { project, clip, trackId: "track-2" };
}

// Purpose: Build one ClipPresentationInputs value for a test scenario.
// How: Start from the empty defaults and override only the fields the scenario touches.
function buildClipPresentationInputs(setup: Partial<ClipPresentationInputs>): ClipPresentationInputs {
  return { ...EMPTY_CLIP_PRESENTATION_INPUTS, ...setup };
}

test("TimelineClip.buildRenderModel projects clip geometry and prefers onset preview state", () => {
  const { project, clip, trackId } = buildSingleClipProject();
  const storedAnnotation: ClipOnsetAnnotation = {
    version: 1,
    settings: { sensitivity: 55, minSpacingMs: 30, refineCuts: true },
    onsetSamples: [100, 200],
  };
  const previewAnnotation: ClipOnsetAnnotation = {
    version: 1,
    settings: { sensitivity: 60, minSpacingMs: 40, refineCuts: false },
    onsetSamples: [320, 640],
  };

  const presentationInputs = buildClipPresentationInputs({
    selectedClipIds: new Set([clip.id]),
    clipOnsetAnnotations: new Map([[clip.id, storedAnnotation]]),
    clipOnsetEditorState: {
      clipId: clip.id,
      settings: previewAnnotation.settings,
      previewAnnotation,
      busy: false,
    },
  });
  {
    const model = TimelineClip.buildRenderModel(
      project,
      { ...clip, name: " Lead Vox " },
      clip.start,
      trackId,
      geometry,
      0,
      presentationInputs,
    );
    const clipDurationCoord = project.timebase.toTimeCoord(2);

    assert.equal(model.id, clip.id);
    assert.equal(model.resourceId, resource.id);
    assert.equal(model.sourceStartSample, 0);
    assert.equal(model.sourceLengthSamples, resource.length);
    assert.deepEqual(model.onsetSamples, [320, 640]);
    assert.equal(model.titleText, "Lead Vox");
    const pixelsPerSample = geometry.pixelsPerSample(project.timebase);
    assert.equal(model.startLabel, formatCurrentAbsoluteTimeLabel(clip.start, project.timebase, pixelsPerSample));
    assert.equal(
      model.endLabel,
      formatCurrentAbsoluteTimeLabel(clip.start + clipDurationCoord, project.timebase, pixelsPerSample),
    );
    assert.equal(model.metaText, `${model.startLabel} -> ${model.endLabel}`);
    assert.equal(model.leftPx, 120);
    assert.equal(model.widthPx, 192);
    assert.equal(model.topPx, 88);
    assert.equal(model.heightPx, 64);
    assert.equal(model.isDragging, false);
    assert.equal(model.isSelected, true);
    assert.equal(model.isSessionRender, false);
  }
});

test("TimelineClip.buildRenderModel derives session render linkage states without changing geometry", () => {
  const { project, clip, trackId } = buildSingleClipProject();
  const baseSessionRender: SessionRenderResourceLink = {
    sourceSessionId: "session-1",
    sourceSessionName: "Rendered Session",
    sourceSessionRevision: "rev-1",
    renderedAt: 1,
    renderSampleRate: 48_000,
    renderLengthSamples: 96_000,
    channelCount: 2,
  };

  const cases = [
    {
      name: "pending",
      sessionRenderResources: new Map([[resource.id, baseSessionRender]]),
      workspaceSessions: new Map([[baseSessionRender.sourceSessionId, { sessionName: "Rendered Session", sessionRevision: "rev-1" }]]),
      resourceSourceFiles: new Map(),
      resourceAudioBuffers: new Map(),
      expectedMetaSuffix: "pending",
      expectedLinked: true,
      expectedStale: false,
      expectedPending: true,
    },
    {
      name: "unlinked",
      sessionRenderResources: new Map([[resource.id, baseSessionRender]]),
      workspaceSessions: new Map(),
      resourceSourceFiles: new Map([[resource.id, {
        fileName: "render.wav",
        mimeType: "audio/wav",
        lastModified: 0,
        bytes: new Uint8Array(),
      }]]),
      resourceAudioBuffers: new Map(),
      expectedMetaSuffix: "unlinked",
      expectedLinked: false,
      expectedStale: false,
      expectedPending: false,
    },
    {
      name: "stale",
      sessionRenderResources: new Map([[resource.id, baseSessionRender]]),
      workspaceSessions: new Map([[baseSessionRender.sourceSessionId, { sessionName: "Rendered Session", sessionRevision: "rev-2" }]]),
      resourceSourceFiles: new Map(),
      resourceAudioBuffers: new Map([[resource.id, { numberOfChannels: 2 } as AudioBuffer]]),
      expectedMetaSuffix: "linked · stale",
      expectedLinked: true,
      expectedStale: true,
      expectedPending: false,
    },
    {
      name: "sync",
      sessionRenderResources: new Map([[resource.id, baseSessionRender]]),
      workspaceSessions: new Map([[baseSessionRender.sourceSessionId, { sessionName: "Rendered Session", sessionRevision: "rev-1" }]]),
      resourceSourceFiles: new Map(),
      resourceAudioBuffers: new Map([[resource.id, { numberOfChannels: 2 } as AudioBuffer]]),
      expectedMetaSuffix: "linked · sync",
      expectedLinked: true,
      expectedStale: false,
      expectedPending: false,
    },
  ] as const;

  for (const scenario of cases) {
    const presentationInputs = buildClipPresentationInputs({
      sessionRenderResources: scenario.sessionRenderResources,
      workspaceSessions: scenario.workspaceSessions,
      resourceSourceFiles: scenario.resourceSourceFiles,
      resourceAudioBuffers: scenario.resourceAudioBuffers,
    });
    const model = TimelineClip.buildRenderModel(
      project,
      clip,
      clip.start,
      trackId,
      geometry,
      0,
      presentationInputs,
    );

    const expectedTitle = scenario.resourceAudioBuffers.size > 0 ? "[S] Rendered Session" : "Rendered Session";
    assert.equal(model.titleText, expectedTitle, scenario.name);
    assert.match(model.metaText, new RegExp(`${scenario.expectedMetaSuffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), scenario.name);
    assert.equal(model.leftPx, 120, scenario.name);
    assert.equal(model.widthPx, 192, scenario.name);
    assert.equal(model.isSessionRender, true, scenario.name);
    assert.equal(model.isSessionRenderLinked, scenario.expectedLinked, scenario.name);
    assert.equal(model.isSessionRenderStale, scenario.expectedStale, scenario.name);
    assert.equal(model.isSessionRenderPending, scenario.expectedPending, scenario.name);
  }
});
