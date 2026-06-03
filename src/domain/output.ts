/**
 * Purpose: Define the observable output produced by the DAW domain at one instant.
 * How: Model silence and active signal observations as small discriminated records detached from implementation details.
 */
import type { ClipId, ResourceId } from "./identifiers.js";
import type { TrackId } from "./track-id.js";

/**
 * Purpose: Describe one active signal contribution in the observed mix.
 * How: Record the source clip, source resource, current read offset, and emitting track for one active playback branch.
 */
export type SignalOutput = {
  clipId: ClipId;
  resourceId: ResourceId;
  offset: number;
  trackId: TrackId;
}

/**
 * Purpose: Represent the externally observable audio state of the project.
 * How: Use a discriminated union that is either pure silence or a symbolic mix of active signal contributions.
 */
export type Output =
  | { type: "Silence" }
  | { type: "Mix"; signals: readonly SignalOutput[] };
