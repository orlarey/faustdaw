/****************************** track/track-order.ts ******************************
 *
 * Purpose: Provide the canonical vertical ordering of timeline track ids.
 * How: Materialize the fixed `TRACK_IDS` sequence into one reusable id-to-index lookup
 *      so track-aware render layers share the same lane mapping.
 *
 ******************************************************************************/
import { TRACK_IDS, type TrackId } from "../../src/domain/track-id.js";

// Purpose: Represent the canonical zero-based lane index assigned to each fixed track id.
// How: Store one immutable map keyed by `TrackId` and populated in `TRACK_IDS` order.
// @invariant: every identifier in TRACK_IDS appears exactly once with a dense index starting at zero.
export type TimelineTrackOrder = ReadonlyMap<TrackId, number>;

// Purpose: Expose the default track-to-lane mapping used by timeline renderers.
// How: Convert the fixed track id list into a single read-only map at module load.
export const trackIdToIndex: TimelineTrackOrder = new Map<TrackId, number>(
  TRACK_IDS.map((trackId, index) => [trackId, index]),
);
