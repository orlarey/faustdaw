/******************************** view/daw-render-view.ts ********************************
 *
 * Purpose: Represent the global DAW view state independently from any one renderer.
 * How: Store the visible timeline interval, zoom lattice, cached viewport dimensions,
 *      and cursor-related view markers in one immutable ADT built from an explicit snapshot.
 *
 ******************************************************************************/
import { TimeScale } from "../time-scale.js";
import type { TimeCoord, Timebase } from "../../src/domain/timebase.js";
import { TRACK_COUNT } from "../track/track-playback.js";

export type DAWRenderViewSnapshot = {
  exactTimelineZoomLevelIndex: number;
  timebase: Timebase;
  viewStartCoord: TimeCoord;
  viewDurationCoord: TimeCoord;
  viewportWidthPx: number;
  viewportHeightPx: number;
  cursorCoord: TimeCoord;
  lastPlayStartCoord: TimeCoord | null;
  trackCount?: number;
};

// Purpose: Represent the current global DAW view independently from timeline scene contents.
// How: Store the visible timeline interval, the snapped viewport dimensions, and cursor markers as immutable fields.
export class DAWRenderView {
  readonly exactTimelineZoomLevelIndex: number;
  readonly timebase: Timebase;
  readonly viewStartCoord: TimeCoord;
  readonly viewDurationCoord: TimeCoord;
  readonly viewEndCoord: TimeCoord;
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
  readonly cursorCoord: TimeCoord;
  readonly lastPlayStartCoord: TimeCoord | null;
  readonly trackCount: number;
  readonly #exactTimelineGridWidthPx: number;

  private constructor(input: DAWRenderViewSnapshot) {
    this.exactTimelineZoomLevelIndex = input.exactTimelineZoomLevelIndex;
    this.timebase = input.timebase;
    this.viewStartCoord = input.viewStartCoord;
    this.viewDurationCoord = input.viewDurationCoord;
    this.viewEndCoord = input.viewStartCoord + input.viewDurationCoord;
    this.viewportWidthPx = Math.max(0, input.viewportWidthPx);
    this.viewportHeightPx = Math.max(0, input.viewportHeightPx);
    this.cursorCoord = input.cursorCoord;
    this.lastPlayStartCoord = input.lastPlayStartCoord;
    this.trackCount = Math.max(1, input.trackCount ?? TRACK_COUNT);
    this.#exactTimelineGridWidthPx = new TimeScale(this.exactTimelineZoomLevelIndex, this.timebase)
      .getGridWidthPx(this.viewportWidthPx);
  }

  // Purpose: Build one immutable DAW view from explicit values for tests or intermediate projections.
  // How: Store the provided snapshot as-is after normalizing viewport sizes and track count.
  static fromSnapshot(input: DAWRenderViewSnapshot): DAWRenderView {
    return new DAWRenderView(input);
  }

  // Purpose: Return the exact snapped timeline grid width for this view.
  // How: Return the value cached at construction from the discrete zoom lattice.
  exactTimelineGridWidthPx(): number {
    return this.#exactTimelineGridWidthPx;
  }

  // Purpose: Return the linear temporal-to-pixel scale used by canvases built from this view.
  // How: Divide the exact snapped grid width by the visible duration when that duration is positive.
  pixelsPerCoord(): number {
    return this.viewDurationCoord > 0 ? this.exactTimelineGridWidthPx() / this.viewDurationCoord : 0;
  }

  // Purpose: Return the standard per-track height for timeline canvases built from this view.
  // How: Divide the measured grid viewport height by the number of tracks.
  laneHeightPx(): number {
    return this.viewportHeightPx > 0 ? this.viewportHeightPx / this.trackCount : 0;
  }
}
