/***************************** timeline-geometry.ts *****************************
 *
 * Purpose: Retain compatibility helpers around the newer timeline projection ADT.
 * How: Build the visible timeline canvas projection from the current DAW view and
 *      keep the render-division and buffered-window helpers used by the renderer.
 *
 ******************************************************************************/
import type { ExactTimelineScale } from "../time-scale.js";
import { measurePerf } from "../perf.js";
import { TimelineProjection } from "./timeline-projection.js";
import { View } from "../view/view.js";

// Purpose: Preserve the previous type name during migration toward TimelineProjection.
// How: Re-export the projection ADT under the old geometry alias while callers are updated incrementally.
export type TimelineGeometry = TimelineProjection;

// Purpose: Describe the subdivision strategy for one render-window tiling pass.
// How: Store the unit step in samples and coordinates alongside the pixel width and grouping factor.
export type RenderDivisionSpec = {
  unitStepSamples: number;
  unitStepCoord: number;
  unitWidthPx: number;
  unitCountPerPrimary: number;
  primaryWidthLimitPx: number;
};

// Purpose: Compute the current visible timeline canvas projection.
// How: Capture the current DAW view and derive the exact grid projection used by clips and the playhead.
//      The viewport must already be synced with the DOM via View.syncExactTimelineViewport before this call.
export function getTimelineGeometry(): TimelineGeometry {
  return measurePerf("render.timeline.geometry", () => {
    return TimelineProjection.fromView(View.captureRenderView());
  });
}

// Purpose: Choose the optimal subdivision unit for tiling the render window.
// How: Start from the primary step and subdivide until the unit width fits within the limit.
export function getRenderDivisionSpec(
  renderScale: ExactTimelineScale,
  primaryWidthLimitPx: number,
): RenderDivisionSpec {
  const safePrimaryWidthLimitPx = Math.max(renderScale.secondarySpacingPx, primaryWidthLimitPx);
  const primaryWidthPx = renderScale.primarySpacingPx;
  const secondaryCountPerPrimary = Math.max(
    1,
    Math.round(renderScale.primaryStepSamples / renderScale.secondaryStepSamples),
  );
  if (primaryWidthPx <= safePrimaryWidthLimitPx || secondaryCountPerPrimary <= 1) {
    return {
      unitStepSamples: renderScale.primaryStepSamples,
      unitStepCoord: renderScale.primaryStepCoord,
      unitWidthPx: primaryWidthPx,
      unitCountPerPrimary: 1,
      primaryWidthLimitPx: safePrimaryWidthLimitPx,
    };
  }

  for (let unitCountPerPrimary = 2; unitCountPerPrimary <= secondaryCountPerPrimary; unitCountPerPrimary += 1) {
    if (secondaryCountPerPrimary % unitCountPerPrimary !== 0) {
      continue;
    }
    const unitWidthPx = primaryWidthPx / unitCountPerPrimary;
    if (unitWidthPx > safePrimaryWidthLimitPx) {
      continue;
    }
    const unitStepSamples = renderScale.primaryStepSamples / unitCountPerPrimary;
    return {
      unitStepSamples,
      unitStepCoord: unitStepSamples * renderScale.sampleCoord,
      unitWidthPx,
      unitCountPerPrimary,
      primaryWidthLimitPx: safePrimaryWidthLimitPx,
    };
  }

  return {
    unitStepSamples: renderScale.primaryStepSamples,
    unitStepCoord: renderScale.primaryStepCoord,
    unitWidthPx: primaryWidthPx,
    unitCountPerPrimary: 1,
    primaryWidthLimitPx: safePrimaryWidthLimitPx,
  };
}

// Purpose: Resolve the visible display sub-window within a wider render window, reusing the previous bounds when stable.
// How: Keep the previous window if the viewport still fits inside; otherwise expand to include a margin around the viewport.
export function resolveBufferedDisplayWindow(
  renderStartCoord: number,
  renderEndCoord: number,
  viewStartCoord: number,
  viewEndCoord: number,
  marginCoord: number,
  previousStartCoord: number | null,
  previousEndCoord: number | null,
  allowReuse: boolean,
): { startCoord: number; endCoord: number } {
  if (
    allowReuse
    && previousStartCoord !== null
    && previousEndCoord !== null
    && renderStartCoord <= previousStartCoord
    && previousEndCoord <= renderEndCoord
    && previousStartCoord <= viewStartCoord
    && viewEndCoord <= previousEndCoord
  ) {
    return {
      startCoord: previousStartCoord,
      endCoord: previousEndCoord,
    };
  }

  return {
    startCoord: Math.max(renderStartCoord, viewStartCoord - marginCoord),
    endCoord: Math.min(renderEndCoord, viewEndCoord + marginCoord),
  };
}
