/******************************** view/view-clamps.ts ********************************
 *
 * Purpose: Pure clamping functions for candidate timeline view window values.
 * How: Bound the visible duration against the fixed workspace range and clamp a candidate
 *      view start against the leftmost legal scroll position given its candidate duration.
 *      Kept outside TimelineViewport so ruler gestures and session restore can call them
 *      without owning a viewport instance.
 *
 ******************************************************************************/
import type { Timebase } from "../../src/domain/timebase.js";

const MIN_VIEW_DURATION_SECONDS = 0.05;
const MAX_VIEW_DURATION_SECONDS = 7200;

// Purpose: Clamp a visible duration inside the allowed zoom range.
// How: Convert second bounds to coordinates and bound the candidate.
export function clampViewDuration(durationCoord: number, timebase: Timebase): number {
  const minimum = timebase.toTimeCoord(MIN_VIEW_DURATION_SECONDS);
  const maximum = timebase.toTimeCoord(MAX_VIEW_DURATION_SECONDS);
  return Math.min(Math.max(durationCoord, minimum), maximum);
}

// Purpose: Clamp a visible window start against the leftmost legal scroll position.
// How: Enforce a lower bound of minus the current duration.
export function clampViewStart(startCoord: number, durationCoord: number): number {
  return Math.max(startCoord, -durationCoord);
}
