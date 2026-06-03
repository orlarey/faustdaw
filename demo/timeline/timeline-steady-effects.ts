/************************ timeline/timeline-steady-effects.ts ************************
 *
 * Purpose: Own the steady timeline branch where clip geometry stays valid and only light updates run.
 * How: Hide the waveform refresh, drag-overlay routing, pan preview, and track-view refresh
 *      behind one helper so the main renderer only dispatches to the steady branch.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import type { ExactTimelineScale } from "../time-scale.js";
import type { TimelineFramePlan } from "./timeline-frame-plan.js";
import type { TimelineFrameSequence } from "./timeline-frame-sequence.js";
import type { TimelineProjection } from "./timeline-projection.js";
import type { TimelineRenderHistoryState } from "./timeline-render-history.js";
import type { ClipDragRenderContext, TimelineDragOverlay } from "./timeline-drag-overlay.js";
import type { TimelineSceneSurface } from "./timeline-scene-surface.js";
import type { TrackViewState } from "../track/track-render.js";
import type { WaveformViewFrame } from "../waveform-view/waveform-view.js";
import { TimelineFrameEffects } from "./timeline-frame-effects.js";
import { measurePerf } from "../perf.js";

type TimelineSceneSurfacePort = Pick<
  TimelineSceneSurface,
  "renderTrackViews" | "renderWaveformsFrame" | "clearDragOverlay" | "renderDragOverlay"
>;

export class TimelineSteadyEffects {
  static render(input: {
    project: Project;
    geometry: TimelineProjection;
    renderScale: ExactTimelineScale;
    framePlan: TimelineFramePlan;
    frameSequence: TimelineFrameSequence;
    waveformFrame: WaveformViewFrame;
    history: TimelineRenderHistoryState;
    dragOverlay: TimelineDragOverlay;
    dragContext: ClipDragRenderContext;
    presentationInputs: ClipPresentationInputs;
    trackViewState: TrackViewState;
    setPanPreviewOffset(offsetPx: number): void;
    surface: TimelineSceneSurfacePort;
  }): void {
    TimelineFrameEffects.renderWaveforms({
      enabled: input.frameSequence.shouldRenderWaveforms,
      surface: input.surface,
      history: input.history,
      project: input.project,
      frame: input.waveformFrame,
      bufferedViewport: input.framePlan.useBufferedWaveformViewport,
      dragContext: input.dragContext,
      presentationInputs: input.presentationInputs,
    });
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
  }
}
