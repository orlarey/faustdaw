/******************************* clip/clip.ts ********************************
 *
 * Purpose: Represent the public clip API used by the demo as one entity plus its clip-level operations.
 * How: Capture one immutable clip value for instance-level behavior, and expose the rest of the clip subsystem
 *      through static methods so callers read one class to understand the available clip operations.
 *
 ******************************************************************************/
import type { Clip } from "../../src/domain/clip.js";
import type { ClipId } from "../../src/domain/identifiers.js";
import type { Project } from "../../src/domain/project.js";
import type { TrackId } from "../../src/domain/track-id.js";
import { clipEnd } from "../../src/domain/clip.js";
import {
  buildClipRenderModel as buildClipRenderModelInternal,
  buildLocalClipRenderModel as buildLocalClipRenderModelInternal,
  resolveClipRenderPresentation,
  type ClipRenderModel,
} from "./clip-render-model.js";
import type { ClipPresentationInputs } from "./clip-presentation-inputs.js";
import {
  drawRasterClipBlock,
  drawRasterClipBlocks as drawRasterClipBlocksInternal,
  drawRasterClipSelectionBorders as drawRasterClipSelectionBordersInternal,
} from "./clip-raster.js";
import { getIndexedClip } from "../project-index.js";
import type { TimelineProjection } from "../timeline/timeline-projection.js";

export type { ClipRenderModel } from "./clip-render-model.js";
export type ClipPixmap = {
  drawClip(model: ClipRenderModel): void;
  directCanvasContext?(): CanvasRenderingContext2D;
  topOffsetPx?(): number;
};

export class ClipCanvasPixmap implements ClipPixmap {
  readonly #context: CanvasRenderingContext2D;
  readonly #topOffsetPx: number;

  constructor(context: CanvasRenderingContext2D, topOffsetPx = 0) {
    this.#context = context;
    this.#topOffsetPx = topOffsetPx;
  }

  drawClip(model: ClipRenderModel): void {
    const translatedModel = this.#topOffsetPx === 0
      ? model
      : { ...model, topPx: model.topPx + this.#topOffsetPx };
    TimelineClip.drawRasterBlocks(this.#context, [translatedModel]);
  }

  directCanvasContext(): CanvasRenderingContext2D {
    return this.#context;
  }

  topOffsetPx(): number {
    return this.#topOffsetPx;
  }
}

// Purpose: Represent one clip entity detached from any specific containing track.
// How: Keep only the immutable project snapshot and clip record in private fields.
// @invariant: the stored clip id exists in the stored project snapshot.
export class TimelineClip {
  readonly #project: Project;
  readonly #clip: Clip;

  // Purpose: Construct one resolved timeline clip entity.
  // How: Capture the immutable project snapshot together with the resolved clip value only.
  private constructor(project: Project, clip: Clip) {
    this.#project = project;
    this.#clip = clip;
  }

  // Purpose: Resolve one clip id into a timeline clip entity for the current project snapshot.
  // How: Read the cached project index, keep only the clip value, and return null when the clip id is absent.
  static fromProject(project: Project, clipId: ClipId): TimelineClip | null {
    const clipRef = getIndexedClip(project, clipId);
    if (!clipRef) {
      return null;
    }
    return new TimelineClip(project, clipRef.clip);
  }

  // Purpose: Wrap one clip value already discovered by a containing ADT into the timeline clip API.
  // How: Reuse the provided clip reference directly without attaching any placement metadata.
  static fromClip(project: Project, clip: Clip): TimelineClip {
    return new TimelineClip(project, clip);
  }

  // Purpose: Expose the stable identifier of this timeline clip entity.
  // How: Return the captured clip id without leaking any other internal representation.
  id(): ClipId {
    return this.#clip.id;
  }

  // Purpose: Expose the underlying immutable clip value when a lower-level ADT still needs it.
  // How: Return the stored clip reference exactly as captured from the project snapshot.
  clip(): Clip {
    return this.#clip;
  }

  // Purpose: Build the render model for one clip at one explicit timeline placement.
  // How: Delegate to the internal render-model ADT without exposing that lower-level module to callers.
  static buildRenderModel(
    project: Project,
    clip: Project["timeline"]["tracks"][number]["clips"][number],
    effectiveStart: number,
    effectiveTrackId: TrackId,
    projection: TimelineProjection,
    renderStartCoord: number,
    presentationInputs: ClipPresentationInputs,
  ): ClipRenderModel {
    return buildClipRenderModelInternal(
      project,
      clip,
      effectiveStart,
      effectiveTrackId,
      projection,
      renderStartCoord,
      presentationInputs,
    );
  }

  // Purpose: Paint clip blocks onto one raster canvas.
  // How: Delegate to the internal clip-raster ADT while keeping raster entry points on the clip class.
  static drawRasterBlocks(context: CanvasRenderingContext2D, models: readonly ClipRenderModel[]): void {
    drawRasterClipBlocksInternal(context, models);
  }

  // Purpose: Paint clip selection borders onto one raster canvas.
  // How: Delegate to the internal clip-raster ADT with the same models already projected for clip rendering.
  static drawRasterSelectionBorders(context: CanvasRenderingContext2D, models: readonly ClipRenderModel[]): void {
    drawRasterClipSelectionBordersInternal(context, models);
  }

  // Purpose: Build the standard render model of this clip for one viewport configuration.
  // How: Delegate to the clip render-model ADT using the caller-provided placement supplied by the containing track workflow.
  buildRenderModel(input: {
    projection: TimelineProjection;
    renderStartCoord: number;
    effectiveTrackId: TrackId;
    presentationInputs: ClipPresentationInputs;
    effectiveStart?: number;
  }): ClipRenderModel {
    return TimelineClip.buildRenderModel(
      this.#project,
      this.#clip,
      input.effectiveStart ?? this.#clip.start,
      input.effectiveTrackId,
      input.projection,
      input.renderStartCoord,
      input.presentationInputs,
    );
  }

  // Purpose: Build the standard render model of this clip in one track-local projection.
  // How: Delegate to the clip render-model ADT without requiring any containing track identity.
  buildLocalRenderModel(input: {
    projection: TimelineProjection;
    renderStartCoord: number;
    presentationInputs: ClipPresentationInputs;
    effectiveStart?: number;
  }): ClipRenderModel {
    return buildLocalClipRenderModelInternal(
      this.#project,
      this.#clip,
      input.effectiveStart ?? this.#clip.start,
      input.projection,
      input.renderStartCoord,
      input.presentationInputs,
    );
  }

  // Purpose: Render this clip directly into one canvas-backed pixmap using one track-local projection.
  // How: Build the local render model from the captured clip content, then rasterize it immediately into the target pixmap.
  render(
    pixmap: ClipPixmap,
    input: {
      projection: TimelineProjection;
      renderStartCoord: number;
      presentationInputs: ClipPresentationInputs;
      effectiveStart?: number;
    },
  ): void {
    const context = pixmap.directCanvasContext?.() ?? null;
    if (!context) {
      pixmap.drawClip(this.buildLocalRenderModel(input));
      return;
    }

    const effectiveStart = input.effectiveStart ?? this.#clip.start;
    const clipDurationCoord = clipEnd(this.#project, this.#clip) - this.#clip.start;
    const widthPx = Math.max(clipDurationCoord * input.projection.pixelsPerCoord, 0);
    const heightPx = Math.max(input.projection.laneHeightPx - 16, 0);
    const topOffsetPx = pixmap.topOffsetPx?.() ?? 0;
    const presentation = resolveClipRenderPresentation(
      this.#project,
      this.#clip,
      effectiveStart,
      input.projection.pixelsPerSample(this.#project.timebase),
      input.presentationInputs,
    );
    drawRasterClipBlock(context, {
      leftPx: (effectiveStart - input.renderStartCoord) * input.projection.pixelsPerCoord,
      widthPx,
      topPx: Math.max((input.projection.laneHeightPx - heightPx) / 2, 0) + topOffsetPx,
      heightPx,
      titleText: presentation.titleText,
      metaText: presentation.metaText,
      isSelected: presentation.isSelected,
      isDimmed: presentation.isDimmed,
      isSessionRender: presentation.isSessionRender,
      isSessionRenderLinked: presentation.isSessionRenderLinked,
      isSessionRenderStale: presentation.isSessionRenderStale,
    });
  }

  // Purpose: Determine whether one point inside a track-local projection falls on this visible clip body.
  // How: Project the clip into the local lane, then compare the point against the rendered block bounds.
  hitTestLocalPoint(input: {
    projection: TimelineProjection;
    renderStartCoord: number;
    presentationInputs: ClipPresentationInputs;
    timeCoord: number;
    localYPx: number;
    effectiveStart?: number;
  }): boolean {
    const model = input.effectiveStart === undefined
      ? this.buildLocalRenderModel({
        projection: input.projection,
        renderStartCoord: input.renderStartCoord,
        presentationInputs: input.presentationInputs,
      })
      : this.buildLocalRenderModel({
        projection: input.projection,
        renderStartCoord: input.renderStartCoord,
        presentationInputs: input.presentationInputs,
        effectiveStart: input.effectiveStart,
      });
    const x = input.projection.coordToCanvasX(input.timeCoord);
    return (
      x >= model.leftPx
      && x < model.leftPx + model.widthPx
      && input.localYPx >= model.topPx
      && input.localYPx < model.topPx + model.heightPx
    );
  }

  // Purpose: Build the transient render model shown for one duplicated drag preview.
  // How: Reuse the normal render projection at the preview placement, then replace identity and drag flags.
  buildDuplicatePreviewModel(input: {
    previewClipId: string;
    previewStart: number;
    previewTrackId: TrackId;
    projection: TimelineProjection;
    renderStartCoord: number;
    presentationInputs: ClipPresentationInputs;
  }): ClipRenderModel {
    return {
      ...this.buildRenderModel({
        projection: input.projection,
        renderStartCoord: input.renderStartCoord,
        effectiveStart: input.previewStart,
        effectiveTrackId: input.previewTrackId,
        presentationInputs: input.presentationInputs,
      }),
      id: input.previewClipId,
      isDragging: true,
      isSelected: true,
    };
  }
}
