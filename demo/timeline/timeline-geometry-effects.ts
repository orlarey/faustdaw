/************************ timeline/timeline-geometry-effects.ts ************************
 *
 * Purpose: Own the geometry/ruler rebuild pass performed ahead of clip and waveform rendering.
 * How: Hide the grid redraw, ruler-label rebuild, history update, and associated perf/debug
 *      bookkeeping behind one helper so the timeline renderer only sequences the pass.
 *
 ******************************************************************************/
import type { ExactTimelineScale } from "../time-scale.js";
import type { GridViewFrame } from "../grid-view/grid-view.js";
import type { TimelineFramePlan } from "./timeline-frame-plan.js";
import type { TimelineProjection } from "./timeline-projection.js";
import type { TimelineRenderHistoryState } from "./timeline-render-history.js";
import type { TimelineSceneSurface } from "./timeline-scene-surface.js";
import type { DAWRenderView } from "../view/daw-render-view.js";
import { buildBufferedRulerModels } from "../ruler-labels.js";
import { measurePerf } from "../perf.js";
import { measureRebuildPass } from "./timeline-debug.js";

type TimelineGeometrySurfacePort = Pick<
  TimelineSceneSurface,
  "renderGridFrame" | "renderRulerLabels"
>;

export class TimelineGeometryEffects {
  static renderRebuild(input: {
    enabled: boolean;
    surface: TimelineGeometrySurfacePort;
    gridFrame: GridViewFrame;
    renderScale: ExactTimelineScale;
    geometry: TimelineProjection;
    view: DAWRenderView;
    framePlan: TimelineFramePlan;
    history: TimelineRenderHistoryState;
    geometryRenderWindowStartCoord: number | null;
    geometryRenderWindowEndCoord: number | null;
    geometryRenderWidthPx: number;
    totalClipCount: number;
  }): void {
    if (!input.enabled) {
      return;
    }
    measurePerf("render.timeline.geometryRebuild", () => {
      measureRebuildPass({
        kind: "geometry",
        run: () => {
          measurePerf("render.timeline.geometryRebuild.sharedGrid.dom", () => {
            input.surface.renderGridFrame(input.gridFrame);
          });
          measurePerf("render.timeline.geometryRebuild.ruler.dom", () => {
            const rulerModels = buildBufferedRulerModels(
              input.renderScale,
              input.gridFrame.displayStartCoord,
              input.gridFrame.displayEndCoord,
              input.gridFrame.displayProjection.canvasWidthPx,
              input.geometry.pixelsPerCoord,
            );
            input.surface.renderRulerLabels(rulerModels);
          });
          input.history.updateGeometry({
            renderWindowStartCoord: input.geometryRenderWindowStartCoord,
            renderWindowEndCoord: input.geometryRenderWindowEndCoord,
            pixelsPerCoord: input.geometry.pixelsPerCoord,
            gridWidthPx: input.geometry.canvasWidthPx,
            displayStartCoord: input.gridFrame.displayStartCoord,
            displayEndCoord: input.gridFrame.displayEndCoord,
            bufferedViewport: input.framePlan.useBufferedGeometryViewport,
          });
        },
        slowDetails: () => ({
          viewStartCoord: input.view.viewStartCoord,
          viewEndCoord: input.view.viewEndCoord,
          gridWidthPx: Math.round(input.geometry.canvasWidthPx),
          renderWidthPx: Math.round(input.geometryRenderWidthPx),
        }),
        rareCostDetails: () => ({
          bufferedViewport: input.framePlan.useBufferedGeometryViewport,
          renderWidthPx: Math.round(input.gridFrame.displayProjection.canvasWidthPx),
          viewStartCoord: input.view.viewStartCoord,
          viewEndCoord: input.view.viewEndCoord,
          totalClipCount: input.totalClipCount,
        }),
      });
    });
  }
}
