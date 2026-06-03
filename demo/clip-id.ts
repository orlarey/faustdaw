/********************************* clip-id.ts *********************************
 *
 * Purpose: Allocate a unique clip identifier against the current project.
 * How: Consume the shared ordinal counter (`demoState.nextClipOrdinal`)
 *      until the generated id is not already present in the project.
 *
 ******************************************************************************/
import { demoState } from "./state.js";

/**
 * Purpose: Allocate the next unique clip identifier for the demo.
 * How: Consume the shared ordinal counter until the generated id is not already present in the project.
 */
export function createNextClipId(): string {
  let clipId = `clip-${demoState.nextClipOrdinal++}`;
  while (demoState.project.timeline.tracks.some((track) => track.clips.some((clip) => clip.id === clipId))) {
    clipId = `clip-${demoState.nextClipOrdinal++}`;
  }
  return clipId;
}
