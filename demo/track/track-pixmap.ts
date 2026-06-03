/****************************** track/track-pixmap.ts ******************************
 *
 * Purpose: Own the canvas-backed pixmap protocol used when track content rasterizes clips.
 * How: Adapt one canvas context to the clip pixmap API while carrying one accumulated track Y offset.
 *
 ******************************************************************************/
import { ClipCanvasPixmap, type ClipPixmap, type ClipRenderModel } from "../clip/clip.js";

export type TrackPixmap = {
  withTrackOffset(topOffsetPx: number): ClipPixmap;
};

export class TrackCanvasPixmap implements TrackPixmap, ClipPixmap {
  readonly #context: CanvasRenderingContext2D;
  readonly #topOffsetPx: number;

  constructor(context: CanvasRenderingContext2D, topOffsetPx = 0) {
    this.#context = context;
    this.#topOffsetPx = topOffsetPx;
  }

  drawClip(model: ClipRenderModel): void {
    new ClipCanvasPixmap(this.#context, this.#topOffsetPx).drawClip(model);
  }

  directCanvasContext(): CanvasRenderingContext2D {
    return this.#context;
  }

  topOffsetPx(): number {
    return this.#topOffsetPx;
  }

  withTrackOffset(topOffsetPx: number): ClipPixmap {
    return new TrackCanvasPixmap(this.#context, this.#topOffsetPx + topOffsetPx);
  }
}
