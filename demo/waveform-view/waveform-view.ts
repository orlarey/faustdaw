/****************************** waveform-view/waveform-view.ts ******************************
 *
 * Purpose: Represent the scrolling waveform-view subsystem independently from timeline scene rendering.
 * How: Waveform content is painted into the shared grid sliding buffers via a content painter callback,
 *      then composited from the track portion (below ruler) of those buffers into the waveform canvas.
 *      Selection borders are drawn on top during compositing.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { Elements } from "../bind-elements.js";
import { TimelineClip, type ClipPixmap, type ClipRenderModel } from "../clip/clip.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import { hasEffectiveDragPreview } from "../clip/clip-drag-preview.js";
import type { ExactTimelineScale } from "../time-scale.js";
import type { DragState } from "../gesture/gesture-state.js";
import { Timeline } from "../timeline/timeline.js";
import { TimelineProjection } from "../timeline/timeline-projection.js";
import {
  logPrimaryDivisionDraw,
  logRareRenderCost,
} from "../timeline/timeline-debug.js";
import { DAWRenderView } from "../view/daw-render-view.js";
import {
  getSharedGridSlidingState,
  SHARED_GRID_RULER_HEIGHT_PX,
  type DivisionContentPainter,
} from "../grid-view/grid-view-buffers.js";
import {
  drawClipWaveformsToContext,
} from "./waveform-painter.js";

export type WaveformViewFrame = {
  displayStartCoord: number;
  displayEndCoord: number;
  displayProjection: TimelineProjection;
  windowChanged: boolean;
};

export type WaveformFrameRenderResult = {
  visibleModels: readonly ClipRenderModel[];
};

class WaveformTimelinePixmap implements ClipPixmap {
  readonly #context: CanvasRenderingContext2D | null;
  readonly #topOffsetPx: number;
  readonly #suppressSelection: boolean;
  readonly #models: ClipRenderModel[];

  constructor(
    context: CanvasRenderingContext2D | null,
    options?: {
      topOffsetPx?: number;
      suppressSelection?: boolean;
      models?: ClipRenderModel[];
    },
  ) {
    this.#context = context;
    this.#topOffsetPx = options?.topOffsetPx ?? 0;
    this.#suppressSelection = options?.suppressSelection ?? false;
    this.#models = options?.models ?? [];
  }

  withTrackOffset(topOffsetPx: number): WaveformTimelinePixmap {
    return new WaveformTimelinePixmap(this.#context, {
      topOffsetPx: this.#topOffsetPx + topOffsetPx,
      suppressSelection: this.#suppressSelection,
      models: this.#models,
    });
  }

  drawClip(model: ClipRenderModel): void {
    const translatedModel = this.#topOffsetPx === 0
      ? model
      : { ...model, topPx: model.topPx + this.#topOffsetPx };
    this.#models.push(translatedModel);
    if (!this.#context) {
      return;
    }
    TimelineClip.drawRasterBlocks(this.#context, [
      this.#suppressSelection
        ? { ...translatedModel, isSelected: false }
        : translatedModel,
    ]);
  }

  models(): readonly ClipRenderModel[] {
    return this.#models;
  }
}

function renderTimelineModels(
  current: Project,
  projection: TimelineProjection,
  dragState: DragState | null,
  presentationInputs: ClipPresentationInputs,
  options?: {
    context?: CanvasRenderingContext2D | null;
    suppressSelection?: boolean;
  },
): ClipRenderModel[] {
  const pixmap = new WaveformTimelinePixmap(options?.context ?? null, {
    suppressSelection: options?.suppressSelection ?? false,
  });
  Timeline.fromProject(current).render(pixmap, projection, dragState, presentationInputs);
  return [...pixmap.models()];
}

function getWaveformBackgroundSuppressionKey(dragState: DragState | null): string {
  return !dragState || dragState.duplicateOnDrag || !hasEffectiveDragPreview(dragState)
    ? "none"
    : `move:${dragState.clipIds.join(",")}`;
}

function getWaveformSelectedOverlayModels(models: readonly ClipRenderModel[]): ClipRenderModel[] {
  return models.filter((model) => model.isSelected);
}

// Purpose: Build the content-key fragment that the grid sliding-state uses to detect waveform invalidation.
// How: Encode the drag-suppression state so that drag changes force a buffer rebuild.
export function buildWaveformContentKey(dragState: DragState | null): string {
  return `waveform;v${_waveformContentVersion};${getWaveformBackgroundSuppressionKey(dragState)}`;
}

// Purpose: Build a DivisionContentPainter that draws clip waveforms into each grid buffer division.
// How: For each division, project the division's time range, render clip models, and draw waveforms
//      into the provided context at a Y offset below the ruler.
export function buildWaveformContentPainter(
  current: Project,
  visibleProjection: TimelineProjection,
  renderScale: ExactTimelineScale,
  dragState: DragState | null,
  presentationInputs: ClipPresentationInputs,
): DivisionContentPainter {
  return (
    context: CanvasRenderingContext2D,
    divisionOffsetIndex: number,
    renderUnitIndex: number,
    unitStepCoord: number,
    unitWidthPx: number,
    renderHeightPx: number,
    _bufferWidthPx: number,
  ) => {
    const trackHeightPx = renderHeightPx - SHARED_GRID_RULER_HEIGHT_PX;
    if (trackHeightPx <= 0) {
      return;
    }
    const destLeftPx = divisionOffsetIndex * unitWidthPx;
    const divisionStartCoord = renderUnitIndex * unitStepCoord;
    const divisionEndCoord = divisionStartCoord + unitStepCoord;
    context.save();
    context.beginPath();
    context.rect(destLeftPx, SHARED_GRID_RULER_HEIGHT_PX, unitWidthPx, trackHeightPx);
    context.clip();
    context.translate(destLeftPx, SHARED_GRID_RULER_HEIGHT_PX);
    const divisionProjection = TimelineProjection.fromCanvas({
      canvasStartCoord: divisionStartCoord,
      canvasEndCoord: divisionEndCoord,
      canvasHeightPx: trackHeightPx,
      pixelsPerCoord: visibleProjection.pixelsPerCoord,
      trackCount: visibleProjection.trackCount,
    });
    const models = renderTimelineModels(current, divisionProjection, dragState, presentationInputs, {
      context,
      suppressSelection: true,
    });
    drawClipWaveformsToContext(context, models, unitWidthPx, renderScale);
    context.restore();
    logPrimaryDivisionDraw("waveform", "left", "unified-fill", renderUnitIndex, unitStepCoord);
  };
}

// Purpose: Represent the waveform-view subsystem through one public API.
// How: Waveform content lives in the shared grid sliding buffers. This class only handles
//      compositing the track portion to the waveform DOM canvas and drawing selection borders.
let _waveformContentVersion = 0;

export class WaveformView {
  static invalidateBuffers(): void {
    _waveformContentVersion++;
  }

  // Purpose: Prepare one buffered waveform frame from the grid's unified sliding buffers.
  // How: Derive the display window from the grid frame since both share the same buffers.
  static prepareFrame(input: {
    project: Project;
    view: DAWRenderView;
    visibleProjection: TimelineProjection;
    renderScale: ExactTimelineScale;
    useBufferedViewport: boolean;
    bufferedDisplayMarginCoord: number;
    previousDisplayStartCoord: number | null;
    previousDisplayEndCoord: number | null;
  }): WaveformViewFrame {
    // Waveform frame is now derived in timeline-frame-context from the grid frame.
    // This method is kept for backward compatibility with the direct-rendering path.
    return {
      displayStartCoord: input.view.viewStartCoord,
      displayEndCoord: input.view.viewEndCoord,
      displayProjection: TimelineProjection.fromCanvasRange(
        input.view,
        input.view.viewStartCoord,
        input.view.viewEndCoord,
        input.visibleProjection.canvasHeightPx,
      ),
      windowChanged: false,
    };
  }

  static renderFrame(
    elements: Elements,
    current: Project,
    frame: WaveformViewFrame,
    dragState: DragState | null,
    presentationInputs: ClipPresentationInputs,
  ): WaveformFrameRenderResult {
    const renderStartMs = performance.now();
    const gridState = getSharedGridSlidingState();
    if (!gridState) {
      return { visibleModels: [] };
    }
    const trackHeightPx = gridState.renderHeightPx - SHARED_GRID_RULER_HEIGHT_PX;
    if (trackHeightPx <= 0) {
      return { visibleModels: [] };
    }

    // Compute visible models from the composited buffer range.
    const leftSlot = gridState.slots[gridState.leftSlot]!;
    const rightSlot = gridState.slots[gridState.rightSlot]!;
    const renderStartCoord = Math.max(frame.displayStartCoord, leftSlot.startCoord);
    const renderEndCoord = Math.min(frame.displayEndCoord, rightSlot.endCoord);
    const visibleModels = renderTimelineModels(
      current,
      TimelineProjection.fromCanvas({
        canvasStartCoord: renderStartCoord,
        canvasEndCoord: renderEndCoord,
        canvasHeightPx: trackHeightPx,
        pixelsPerCoord: frame.displayProjection.pixelsPerCoord,
        trackCount: frame.displayProjection.trackCount,
      }),
      dragState,
      presentationInputs,
    );

    // Draw selection borders on the shared-grid canvas (offset by ruler height).
    const selectedModels = getWaveformSelectedOverlayModels(visibleModels);
    if (selectedModels.length > 0) {
      const context = elements.timelineSharedGrid.getContext("2d");
      if (context) {
        const dpr = window.devicePixelRatio || 1;
        context.save();
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.translate(0, SHARED_GRID_RULER_HEIGHT_PX);
        TimelineClip.drawRasterSelectionBorders(context, selectedModels);
        context.restore();
      }
    }

    logRareRenderCost("waveform-viewport", performance.now() - renderStartMs, {
      renderWidthPx: Math.round(frame.displayProjection.canvasWidthPx),
      windowStartCoord: frame.displayStartCoord,
      windowEndCoord: frame.displayEndCoord,
      trackHeightPx: Math.round(trackHeightPx),
    });
    return { visibleModels };
  }

  static renderDirectFrame(
    elements: Elements,
    current: Project,
    projection: TimelineProjection,
    renderScale: ExactTimelineScale,
    dragState: DragState | null,
    presentationInputs: ClipPresentationInputs,
  ): void {
    // Draw clips directly onto the shared-grid canvas (which already has grid lines at full height).
    // The grid was drawn by GridView.renderDirectFrame; we overlay clips in the track area.
    const context = elements.timelineSharedGrid.getContext("2d");
    if (!context) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.translate(0, SHARED_GRID_RULER_HEIGHT_PX);
    const models = renderTimelineModels(current, projection, dragState, presentationInputs, {
      context,
      suppressSelection: true,
    });
    if (models.length > 0) {
      drawClipWaveformsToContext(context, models, projection.canvasWidthPx, renderScale, "envelope");
      TimelineClip.drawRasterSelectionBorders(context, getWaveformSelectedOverlayModels(models));
    }
    context.restore();
  }
}
