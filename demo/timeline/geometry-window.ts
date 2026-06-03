/****************************** geometry-window.ts ****************************
 *
 * Purpose: Group the state that describes the timeline's grid-geometry render
 *          windows. These seven fields were previously scattered at the top
 *          level of `demoState` with a `geometry*` prefix; the co-usage test
 *          revealed them as a single concept (timeline-scene reads all seven
 *          together to schedule rendering, grid-view-buffers maintains the
 *          render/stable/display coordinates, viewport-commit writes them,
 *          and gestures set the warm flag).
 * How: Pure type — operations live in the modules that read/write it
 *      (timeline-scene, grid-view-buffers, viewport-commit, and the gesture
 *      modules that drive `keepWarm`). Only behaviour here is the initial
 *      constructor used by state.ts at module load.
 *
 ******************************************************************************/

/**
 * Purpose: Describe the three nested windows used by the timeline grid
 *          rendering pipeline, plus a warm-keeping flag driven by gestures.
 *          Window endpoints are null until the viewport has been initialised.
 */
export type GeometryWindowState = {
  /** The window whose buffered geometry is currently being rendered. */
  renderStart: number | null;
  renderEnd: number | null;
  /** The stable sub-window inside `render` that has not yet reached the edge. */
  stableStart: number | null;
  stableEnd: number | null;
  /** The window currently visible on screen. */
  displayStart: number | null;
  displayEnd: number | null;
  /** When true, keep buffered viewport geometry warm across gesture frames. */
  keepWarm: boolean;
};

export function createInitialGeometryWindowState(): GeometryWindowState {
  return {
    renderStart: null,
    renderEnd: null,
    stableStart: null,
    stableEnd: null,
    displayStart: null,
    displayEnd: null,
    keepWarm: false,
  };
}
