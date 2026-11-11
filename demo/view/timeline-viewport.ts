/*************************** view/timeline-viewport.ts ***************************
 *
 * Purpose: Unified mutable viewport for the timeline — groups all data and
 *          operations that read or write the visible time window.
 * How: Owns viewStart, viewDuration, and grid dimensions; delegates all
 *      zoom and time-to-pixel conversion to a contained TimeScale instance.
 *
 ******************************************************************************/
import type { TimeCoord, Timebase } from "../../src/domain/timebase.js";
import { TimeScale } from "../time-scale.js";
import { clampViewDuration, clampViewStart } from "./view-clamps.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYBACK_FOLLOW_RATIO = 2 / 3;

/** The visible window of a TimelineViewport (see snapshot / restore). */
export type TimelineViewportSnapshot = {
  readonly viewStartCoord: number;
  readonly viewDurationCoord: number;
  readonly zoomLevelIndex: number;
};

// ---------------------------------------------------------------------------
// TimelineViewport class
// ---------------------------------------------------------------------------

/**
 * Purpose: Own the mutable viewport state and every operation on it.
 * How: Methods read and write instance fields directly — zoom and timebase
 *      are delegated to the contained TimeScale service.
 */
export class TimelineViewport {
  viewStartCoord: number;
  viewDurationCoord: number;
  timeScale: TimeScale;
  gridWidthPx: number;
  gridHeightPx: number;

  constructor(init: {
    viewStartCoord: number;
    viewDurationCoord: number;
    zoomLevelIndex: number;
    timebase: Timebase;
    gridWidthPx: number;
    gridHeightPx: number;
  }) {
    this.viewStartCoord = init.viewStartCoord;
    this.viewDurationCoord = init.viewDurationCoord;
    this.timeScale = new TimeScale(init.zoomLevelIndex, init.timebase);
    this.gridWidthPx = init.gridWidthPx;
    this.gridHeightPx = init.gridHeightPx;
  }

  // -------------------------------------------------------------------------
  // Coordinate conversion
  // -------------------------------------------------------------------------

  // Purpose: Convert a timeline coordinate to a pixel offset within the grid.
  // How: Compute the coordinate's fraction of the visible window, then scale by grid width.
  coordToPixel(coord: TimeCoord): number {
    if (this.viewDurationCoord <= 0) return 0;
    const ratio = (coord - this.viewStartCoord) / this.viewDurationCoord;
    return ratio * this.exactGridWidthPx();
  }

  // Purpose: Convert a client-space X pixel to a timeline coordinate.
  // How: Clamp the pointer inside the exact grid width, quantize to a sample index, add to viewStart.
  pixelToCoord(clientX: number, gridLeftPx: number): TimeCoord {
    const pps = this.timeScale.pixelsPerSample;
    const exactWidth = this.exactGridWidthPx();
    if (exactWidth <= 0) return Math.max(0, this.viewStartCoord) as TimeCoord;
    const sampleIndex = Math.round(
      Math.min(Math.max(clientX - gridLeftPx, 0), exactWidth) / pps,
    );
    return Math.max(0, this.viewStartCoord + sampleIndex * this.timeScale.timebase.internalTimeFactor) as TimeCoord;
  }

  // Purpose: Return the current scale factor in pixels per coordinate unit.
  // How: Divide the exact grid width by the visible duration.
  pixelsPerCoord(): number {
    if (this.viewDurationCoord <= 0) return 0;
    return this.exactGridWidthPx() / this.viewDurationCoord;
  }

  // Purpose: Return the snapped grid width for the current zoom level.
  // How: Delegate to TimeScale.
  exactGridWidthPx(): number {
    return this.timeScale.getGridWidthPx(this.gridWidthPx);
  }

  // -------------------------------------------------------------------------
  // Clamping
  // -------------------------------------------------------------------------

  clampDurationCoord(durationCoord: number): number {
    return clampViewDuration(durationCoord, this.timeScale.timebase);
  }

  clampStartCoord(startCoord: number): number {
    return clampViewStart(startCoord, this.viewDurationCoord);
  }

  // -------------------------------------------------------------------------
  // Zoom
  // -------------------------------------------------------------------------

  // Purpose: Snap the visible duration to the exact zoom lattice, preserving center.
  // How: Recompute duration for the measured width, then either keep zero-anchored or preserve center.
  syncViewport(): void {
    if (this.gridWidthPx <= 0) return;

    const nextDuration = this.timeScale.getDurationCoord(this.gridWidthPx);
    if (nextDuration === this.viewDurationCoord) {
      this.viewStartCoord = this.clampStartCoord(
        this.timeScale.snapToSample(this.viewStartCoord),
      );
      return;
    }
    if (this.viewStartCoord === 0) {
      this.viewDurationCoord = nextDuration;
      return;
    }
    const center = this.viewStartCoord + Math.round(this.viewDurationCoord / 2);
    this.viewDurationCoord = nextDuration;
    this.viewStartCoord = this.clampStartCoord(
      this.timeScale.snapToSample(center - Math.round(nextDuration / 2)),
    );
  }

  // Purpose: Change the zoom level while preserving the viewport center.
  // How: Delegate to TimeScale, short-circuit if unchanged, then sync viewport.
  setZoomLevel(levelIndex: number): boolean {
    if (!this.timeScale.setZoomLevel(levelIndex)) return false;
    this.syncViewport();
    return true;
  }

  // Purpose: Change the zoom level while keeping the same time under one screen X.
  // How: Resolve the anchored time at the current level, then solve the new start so the same X maps to that time.
  setAnchoredZoomLevel(levelIndex: number, clientX: number, gridLeftPx: number): boolean {
    const clamped = TimeScale.clampZoomLevel(levelIndex);
    if (clamped === this.timeScale.zoomLevelIndex) return false;
    if (this.gridWidthPx <= 0) return this.setZoomLevel(levelIndex);

    // Resolve anchor time at current zoom
    const currentPPS = this.timeScale.pixelsPerSample;
    const currentGridWidth = this.exactGridWidthPx();
    const clampedOffset = Math.min(Math.max(clientX - gridLeftPx, 0), currentGridWidth);
    const anchoredSampleIndex = Math.round(clampedOffset / currentPPS);
    const anchoredTime = this.viewStartCoord + anchoredSampleIndex * this.timeScale.timebase.internalTimeFactor;

    // Switch to next zoom level
    this.timeScale.setZoomLevel(clamped);
    const nextDuration = this.timeScale.getDurationCoord(this.gridWidthPx);
    const nextPPS = this.timeScale.pixelsPerSample;
    const nextGridWidth = this.timeScale.getGridWidthPx(this.gridWidthPx);
    const nextSampleOffset = Math.round(
      Math.min(Math.max(clientX - gridLeftPx, 0), nextGridWidth) / nextPPS,
    );

    this.viewDurationCoord = nextDuration;
    this.viewStartCoord = this.clampStartCoord(
      this.timeScale.snapToSample(
        anchoredTime - nextSampleOffset * this.timeScale.timebase.internalTimeFactor,
      ),
    );
    return true;
  }

  // Purpose: Step the zoom level by one increment.
  // How: Delegate to setZoomLevel with an offset.
  stepZoomLevel(delta: -1 | 1): boolean {
    return this.setZoomLevel(this.timeScale.zoomLevelIndex + delta);
  }

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  // Purpose: Shift the window to keep the cursor visible.
  // How: Pan only when the cursor lies outside the visible range, then clamp.
  ensureCursorVisible(cursorCoord: TimeCoord): void {
    const viewEnd = this.viewStartCoord + this.viewDurationCoord;
    if (cursorCoord < this.viewStartCoord) {
      this.viewStartCoord = this.clampStartCoord(cursorCoord);
    } else if (cursorCoord > viewEnd) {
      this.viewStartCoord = this.clampStartCoord(cursorCoord - this.viewDurationCoord);
    } else {
      this.viewStartCoord = this.clampStartCoord(this.viewStartCoord);
    }
  }

  // Purpose: Shift the window to keep a time range fully visible.
  // How: Pan left or right as needed, then clamp.
  ensureRangeVisible(rangeStart: TimeCoord, rangeEnd: TimeCoord): void {
    const viewEnd = this.viewStartCoord + this.viewDurationCoord;
    if (rangeStart < this.viewStartCoord) {
      this.viewStartCoord = this.clampStartCoord(rangeStart);
    } else if (rangeEnd > viewEnd) {
      this.viewStartCoord = this.clampStartCoord(rangeEnd - this.viewDurationCoord);
    } else {
      this.viewStartCoord = this.clampStartCoord(this.viewStartCoord);
    }
  }

  // Purpose: Compute playback-follow drift as a signed coordinate offset.
  // How: Compare the cursor against the follow zone and return the needed shift.
  getPlaybackFollowPreviewOffset(cursorCoord: TimeCoord): number {
    const followCoord = this.viewStartCoord + Math.round(this.viewDurationCoord * PLAYBACK_FOLLOW_RATIO);
    if (cursorCoord > followCoord) return followCoord - cursorCoord;
    if (cursorCoord < this.viewStartCoord) return this.viewStartCoord - cursorCoord;
    return 0;
  }

  // -------------------------------------------------------------------------
  // Edge scroll
  // -------------------------------------------------------------------------

  // Purpose: Return the maximum edge-scroll speed proportional to the visible duration.
  // How: Scale by 1.75× the visible seconds so speed stays consistent across zoom levels.
  getEdgeScrollMaxSpeed(): number {
    return this.viewDurationSeconds() * 1.75;
  }

  // -------------------------------------------------------------------------
  // Time conversions
  // -------------------------------------------------------------------------

  // Purpose: Return the visible start in seconds.
  // How: Convert from internal time coordinates using the current time context.
  viewStartSeconds(): number {
    return this.timeScale.fromTimeCoord(this.viewStartCoord);
  }

  // Purpose: Return the visible duration in seconds.
  // How: Convert from internal time coordinates using the current time context.
  viewDurationSeconds(): number {
    return this.timeScale.fromTimeCoord(this.viewDurationCoord);
  }

  // Purpose: Resynchronize the timebase after a project change (e.g. sample rate).
  // How: Preserve the visible start in seconds, switch timebase, then snap and clamp.
  syncTimebase(timebase: Timebase): void {
    const viewStartSec = this.viewStartSeconds();
    this.timeScale.setTimebase(timebase);
    this.viewStartCoord = this.clampStartCoord(
      this.timeScale.snapToSample(
        this.timeScale.toTimeCoord(viewStartSec),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Snapshot
  // -------------------------------------------------------------------------

  // Purpose: Capture the visible window, e.g. when a gesture that Escape may
  //          cancel starts.
  // How: Copy the start, the duration and the zoom level.
  snapshot(): TimelineViewportSnapshot {
    return {
      viewStartCoord: this.viewStartCoord,
      viewDurationCoord: this.viewDurationCoord,
      zoomLevelIndex: this.timeScale.zoomLevelIndex,
    };
  }

  // Purpose: Put the visible window back exactly as a snapshot recorded it.
  // How: Restore the zoom level, then the start and duration as they were
  //      (no re-snap: they were valid for that level). Returns whether the
  //      window changed.
  restore(snapshot: TimelineViewportSnapshot): boolean {
    const changed = snapshot.zoomLevelIndex !== this.timeScale.zoomLevelIndex
      || snapshot.viewStartCoord !== this.viewStartCoord
      || snapshot.viewDurationCoord !== this.viewDurationCoord;
    this.timeScale.setZoomLevel(snapshot.zoomLevelIndex);
    this.viewDurationCoord = snapshot.viewDurationCoord;
    this.viewStartCoord = snapshot.viewStartCoord;
    return changed;
  }

  // -------------------------------------------------------------------------
  // Grid measurement
  // -------------------------------------------------------------------------

  // Purpose: Update the cached grid dimensions after a DOM resize.
  // How: Store the measured values so zoom/conversion operations use up-to-date geometry.
  updateGridDimensions(widthPx: number, heightPx: number): void {
    this.gridWidthPx = widthPx;
    this.gridHeightPx = heightPx;
  }
}
