/************************ timeline/timeline-render-history.ts ************************
 *
 * Purpose: Store the mutable history of the last timeline render pass behind one ADT.
 * How: Keep geometry, clip, and waveform cache markers together so the renderer can
 *      read and update one object instead of mutating many module-level variables.
 *
 ******************************************************************************/
import type { TimeCoord } from "../../src/domain/timebase.js";
import type { TimelineRenderHistory } from "./timeline-frame-plan.js";

export class TimelineRenderHistoryState {
  #lastRenderedGeometryWindowStartCoord: number | null = null;
  #lastRenderedGeometryWindowEndCoord: number | null = null;
  #lastRenderedGeometryPixelsPerCoord: number | null = null;
  #lastRenderedGeometryDisplayStartCoord: number | null = null;
  #lastRenderedGeometryDisplayEndCoord: number | null = null;
  #lastRenderedGeometryBufferedViewport: boolean | null = null;
  #lastRenderedWaveformDisplayStartCoord: number | null = null;
  #lastRenderedWaveformDisplayEndCoord: number | null = null;
  #lastRenderedWaveformBufferedViewport: boolean | null = null;
  #lastRenderedGeometryGridWidthPx: number | null = null;
  #lastRenderedClipWindowStartCoord: number | null = null;
  #lastRenderedClipWindowEndCoord: number | null = null;
  #lastRenderedClipPixelsPerCoord: number | null = null;
  #lastRenderedClipGridHeightPx: number | null = null;

  plannerHistory(): TimelineRenderHistory {
    return {
      lastRenderedGeometryWindowStartCoord: this.#lastRenderedGeometryWindowStartCoord,
      lastRenderedGeometryWindowEndCoord: this.#lastRenderedGeometryWindowEndCoord,
      lastRenderedGeometryPixelsPerCoord: this.#lastRenderedGeometryPixelsPerCoord,
      lastRenderedGeometryGridWidthPx: this.#lastRenderedGeometryGridWidthPx,
      lastRenderedGeometryDisplayStartCoord: this.#lastRenderedGeometryDisplayStartCoord,
      lastRenderedGeometryDisplayEndCoord: this.#lastRenderedGeometryDisplayEndCoord,
      lastRenderedGeometryBufferedViewport: this.#lastRenderedGeometryBufferedViewport,
      lastRenderedClipWindowStartCoord: this.#lastRenderedClipWindowStartCoord,
      lastRenderedClipWindowEndCoord: this.#lastRenderedClipWindowEndCoord,
      lastRenderedClipPixelsPerCoord: this.#lastRenderedClipPixelsPerCoord,
      lastRenderedClipGridHeightPx: this.#lastRenderedClipGridHeightPx,
    };
  }

  previousGeometryDisplayStartCoord(): number | null {
    return this.#lastRenderedGeometryDisplayStartCoord;
  }

  previousGeometryDisplayEndCoord(): number | null {
    return this.#lastRenderedGeometryDisplayEndCoord;
  }

  previousWaveformDisplayStartCoord(): number | null {
    return this.#lastRenderedWaveformDisplayStartCoord;
  }

  previousWaveformDisplayEndCoord(): number | null {
    return this.#lastRenderedWaveformDisplayEndCoord;
  }

  hasRenderedClipWindow(): boolean {
    return this.#lastRenderedClipWindowStartCoord !== null;
  }

  waveformDisplayChanged(displayStartCoord: TimeCoord, displayEndCoord: TimeCoord, bufferedViewport: boolean): boolean {
    return this.#lastRenderedWaveformDisplayStartCoord !== displayStartCoord
      || this.#lastRenderedWaveformDisplayEndCoord !== displayEndCoord
      || this.#lastRenderedWaveformBufferedViewport !== bufferedViewport;
  }

  updateGeometry(input: {
    renderWindowStartCoord: TimeCoord | null;
    renderWindowEndCoord: TimeCoord | null;
    pixelsPerCoord: number;
    gridWidthPx: number;
    displayStartCoord: TimeCoord;
    displayEndCoord: TimeCoord;
    bufferedViewport: boolean;
  }): void {
    this.#lastRenderedGeometryWindowStartCoord = input.renderWindowStartCoord;
    this.#lastRenderedGeometryWindowEndCoord = input.renderWindowEndCoord;
    this.#lastRenderedGeometryPixelsPerCoord = input.pixelsPerCoord;
    this.#lastRenderedGeometryGridWidthPx = input.gridWidthPx;
    this.#lastRenderedGeometryDisplayStartCoord = input.displayStartCoord;
    this.#lastRenderedGeometryDisplayEndCoord = input.displayEndCoord;
    this.#lastRenderedGeometryBufferedViewport = input.bufferedViewport;
  }

  updateWaveforms(input: {
    displayStartCoord: TimeCoord;
    displayEndCoord: TimeCoord;
    bufferedViewport: boolean;
  }): void {
    this.#lastRenderedWaveformDisplayStartCoord = input.displayStartCoord;
    this.#lastRenderedWaveformDisplayEndCoord = input.displayEndCoord;
    this.#lastRenderedWaveformBufferedViewport = input.bufferedViewport;
  }

  clearWaveforms(): void {
    this.#lastRenderedWaveformDisplayStartCoord = null;
    this.#lastRenderedWaveformDisplayEndCoord = null;
    this.#lastRenderedWaveformBufferedViewport = null;
  }

  updateClips(input: {
    windowStartCoord: TimeCoord;
    windowEndCoord: TimeCoord;
    pixelsPerCoord: number;
    gridHeightPx: number;
  }): void {
    this.#lastRenderedClipWindowStartCoord = input.windowStartCoord;
    this.#lastRenderedClipWindowEndCoord = input.windowEndCoord;
    this.#lastRenderedClipPixelsPerCoord = input.pixelsPerCoord;
    this.#lastRenderedClipGridHeightPx = input.gridHeightPx;
  }

  reset(): void {
    this.#lastRenderedGeometryWindowStartCoord = null;
    this.#lastRenderedGeometryWindowEndCoord = null;
    this.#lastRenderedGeometryPixelsPerCoord = null;
    this.#lastRenderedGeometryDisplayStartCoord = null;
    this.#lastRenderedGeometryDisplayEndCoord = null;
    this.#lastRenderedGeometryBufferedViewport = null;
    this.#lastRenderedWaveformDisplayStartCoord = null;
    this.#lastRenderedWaveformDisplayEndCoord = null;
    this.#lastRenderedWaveformBufferedViewport = null;
    this.#lastRenderedGeometryGridWidthPx = null;
    this.#lastRenderedClipWindowStartCoord = null;
    this.#lastRenderedClipWindowEndCoord = null;
    this.#lastRenderedClipPixelsPerCoord = null;
    this.#lastRenderedClipGridHeightPx = null;
  }
}
