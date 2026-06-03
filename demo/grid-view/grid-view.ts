/****************************** grid-view/grid-view.ts ******************************
 *
 * Purpose: Represent the scrolling grid-view subsystem independently from timeline scene rendering.
 * How: Hide the shared-grid sliding buffers, prepare one buffered or direct frame from the DAW view,
 *      then render that frame into the background grid canvas without exposing the internal three-slot buffer strategy.
 *
 ******************************************************************************/
import type { Elements } from "../bind-elements.js";
import { demoState } from "../state.js";
import type { ExactTimelineScale } from "../time-scale.js";
import {
  buildSharedGridRasterModel,
  renderSharedGridCanvas,
  renderFullViewport,
  SHARED_GRID_RULER_HEIGHT_PX,
  syncSharedGridSlidingBuffers,
  warmSharedGridPrimaryTileCanvases,
} from "./grid-view-buffers.js";
import { resolveBufferedDisplayWindow } from "../timeline/timeline-geometry.js";
import { TimelineProjection } from "../timeline/timeline-projection.js";
import type { RulerLabelRenderModel } from "../ruler-labels.js";
import { DAWRenderView } from "../view/daw-render-view.js";

export type GridViewFrame = {
  renderHeightPx: number;
  renderStartCoord: number;
  renderEndCoord: number;
  renderWidthPx: number;
  displayStartCoord: number;
  displayEndCoord: number;
  displayProjection: TimelineProjection;
  windowChanged: boolean;
};

// Purpose: Represent the background grid-view subsystem through one public API.
// How: Translate a DAW view into one buffered or direct background frame without exposing the internal three-slot buffer strategy.
export class GridView {
  // Purpose: Compute the full background-canvas height for one visible timeline view.
  // How: Add the ruler band height to the visible track-grid height.
  static renderHeightPx(visibleProjection: TimelineProjection): number {
    return SHARED_GRID_RULER_HEIGHT_PX + visibleProjection.canvasHeightPx;
  }

  // Purpose: Prepare one buffered background frame from the current view without exposing slot internals.
  // How: Synchronize the shared-grid buffers, read the published render window, and derive the display projection that should be composited.
  static prepareFrame(input: {
    view: DAWRenderView;
    visibleProjection: TimelineProjection;
    renderScale: ExactTimelineScale;
    useBufferedViewport: boolean;
    bufferedDisplayMarginCoord: number;
    previousDisplayStartCoord: number | null;
    previousDisplayEndCoord: number | null;
  }): GridViewFrame {
    const renderHeightPx = GridView.renderHeightPx(input.visibleProjection);
    warmSharedGridPrimaryTileCanvases(renderHeightPx);
    const windowChanged = syncSharedGridSlidingBuffers(
      input.view,
      input.visibleProjection,
      input.renderScale,
      renderHeightPx,
    );
    const renderStartCoord = demoState.geometryWindow.renderStart ?? input.view.viewStartCoord;
    const renderEndCoord = demoState.geometryWindow.renderEnd ?? input.view.viewEndCoord;
    const displayWindow = input.useBufferedViewport
      ? resolveBufferedDisplayWindow(
          renderStartCoord,
          renderEndCoord,
          input.view.viewStartCoord,
          input.view.viewEndCoord,
          input.bufferedDisplayMarginCoord,
          input.previousDisplayStartCoord,
          input.previousDisplayEndCoord,
          !windowChanged,
        )
      : {
          startCoord: input.view.viewStartCoord,
          endCoord: input.view.viewEndCoord,
        };
    const displayProjection = TimelineProjection.fromCanvasRange(
      input.view,
      displayWindow.startCoord,
      displayWindow.endCoord,
      renderHeightPx,
    );
    return {
      renderHeightPx,
      renderStartCoord,
      renderEndCoord,
      renderWidthPx: Math.max(0, (renderEndCoord - renderStartCoord) * input.visibleProjection.pixelsPerCoord),
      displayStartCoord: displayWindow.startCoord,
      displayEndCoord: displayWindow.endCoord,
      displayProjection,
      windowChanged,
    };
  }

  // Purpose: Render one prepared buffered background frame into the shared-grid canvas at full height.
  // How: Composite the full unified sliding buffers (ruler + tracks) into the shared-grid canvas.
  static renderFrame(elements: Elements, frame: GridViewFrame): boolean {
    elements.timelineSharedGrid.style.width = `${frame.displayProjection.canvasWidthPx.toFixed(4)}px`;
    elements.timelineSharedGrid.style.height = `${frame.renderHeightPx}px`;
    return renderFullViewport(
      elements,
      frame.displayProjection,
      frame.displayStartCoord,
      frame.displayEndCoord,
      frame.renderHeightPx,
    );
  }

  // Purpose: Render one direct, non-buffered background frame for zoom gestures or other forced rebuilds.
  // How: Build one raster model at full height (ruler + tracks) and paint it directly into the shared-grid canvas
  //      so that track-area grid lines are visible through the transparent waveform layer above.
  static renderDirectFrame(input: {
    elements: Elements;
    projection: TimelineProjection;
    renderScale: ExactTimelineScale;
    rulerLabels: readonly RulerLabelRenderModel[];
    renderHeightPx: number;
  }): void {
    input.elements.timelineSharedGrid.style.width = `${input.projection.canvasWidthPx.toFixed(4)}px`;
    input.elements.timelineSharedGrid.style.height = `${input.renderHeightPx}px`;
    const rasterModel = buildSharedGridRasterModel(
      input.renderScale,
      input.projection.canvasStartCoord,
      input.projection.canvasEndCoord,
      input.projection.canvasWidthPx,
      input.projection.canvasWidthPx,
      input.renderHeightPx,
      input.projection.pixelsPerCoord,
    );
    renderSharedGridCanvas(input.elements, rasterModel, input.rulerLabels);
  }
}
