/******************************* onset-annotations.ts *************************
 *
 * Purpose: Mutate the clip-onset annotation map and keep the onset editor
 *          state in sync when any of the affected clips are currently open.
 * How: `clearClipOnsetAnnotationsForClipIds` deletes entries from
 *      `demoState.clipOnsetAnnotations` and, if the open onset editor is
 *      pointing at one of the cleared clips, closes it via a registerable
 *      hook that interactions.ts binds once at wire time. The hook holds
 *      the wireEvents-local machinery (timeout cancellation + DOM refresh)
 *      that this module cannot reach directly.
 *
 ******************************************************************************/
import { demoState } from "./state.js";

let closeEditorHook: (() => void) | null = null;

/**
 * Purpose: Register the teardown routine to run when the onset editor must
 *          close because its target clip is being removed.
 * How: Called once from `wireEvents`; the hook typically cancels the preview
 *      timer and hides the onset panel.
 */
export function registerOnsetEditorCloseHook(hook: () => void): void {
  closeEditorHook = hook;
}

/**
 * Purpose: Drop the onset annotations of the given clips and close the onset
 *          editor when it was pointing at one of them.
 * How: Delete each entry from the Map. If the open editor targets a cleared
 *      clip, null it out and invoke the registered close hook so the panel
 *      and preview timer are torn down.
 */
export function clearClipOnsetAnnotationsForClipIds(clipIds: readonly string[]): void {
  for (const clipId of clipIds) {
    demoState.clipOnsetAnnotations.delete(clipId);
  }
  if (
    demoState.clipOnsetEditorState
    && clipIds.includes(demoState.clipOnsetEditorState.clipId)
  ) {
    demoState.clipOnsetEditorState = null;
    closeEditorHook?.();
  }
}
