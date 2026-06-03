/*************************** marker/marker-manager.ts ***************************
 *
 * Purpose: Container for all timeline markers. Manages their lifecycle, drag
 *          interactions, auto-scroll, and position projection (coord→pixel).
 * How: The MarkerManager is to markers what a track is to clips: the container
 *      knows the content, but not the inverse. Markers are purely visual; the
 *      manager handles all behavior.
 *
 ******************************************************************************/
import type { TimeCoord, Timebase } from "../../src/domain/timebase.js";
import { Marker, makeCursorMarker, makeCutMarker, makeLastPlayMarker, makeLoopEndMarker } from "./marker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-marker domain callback invoked on each position change during drag. */
type MarkerDragStepCallback = (marker: Marker, coord: TimeCoord) => void;

/** Per-marker domain callback invoked when a drag ends. */
type MarkerDragEndCallback = (marker: Marker) => void;

/**
 * Purpose: Abstract the viewport state needed by auto-scroll.
 * How: The caller provides read/write access to view coordinates and
 *      helper functions so MarkerManager stays independent of demoState.
 */
export type MarkerManagerViewport = {
  readonly viewStartCoord: number;
  readonly viewDurationCoord: number;
  readonly timebase: Timebase;
  setViewStartCoord(coord: number): void;
  clampViewStartCoord(viewStart: number): number;
  getEdgeScrollMaxSpeed(): number;
}

/**
 * Purpose: Full configuration for MarkerManager construction.
 */
export type MarkerManagerConfig = {
  container: HTMLElement;
  pixelToCoord: (clientX: number) => TimeCoord;
  coordToPixel: (coord: TimeCoord) => number;
  snapToGrid: (coord: TimeCoord) => TimeCoord;
  renderFrame: () => void;
  getGridRect: () => DOMRect;
  viewport: MarkerManagerViewport;
  cursorOnStep: MarkerDragStepCallback;
  cursorOnDragEnd: MarkerDragEndCallback;
}

// ---------------------------------------------------------------------------
// Edge-scroll constants
// ---------------------------------------------------------------------------

const EDGE_SCROLL_ZONE_PX = 60;

// ---------------------------------------------------------------------------
// MarkerManager class
// ---------------------------------------------------------------------------

/**
 * Purpose: Own and operate all timeline markers.
 * How: Creates markers at construction, handles drag interactions (hit-test,
 *      pointer capture, coord conversion, snap, auto-scroll) and exposes
 *      render-pipeline hooks for position projection.
 */
export class MarkerManager {
  // Markers
  private readonly cursorMarker: Marker;
  private readonly cutMarker: Marker;
  private readonly lastPlayMarker: Marker;
  private readonly loopEndMarker: Marker;

  // Draggable entries with domain callbacks
  private readonly draggableMarkers: {
    marker: Marker;
    onStep: MarkerDragStepCallback;
    onDragEnd: MarkerDragEndCallback;
  }[];

  // Injected services
  private readonly pixelToCoord: (clientX: number) => TimeCoord;
  private readonly coordToPixel: (coord: TimeCoord) => number;
  private readonly snapToGrid: (coord: TimeCoord) => TimeCoord;
  private readonly renderFrame: () => void;
  private readonly getGridRect: () => DOMRect;
  private readonly viewport: MarkerManagerViewport;

  // Pan preview offset — set by the render pipeline each frame
  private panOffsetPx = 0;

  // Drag state (shared across all markers)
  private draggedMarker: Marker | null = null;
  private dragPointerId: number | null = null;
  private lastPointerX = 0;
  private lastDeltaX = 0;
  private lastNonZeroDeltaX = 0;
  private autoScrollFrameId: number | null = null;
  private autoScrollTimestamp: number | null = null;

  // Bound event handlers (stable references for add/removeEventListener)
  private readonly onContainerPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;

  constructor(config: MarkerManagerConfig) {
    this.pixelToCoord = config.pixelToCoord;
    this.coordToPixel = config.coordToPixel;
    this.snapToGrid = config.snapToGrid;
    this.renderFrame = config.renderFrame;
    this.getGridRect = config.getGridRect;
    this.viewport = config.viewport;

    // Bind event handlers
    this.onContainerPointerDown = (e) => this.handlePointerDown(e);
    this.onPointerMove = (e) => this.handlePointerMove(e);
    this.onPointerUp = (e) => this.handlePointerUp(e);

    // Create markers
    this.cursorMarker = makeCursorMarker();
    this.cutMarker = makeCutMarker();
    this.lastPlayMarker = makeLastPlayMarker(0 as TimeCoord);
    this.lastPlayMarker.setVisible(false);
    this.loopEndMarker = makeLoopEndMarker(0 as TimeCoord);
    this.loopEndMarker.setVisible(false);

    // Insert into container
    config.container.appendChild(this.cursorMarker.rootElement);
    config.container.appendChild(this.cutMarker.rootElement);
    config.container.appendChild(this.lastPlayMarker.rootElement);
    config.container.appendChild(this.loopEndMarker.rootElement);

    // Register draggable markers with their domain callbacks
    this.draggableMarkers = [
      {
        marker: this.cursorMarker,
        onStep: config.cursorOnStep,
        onDragEnd: config.cursorOnDragEnd,
      },
      {
        marker: this.cutMarker,
        onStep: (_marker, _coord) => {},
        onDragEnd: (_marker) => {},
      },
    ];

    // Listen for pointer events on the container
    config.container.addEventListener("pointerdown", this.onContainerPointerDown);
  }

  // -------------------------------------------------------------------------
  // Projection helper
  // -------------------------------------------------------------------------

  private projectCoord(coord: TimeCoord): number {
    return this.coordToPixel(coord) + this.panOffsetPx;
  }

  // -------------------------------------------------------------------------
  // Render-pipeline hooks
  // -------------------------------------------------------------------------

  setPanOffset(offset: number): void {
    this.panOffsetPx = offset;
  }

  updateCursorPosition(coord: TimeCoord): void {
    this.cursorMarker.update(coord, this.projectCoord(coord));
  }

  updateCutPosition(coord: TimeCoord): void {
    this.cutMarker.update(coord, this.projectCoord(coord));
  }

  getCutPosition(): TimeCoord {
    return this.cutMarker.position;
  }

  setCutPosition(coord: TimeCoord): void {
    this.cutMarker.update(coord, this.projectCoord(coord));
  }

  updateLastPlayPosition(coord: TimeCoord | null): void {
    if (coord === null) {
      this.lastPlayMarker.setVisible(false);
    } else {
      this.lastPlayMarker.setVisible(true);
      this.lastPlayMarker.update(coord, this.projectCoord(coord));
    }
  }

  updateLoopEndPosition(coord: TimeCoord | null): void {
    if (coord === null) {
      this.loopEndMarker.setVisible(false);
    } else {
      this.loopEndMarker.setVisible(true);
      this.loopEndMarker.update(coord, this.projectCoord(coord));
    }
  }

  setCursorDragFeedback(text: string | null): void {
    this.cursorMarker.setDragFeedback(text);
  }

  isMarkerDragging(): boolean {
    return this.draggedMarker !== null;
  }

  isCursorDragging(): boolean {
    return this.draggedMarker === this.cursorMarker;
  }

  getMarkerDragPointerX(): number | null {
    return this.draggedMarker !== null ? this.lastPointerX : null;
  }

  // -------------------------------------------------------------------------
  // Drag: pointer event handlers
  // -------------------------------------------------------------------------

  private handlePointerDown(e: PointerEvent): void {
    if (this.draggedMarker) return;

    // Hit-test: find which draggable marker's icon was clicked
    const target = e.target as HTMLElement;
    const entry = this.draggableMarkers.find(({ marker }) =>
      marker.active && marker.draggable && marker.iconElement.contains(target),
    );
    if (!entry) return;

    e.preventDefault();
    e.stopPropagation();

    this.draggedMarker = entry.marker;
    this.dragPointerId = e.pointerId;
    this.lastPointerX = e.clientX;
    this.lastDeltaX = 0;
    this.lastNonZeroDeltaX = 0;

    // Capture on the icon element for reliable tracking
    entry.marker.iconElement.setPointerCapture(e.pointerId);
    entry.marker.iconElement.addEventListener("pointermove", this.onPointerMove);
    entry.marker.iconElement.addEventListener("pointerup", this.onPointerUp);
    entry.marker.iconElement.addEventListener("pointercancel", this.onPointerUp);

    // Immediate position update at click point
    let coord = this.pixelToCoord(e.clientX);
    if (entry.marker.snappable) {
      coord = this.snapToGrid(coord);
    }
    if (coord < 0) coord = 0 as TimeCoord;
    entry.marker.update(coord, this.projectCoord(coord));
    entry.onStep(entry.marker, coord);
    this.renderFrame();
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.draggedMarker) return;

    const delta = e.clientX - this.lastPointerX;
    this.lastPointerX = e.clientX;
    this.lastDeltaX = delta;
    if (delta !== 0) {
      this.lastNonZeroDeltaX = delta;
    }

    // Compute new position
    let coord = this.pixelToCoord(e.clientX);
    const entry = this.draggableMarkers.find(({ marker }) => marker === this.draggedMarker);
    if (!entry) return;

    if (entry.marker.snappable) {
      coord = this.snapToGrid(coord);
    }
    if (coord < 0) coord = 0 as TimeCoord;

    entry.marker.update(coord, this.projectCoord(coord));
    entry.onStep(entry.marker, coord);
    this.renderFrame();

    // Start auto-scroll if near edge
    this.startAutoScrollIfNeeded();
  }

  private handlePointerUp(_e: PointerEvent): void {
    if (!this.draggedMarker) return;

    const entry = this.draggableMarkers.find(({ marker }) => marker === this.draggedMarker);
    const icon = this.draggedMarker.iconElement;

    if (this.dragPointerId !== null) {
      icon.releasePointerCapture(this.dragPointerId);
    }
    icon.removeEventListener("pointermove", this.onPointerMove);
    icon.removeEventListener("pointerup", this.onPointerUp);
    icon.removeEventListener("pointercancel", this.onPointerUp);

    this.stopAutoScroll();

    if (entry) {
      entry.onDragEnd(entry.marker);
    }

    this.draggedMarker = null;
    this.dragPointerId = null;
    this.renderFrame();
  }

  // -------------------------------------------------------------------------
  // Auto-scroll during drag
  // -------------------------------------------------------------------------

  private getEdgeScrollSpeed(): number {
    if (!this.draggedMarker) return 0;

    const gridRect = this.getGridRect();
    const vp = this.viewport;
    const zeroClientXPx = vp.viewStartCoord < 0 && vp.viewDurationCoord > 0
      ? gridRect.left + ((0 - vp.viewStartCoord) / vp.viewDurationCoord) * gridRect.width
      : null;
    const rightZoneStartPx = gridRect.right - EDGE_SCROLL_ZONE_PX;

    if (this.lastPointerX >= rightZoneStartPx) {
      if (this.lastNonZeroDeltaX <= 0) return 0;
      if (
        zeroClientXPx !== null
        && this.draggedMarker.position <= 0
        && this.lastPointerX <= zeroClientXPx
      ) {
        return 0;
      }
      const intensity = Math.min((this.lastPointerX - rightZoneStartPx) / EDGE_SCROLL_ZONE_PX, 1);
      return vp.getEdgeScrollMaxSpeed() * intensity * intensity;
    }

    if (this.lastPointerX < gridRect.left) {
      if (vp.viewStartCoord <= 0) return 0;
      const intensity = Math.min((gridRect.left - this.lastPointerX) / EDGE_SCROLL_ZONE_PX, 1);
      return -vp.getEdgeScrollMaxSpeed() * intensity * intensity;
    }

    return 0;
  }

  private stopAutoScroll(): void {
    if (this.autoScrollFrameId !== null) {
      cancelAnimationFrame(this.autoScrollFrameId);
    }
    this.autoScrollFrameId = null;
    this.autoScrollTimestamp = null;
  }

  private stepAutoScroll(timestamp: number): void {
    if (!this.draggedMarker) {
      this.stopAutoScroll();
      return;
    }

    const speed = this.getEdgeScrollSpeed();
    if (speed === 0) {
      this.stopAutoScroll();
      this.renderFrame();
      return;
    }

    const previousTimestamp = this.autoScrollTimestamp ?? timestamp;
    const deltaSeconds = (timestamp - previousTimestamp) / 1000;
    this.autoScrollTimestamp = timestamp;

    // Shift the view
    const vp = this.viewport;
    vp.setViewStartCoord(
      vp.clampViewStartCoord(
        vp.viewStartCoord + vp.timebase.toTimeCoord(speed * deltaSeconds),
      ),
    );

    // Recompute marker position at current pointer
    const entry = this.draggableMarkers.find(({ marker }) => marker === this.draggedMarker);
    if (entry) {
      let coord = this.pixelToCoord(this.lastPointerX);
      if (entry.marker.snappable) {
        coord = this.snapToGrid(coord);
      }
      if (coord < 0) coord = 0 as TimeCoord;
      entry.marker.update(coord, this.projectCoord(coord));
      entry.onStep(entry.marker, coord);
    }

    this.renderFrame();
    this.autoScrollFrameId = requestAnimationFrame((t) => this.stepAutoScroll(t));
  }

  private startAutoScrollIfNeeded(): void {
    if (!this.draggedMarker || this.autoScrollFrameId !== null) return;
    const speed = this.getEdgeScrollSpeed();
    if (speed === 0) return;
    this.autoScrollFrameId = requestAnimationFrame((t) => this.stepAutoScroll(t));
  }
}

// ---------------------------------------------------------------------------
// Demo-level singleton
// ---------------------------------------------------------------------------

let instance: MarkerManager | null = null;

/**
 * Purpose: Create and store the singleton MarkerManager instance.
 */
export function initMarkerManager(config: MarkerManagerConfig): void {
  instance = new MarkerManager(config);
}

/**
 * Purpose: Return the initialized MarkerManager instance.
 * How: Throw if initMarkerManager has not been called yet.
 */
export function markerManager(): MarkerManager {
  if (!instance) throw new Error("MarkerManager not initialized — call initMarkerManager first");
  return instance;
}
