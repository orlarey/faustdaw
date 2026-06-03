/******************************** timeline/timeline.ts ********************************
 *
 * Purpose: Represent one timeline content entity composed of ordered track entities.
 * How: Capture one immutable project snapshot, expose its tracks, and render the visible
 *      slice by delegating to those contained tracks through one render surface.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { DragState } from "../gesture/gesture-state.js";
import { TimelineClip } from "../clip/clip.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import { getIndexedClip } from "../project-index.js";
import { Track } from "../track/track.js";
import { TrackCanvasPixmap, type TrackPixmap } from "../track/track-pixmap.js";
import { TimelineProjection } from "./timeline-projection.js";

// Purpose: Represent one immutable timeline entity owning the ordered track hierarchy of one project snapshot.
// How: Keep the track entities as fields and expose only content-oriented operations such as tracks() and render(...).
export class Timeline {
  readonly #project: Project;
  readonly #tracks: readonly Track[];

  private constructor(project: Project) {
    this.#project = project;
    this.#tracks = project.timeline.tracks.map((track) => Track.fromTrack(project, track));
  }

  // Purpose: Resolve one immutable project snapshot into one timeline entity that owns ordered track entities.
  // How: Wrap each timeline track exactly once so callers can render through the containment hierarchy rather than through global state.
  static fromProject(project: Project): Timeline {
    return new Timeline(project);
  }

  // Purpose: Expose the ordered tracks directly contained in this timeline.
  // How: Return the immutable track entities captured when the timeline snapshot was constructed.
  tracks(): readonly Track[] {
    return this.#tracks;
  }

  // Purpose: Render the visible slice of this timeline directly into one canvas-backed pixmap.
  // How: Let each contained track rasterize itself into the shared pixmap using the provided projection.
  render(
    pixmap: TrackPixmap,
    projection: TimelineProjection,
    dragState: DragState | null,
    presentationInputs: ClipPresentationInputs,
  ): void {
    for (const track of this.#tracks) {
      track.render(pixmap, {
        projection,
        dragState,
        presentationInputs,
        renderStartCoord: projection.canvasStartCoord,
        renderEndCoord: projection.canvasEndCoord,
      });
    }
  }

  // Purpose: Render the detached drag-preview raster through the timeline entity itself.
  // How: Resolve the dragged clips from the captured project snapshot, derive one one-lane local projection, then let each contained clip render at its source placement relative to the dragged group.
  renderDragOverlay(
    pixmap: TrackPixmap,
    projection: TimelineProjection,
    dragState: DragState,
    presentationInputs: ClipPresentationInputs,
  ): void {
    const localProjection = TimelineProjection.fromCanvas({
      canvasStartCoord: dragState.dragRasterStartCoord,
      canvasEndCoord: dragState.dragRasterEndCoord,
      canvasHeightPx: projection.laneHeightPx,
      pixelsPerCoord: projection.pixelsPerCoord,
      trackCount: 1,
    });

    for (const clipId of dragState.clipIds) {
      const clip = getIndexedClip(this.#project, clipId)?.clip ?? null;
      const sourcePlacement = dragState.sourcePlacements.get(clipId) ?? null;
      if (!clip || !sourcePlacement) {
        continue;
      }
      const relativeTrackIndex = Math.max(
        0,
        Track.laneIndex(sourcePlacement.trackId) - dragState.sourceGroupMinTrackIndex,
      );
      TimelineClip.fromClip(this.#project, clip).render(
        pixmap.withTrackOffset(relativeTrackIndex * projection.laneHeightPx),
        {
          projection: localProjection,
          renderStartCoord: dragState.dragRasterStartCoord,
          presentationInputs,
          effectiveStart: sourcePlacement.start,
        },
      );
    }
  }

  // Purpose: Resolve which visible clip body, if any, contains one point inside the current timeline projection.
  // How: Resolve the containing track from the current hierarchy, convert the point to one track-local Y coordinate, then delegate the hit test to that track.
  hitTestClip(input: {
    projection: TimelineProjection;
    timeCoord: number;
    trackId: string;
    localTrackYPx: number;
    dragState: DragState | null;
    presentationInputs: ClipPresentationInputs;
  }): TimelineClip | null {
    const track = this.#tracks.find((candidate) => candidate.id() === input.trackId) ?? null;
    if (!track) {
      return null;
    }
    return track.hitTestClip({
      projection: input.projection,
      timeCoord: input.timeCoord,
      localYPx: input.localTrackYPx,
      dragState: input.dragState,
      presentationInputs: input.presentationInputs,
      renderStartCoord: input.projection.canvasStartCoord,
      renderEndCoord: input.projection.canvasEndCoord,
    });
  }
}

// Purpose: Represent the canvas-backed pixmap consumed by the hierarchical timeline render path.
// How: Reuse the existing track-level pixmap because Timeline rendering ultimately delegates to contained tracks.
export class TimelineCanvasPixmap extends TrackCanvasPixmap {}
