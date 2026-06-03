/****************************** track/track-render.ts ******************************
 *
 * Purpose: Orchestrate the visual rendering state owned by tracks.
 * How: Walk the track hierarchy to build visible clip models, then update the fixed
 *      track-strip column from the current selection and playback state.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import { findActiveClipInTrack } from "../../src/domain/clip.js";
import type { Elements } from "../bind-elements.js";
import { getIndexedClip } from "../project-index.js";
import { demoState } from "../state.js";
import type { ClipDragRenderContext } from "../timeline/timeline-drag-overlay.js";
import { estimateTrackActivityLevel } from "./track-activity.js";
import { getTrackEffectiveGain } from "./track-runtime.js";

export type TrackViewState = {
  dragContext: ClipDragRenderContext;
  selectedClipId: string | null;
};

// Purpose: Update the per-track visual state in the fixed left column.
// How: Highlight the strip that contains the selected clip and mark tracks whose clip is active at the cursor.
export function renderTrackViews(elements: Elements, project: Project, state: TrackViewState): void {
  const dragState = state.dragContext.dragState;
  const selectedTrackId =
    dragState && state.selectedClipId === dragState.clipId
      ? dragState.previewTrackId
      : state.selectedClipId
        ? getIndexedClip(project, state.selectedClipId)?.trackId ?? null
        : null;

  for (const [index, track] of project.timeline.tracks.entries()) {
    const strip = elements.trackStrips[index];
    const selectedOnTrack = selectedTrackId === track.id;
    strip?.classList.toggle("active", Boolean(selectedOnTrack));
    if (!strip) {
      continue;
    }
    const activeClip = project.timeline.transport === "Playing"
      ? findActiveClipInTrack(project, track.clips, project.timeline.cursor)
      : null;
    const hasActiveClip = activeClip !== null
      && (!demoState.playSelection.clipFilter || demoState.playSelection.clipFilter.has(activeClip.id))
      && getTrackEffectiveGain(track.id) > 0;
    const activityLevel = hasActiveClip ? estimateTrackActivityLevel(project, track.id) : 0;
    strip.classList.toggle("playing", hasActiveClip);
    strip.style.setProperty("--track-activity-level", activityLevel.toFixed(3));
  }
}
