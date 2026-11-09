/******************************* preview-playback.ts ***************************
 *
 * Purpose: Start/stop a one-shot preview playback that loops over a single
 *          clip, reusing the Play Selection mechanism (clip filter + loop
 *          range). Used by the Faust Transform panel to audition a clip
 *          through the current Transform Chain.
 * How: `startPreviewClip` builds a Selection of the clip, installs it as a
 *      Play Selection filter, seeks to the clip start, and starts playback.
 *      `stopPreview` clears the filter and the loop range, then stops
 *      playback if it was running. Both require the `Elements` bundle
 *      because the transport loop reads from it during scheduling.
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import { play, seek, stop } from "../src/domain/transport.js";
import { Selection } from "../src/domain/selection/selection.js";
import { demoState } from "./state.js";
import { render } from "./daw-render/daw-render-runtime.js";
import { invalidateWaveformSlidingBuffers } from "./daw-render/daw-render-runtime.js";
import { normalizeErrorMessage } from "./error-message.js";

/**
 * Purpose: Start looped playback of a single clip through the current FX chain.
 * How: Resolve the clip's time range, configure the Play Selection filter
 *      and loop range, seek to the start, then start silent audio and the
 *      transport loop. Errors surface in the footer status.
 */
export async function startPreviewClip(clipId: string, elements: Elements): Promise<void> {
  const clip = demoState.project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clip) return;
  const selection = Selection.of(demoState.project, [clipId]);
  const range = selection.timeRange();
  if (!range) return;

  if (demoState.project.timeline.transport === "Playing") {
    demoState.transportLoop.stop(elements);
    demoState.project = stop(demoState.project);
  }
  demoState.playSelection.clipFilter = new Set([clipId]);
  demoState.playSelection.loopRange = { startCoord: range.startCoord, endCoord: range.endCoord };
  demoState.clipRenderStable.dirty = true;
  invalidateWaveformSlidingBuffers();
  demoState.project = seek(demoState.project, range.startCoord);
  try {
    await demoState.audio.startSilent();
    demoState.lastPlayStartCoord = demoState.project.timeline.cursor;
    demoState.project = play(demoState.project);
    demoState.playbackSession.start();
    render(elements);
    demoState.transportLoop.startIfNeeded(elements);
  } catch (error) {
    demoState.transportLoop.abortFailedPlay(elements);
    demoState.footer.setStatus(normalizeErrorMessage(error), "error");
  }
}

/**
 * Purpose: Stop the preview loop and clear Play Selection state.
 * How: Stop the transport loop, release the clip filter and loop range,
 *      and stop the transport if it was running.
 */
export function stopPreview(elements: Elements): void {
  demoState.transportLoop.stop(elements);
  demoState.playSelection.clipFilter = null;
  demoState.playSelection.loopRange = null;
  demoState.clipRenderStable.dirty = true;
  invalidateWaveformSlidingBuffers();
  if (demoState.project.timeline.transport === "Playing") {
    demoState.project = stop(demoState.project);
  }
  render(elements);
}
