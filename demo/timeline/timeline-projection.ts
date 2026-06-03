/*************************** timeline/timeline-projection.ts ***************************
 *
 * Purpose: Represent the time-to-pixel projection of one concrete timeline canvas.
 * How: Capture one canvas time range, its pixel dimensions, and the derived conversion
 *      helpers used by timeline, track, clip, and grid renderers.
 *
 ******************************************************************************/
import type { Timebase } from "../../src/domain/timebase.js";
import { TRACK_COUNT } from "../track/track-playback.js";
import { DAWRenderView } from "../view/daw-render-view.js";

export type TimelineProjectionInput = {
  canvasStartCoord: number;
  canvasEndCoord: number;
  canvasHeightPx: number;
  pixelsPerCoord: number;
  trackCount?: number;
};

// Purpose: Represent the exact projection of one timeline canvas rather than the DAW view itself.
// How: Store the canvas time span, pixel size, per-track height, and coordinate conversion helpers in one immutable ADT.
export class TimelineProjection {
  readonly canvasStartCoord: number;
  readonly canvasEndCoord: number;
  readonly canvasHeightPx: number;
  readonly pixelsPerCoord: number;
  readonly trackCount: number;
  readonly canvasWidthPx: number;
  readonly canvasDurationCoord: number;
  readonly laneHeightPx: number;

  private constructor(input: TimelineProjectionInput) {
    this.canvasStartCoord = input.canvasStartCoord;
    this.canvasEndCoord = input.canvasEndCoord;
    this.canvasHeightPx = Math.max(0, input.canvasHeightPx);
    this.pixelsPerCoord = Math.max(0, input.pixelsPerCoord);
    this.trackCount = Math.max(1, input.trackCount ?? TRACK_COUNT);
    this.canvasDurationCoord = Math.max(0, this.canvasEndCoord - this.canvasStartCoord);
    this.canvasWidthPx = this.canvasDurationCoord * this.pixelsPerCoord;
    this.laneHeightPx = this.canvasHeightPx > 0 ? this.canvasHeightPx / this.trackCount : 0;
  }

  // Purpose: Build one projection directly from explicit canvas coordinates for tests or low-level render flows.
  // How: Store the provided time span and scale as the immutable canvas projection.
  static fromCanvas(input: TimelineProjectionInput): TimelineProjection {
    return new TimelineProjection(input);
  }

  // Purpose: Build the projection of the visible timeline grid from one DAW view.
  // How: Use the view's visible time range and measured grid height as the canvas range.
  static fromView(view: DAWRenderView): TimelineProjection {
    return TimelineProjection.fromCanvasRange(view, view.viewStartCoord, view.viewEndCoord, view.viewportHeightPx);
  }

  // Purpose: Build the projection of an arbitrary timeline canvas tied to one DAW view.
  // How: Reuse the view's zoom-derived pixels-per-coordinate while substituting the requested canvas time range and height.
  static fromCanvasRange(
    view: DAWRenderView,
    canvasStartCoord: number,
    canvasEndCoord: number,
    canvasHeightPx: number,
  ): TimelineProjection {
    return new TimelineProjection({
      canvasStartCoord,
      canvasEndCoord,
      canvasHeightPx,
      pixelsPerCoord: view.pixelsPerCoord(),
      trackCount: view.trackCount,
    });
  }

  // Purpose: Convert one timeline time coordinate into one horizontal canvas pixel.
  // How: Subtract the canvas origin then multiply by the linear pixels-per-coordinate ratio.
  coordToCanvasX(coord: number): number {
    return (coord - this.canvasStartCoord) * this.pixelsPerCoord;
  }

  // Purpose: Convert one horizontal canvas pixel back into a timeline time coordinate.
  // How: Divide by the linear pixels-per-coordinate ratio then add the canvas origin.
  canvasXToCoord(canvasXPx: number): number {
    if (this.pixelsPerCoord <= 0) {
      return this.canvasStartCoord;
    }
    return this.canvasStartCoord + canvasXPx / this.pixelsPerCoord;
  }

  // Purpose: Convert one zero-based track index into one vertical canvas pixel.
  // How: Multiply the index by the lane height derived from the canvas height.
  trackIndexToCanvasY(trackIndex: number): number {
    return trackIndex * this.laneHeightPx;
  }

  // Purpose: Compute the pixels-per-sample density implied by this projection for one timebase.
  // How: Combine the projection's pixels-per-time-coord ratio with the timebase's coord-per-sample factor.
  pixelsPerSample(timebase: Timebase): number {
    return this.pixelsPerCoord * timebase.internalTimeFactor;
  }

  // Purpose: Preserve compatibility with older geometry-based render code during migration.
  // How: Expose the old field name as an alias for the canvas start coordinate.
  get viewStartCoord(): number {
    return this.canvasStartCoord;
  }

  // Purpose: Preserve compatibility with older geometry-based render code during migration.
  // How: Expose the old field name as an alias for the canvas end coordinate.
  get viewEndCoord(): number {
    return this.canvasEndCoord;
  }

  // Purpose: Preserve compatibility with older geometry-based render code during migration.
  // How: Expose the old field name as an alias for the canvas duration.
  get spanCoord(): number {
    return this.canvasDurationCoord;
  }

  // Purpose: Preserve compatibility with older geometry-based render code during migration.
  // How: Expose the old field name as an alias for the canvas width.
  get gridWidthPx(): number {
    return this.canvasWidthPx;
  }

  // Purpose: Preserve compatibility with older geometry-based render code during migration.
  // How: Expose the old field name as an alias for the canvas height.
  get gridHeightPx(): number {
    return this.canvasHeightPx;
  }
}
