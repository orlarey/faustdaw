/************************ timeline-frame-context.test.ts ************************
 *
 * Purpose: Verify that the prepared timeline frame context stays coherent before DOM effects run.
 * How: Build deterministic views and projects, then assert the prepared plan, waveform frame,
 *      and branch sequence produced by the frame-context ADT.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { importAudioResource } from "../src/domain/audio-resource.js";
import { initProject } from "../src/domain/project.js";
import { placeClip } from "../src/domain/clip.js";
import { EMPTY_CLIP_PRESENTATION_INPUTS } from "../demo/clip/clip-presentation-inputs.js";
import { TimeScale } from "../demo/time-scale.js";
import { TimelineFrameContextBuilder } from "../demo/timeline/timeline-frame-context.js";
import { TimelineRenderHistoryState } from "../demo/timeline/timeline-render-history.js";
import { TimelineProjection } from "../demo/timeline/timeline-projection.js";
import { DAWRenderView } from "../demo/view/daw-render-view.js";

test("TimelineFrameContextBuilder prepares an empty direct-zoom frame", () => {
  const project = initProject("timeline-frame-context-empty");
  const timeScale = new TimeScale(0, project.timebase);
  const view = DAWRenderView.fromSnapshot({
    exactTimelineZoomLevelIndex: 0,
    timebase: project.timebase,
    viewStartCoord: project.timebase.toTimeCoord(0),
    viewDurationCoord: project.timebase.toTimeCoord(4),
    viewportWidthPx: 640,
    viewportHeightPx: 240,
    cursorCoord: project.timeline.cursor,
    lastPlayStartCoord: null,
    trackCount: 4,
  });
  const context = TimelineFrameContextBuilder.prepare({
    project,
    view,
    history: new TimelineRenderHistoryState(),
    timeScale,
    dragState: null,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    rulerDragState: {
      pointerId: 1,
      startPointerX: 0,
      startPointerY: 0,
      lastPointerX: 0,
      lastPointerY: 0,
      lastPointerTimestampMs: 0,
      startZoomLevelIndex: 0,
      gridWidthPx: view.viewportWidthPx,
      gridHeightPx: view.viewportHeightPx,
      pendingZoomDeltaY: 0,
      panPreviewOffsetPx: 0,
      panCommittedOffsetPx: 0,
      panVelocityPxPerMs: 0,
      mode: "zoom",
    },
    keepBufferedGeometryViewportWarm: false,
    playbackFollowPreviewOffsetPx: 0,
    clipRenderStructureDirty: false,
    geometryRenderWindowStartCoord: view.viewStartCoord,
    geometryRenderWindowEndCoord: view.viewEndCoord,
    freezeGeometryDuringPan: false,
    gridView: {
      prepareFrame({ visibleProjection }) {
        return {
          renderHeightPx: visibleProjection.canvasHeightPx,
          renderStartCoord: view.viewStartCoord,
          renderEndCoord: view.viewEndCoord,
          renderWidthPx: visibleProjection.canvasWidthPx,
          displayStartCoord: view.viewStartCoord,
          displayEndCoord: view.viewEndCoord,
          displayProjection: visibleProjection,
          windowChanged: false,
        };
      },
    },
  });

  assert.equal(context.totalClipCount, 0);
  assert.notEqual(context.waveformFrame, null);
  assert.equal(context.framePlan.useDirectZoomViewportRendering, true);
  assert.equal(context.frameSequence.mode, "direct-zoom");
  assert.equal(context.geometryDisplayWidthPx, context.gridFrame.displayProjection.canvasWidthPx);
  assert.equal(context.panDebugSnapshot.totalClipCount, 0);
});

test("TimelineFrameContextBuilder prepares a non-empty steady frame with waveform data", () => {
  let project = initProject("timeline-frame-context-steady");
  const resource = {
    id: "res-1",
    sampleRate: 48_000,
    channels: 1,
    length: 48_000,
  };
  project = importAudioResource(project, resource);
  project = placeClip(project, "clip-1", resource, project.timebase.toTimeCoord(1), "track-1");
  const timeScale = new TimeScale(0, project.timebase);
  const view = DAWRenderView.fromSnapshot({
    exactTimelineZoomLevelIndex: 0,
    timebase: project.timebase,
    viewStartCoord: project.timebase.toTimeCoord(0),
    viewDurationCoord: project.timebase.toTimeCoord(4),
    viewportWidthPx: 640,
    viewportHeightPx: 240,
    cursorCoord: project.timeline.cursor,
    lastPlayStartCoord: null,
    trackCount: 4,
  });
  const history = new TimelineRenderHistoryState();
  const geometry = TimelineProjection.fromView(view);
  history.updateClips({
    windowStartCoord: view.viewStartCoord,
    windowEndCoord: view.viewEndCoord,
    pixelsPerCoord: geometry.pixelsPerCoord,
    gridHeightPx: geometry.canvasHeightPx,
  });

  const context = TimelineFrameContextBuilder.prepare({
    project,
    view,
    history,
    timeScale,
    dragState: null,
    presentationInputs: EMPTY_CLIP_PRESENTATION_INPUTS,
    rulerDragState: null,
    keepBufferedGeometryViewportWarm: false,
    playbackFollowPreviewOffsetPx: 0,
    clipRenderStructureDirty: false,
    geometryRenderWindowStartCoord: view.viewStartCoord,
    geometryRenderWindowEndCoord: view.viewEndCoord,
    freezeGeometryDuringPan: false,
    gridView: {
      prepareFrame({ visibleProjection }) {
        return {
          renderHeightPx: visibleProjection.canvasHeightPx,
          renderStartCoord: view.viewStartCoord,
          renderEndCoord: view.viewEndCoord,
          renderWidthPx: visibleProjection.canvasWidthPx,
          displayStartCoord: view.viewStartCoord,
          displayEndCoord: view.viewEndCoord,
          displayProjection: visibleProjection,
          windowChanged: false,
        };
      },
    },
    waveformView: {
      prepareFrame({ visibleProjection }) {
        return {
          displayStartCoord: view.viewStartCoord,
          displayEndCoord: view.viewEndCoord,
          displayProjection: TimelineProjection.fromCanvasRange(
            view,
            view.viewStartCoord,
            view.viewEndCoord,
            visibleProjection.canvasHeightPx,
          ),
          windowChanged: false,
        };
      },
    },
  });

  assert.equal(context.totalClipCount, 1);
  assert.notEqual(context.waveformFrame, null);
  assert.equal(context.frameSequence.mode, "steady");
  assert.equal(context.framePlan.clipGeometryChanged, false);
  assert.equal(context.waveformFrame.displayStartCoord, context.view.viewStartCoord);
  assert.equal(context.panDebugSnapshot.totalClipCount, 1);
});
