/********************************* play.ts ************************************
 *
 * Purpose: Start a looped playback restricted to the currently-selected clips
 *          via the Play Selection mechanism (clipFilter + loopRange). Pure UI
 *          action — does not modify the project, so no history entry.
 * How: Stop any active playback, install the selection as a play filter,
 *      seek to the selection start, ensure the cursor is visible, then start
 *      the audio engine and transport loop. Errors surface via a render-log
 *      entry without a footer banner (the preview panel takes over the
 *      status line).
 *
 ******************************************************************************/
import type { Selection } from "../../src/domain/selection/selection.js";
import { play, seek, stop } from "../../src/domain/transport.js";
import { demoState } from "../state.js";
import { render, pushRenderLog, invalidateWaveformSlidingBuffers } from "../daw-render/daw-render-runtime.js";
import { normalizeErrorMessage } from "../error-message.js";
import type { MenuEnv, MenuOperation } from "../menu-operation.js";

class PlaySelectionOperation implements MenuOperation {
  readonly name = "Play Selection";
  readonly shortcut = "p";
  readonly needsWriteAccess = false;

  applies(sel: Selection): boolean {
    return !sel.isEmpty;
  }

  async execute(sel: Selection, env: MenuEnv) {
    const range = sel.timeRange();
    if (!range) return "cancelled";

    if (demoState.project.timeline.transport === "Playing") {
      demoState.transportLoop.stop(env.elements);
      demoState.project = stop(demoState.project);
    }

    demoState.playSelection.clipFilter = new Set(sel.clipIds);
    demoState.playSelection.loopRange = { startCoord: range.startCoord, endCoord: range.endCoord };
    demoState.clipRenderStable.dirty = true;
    invalidateWaveformSlidingBuffers();
    demoState.project = seek(demoState.project, range.startCoord);
    demoState.viewport.ensureCursorVisible(demoState.project.timeline.cursor);

    try {
      await demoState.audio.startSilent();
      demoState.lastPlayStartCoord = demoState.project.timeline.cursor;
      demoState.project = play(demoState.project);
      demoState.playbackSession.start();
      pushRenderLog("Play Selection");
      render(env.elements);
      demoState.transportLoop.startIfNeeded(env.elements);
    } catch (error) {
      demoState.transportLoop.abortFailedPlay(env.elements);
      pushRenderLog(`ERROR: ${normalizeErrorMessage(error)}`);
      render(env.elements);
    }

    return sel;
  }
}

export const playSelectionOperation = new PlaySelectionOperation();
