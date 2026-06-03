/************************ timeline/timeline-waveform-preview.ts ************************
 *
 * Purpose: Own the direct visible-waveform preview pass independently from the main timeline renderer.
 * How: Project the current DAW view into one visible canvas range, hide the waveform layer when the
 *      timeline is empty, and otherwise redraw only the visible waveform canvas without touching buffers.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import type { DragState } from "../gesture/gesture-state.js";
import type { ExactTimelineScale } from "../time-scale.js";
import type { DAWRenderView } from "../view/daw-render-view.js";
import type { TimelineSceneSurface } from "./timeline-scene-surface.js";
import type { TimelineSurface } from "./timeline-surface.js";
import { TimelineProjection } from "./timeline-projection.js";

type TimelineSceneSurfacePort = Pick<TimelineSceneSurface, "renderDirectWaveforms">;
type TimelineSurfacePort = Pick<TimelineSurface, "syncFrame">;

export class TimelineWaveformPreview {
  static render(input: {
    project: Project;
    view: DAWRenderView;
    renderScale: ExactTimelineScale;
    totalClipCount: number;
    dragState: DragState | null;
    presentationInputs: ClipPresentationInputs;
    sceneSurface: TimelineSceneSurfacePort;
    timelineSurface: TimelineSurfacePort;
    setPanPreviewOffset(offsetPx: number): void;
  }): void {
    const projection = TimelineProjection.fromView(input.view);
    if (input.totalClipCount === 0) {
      return;
    }

    input.timelineSurface.syncFrame({
      view: input.view,
      visibleProjection: projection,
      geometryDisplayProjection: projection,
      useBufferedGeometryViewport: false,
      clipDisplayStartCoord: projection.viewStartCoord,
    });
    input.sceneSurface.renderDirectWaveforms(
      input.project,
      projection,
      input.renderScale,
      input.dragState,
      input.presentationInputs,
    );
    input.setPanPreviewOffset(0);
  }
}
