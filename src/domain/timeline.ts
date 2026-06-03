/**
 * Purpose: Define the shared temporal workspace that contains tracks and transport state.
 * How: Expose a compact aggregate interface for ordered tracks, the current cursor position, and the transport mode.
 */
import type { Track } from "./track.js";
import type { TimeCoord } from "./timebase.js";
import type { TransportState } from "./transport.js";

/**
 * Purpose: Represent the editable multitrack timeline of the project.
 * How: Store the ordered track collection together with the current cursor coordinate and transport state.
 */
export type Timeline = {
  tracks: readonly Track[];
  cursor: TimeCoord;
  transport: TransportState;
}
