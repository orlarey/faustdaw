/**
 * Purpose: Define the fixed track identities available in the current multitrack refinement.
 * How: Declare the canonical ordered track identifier list and derive the corresponding union type from it.
 */
export const TRACK_IDS = [
  "track-1",
  "track-2",
  "track-3",
  "track-4",
  "track-5",
  "track-6",
  "track-7",
  "track-8",
] as const;

/**
 * Purpose: Constrain track references to the finite set of supported track identifiers.
 * How: Derive the union directly from `TRACK_IDS` so value-level order and type-level identity stay synchronized.
 */
export type TrackId = (typeof TRACK_IDS)[number];
