/******************************** view/view.ts ********************************
 *
 * Purpose: Bridge DOM measurements and ruler-gesture controllers into the DOM-agnostic TimelineViewport.
 * How: Expose static methods that read element rects and drive the ruler gesture state machine,
 *      so TimelineViewport and DAWRulerGesture stay free of Elements and global drag state.
 *
 ******************************************************************************/
import { TRACK_IDS, type TrackId } from "../../src/domain/track-id.js";
import type { TimeCoord } from "../../src/domain/timebase.js";
import type { Elements } from "../bind-elements.js";
import { RULER_GESTURE_LOCK_PX, RULER_ZOOM_STEP_PX } from "../gesture/gesture-state.js";
import { demoState } from "../state.js";
import { DAWRulerGesture } from "./daw-ruler-gesture.js";
import { DAWRenderView } from "./daw-render-view.js";

const dawRulerGesture = new DAWRulerGesture();

// Purpose: Bridge DOM measurements and ruler-gesture state into the DOM-agnostic TimelineViewport.
// How: Each static method reads element rects or the current ruler drag state, then forwards to the viewport or gesture controller.
export class View {
  // Purpose: Capture the current render view from the already-synced viewport state.
  // How: Snapshot the viewport and cursor markers from demoState into one immutable DAWRenderView value.
  static captureRenderView(): DAWRenderView {
    const vp = demoState.viewport;
    return DAWRenderView.fromSnapshot({
      exactTimelineZoomLevelIndex: vp.timeScale.zoomLevelIndex,
      timebase: vp.timeScale.timebase,
      viewStartCoord: vp.viewStartCoord as TimeCoord,
      viewDurationCoord: vp.viewDurationCoord as TimeCoord,
      viewportWidthPx: vp.gridWidthPx,
      viewportHeightPx: vp.gridHeightPx,
      cursorCoord: demoState.project.timeline.cursor,
      lastPlayStartCoord: demoState.lastPlayStartCoord,
    });
  }

  // Purpose: Convert a horizontal client pixel to a timeline coordinate.
  // How: Measure the grid rect and delegate to the viewport's pixel-to-coord conversion.
  static getTimeFromGridClientX(clientX: number, elements: Elements): TimeCoord {
    const gridRect = elements.timelineGrid.getBoundingClientRect();
    return demoState.viewport.pixelToCoord(clientX, gridRect.left);
  }

  // Purpose: Convert a vertical client pixel to one of the fixed track ids.
  // How: Clamp the pointer inside the measured grid height, then map its relative Y to a discrete lane index.
  static getTrackIdFromGridClientY(clientY: number, elements: Elements): TrackId {
    const gridRect = elements.timelineGrid.getBoundingClientRect();
    const fallbackTrackId = TRACK_IDS[0];
    if (!fallbackTrackId) {
      throw new Error("Expected at least one track id");
    }
    if (gridRect.height <= 0) {
      return fallbackTrackId;
    }
    const relativeY = Math.min(
      Math.max(clientY - gridRect.top, 0),
      Math.max(gridRect.height - 1, 0),
    );
    const trackIndex = Math.min(
      Math.floor((relativeY / gridRect.height) * TRACK_IDS.length),
      Math.max(TRACK_IDS.length - 1, 0),
    );
    return TRACK_IDS[trackIndex] ?? fallbackTrackId;
  }

  static updateRulerGestureMode(): void {
    if (!demoState.rulerDragState || demoState.rulerDragState.mode !== "pending") {
      return;
    }
    demoState.rulerDragState.mode = dawRulerGesture.resolveMode({
      startPointerX: demoState.rulerDragState.startPointerX,
      startPointerY: demoState.rulerDragState.startPointerY,
      lastPointerX: demoState.rulerDragState.lastPointerX,
      lastPointerY: demoState.rulerDragState.lastPointerY,
      lockThresholdPx: RULER_GESTURE_LOCK_PX,
    });
  }

  static panTimelineFromRuler(deltaX: number, elements: Elements): number {
    const vp = demoState.viewport;
    const rulerRect = elements.timelineRuler.getBoundingClientRect();
    const result = dawRulerGesture.pan({
      deltaX,
      rulerWidthPx: rulerRect.width,
      timeScale: vp.timeScale,
      timelineViewStartCoord: vp.viewStartCoord,
      timelineViewDurationCoord: vp.viewDurationCoord,
    });
    vp.viewStartCoord = result.timelineViewStartCoord;
    return result.deltaSamples;
  }

  static resetRulerPanAccumulator(): void {
    dawRulerGesture.resetPanAccumulator();
  }

  static zoomTimelineFromRuler(clientX: number, deltaY: number, elements: Elements): boolean {
    if (!demoState.rulerDragState) {
      return false;
    }
    const targetLevelIndex = dawRulerGesture.resolveZoomLevel({
      startZoomLevelIndex: demoState.rulerDragState.startZoomLevelIndex,
      totalDeltaY: deltaY,
      zoomStepPx: RULER_ZOOM_STEP_PX,
    });
    if (targetLevelIndex === demoState.viewport.timeScale.zoomLevelIndex) {
      return false;
    }
    return View.setTimelineZoomLevelIndexAnchored(targetLevelIndex, clientX, elements);
  }

  static syncExactTimelineViewport(elements: Elements): void {
    const vp = demoState.viewport;
    const rulerDragState = demoState.rulerDragState;
    const cachedWidthPx = rulerDragState?.gridWidthPx ?? (vp.gridWidthPx > 0 ? vp.gridWidthPx : null);
    const cachedHeightPx = rulerDragState?.gridHeightPx ?? (vp.gridHeightPx > 0 ? vp.gridHeightPx : null);
    if (cachedWidthPx === null || cachedHeightPx === null) {
      const gridRect = elements.timelineGrid.getBoundingClientRect();
      vp.gridWidthPx = cachedWidthPx ?? gridRect.width;
      vp.gridHeightPx = cachedHeightPx ?? gridRect.height;
    } else {
      vp.gridWidthPx = cachedWidthPx;
      vp.gridHeightPx = cachedHeightPx;
    }
    vp.syncViewport();
  }

  static setTimelineZoomLevelIndexAnchored(levelIndex: number, clientX: number, elements: Elements): boolean {
    const vp = demoState.viewport;
    const gridRect = elements.timelineGrid.getBoundingClientRect();
    vp.gridWidthPx = gridRect.width;
    return vp.setAnchoredZoomLevel(levelIndex, clientX, gridRect.left);
  }
}
