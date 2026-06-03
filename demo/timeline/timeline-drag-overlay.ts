/******************************** timeline/timeline-drag-overlay.ts ********************************
 *
 * Purpose: Own the temporary drag overlay rendered above the timeline clip layer.
 * How: Cache one overlay canvas and guide elements, then project dragged clips and alignment
 *      guides from the current timeline render state without leaking those DOM details.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { Elements } from "../bind-elements.js";
import { resolveClipAlignmentTarget } from "../placement.js";
import { prepareRasterCanvas } from "../raster-canvas.js";
import type { ExactTimelineScale } from "../time-scale.js";
import type { DragState } from "../gesture/gesture-state.js";
import { type ClipPixmap, type ClipRenderModel, TimelineClip } from "../clip/clip.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import { hasEffectiveDragPreview } from "../clip/clip-drag-preview.js";
import { Track } from "../track/track.js";
import type { TrackPixmap } from "../track/track-pixmap.js";
import { Timeline } from "./timeline.js";
import type { TimelineProjection } from "./timeline-projection.js";
import { drawClipWaveformsToContext } from "../waveform-view/waveform-painter.js";

type DragOverlayPlacement = {
  leftPx: number;
  topPx: number;
  translateXPx: number;
  translateYPx: number;
  widthPx: number;
  heightPx: number;
};

// Purpose: Group the recurring drag-interaction fields consumed by every drag-overlay render site.
// How: Bundle the current drag state with the clip render origin, magnetism radius, and zoom level
//      so callers pass one named object instead of four separate parameters.
export type ClipDragRenderContext = {
  dragState: DragState | null;
  clipRenderStartCoord: number;
  alignmentGuideMagnetismPx: number;
  exactTimelineZoomLevelIndex: number;
};

// Purpose: Pass-through input shared by every site that asks the timeline to draw the drag overlay.
// How: Group the render context (project, projection, scale) with the drag render context,
//      so the overlay can short-circuit to a clear when no preview is active.
export type DragOverlayRenderInput = {
  project: Project;
  projection: TimelineProjection;
  renderScale: ExactTimelineScale;
  dragContext: ClipDragRenderContext;
  presentationInputs: ClipPresentationInputs;
};

class DragOverlayCanvasPixmap implements TrackPixmap, ClipPixmap {
  readonly #context: CanvasRenderingContext2D;
  readonly #topOffsetPx: number;
  readonly #models: ClipRenderModel[];

  constructor(
    context: CanvasRenderingContext2D,
    options?: {
      topOffsetPx?: number;
      models?: ClipRenderModel[];
    },
  ) {
    this.#context = context;
    this.#topOffsetPx = options?.topOffsetPx ?? 0;
    this.#models = options?.models ?? [];
  }

  withTrackOffset(topOffsetPx: number): ClipPixmap {
    return new DragOverlayCanvasPixmap(this.#context, {
      topOffsetPx: this.#topOffsetPx + topOffsetPx,
      models: this.#models,
    });
  }

  drawClip(model: ClipRenderModel): void {
    const translatedModel = {
      ...model,
      topPx: model.topPx + this.#topOffsetPx,
      isDragging: true,
      isSelected: true,
    };
    this.#models.push(translatedModel);
    TimelineClip.drawRasterBlocks(this.#context, [translatedModel]);
  }

  models(): readonly ClipRenderModel[] {
    return this.#models;
  }
}

// Purpose: Represent the timeline drag overlay as one reusable DOM-backed entity.
// How: Keep one private overlay canvas plus alignment-guide elements and redraw them on demand.
export class TimelineDragOverlay {
  readonly #guideElements: HTMLDivElement[] = [];
  #canvas: HTMLCanvasElement | null = null;
  #rasterKey: string | null = null;

  // Purpose: Remove the current overlay canvas content and all visible alignment guides.
  // How: Reset the cached raster key, hide the canvas, and trim guide elements from the overlay layer.
  clear(elements: Elements): void {
    while (this.#guideElements.length > 0) {
      this.#guideElements.pop()?.remove();
    }
    this.#rasterKey = null;
    if (!this.#canvas) {
      return;
    }
    this.#canvas.hidden = true;
    this.#canvas.style.left = "0px";
    this.#canvas.style.top = "0px";
    this.#canvas.style.transform = "";
    this.#canvas.style.width = "0px";
    this.#canvas.style.height = "0px";
    this.#canvas.width = 0;
    this.#canvas.height = 0;
  }

  // Purpose: Render the current drag overlay when the drag produces a detached preview.
  // How: Reuse one overlay canvas and a small guide-element pool, and redraw only when the raster key changes.
  render(input: DragOverlayRenderInput & { elements: Elements }): void {
    const dragState = input.dragContext.dragState;
    if (!dragState || !hasEffectiveDragPreview(dragState)) {
      this.clear(input.elements);
      return;
    }

    const canvas = this.ensureCanvas(input.elements);
    const placement = this.getPlacement(input.projection, dragState, input.dragContext.clipRenderStartCoord);
    const rasterKey = [
      dragState.clipIds.join(","),
      dragState.duplicateOnDrag ? "duplicate" : "move",
      dragState.dragRasterStartCoord,
      dragState.dragRasterEndCoord,
      dragState.sourceGroupMinTrackIndex,
      dragState.sourceGroupMaxTrackIndex,
      input.projection.pixelsPerCoord.toFixed(6),
      input.projection.laneHeightPx.toFixed(4),
      input.dragContext.exactTimelineZoomLevelIndex,
    ].join(";");

    if (this.#rasterKey !== rasterKey) {
      const context = prepareRasterCanvas(canvas, placement.widthPx, placement.heightPx);
      if (!context) {
        canvas.hidden = true;
        return;
      }
      const pixmap = new DragOverlayCanvasPixmap(context);
      Timeline.fromProject(input.project).renderDragOverlay(pixmap, input.projection, dragState, input.presentationInputs);
      const models = pixmap.models();
      drawClipWaveformsToContext(context, models, placement.widthPx, input.renderScale);
      this.#rasterKey = rasterKey;
    }

    canvas.hidden = false;
    canvas.style.left = `${placement.leftPx.toFixed(4)}px`;
    canvas.style.top = `${placement.topPx.toFixed(4)}px`;
    canvas.style.width = `${placement.widthPx.toFixed(4)}px`;
    canvas.style.height = `${placement.heightPx.toFixed(4)}px`;
    canvas.style.transform =
      placement.translateXPx === 0 && placement.translateYPx === 0
        ? ""
        : `translate(${placement.translateXPx.toFixed(4)}px, ${placement.translateYPx.toFixed(4)}px)`;

    this.renderAlignmentGuides(
      input.elements,
      this.getAlignmentGuidePositionsPx(
        dragState,
        input.dragContext.clipRenderStartCoord,
        input.projection.pixelsPerCoord,
        input.dragContext.alignmentGuideMagnetismPx,
      ),
      input.projection.canvasHeightPx,
    );
  }

  // Purpose: Lazily create and attach the overlay canvas to the drag-overlay layer.
  // How: Reuse one canvas instance and insert it at the beginning of the overlay layer when detached.
  private ensureCanvas(elements: Elements): HTMLCanvasElement {
    if (!this.#canvas) {
      this.#canvas = document.createElement("canvas");
      this.#canvas.className = "drag-overlay-canvas";
      this.#canvas.hidden = true;
    }
    if (this.#canvas.parentElement !== elements.dragOverlayLayer) {
      elements.dragOverlayLayer.insertBefore(this.#canvas, elements.dragOverlayLayer.firstChild);
    }
    return this.#canvas;
  }

  // Purpose: Compute the overlay placement rectangle for the dragged clip group.
  // How: Convert drag dates and preview lane displacement into one absolute left/top plus a relative translation.
  private getPlacement(
    projection: TimelineProjection,
    dragState: DragState,
    clipRenderStartCoord: number,
  ): DragOverlayPlacement {
    const previewTrackIndex = Track.laneIndex(dragState.previewTrackId);
    const trackDelta = previewTrackIndex - dragState.sourceGroupMinTrackIndex;
    const widthPx = Math.max((dragState.dragRasterEndCoord - dragState.dragRasterStartCoord) * projection.pixelsPerCoord, 1);
    const heightPx = Math.max(
      (dragState.sourceGroupMaxTrackIndex - dragState.sourceGroupMinTrackIndex + 1) * projection.laneHeightPx,
      1,
    );
    return {
      leftPx: (dragState.dragRasterStartCoord - clipRenderStartCoord) * projection.pixelsPerCoord,
      topPx: dragState.sourceGroupMinTrackIndex * projection.laneHeightPx,
      translateXPx: (dragState.previewStart - dragState.sourceGroupStart) * projection.pixelsPerCoord,
      translateYPx: trackDelta * projection.laneHeightPx,
      widthPx,
      heightPx,
    };
  }

  // Purpose: Compute the alignment-guide x positions for the current dragged clip group.
  // How: Match the dragged group edges against precomputed guide dates, then convert the matches to visible pixels.
  private getAlignmentGuidePositionsPx(
    dragState: DragState,
    clipRenderStartCoord: number,
    pixelsPerCoord: number,
    alignmentGuideMagnetismPx: number,
  ): number[] {
    const alignment = resolveClipAlignmentTarget(
      dragState.previewStart,
      dragState.sourceGroupDurationCoord,
      dragState.alignmentGuideCoords,
      pixelsPerCoord,
      alignmentGuideMagnetismPx,
    );
    return alignment.matchedGuideCoords.map((guideCoord) => (guideCoord - clipRenderStartCoord) * pixelsPerCoord);
  }

  // Purpose: Synchronize the visible vertical alignment guides with the current matched guide positions.
  // How: Reuse guide DOM nodes in order and trim any extra nodes when fewer guides are active.
  private renderAlignmentGuides(elements: Elements, xPositionsPx: readonly number[], gridHeightPx: number): void {
    while (this.#guideElements.length > xPositionsPx.length) {
      this.#guideElements.pop()?.remove();
    }

    for (let index = 0; index < xPositionsPx.length; index += 1) {
      let guideElement = this.#guideElements[index];
      if (!guideElement) {
        guideElement = document.createElement("div");
        guideElement.className = "drag-alignment-guide";
        this.#guideElements.push(guideElement);
        elements.dragOverlayLayer.appendChild(guideElement);
      }
      guideElement.style.left = `${xPositionsPx[index]!.toFixed(4)}px`;
      guideElement.style.height = `${gridHeightPx.toFixed(4)}px`;
    }
  }
}
