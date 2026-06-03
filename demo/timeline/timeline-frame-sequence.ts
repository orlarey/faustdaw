/************************ timeline/timeline-frame-sequence.ts ************************
 *
 * Purpose: Classify one timeline render into a small set of mutually exclusive frame branches.
 * How: Turn the remaining renderer conditionals into one immutable sequence object so the
 *      timeline renderer orchestrates named passes instead of open-coded nested booleans.
 *
 ******************************************************************************/
import type { TimelineFramePlan } from "./timeline-frame-plan.js";

export type TimelineFrameSequenceMode =
  | "direct-zoom"
  | "steady"
  | "rebuild";

export type TimelineFrameSequence = {
  mode: TimelineFrameSequenceMode;
  shouldRenderWaveforms: boolean;
  shouldBuildClipModels: boolean;
  shouldCollectDomModels: boolean;
  shouldRenderDragOverlay: boolean;
};

export class TimelineFrameSequencer {
  static build(input: {
    framePlan: TimelineFramePlan;
    totalClipCount: number;
    waveformWindowChanged: boolean;
    waveformDisplayChanged: boolean;
    clipRenderStructureDirty: boolean;
    dragActive: boolean;
  }): TimelineFrameSequence {
    if (input.framePlan.useDirectZoomViewportRendering) {
      return {
        mode: "direct-zoom",
        shouldRenderWaveforms: input.totalClipCount > 0,
        shouldBuildClipModels: false,
        shouldCollectDomModels: false,
        shouldRenderDragOverlay: false,
      };
    }

    if (!input.framePlan.clipGeometryChanged) {
      return {
        mode: "steady",
        shouldRenderWaveforms:
          input.waveformWindowChanged
          || input.waveformDisplayChanged
          || !input.framePlan.freezeBackgroundRasterDuringInteraction,
        shouldBuildClipModels: false,
        shouldCollectDomModels: false,
        shouldRenderDragOverlay: input.dragActive,
      };
    }

    return {
      mode: "rebuild",
      shouldRenderWaveforms:
        input.waveformWindowChanged
        || input.waveformDisplayChanged
        || input.clipRenderStructureDirty
        || input.framePlan.shouldRefreshClipVisuals
        || !input.framePlan.freezeBackgroundRasterDuringInteraction,
      shouldBuildClipModels: input.framePlan.shouldRefreshClipVisuals,
      shouldCollectDomModels: input.framePlan.shouldRefreshClipVisuals,
      shouldRenderDragOverlay: input.dragActive,
    };
  }
}
