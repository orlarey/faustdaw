/************************ timeline/timeline-frame-effects.ts ************************
 *
 * Purpose: Centralize the repeated side effects performed by timeline frame branches.
 * How: Hide the repetitive waveform-cache updates, drag-overlay routing, and clip-layer clearing
 *      behind small helpers so the main renderer only sequences named effects.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { ClipRenderModel } from "../clip/clip.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import type { ClipDragRenderContext, DragOverlayRenderInput, TimelineDragOverlay } from "./timeline-drag-overlay.js";
import type { TimelineRenderHistoryState } from "./timeline-render-history.js";
import type { TimelineSceneSurface } from "./timeline-scene-surface.js";
import { WaveformView, type WaveformViewFrame } from "../waveform-view/waveform-view.js";

type TimelineWaveformSurfacePort = Pick<TimelineSceneSurface, "renderWaveformsFrame">;

type TimelineDragOverlaySurfacePort = Pick<
  TimelineSceneSurface,
  "clearDragOverlay" | "renderDragOverlay"
>;

export class TimelineFrameEffects {
  static renderWaveforms(input: {
    enabled: boolean;
    surface: TimelineWaveformSurfacePort;
    history: TimelineRenderHistoryState;
    project: Project;
    frame: WaveformViewFrame;
    bufferedViewport: boolean;
    dragContext: ClipDragRenderContext;
    presentationInputs: ClipPresentationInputs;
  }): readonly ClipRenderModel[] | null {
    if (!input.enabled) {
      return null;
    }
    const result = input.surface.renderWaveformsFrame(
      input.project,
      input.frame,
      input.dragContext.dragState,
      input.presentationInputs,
    );
    input.history.updateWaveforms({
      displayStartCoord: input.frame.displayStartCoord,
      displayEndCoord: input.frame.displayEndCoord,
      bufferedViewport: input.bufferedViewport,
    });
    return result.visibleModels;
  }

  static clearWaveforms(input: {
    history: TimelineRenderHistoryState;
  }): void {
    WaveformView.invalidateBuffers();
    input.history.clearWaveforms();
  }

  static renderDragOverlay(
    input: DragOverlayRenderInput & {
      enabled: boolean;
      surface: TimelineDragOverlaySurfacePort;
      overlay: TimelineDragOverlay;
    },
  ): void {
    if (!input.enabled || !input.dragContext.dragState) {
      input.surface.clearDragOverlay(input.overlay);
      return;
    }
    input.surface.renderDragOverlay(input.overlay, input);
  }
}
