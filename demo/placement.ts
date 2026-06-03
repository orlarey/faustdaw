/******************************** placement.ts ********************************
 *
 * Purpose: Resolve assisted placement targets shared by drag feedback and drop.
 * How: Compare candidate object edges against visible guide dates in screen
 *      space, then choose one deterministic target when several alignments are
 *      admissible at once.
 *
 ******************************************************************************/
import type { TimeCoord } from "../src/domain/timebase.js";

export type ClipAlignmentEdge = "start" | "end";

export type ClipAlignmentTarget = {
  edge: ClipAlignmentEdge;
  guideCoord: TimeCoord;
  snappedStartCoord: TimeCoord;
  distancePx: number;
  timeDistanceCoord: number;
};

function compareClipAlignmentTargets(left: ClipAlignmentTarget, right: ClipAlignmentTarget): number {
  if (left.timeDistanceCoord !== right.timeDistanceCoord) {
    return left.timeDistanceCoord - right.timeDistanceCoord;
  }
  if (left.edge !== right.edge) {
    return left.edge === "start" ? -1 : 1;
  }
  if (left.distancePx !== right.distancePx) {
    return left.distancePx - right.distancePx;
  }
  return left.guideCoord - right.guideCoord;
}

/**
 * Purpose: Resolve the active object-object alignment target for one dragged clip.
 * How: Keep all guide dates whose screen projection is inside the admissible threshold for the clip start or end, then choose the closest date in time and prefer the start edge on ties.
 */
export function resolveClipAlignmentTarget(
  previewStartCoord: TimeCoord,
  clipDurationCoord: TimeCoord,
  guideCoords: readonly TimeCoord[],
  pixelsPerCoord: number,
  thresholdPx: number,
): { matchedGuideCoords: TimeCoord[]; activeTarget: ClipAlignmentTarget | null } {
  const previewEndCoord = previewStartCoord + clipDurationCoord;
  const matchedGuideCoords = new Set<TimeCoord>();
  let activeTarget: ClipAlignmentTarget | null = null;

  for (const guideCoord of guideCoords) {
    const startDistancePx = Math.abs((guideCoord - previewStartCoord) * pixelsPerCoord);
    if (startDistancePx <= thresholdPx) {
      matchedGuideCoords.add(guideCoord);
      const target: ClipAlignmentTarget = {
        edge: "start",
        guideCoord,
        snappedStartCoord: guideCoord,
        distancePx: startDistancePx,
        timeDistanceCoord: Math.abs(guideCoord - previewStartCoord),
      };
      if (!activeTarget || compareClipAlignmentTargets(target, activeTarget) < 0) {
        activeTarget = target;
      }
    }

    const endDistancePx = Math.abs((guideCoord - previewEndCoord) * pixelsPerCoord);
    if (endDistancePx <= thresholdPx) {
      matchedGuideCoords.add(guideCoord);
      const target: ClipAlignmentTarget = {
        edge: "end",
        guideCoord,
        snappedStartCoord: guideCoord - clipDurationCoord,
        distancePx: endDistancePx,
        timeDistanceCoord: Math.abs(guideCoord - previewEndCoord),
      };
      if (!activeTarget || compareClipAlignmentTargets(target, activeTarget) < 0) {
        activeTarget = target;
      }
    }
  }

  return {
    matchedGuideCoords: Array.from(matchedGuideCoords).sort((left, right) => left - right),
    activeTarget,
  };
}
