/**************************** faust-transform-state.ts ************************
 *
 * Purpose: In-flight state for the Faust Transform preview — which clip is
 *          being previewed, the live worklet nodes driving the preview, and
 *          the selected effect index inside the transform chain.
 * How: Plain data type. Operations live in faust-transform-panel.ts and
 *      interactions.ts.
 *
 ******************************************************************************/

export type FaustTransformPreviewState = {
  clipId: string;
  transformNodes: AudioWorkletNode[];
  selectedEffectIndex: number;
};
