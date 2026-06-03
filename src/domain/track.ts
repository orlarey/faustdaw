/**
 * Purpose: Define one timeline track that groups clips under a stable lane identity.
 * How: Expose a minimal interface with the track identifier, display label,
 *      ordered clip sequence, and a reference to its FX chain (the chain
 *      itself lives in `Project.chains`).
 */
import type { Clip } from "./clip.js";
import type { FxChainId } from "./fx-chain.js";
import type { TrackId } from "./track-id.js";

/**
 * Purpose: Represent one fixed lane of the multitrack timeline.
 * How: Store the lane identity, its human-readable label, the ordered
 *      non-overlapping clips currently placed on it, and the id of the
 *      FX chain attached to this track. The chain (its effects, ordering,
 *      bypass state, etc.) lives in `Project.chains[chainId]`.
 */
export type Track = {
  id: TrackId;
  label: string;
  clips: readonly Clip[];
  chainId: FxChainId;
}
