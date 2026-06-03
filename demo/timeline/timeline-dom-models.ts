/*************************** timeline/timeline-dom-models.ts ***************************
 *
 * Purpose: Keep DOM-model collection for secondary DOM queries and tests outside the public content ADTs.
 * How: Walk the immutable project snapshot directly, reuse the visible-range cache, and project
 *      clip models through the same drag-preview rules as the raster hierarchy.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { Track as DomainTrack } from "../../src/domain/track.js";
import { TimelineClip, type ClipRenderModel } from "../clip/clip.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import { isClipHiddenByDragPreview } from "../clip/clip-drag-preview.js";
import type { DragState } from "../gesture/gesture-state.js";
import { Track } from "../track/track.js";
import { getVisibleClipRangeCached } from "../visible-range-cache.js";
import { TimelineProjection } from "./timeline-projection.js";

type ClipDomModelSurface = {
  renderClip(model: ClipRenderModel): void;
};

type TimelineDomModelSink = {
  withTrackOffset(topOffsetPx: number): ClipDomModelSurface;
};

class OffsetClipDomModelSurface implements ClipDomModelSurface {
  readonly #target: ClipDomModelSurface;
  readonly #topOffsetPx: number;

  constructor(target: ClipDomModelSurface, topOffsetPx: number) {
    this.#target = target;
    this.#topOffsetPx = topOffsetPx;
  }

  renderClip(model: ClipRenderModel): void {
    this.#target.renderClip({
      ...model,
      topPx: model.topPx + this.#topOffsetPx,
    });
  }
}

export class TimelineDomModelSurface implements TimelineDomModelSink, ClipDomModelSurface {
  readonly #models: ClipRenderModel[] = [];

  renderClip(model: ClipRenderModel): void {
    this.#models.push(model);
  }

  withTrackOffset(topOffsetPx: number): ClipDomModelSurface {
    return new OffsetClipDomModelSurface(this, topOffsetPx);
  }

  models(): readonly ClipRenderModel[] {
    return this.#models;
  }
}

function collectTrackClipDomModels(
  project: Project,
  track: DomainTrack,
  surface: ClipDomModelSurface,
  input: {
    dragState: DragState | null;
    projection: TimelineProjection;
    presentationInputs: ClipPresentationInputs;
    renderStartCoord: number;
    renderEndCoord: number;
  },
): void {
  const range = getVisibleClipRangeCached(project, track, input.renderStartCoord, input.renderEndCoord);

  for (let index = range.first; index <= range.last; index += 1) {
    const clip = track.clips[index]!;
    if (isClipHiddenByDragPreview(input.dragState, clip.id)) {
      continue;
    }
    surface.renderClip(TimelineClip.fromClip(project, clip).buildLocalRenderModel({
      projection: input.projection,
      renderStartCoord: input.renderStartCoord,
      presentationInputs: input.presentationInputs,
    }));
  }
}

export function collectTrackDomModels(
  project: Project,
  track: DomainTrack,
  surface: TimelineDomModelSink,
  input: {
    dragState: DragState | null;
    projection: TimelineProjection;
    presentationInputs: ClipPresentationInputs;
    renderStartCoord?: number;
    renderEndCoord?: number;
  },
): void {
  const renderStartCoord = input.renderStartCoord ?? input.projection.canvasStartCoord;
  const renderEndCoord = input.renderEndCoord ?? input.projection.canvasEndCoord;
  const localProjection = TimelineProjection.fromCanvas({
    canvasStartCoord: input.projection.canvasStartCoord,
    canvasEndCoord: input.projection.canvasEndCoord,
    canvasHeightPx: input.projection.laneHeightPx,
    pixelsPerCoord: input.projection.pixelsPerCoord,
    trackCount: 1,
  });
  collectTrackClipDomModels(
    project,
    track,
    surface.withTrackOffset(Track.laneIndex(track.id) * input.projection.laneHeightPx),
    {
      dragState: input.dragState,
      projection: localProjection,
      presentationInputs: input.presentationInputs,
      renderStartCoord,
      renderEndCoord,
    },
  );
}

export function collectTimelineDomModels(
  project: Project,
  surface: TimelineDomModelSink,
  projection: TimelineProjection,
  dragState: DragState | null,
  presentationInputs: ClipPresentationInputs,
): void {
  for (const track of project.timeline.tracks) {
    collectTrackDomModels(project, track, surface, {
      dragState,
      projection,
      presentationInputs,
      renderStartCoord: projection.canvasStartCoord,
      renderEndCoord: projection.canvasEndCoord,
    });
  }
}
