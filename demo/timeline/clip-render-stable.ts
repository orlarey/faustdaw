/***************************** clip-render-stable.ts **************************
 *
 * Purpose: Group the three fields that describe the "stable" window used by
 *          the clip-render scene cache — the last rendered start/end coord
 *          plus a dirty flag invalidated by any clip-structure edit. All
 *          three are read together by timeline-scene when deciding whether
 *          to reuse or rebuild the clip layer.
 * How: Pure type. The dirty flag is written by many sites that mutate the
 *      clip structure (drag, selection, session load, …); the coords are
 *      written by timeline-scene after a successful render.
 *
 ******************************************************************************/

/**
 * Purpose: Describe the last rendered clip-structure window and whether the
 *          cache is still valid.
 */
export type ClipRenderStableState = {
  /** Start coord of the last fully rendered clip window, null before first render. */
  startCoord: number | null;
  /** End coord of the last fully rendered clip window, null before first render. */
  endCoord: number | null;
  /** True when any caller mutated the clip structure since the last render. */
  dirty: boolean;
};

export function createInitialClipRenderStableState(): ClipRenderStableState {
  return {
    startCoord: null,
    endCoord: null,
    dirty: false,
  };
}
