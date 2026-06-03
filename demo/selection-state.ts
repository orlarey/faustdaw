/**************************** selection-state.ts ******************************
 *
 * Purpose: Clip selection as demo-level view state. Expose the operations that
 *          read and mutate the selection (current, set, clear, toggle, ordered
 *          list) plus the internal mirror that keeps `demoState.selection.ids`
 *          and `demoState.selection.primaryId` coherent with a `Selection` value.
 * How: The Selection domain type lives in /src/domain/selection/selection.ts.
 *      This file is the bridge between that immutable domain value and the
 *      mutable demo view state. Every mutation sets `clipRenderStable.dirty`
 *      when the selection content actually changes.
 *
 ******************************************************************************/
import { Selection } from "../src/domain/selection/selection.js";
import type { Project } from "../src/domain/project.js";
import { demoState } from "./state.js";

/**
 * Purpose: Demo-level view state for the current clip selection.
 * How: Hold the primary (anchor) clip id and the full set of selected clip
 *      ids. Operations in this module keep the pair coherent with a
 *      `Selection` domain value.
 */
export type SelectionState = {
  primaryId: string | null;
  ids: Set<string>;
};

export function createInitialSelectionState(): SelectionState {
  return {
    primaryId: null,
    ids: new Set(),
  };
}

/**
 * Purpose: Materialize a fresh Selection bound to the current project snapshot.
 * How: Feed the raw view-state set of selected clip ids through `Selection.of`
 *      so orphan ids are filtered and the visual order is normalized. Always
 *      up-to-date because it reads `demoState.project` at call time — no
 *      cached Selection instance is ever kept around to become stale.
 */
export function getCurrentSelection(): Selection {
  return Selection.of(demoState.project, demoState.selection.ids);
}

/**
 * Purpose: Mirror a Selection into the demo view-state consumed by rendering.
 * How: Replace the raw id set, update the primary anchor id, and flag the
 *      clip render structure dirty when the content actually changed. Returns
 *      whether the view-state differs from before so callers can skip
 *      unnecessary render passes.
 */
export function writeSelectionToDemoState(selection: Selection): boolean {
  const nextIds = selection.clipIds;
  const nextPrimary = selection.primaryClipId;
  const selectionChanged =
    demoState.selection.primaryId !== nextPrimary
    || demoState.selection.ids.size !== nextIds.length
    || nextIds.some((clipId) => !demoState.selection.ids.has(clipId));
  demoState.selection.ids = new Set(nextIds);
  demoState.selection.primaryId = nextPrimary;
  if (selectionChanged) {
    demoState.clipRenderStable.dirty = true;
  }
  return selectionChanged;
}

/**
 * Purpose: Replace the current clip selection with a deterministic ordered set of clip ids.
 * How: Build a fresh Selection through `Selection.of` and mirror it into the view-state.
 */
export function setSelectedClipIds(clipIds: readonly string[]): boolean {
  return writeSelectionToDemoState(Selection.of(demoState.project, clipIds));
}

/**
 * Purpose: Clear the current clip selection state.
 * How: Mirror an empty Selection bound to the current project into the view-state.
 */
export function clearSelectedClips(): boolean {
  return writeSelectionToDemoState(Selection.empty(demoState.project));
}

/**
 * Purpose: Toggle one clip inside the current multi-selection from a modifier click.
 * How: Delegate to `Selection.toggle` so normalization and visual ordering stay centralized.
 */
export function toggleSelectedClipId(current: Project, clipId: string): void {
  writeSelectionToDemoState(Selection.of(current, demoState.selection.ids).toggle(clipId));
}

/**
 * Purpose: Return every currently selected clip id in a stable visual order.
 * How: Delegate the ordering to `Selection.of`; preserve the legacy fallback to the
 *      primary anchor id when the raw set is empty so transitional callers keep working.
 */
export function getOrderedSelectedClipIds(current: Project): string[] {
  const selection = Selection.of(current, demoState.selection.ids);
  if (selection.isEmpty) {
    return demoState.selection.primaryId ? [demoState.selection.primaryId] : [];
  }
  return [...selection.clipIds];
}
