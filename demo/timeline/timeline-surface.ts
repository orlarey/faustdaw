/******************************** timeline/timeline-surface.ts ********************************
 *
 * Purpose: Own the composition state of the parallel timeline DOM surfaces.
 * How: Capture the current canvas offsets and playhead markers from one DAW view,
 *      then apply pan-preview transforms to the grid, waveform, clip, and overlay layers.
 *
 ******************************************************************************/
import type { TimelineProjection } from "./timeline-projection.js";
import { DAWRenderView } from "../view/daw-render-view.js";

export type TimelineSurfaceFrame = {
  geometryRenderOffsetPx: number;
  clipRenderOffsetPx: number;
  clipRenderStartCoord: number;
  zeroTimeXPx: number;
  gridWidthPx: number;
  playheadLeftPx: number;
  lastPlayStartLeftPx: number | null;
};

export type TimelinePanPreviewState = {
  geometryRenderWindowTransform: string;
  dragOverlayTransform: string;
  negativeOverlayWidthPx: number;
};

const EMPTY_TIMELINE_SURFACE_FRAME: TimelineSurfaceFrame = {
  geometryRenderOffsetPx: 0,
  clipRenderOffsetPx: 0,
  clipRenderStartCoord: 0,
  zeroTimeXPx: 0,
  gridWidthPx: 0,
  playheadLeftPx: 0,
  lastPlayStartLeftPx: null,
};

// Purpose: Represent the DOM-composition state of the timeline surfaces independently from rendering decisions.
// How: Store only the latest offsets and marker positions, then apply preview transforms from that state.
export class TimelineSurface {
  #frame: TimelineSurfaceFrame = EMPTY_TIMELINE_SURFACE_FRAME;

  // Purpose: Build one immutable composition frame from the current DAW view and render-window choices.
  // How: Convert visible dates into layer offsets, playhead positions, and zero-time marker positions.
  static buildFrame(input: {
    view: DAWRenderView;
    visibleProjection: TimelineProjection;
    geometryDisplayProjection: TimelineProjection;
    useBufferedGeometryViewport: boolean;
    clipDisplayStartCoord: number;
  }): TimelineSurfaceFrame {
    const gridWidthPx = input.visibleProjection.canvasWidthPx;
    const cursorRatio = input.view.viewDurationCoord > 0
      ? (input.view.cursorCoord - input.view.viewStartCoord) / input.view.viewDurationCoord
      : 0;
    const playheadX = cursorRatio * gridWidthPx;
    const playheadLeftPx = Number.isFinite(playheadX) ? playheadX : 0;
    const lastPlayStartRatio = input.view.lastPlayStartCoord === null || input.view.viewDurationCoord <= 0
      ? null
      : (input.view.lastPlayStartCoord - input.view.viewStartCoord) / input.view.viewDurationCoord;
    const lastPlayStartX = lastPlayStartRatio === null ? null : lastPlayStartRatio * gridWidthPx;
    return {
      geometryRenderOffsetPx: input.useBufferedGeometryViewport
        ? input.geometryDisplayProjection.coordToCanvasX(input.view.viewStartCoord)
        : 0,
      clipRenderOffsetPx: (input.view.viewStartCoord - input.clipDisplayStartCoord) * input.visibleProjection.pixelsPerCoord,
      clipRenderStartCoord: input.view.viewStartCoord,
      zeroTimeXPx: input.visibleProjection.coordToCanvasX(0),
      gridWidthPx,
      playheadLeftPx,
      lastPlayStartLeftPx:
        lastPlayStartX !== null
        && Number.isFinite(lastPlayStartX)
        && lastPlayStartX >= 0
        && lastPlayStartX <= gridWidthPx
          ? lastPlayStartX
          : null,
    };
  }

  // Purpose: Capture the current composition frame so later preview transforms use consistent offsets.
  // How: Build one immutable frame from the caller input, then replace the stored internal state.
  syncFrame(input: {
    view: DAWRenderView;
    visibleProjection: TimelineProjection;
    geometryDisplayProjection: TimelineProjection;
    useBufferedGeometryViewport: boolean;
    clipDisplayStartCoord: number;
  }): TimelineSurfaceFrame {
    this.#frame = TimelineSurface.buildFrame(input);
    return this.#frame;
  }

  // Purpose: Replace the stored composition frame directly when one direct-render path needs explicit zero offsets.
  // How: Store the provided immutable frame as-is.
  setFrame(frame: TimelineSurfaceFrame): void {
    this.#frame = frame;
  }

  // Purpose: Read the current clip render origin used by drag overlays and guides.
  // How: Return the clip render start date stored in the latest composition frame.
  clipRenderStartCoord(): number {
    return this.#frame.clipRenderStartCoord;
  }

  // Purpose: Read the latest playhead pixel position.
  // How: Return the stored playhead position from the latest composition frame.
  playheadLeftPx(): number {
    return this.#frame.playheadLeftPx;
  }

  // Purpose: Read the latest visible last-play-start marker position.
  // How: Return the stored marker position or null when the marker is off-screen.
  lastPlayStartLeftPx(): number | null {
    return this.#frame.lastPlayStartLeftPx;
  }

  // Purpose: Read the current zero-time overlay width in visible pixels.
  // How: Clamp the zero-time x position to the visible grid width.
  negativeOverlayWidthPx(offsetPx = 0): number {
    return Math.min(
      Math.max(this.#frame.zeroTimeXPx + offsetPx, 0),
      this.#frame.gridWidthPx,
    );
  }

  // Purpose: Build one temporary pan-preview state for every time-dependent surface.
  // How: Convert the stored composition frame into one immutable set of CSS transforms and overlay widths.
  buildPanPreviewState(offsetPx: number, hasDetachedDragOverlay: boolean): TimelinePanPreviewState {
    const geometryRenderWindowTransform =
      this.#frame.geometryRenderOffsetPx === 0 && offsetPx === 0
        ? ""
        : `translateX(${(-this.#frame.geometryRenderOffsetPx + offsetPx).toFixed(4)}px)`;
    const dragOverlayTransform =
      hasDetachedDragOverlay || (this.#frame.clipRenderOffsetPx === 0 && offsetPx === 0)
        ? ""
        : `translateX(${(-this.#frame.clipRenderOffsetPx + offsetPx).toFixed(4)}px)`;
    return {
      geometryRenderWindowTransform,
      dragOverlayTransform,
      negativeOverlayWidthPx: this.negativeOverlayWidthPx(offsetPx),
    };
  }

  // Purpose: Forget the stored composition state after a full renderer reset.
  // How: Restore the internal frame to the zero-offset default.
  reset(): void {
    this.#frame = EMPTY_TIMELINE_SURFACE_FRAME;
  }
}
