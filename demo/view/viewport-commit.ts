/****************************** viewport-commit.ts ****************************
 *
 * Purpose: Convert a pan preview offset (from ruler drag or playback follow)
 *          into a permanent viewport change, respecting the available
 *          geometry-render headroom and a safety margin.
 * How: `getTimelinePreviewHeadroomPx` measures the left/right pixel budget
 *      available before the viewport would escape the currently rendered
 *      geometry window. `commitTimelinePreviewOffset` uses that budget to
 *      decide whether (and how much) of the preview offset to materialize
 *      into `demoState.viewport.viewStartCoord` via `panTimelineFromRuler`.
 *      Consumers: ruler-gesture pan, playback-follow offset commit in
 *      interactions.ts.
 *
 ******************************************************************************/
import type { Elements } from "../bind-elements.js";
import { demoState } from "../state.js";
import { RULER_PAN_COMMIT_THRESHOLD_PX } from "../gesture/gesture-state.js";
import { View } from "./view.js";


function getTimelinePreviewHeadroomPx(gridWidthPx: number): { leftPx: number; rightPx: number } | null {
  const vp = demoState.viewport;
  if (vp.viewDurationCoord <= 0) {
    return null;
  }
  const exactGridWidthPx = vp.timeScale.getGridWidthPx(gridWidthPx);
  if (exactGridWidthPx <= 0) {
    return null;
  }
  const pixelsPerCoord = exactGridWidthPx / vp.viewDurationCoord;
  const viewStartCoord = vp.viewStartCoord;
  const viewEndCoord = viewStartCoord + vp.viewDurationCoord;
  const leftCandidatesPx: number[] = [];
  const rightCandidatesPx: number[] = [];
  const displayWindowStartCoord = demoState.geometryWindow.displayStart;
  const displayWindowEndCoord = demoState.geometryWindow.displayEnd;
  if (displayWindowStartCoord !== null && displayWindowEndCoord !== null) {
    leftCandidatesPx.push((viewStartCoord - displayWindowStartCoord) * pixelsPerCoord);
    rightCandidatesPx.push((displayWindowEndCoord - viewEndCoord) * pixelsPerCoord);
  } else if (demoState.geometryWindow.renderStart !== null && demoState.geometryWindow.renderEnd !== null) {
    leftCandidatesPx.push((viewStartCoord - demoState.geometryWindow.renderStart) * pixelsPerCoord);
    rightCandidatesPx.push((demoState.geometryWindow.renderEnd - viewEndCoord) * pixelsPerCoord);
  }
  if (leftCandidatesPx.length === 0 || rightCandidatesPx.length === 0) {
    return null;
  }

  return {
    leftPx: Math.max(0, Math.min(...leftCandidatesPx)),
    rightPx: Math.max(0, Math.min(...rightCandidatesPx)),
  };
}

export function commitTimelinePreviewOffset(
  previewOffsetPx: number,
  gridWidthPx: number,
  elements: Elements,
  force = false,
): { committed: boolean; previewOffsetPx: number } {
  let commitOffsetPx = previewOffsetPx;
  if (!force) {
    const headroom = getTimelinePreviewHeadroomPx(gridWidthPx);
    if (!headroom) {
      return { committed: false, previewOffsetPx };
    }
    const safetyMarginPx = Math.max(48, Math.round(RULER_PAN_COMMIT_THRESHOLD_PX * 0.5));
    if (previewOffsetPx > 0) {
      const maxPreviewPx = Math.max(headroom.leftPx - safetyMarginPx, 0);
      if (previewOffsetPx <= maxPreviewPx) {
        return { committed: false, previewOffsetPx };
      }
      const targetPreviewPx = Math.max(Math.min(headroom.leftPx * 0.35, maxPreviewPx), 0);
      commitOffsetPx = previewOffsetPx - targetPreviewPx;
    } else if (previewOffsetPx < 0) {
      const maxPreviewPx = Math.max(headroom.rightPx - safetyMarginPx, 0);
      if (-previewOffsetPx <= maxPreviewPx) {
        return { committed: false, previewOffsetPx };
      }
      const targetPreviewPx = Math.max(Math.min(headroom.rightPx * 0.35, maxPreviewPx), 0);
      commitOffsetPx = previewOffsetPx + targetPreviewPx;
    } else {
      return { committed: false, previewOffsetPx };
    }
  }

  const committedSamples = View.panTimelineFromRuler(commitOffsetPx, elements);
  if (committedSamples === 0) {
    return {
      committed: false,
      previewOffsetPx: force ? 0 : previewOffsetPx,
    };
  }

  const pixelsPerSample = demoState.viewport.timeScale.pixelsPerSample;
  const committedOffsetPx = committedSamples * pixelsPerSample;
  let nextPreviewOffsetPx = previewOffsetPx - committedOffsetPx;
  if (Math.abs(nextPreviewOffsetPx) < 0.001) {
    nextPreviewOffsetPx = 0;
  }
  return {
    committed: true,
    previewOffsetPx: nextPreviewOffsetPx,
  };
}
