/**************************** gesture-state.ts ********************************
 *
 * Purpose: Types and tuning constants for transient pointer gestures on the
 *          timeline — clip drag, marquee selection, ruler pan/zoom.
 * How: Declare the in-flight state types and the ruler/edge-scroll tuning
 *      constants. The mutable instances live on demoState (for now); the
 *      operations that drive these gestures live in interactions.ts.
 *
 ******************************************************************************/
import type { TimeCoord } from "../../src/domain/timebase.js";
import type { TrackId } from "../../src/domain/track-id.js";

/** Pointer travel (px) before a press on a clip becomes a drag; same as the marquee selection. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * Purpose: Track the in-flight state of a clip drag gesture.
 * How: Store the pointer identity, raw and snapped preview positions, and target track.
 */
export type DragState = {
  clipId: string;
  clipIds: string[];
  previewClipId: string;
  previewClipIds: Map<string, string>;
  previewDetachedFromBackground: boolean;
  duplicateOnDrag: boolean;
  pointerId: number;
  /** Pointer position at pointerdown, for the drag threshold. */
  startPointerX: number;
  startPointerY: number;
  /** True once the pointer has moved past DRAG_THRESHOLD_PX: before that, a release is a plain click. */
  moved: boolean;
  grabTime: TimeCoord;
  pointerOffsetCoord: TimeCoord;
  pointerOffsetTrack: number;
  lastPointerX: number;
  lastDeltaX: number;
  lastNonZeroDeltaX: number;
  lastPointerY: number;
  gridLeftPx: number;
  gridRightPx: number;
  gridTopPx: number;
  gridWidthPx: number;
  gridHeightPx: number;
  sourceGroupStart: TimeCoord;
  sourceGroupDurationCoord: TimeCoord;
  sourceGroupMinTrackIndex: number;
  sourceGroupMaxTrackIndex: number;
  dragRasterStartCoord: TimeCoord;
  dragRasterEndCoord: TimeCoord;
  alignmentGuideWindowStartCoord: TimeCoord;
  alignmentGuideWindowEndCoord: TimeCoord;
  rawPreviewStart: TimeCoord;
  previewStart: TimeCoord;
  previewTrackId: TrackId;
  previewPlacements: Map<string, { start: TimeCoord; trackId: TrackId }>;
  sourcePlacements: Map<string, { start: TimeCoord; trackId: TrackId }>;
  alignmentGuideCoords: TimeCoord[];
};

/**
 * Purpose: Track one in-flight marquee selection gesture over the timeline grid.
 * How: Store the pointer identity, grid bounds, and current rectangle endpoints in client pixels.
 */
export type SelectionRectState = {
  pointerId: number;
  startPointerX: number;
  startPointerY: number;
  lastPointerX: number;
  lastPointerY: number;
  gridLeftPx: number;
  gridTopPx: number;
  gridWidthPx: number;
  gridHeightPx: number;
  active: boolean;
};

/**
 * Purpose: Track the in-flight state of a ruler pan/zoom gesture.
 * How: Store pointer start and current positions, accumulated zoom delta, and resolved gesture mode.
 */
export type RulerDragState = {
  pointerId: number;
  startPointerX: number;
  startPointerY: number;
  lastPointerX: number;
  lastPointerY: number;
  lastPointerTimestampMs: number;
  startZoomLevelIndex: number;
  gridWidthPx: number;
  gridHeightPx: number;
  pendingZoomDeltaY: number;
  panPreviewOffsetPx: number;
  panCommittedOffsetPx: number;
  panVelocityPxPerMs: number;
  mode: "pending" | "pan" | "zoom";
};

// ---------------------------------------------------------------------------
// Tuning constants — ruler & edge-scroll
// ---------------------------------------------------------------------------

export const EDGE_SCROLL_ZONE_PX = 140;
export const RULER_ZOOM_STEP_PX = 16;
export const RULER_GESTURE_LOCK_PX = 10;
export const RULER_ZOOM_STEP_FACTOR = 2 ** (1 / 4);
export const RULER_PAN_COMMIT_THRESHOLD_PX = 160;
/**
 * Decay of the pan momentum while the ruler pointer is held (per ms): after a
 * flick, the view keeps going and slows down with a time constant of ~0.29 s.
 * There is no inertia after release: the pan stops when the pointer is lifted.
 */
export const RULER_PAN_DRAG_DECAY_PER_MS = 0.0035;
export const RULER_PAN_DRAG_GAIN = 1.15;
