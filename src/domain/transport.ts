/**
 * Purpose: Transport concept — the transport state machine (Stopped /
 *          Playing), the playhead and tick operations, and the output
 *          observation derived from cursor + transport state.
 * How: Expose the TransportState union together with pure functions that
 *      move, start, stop, tick, and observe the timeline. Delegate
 *      per-clip activity questions to the Clip concept.
 */
import { findActiveClipInTrack, getClipSourceStartSample } from "./clip.js";
import type { Output, SignalOutput } from "./output.js";
import type { Project } from "./project.js";
import { assertValidProject } from "./project.js";
import type { TimeCoord } from "./timebase.js";

/**
 * Purpose: Define the transport modes that govern whether timeline time advances.
 * How: Represent the transport as a small closed string union so timeline and project state stay easy to inspect.
 */
export type TransportState = "Stopped" | "Playing";

/**
 * Purpose: Observable silence value returned by `observeOutput` when the
 *          transport is stopped or no clip is active.
 * How: A singleton `Output` of kind `Silence`.
 */
export const SILENCE: Output = { type: "Silence" };

/**
 * Purpose: Move the playhead to an explicit time on the timeline.
 * How: Validate non-negativity and return a project copy with the updated cursor only.
 */
export function seek(project: Project, time: TimeCoord): Project {
  if (!Number.isInteger(time) || time < 0) {
    throw new Error("Precondition violation: seek time must be an integer >= 0");
  }

  const next: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      cursor: time,
    },
  };
  assertValidProject(next);
  return next;
}

/**
 * Purpose: Start transport playback without changing project content.
 * How: Return a project copy whose transport state is set to Playing.
 */
export function play(project: Project): Project {
  const next: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      transport: "Playing",
    },
  };
  assertValidProject(next);
  return next;
}

/**
 * Purpose: Stop transport playback and force the observable output back to silence.
 * How: Return a project copy whose transport state is set to Stopped.
 */
export function stop(project: Project): Project {
  const next: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      transport: "Stopped",
    },
  };
  assertValidProject(next);
  return next;
}

/**
 * Purpose: Advance the playhead according to the minimal temporal evolution rule from the specification.
 * How: Leave the project unchanged when stopped, otherwise add the positive delta to the current cursor.
 */
export function tick(project: Project, deltaTime: TimeCoord): Project {
  if (!Number.isInteger(deltaTime) || deltaTime < 0) {
    throw new Error("Precondition violation: tick delta must be an integer >= 0");
  }

  if (project.timeline.transport === "Stopped") {
    return project;
  }

  const next: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      cursor: project.timeline.cursor + deltaTime,
    },
  };
  assertValidProject(next);
  return next;
}

/**
 * Purpose: Preserve the legacy notion of activity as “at least one clip is active”.
 * How: Return true when any clip across the fixed track set is active at the given time.
 */
export function isActive(project: Project, time: TimeCoord): boolean {
  return project.timeline.tracks.some((track) => findActiveClipInTrack(project, track.clips, time) !== null);
}

/**
 * Purpose: Observe the current audio output produced by the transport and cursor state.
 * How: Return silence when transport is stopped or no clip is active; otherwise collect one signal descriptor per active clip into a mix.
 */
export function observeOutput(project: Project): Output {
  if (project.timeline.transport === "Stopped") {
    return SILENCE;
  }

  const signals: SignalOutput[] = [];
  for (const track of project.timeline.tracks) {
    const clip = findActiveClipInTrack(project, track.clips, project.timeline.cursor);
    if (!clip) {
      continue;
    }

    signals.push({
      clipId: clip.id,
      resourceId: clip.resource.id,
      offset: getClipSourceStartSample(clip)
        + Math.floor((project.timeline.cursor - clip.start) / project.timebase.internalTimeRate * clip.resource.sampleRate),
      trackId: track.id,
    });
  }

  if (signals.length === 0) {
    return SILENCE;
  }

  return { type: "Mix", signals };
}
