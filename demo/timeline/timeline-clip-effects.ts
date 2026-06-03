/************************ timeline/timeline-clip-effects.ts ************************
 *
 * Purpose: Own the full clip-rebuild branch executed when clip geometry changes.
 * How: Hide the layer resizing, clip-model rebuild, history updates, waveform refresh,
 *      overlay routing, and perf/debug logging behind one helper callable from the renderer.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { TimeCoord } from "../../src/domain/timebase.js";
import type { ExactTimelineScale } from "../time-scale.js";
import type { ClipRenderModel } from "../clip/clip.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import type { TimelineFrameSequence } from "./timeline-frame-sequence.js";
import type { TimelineFramePlan } from "./timeline-frame-plan.js";
import type { TimelineProjection } from "./timeline-projection.js";
import type { TimelineRenderHistoryState } from "./timeline-render-history.js";
import type { TimelineSceneSurface } from "./timeline-scene-surface.js";
import type { WaveformViewFrame } from "../waveform-view/waveform-view.js";
import type { ClipDragRenderContext, TimelineDragOverlay } from "./timeline-drag-overlay.js";
import type { TrackViewState } from "../track/track-render.js";
import { TimelineFrameEffects } from "./timeline-frame-effects.js";
import { measurePerf } from "../perf.js";
import { measureRebuildPass } from "./timeline-debug.js";

type TimelineClipSurfacePort = Pick<
  TimelineSceneSurface,
  | "resizeClipLayers"
  | "renderTrackViews"
  | "renderWaveformsFrame"
  | "clearDragOverlay"
  | "renderDragOverlay"
>;

export class TimelineClipEffects {
  static renderRebuild(input: {
    surface: TimelineClipSurfacePort;
    project: Project;
    viewStartCoord: TimeCoord;
    viewEndCoord: TimeCoord;
    geometry: TimelineProjection;
    renderScale: ExactTimelineScale;
    framePlan: TimelineFramePlan;
    frameSequence: TimelineFrameSequence;
    waveformFrame: WaveformViewFrame;
    totalClipCount: number;
    dragContext: ClipDragRenderContext;
    presentationInputs: ClipPresentationInputs;
    trackViewState: TrackViewState;
    history: TimelineRenderHistoryState;
    dragOverlay: TimelineDragOverlay;
    setPanPreviewOffset(offsetPx: number): void;
    markClipRenderStructureClean(): void;
  }): { renderedClipCount: number } {
    let clipModels: ClipRenderModel[] = [];
    measureRebuildPass({
      kind: "clip",
      run: () => {
        measurePerf("render.timeline.geometryRebuild.widths", () => {
          input.surface.resizeClipLayers(input.geometry);
        });
        input.history.updateClips({
          windowStartCoord: input.viewStartCoord,
          windowEndCoord: input.viewEndCoord,
          pixelsPerCoord: input.geometry.pixelsPerCoord,
          gridHeightPx: input.geometry.canvasHeightPx,
        });
        const waveformModels = TimelineFrameEffects.renderWaveforms({
          enabled: input.frameSequence.shouldRenderWaveforms,
          surface: input.surface,
          history: input.history,
          project: input.project,
          frame: input.waveformFrame,
          bufferedViewport: input.framePlan.useBufferedWaveformViewport,
          dragContext: input.dragContext,
          presentationInputs: input.presentationInputs,
        });
        if (waveformModels !== null) {
          clipModels = [...waveformModels];
        } else if (input.frameSequence.shouldBuildClipModels) {
          throw new Error("Expected waveform models when rebuilding timeline clip visuals");
        }
        input.markClipRenderStructureClean();
        TimelineFrameEffects.renderDragOverlay({
          enabled: input.frameSequence.shouldRenderDragOverlay,
          surface: input.surface,
          overlay: input.dragOverlay,
          project: input.project,
          projection: input.geometry,
          renderScale: input.renderScale,
          dragContext: input.dragContext,
          presentationInputs: input.presentationInputs,
        });
        input.setPanPreviewOffset(input.framePlan.previewOffsetPx);
        measurePerf("render.timeline.trackViews", () => input.surface.renderTrackViews(input.project, input.trackViewState));
      },
      slowDetails: () => ({
        viewStartCoord: input.geometry.viewStartCoord,
        viewEndCoord: input.geometry.viewEndCoord,
        gridWidthPx: Math.round(input.geometry.gridWidthPx),
        renderWidthPx: Math.round(input.geometry.canvasWidthPx),
        clipCount: clipModels.length,
      }),
      rareCostDetails: () => ({
        bufferedWaveforms: input.framePlan.useBufferedWaveformViewport,
        renderWidthPx: Math.round(input.geometry.gridWidthPx),
        renderedClipCount: clipModels.length,
        totalClipCount: input.totalClipCount,
      }),
    });
    return { renderedClipCount: clipModels.length };
  }
}
