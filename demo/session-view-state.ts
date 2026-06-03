/************************ session-view-state.ts ************************
 *
 * Purpose: Persist the timeline navigation state that should survive session switches.
 * How: Capture the current zoom and time positions in seconds, then restore
 *      them against any session timebase with clamping at the workspace boundary.
 *
 ******************************************************************************/
import type { Project } from "../src/domain/project.js";
import type { Timebase } from "../src/domain/timebase.js";
import { TimeScale } from "./time-scale.js";
import { DEFAULT_TIMELINE_VIEW_DURATION } from "./timeline/render-constants.js";
import { DAWSessionViewState } from "./view/daw-session-view-state.js";
import { clampViewDuration, clampViewStart } from "./view/view-clamps.js";

// Purpose: Represent the persisted timeline navigation state associated with one session.
// How: Store zoom as a scale index and all temporal positions in seconds so the snapshot can be reapplied across timebases.
// @invariant: exactTimelineZoomLevelIndex is clamped to the available exact zoom levels and timelineViewDurationSeconds > 0.
export type SessionViewState = {
  exactTimelineZoomLevelIndex: number;
  timelineViewStartSeconds: number;
  timelineViewDurationSeconds: number;
  cursorSeconds: number;
  lastPlayStartSeconds: number | null;
};

// Purpose: Represent one session view snapshot converted back into runtime coordinates.
// How: Pair the clamped zoom index with start, duration, cursor, and last-play coordinates in the target timebase.
// @invariant: timelineViewDurationCoord > 0 and timelineViewStartCoord >= -timelineViewDurationCoord.
export type RestoredSessionViewState = DAWSessionViewState;

// Purpose: Check whether an unknown persisted value is a valid session view snapshot.
// How: Validate the numeric zoom and second fields while allowing a null last-play marker for legacy or untouched sessions.
export function isSessionViewState(value: unknown): value is SessionViewState {
  return typeof value === "object"
    && value !== null
    && typeof (value as { exactTimelineZoomLevelIndex?: unknown }).exactTimelineZoomLevelIndex === "number"
    && typeof (value as { timelineViewStartSeconds?: unknown }).timelineViewStartSeconds === "number"
    && typeof (value as { timelineViewDurationSeconds?: unknown }).timelineViewDurationSeconds === "number"
    && typeof (value as { cursorSeconds?: unknown }).cursorSeconds === "number"
    && (
      (value as { lastPlayStartSeconds?: unknown }).lastPlayStartSeconds === null
      || typeof (value as { lastPlayStartSeconds?: unknown }).lastPlayStartSeconds === "number"
    );
}

// Purpose: Snapshot the current timeline navigation state of the active session.
// How: Read zoom from demo state and convert the visible window plus cursor markers from coordinates into seconds.
export function captureSessionViewState(current: Project): SessionViewState {
  return serializeSessionViewState(DAWSessionViewState.capture(current), current.timebase);
}

// Purpose: Compare two persisted session view snapshots for workspace dirty checks.
// How: Return true only when every persisted zoom and second field matches exactly.
export function areSessionViewStatesEqual(
  left: SessionViewState | null,
  right: SessionViewState | null,
): boolean {
  return left?.exactTimelineZoomLevelIndex === right?.exactTimelineZoomLevelIndex
    && left?.timelineViewStartSeconds === right?.timelineViewStartSeconds
    && left?.timelineViewDurationSeconds === right?.timelineViewDurationSeconds
    && left?.cursorSeconds === right?.cursorSeconds
    && left?.lastPlayStartSeconds === right?.lastPlayStartSeconds;
}

// Purpose: Restore one persisted session view snapshot against a target timebase.
// How: Convert persisted seconds back into coordinates, clamp zoom and timeline bounds, and fall back to the default workspace view when absent.
export function restoreSessionViewState(
  sessionViewState: SessionViewState | null,
  timebase: Timebase,
  fallbackZoomLevelIndex: number,
): RestoredSessionViewState {
  const exactTimelineZoomLevelIndex = TimeScale.clampZoomLevel(
    sessionViewState?.exactTimelineZoomLevelIndex ?? fallbackZoomLevelIndex,
  );
  const timelineViewDurationCoord = clampViewDuration(
    sessionViewState === null
      ? timebase.toTimeCoord(DEFAULT_TIMELINE_VIEW_DURATION)
      : timebase.toTimeCoord(sessionViewState.timelineViewDurationSeconds),
    timebase,
  );
  const timelineViewStartCoord = clampViewStart(
    sessionViewState === null
      ? 0
      : timebase.toTimeCoord(sessionViewState.timelineViewStartSeconds),
    timelineViewDurationCoord,
  );
  const cursorCoord = Math.max(
    0,
    sessionViewState === null
      ? 0
      : timebase.toTimeCoord(sessionViewState.cursorSeconds),
  );
  const lastPlayStartCoord = sessionViewState?.lastPlayStartSeconds === null || sessionViewState === null
    ? null
    : Math.max(0, timebase.toTimeCoord(sessionViewState.lastPlayStartSeconds));

  return DAWSessionViewState.fromSnapshot({
    exactTimelineZoomLevelIndex,
    timelineViewStartCoord,
    timelineViewDurationCoord,
    cursorCoord,
    lastPlayStartCoord,
  });
}

// Purpose: Convert one runtime DAW view state into the persisted session snapshot format.
// How: Clamp zoom at the persistence boundary and convert runtime coordinates into seconds against the provided timebase.
function serializeSessionViewState(viewState: DAWSessionViewState, timebase: Timebase): SessionViewState {
  return {
    exactTimelineZoomLevelIndex: TimeScale.clampZoomLevel(viewState.exactTimelineZoomLevelIndex),
    timelineViewStartSeconds: timebase.fromTimeCoord(viewState.timelineViewStartCoord),
    timelineViewDurationSeconds: timebase.fromTimeCoord(viewState.timelineViewDurationCoord),
    cursorSeconds: timebase.fromTimeCoord(viewState.cursorCoord),
    lastPlayStartSeconds: viewState.lastPlayStartCoord === null
      ? null
      : timebase.fromTimeCoord(viewState.lastPlayStartCoord),
  };
}
