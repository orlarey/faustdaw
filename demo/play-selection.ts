/****************************** play-selection.ts *****************************
 *
 * Purpose: Group the two fields that together describe "Play Selection" mode —
 *          playing only a specific subset of clips, optionally looping inside
 *          a time range. These two fields are always set/cleared as a pair
 *          (in startPreviewPlayback / stopPreviewPlayback) and read by the
 *          scheduler (to filter clips during plan build) and the transport
 *          loop (to loop the cursor).
 * How: Pure type. Operations that mutate the pair live in interactions.ts
 *      (preview-playback lifecycle); readers in playback-scheduler,
 *      transport-loop, track-render, track-activity, clip-presentation-inputs,
 *      timeline-scene.
 *
 ******************************************************************************/

/**
 * Purpose: Play-Selection mode state. Both fields are null when the mode is
 *          off; both are set together when it turns on.
 */
export type PlaySelectionState = {
  /** When non-null, only clips whose id is in this set are scheduled. */
  clipFilter: ReadonlySet<string> | null;
  /** When non-null, the transport loops between startCoord and endCoord. */
  loopRange: { startCoord: number; endCoord: number } | null;
};

export function createInitialPlaySelectionState(): PlaySelectionState {
  return {
    clipFilter: null,
    loopRange: null,
  };
}
