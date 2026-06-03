/******************************** view/daw-session-view-state.ts ********************************
 *
 * Purpose: Represent the mutable global DAW view state independently from session persistence details.
 * How: Capture zoom, visible window, cursor, and last-play markers from demo state into one immutable ADT,
 *      then reapply those runtime coordinates back to demo state when a session or view restore occurs.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { TimeCoord, Timebase } from "../../src/domain/timebase.js";
import { demoState } from "../state.js";

export type DAWSessionViewStateSnapshot = {
  exactTimelineZoomLevelIndex: number;
  timelineViewStartCoord: TimeCoord;
  timelineViewDurationCoord: TimeCoord;
  cursorCoord: TimeCoord;
  lastPlayStartCoord: TimeCoord | null;
};

// Purpose: Represent the runtime global view state independently from any persisted session format.
// How: Store the current zoom, visible time window, cursor position, and last-play marker as one immutable snapshot.
export class DAWSessionViewState {
  readonly exactTimelineZoomLevelIndex: number;
  readonly timelineViewStartCoord: TimeCoord;
  readonly timelineViewDurationCoord: TimeCoord;
  readonly cursorCoord: TimeCoord;
  readonly lastPlayStartCoord: TimeCoord | null;

  private constructor(input: DAWSessionViewStateSnapshot) {
    this.exactTimelineZoomLevelIndex = input.exactTimelineZoomLevelIndex;
    this.timelineViewStartCoord = input.timelineViewStartCoord;
    this.timelineViewDurationCoord = input.timelineViewDurationCoord;
    this.cursorCoord = input.cursorCoord;
    this.lastPlayStartCoord = input.lastPlayStartCoord;
  }

  // Purpose: Build one immutable DAW view state from explicit runtime coordinates.
  // How: Store the provided snapshot as-is behind the ADT boundary.
  static fromSnapshot(input: DAWSessionViewStateSnapshot): DAWSessionViewState {
    return new DAWSessionViewState(input);
  }

  // Purpose: Capture the current global view state from demo state and the active project.
  // How: Read the current zoom, visible window, cursor, and last-play marker from the viewport.
  static capture(current: Project): DAWSessionViewState {
    const vp = demoState.viewport;
    return new DAWSessionViewState({
      exactTimelineZoomLevelIndex: vp.timeScale.zoomLevelIndex,
      timelineViewStartCoord: vp.viewStartCoord as TimeCoord,
      timelineViewDurationCoord: vp.viewDurationCoord as TimeCoord,
      cursorCoord: current.timeline.cursor,
      lastPlayStartCoord: demoState.lastPlayStartCoord,
    });
  }

  // Purpose: Reapply one restored runtime view state to demo state after project or session changes.
  // How: Write the restored coordinates into the viewport and update the last-play marker.
  applyToDemoState(timebase: Timebase): void {
    demoState.lastPlayStartCoord = this.lastPlayStartCoord;
    const vp = demoState.viewport;
    vp.viewStartCoord = this.timelineViewStartCoord;
    vp.viewDurationCoord = this.timelineViewDurationCoord;
    vp.timeScale.setZoomLevel(this.exactTimelineZoomLevelIndex);
    vp.timeScale.setTimebase(timebase);
  }
}
