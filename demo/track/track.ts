/******************************** track/track.ts ********************************
 *
 * Purpose: Represent one immutable track entity resolved from one project snapshot.
 * How: Capture the resolved domain track together with its owning project snapshot and expose only track-scoped queries.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { Track as DomainTrack } from "../../src/domain/track.js";
import type { TrackId } from "../../src/domain/track-id.js";
import { findActiveClipInTrack } from "../../src/domain/clip.js";
import { TimelineClip } from "../clip/clip.js";
import type { ClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import { isClipHiddenByDragPreview } from "../clip/clip-drag-preview.js";
import { getVisibleClipRangeCached } from "../visible-range-cache.js";
import type { DragState } from "../gesture/gesture-state.js";
import { TimelineProjection } from "../timeline/timeline-projection.js";
import { estimateTrackActivityLevel } from "./track-activity.js";
import { trackIdToIndex } from "./track-order.js";
import type { TrackPixmap } from "./track-pixmap.js";

// Purpose: Represent one track entity resolved inside one immutable project snapshot.
// How: Keep only the immutable project snapshot and the resolved track value in private fields.
// @invariant: the stored track id exists in the stored project snapshot.
export class Track {
  readonly #project: Project;
  readonly #track: DomainTrack;

  // Purpose: Construct one resolved track entity.
  // How: Capture the immutable project snapshot together with the resolved track value only.
  private constructor(project: Project, track: DomainTrack) {
    this.#project = project;
    this.#track = track;
  }

  // Purpose: Resolve one track id into a track entity for the current project snapshot.
  // How: Find the track in the project timeline and return null when the track id is absent.
  static fromProject(project: Project, trackId: TrackId): Track | null {
    const track = project.timeline.tracks.find((candidate) => candidate.id === trackId) ?? null;
    return track ? new Track(project, track) : null;
  }

  // Purpose: Wrap one track value already discovered by a containing ADT into the track API.
  // How: Reuse the provided track reference directly without attaching any extra derived state.
  static fromTrack(project: Project, track: DomainTrack): Track {
    return new Track(project, track);
  }

  // Purpose: Return the canonical lane index associated with one track id.
  // How: Resolve the index through the internal fixed track-order mapping and fall back to zero when absent.
  static laneIndex(trackId: TrackId): number {
    return trackIdToIndex.get(trackId) ?? 0;
  }

  // Purpose: Estimate the current visual activity level of one track.
  // How: Delegate to the internal track-activity ADT while keeping the public track API centralized here.
  static activityLevel(project: Project, trackId: TrackId): number {
    return estimateTrackActivityLevel(project, trackId);
  }

  // Purpose: Determine whether one track currently contains an active clip at the transport cursor.
  // How: Resolve the track from the project snapshot and delegate the temporal lookup to the domain helper.
  static hasActiveClip(project: Project, trackId: TrackId): boolean {
    const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
    return track ? findActiveClipInTrack(project, track.clips, project.timeline.cursor) !== null : false;
  }

  // Purpose: Expose the stable identifier of this track entity.
  // How: Return the captured track id without leaking any other internal representation.
  id(): TrackId {
    return this.#track.id;
  }

  // Purpose: Expose the underlying immutable track value when a lower-level ADT still needs it.
  // How: Return the stored track reference exactly as captured from the project snapshot.
  track(): DomainTrack {
    return this.#track;
  }

  // Purpose: Expose the clip entities directly contained in this track.
  // How: Wrap each immutable clip value in one TimelineClip so callers can follow the containment hierarchy.
  clips(): readonly TimelineClip[] {
    return this.#track.clips.map((clip) => TimelineClip.fromClip(this.#project, clip));
  }

  // Purpose: Return the canonical lane index of this track.
  // How: Delegate to the shared static lane-index lookup using this track id.
  laneIndex(): number {
    return Track.laneIndex(this.#track.id);
  }

  // Purpose: Estimate the current visual activity level of this track.
  // How: Delegate to the shared static activity estimator using this track id and stored project snapshot.
  activityLevel(): number {
    return Track.activityLevel(this.#project, this.#track.id);
  }

  // Purpose: Determine whether this track currently contains an active clip at the transport cursor.
  // How: Delegate to the shared static active-clip lookup using this track id and stored project snapshot.
  hasActiveClip(): boolean {
    return Track.hasActiveClip(this.#project, this.#track.id);
  }

  // Purpose: Render the visible clips contained by this track directly into one canvas-backed pixmap.
  // How: Compute the visible clip window, derive one track-local projection, then let each contained clip rasterize itself.
  render(
    pixmap: TrackPixmap,
    input: {
      projection: TimelineProjection;
      dragState: DragState | null;
      presentationInputs: ClipPresentationInputs;
      renderStartCoord?: number;
      renderEndCoord?: number;
    },
  ): void {
    const renderStartCoord = input.renderStartCoord ?? input.projection.canvasStartCoord;
    const renderEndCoord = input.renderEndCoord ?? input.projection.canvasEndCoord;
    const range = getVisibleClipRangeCached(this.#project, this.#track, renderStartCoord, renderEndCoord);
    const localProjection = TimelineProjection.fromCanvas({
      canvasStartCoord: input.projection.canvasStartCoord,
      canvasEndCoord: input.projection.canvasEndCoord,
      canvasHeightPx: input.projection.laneHeightPx,
      pixelsPerCoord: input.projection.pixelsPerCoord,
      trackCount: 1,
    });
    const clipPixmap = pixmap.withTrackOffset(this.laneIndex() * input.projection.laneHeightPx);

    for (let index = range.first; index <= range.last; index += 1) {
      const clip = this.#track.clips[index]!;
      if (isClipHiddenByDragPreview(input.dragState, clip.id)) {
        continue;
      }
      TimelineClip.fromClip(this.#project, clip).render(clipPixmap, {
        projection: localProjection,
        renderStartCoord,
        presentationInputs: input.presentationInputs,
      });
    }
  }

  // Purpose: Resolve which visible clip body, if any, contains one point inside this track lane.
  // How: Scan only the visible clips intersecting the current projection and delegate the point test to each contained clip entity.
  hitTestClip(input: {
    projection: TimelineProjection;
    timeCoord: number;
    localYPx: number;
    dragState: DragState | null;
    presentationInputs: ClipPresentationInputs;
    renderStartCoord?: number;
    renderEndCoord?: number;
  }): TimelineClip | null {
    const renderStartCoord = input.renderStartCoord ?? input.projection.canvasStartCoord;
    const renderEndCoord = input.renderEndCoord ?? input.projection.canvasEndCoord;
    const range = getVisibleClipRangeCached(this.#project, this.#track, renderStartCoord, renderEndCoord);
    const localProjection = TimelineProjection.fromCanvas({
      canvasStartCoord: input.projection.canvasStartCoord,
      canvasEndCoord: input.projection.canvasEndCoord,
      canvasHeightPx: input.projection.laneHeightPx,
      pixelsPerCoord: input.projection.pixelsPerCoord,
      trackCount: 1,
    });

    for (let index = range.first; index <= range.last; index += 1) {
      const clip = this.#track.clips[index]!;
      if (isClipHiddenByDragPreview(input.dragState, clip.id)) {
        continue;
      }
      const timelineClip = TimelineClip.fromClip(this.#project, clip);
      if (timelineClip.hitTestLocalPoint({
        projection: localProjection,
        renderStartCoord,
        presentationInputs: input.presentationInputs,
        timeCoord: input.timeCoord,
        localYPx: input.localYPx,
      })) {
        return timelineClip;
      }
    }

    return null;
  }
}
