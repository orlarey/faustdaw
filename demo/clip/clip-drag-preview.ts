/**************************** clip-drag-preview.ts ****************************
 *
 * Purpose: Resolve how an active clip drag preview changes visible clip models.
 * How: Interpret the current drag state to suppress moved source clips and
 *      synthesize duplicate-preview models from the same projection pipeline.
 *
 ******************************************************************************/
import { TRACK_IDS } from "../../src/domain/track-id.js";
import type { Project } from "../../src/domain/project.js";
import type { DragState } from "../gesture/gesture-state.js";

// Purpose: Determine whether the current drag state produces a visible preview displacement.
// How: Compare the preview start and track against the source group origin used when the drag began.
export function hasEffectiveDragPreview(dragPreview: DragState): boolean {
  if (dragPreview.previewStart !== dragPreview.sourceGroupStart) {
    return true;
  }
  const sourceTrackId = TRACK_IDS[dragPreview.sourceGroupMinTrackIndex] ?? dragPreview.previewTrackId;
  return dragPreview.previewTrackId !== sourceTrackId;
}

// Purpose: Decide whether one source clip should be hidden behind the active drag preview.
// How: Require an effective non-duplicating drag whose preview placements include this clip id.
export function isClipHiddenByDragPreview(dragState: DragState | null, clipId: string): boolean {
  return (
    dragState !== null
    && hasEffectiveDragPreview(dragState)
    && !dragState.duplicateOnDrag
    && dragState.previewPlacements.has(clipId)
  );
}
