/**
 * Purpose: Define the domain types for the FX chain system.
 * How: Model FX resources (shared DSP source code) and FX effect instances
 *      (per-track references to a resource with specific parameter settings).
 */

export type FxResourceId = string;

export type FxResource = {
  id: FxResourceId;
  name: string;
  code: string;
}

export type FxEffectId = string;

export type FxParam = {
  address: string;
  value: number;
  min: number;
  max: number;
  default: number;
  step: number;
  label: string;
}

export type FxEffect = {
  id: FxEffectId;
  fxResourceId: FxResourceId;
  parameters: readonly FxParam[];
  bypassed: boolean;
}

/**
 * Purpose: Identify one FX chain — a sequence of effects placed in a host
 *          (a track today, a clip-algo or a master bus tomorrow).
 * How: Nominal string alias. The id space is partitioned by host kind ;
 *      the convention that track-FX chains use the track id as their
 *      chain id (i.e. `Track.chainId === Track.id`) is preserved by
 *      `initProject` and the chain operations. The Transform Chain
 *      uses the dedicated constant `TRANSFORM_CHAIN_ID`.
 */
export type FxChainId = string;

/** Stable id of the project's Transform Chain in `Project.chains`. */
export const TRANSFORM_CHAIN_ID: FxChainId = "__transform__";

/**
 * Purpose: A single FX chain — an ordered sequence of effects.
 * How: Effects are stored in their playback order ; an effect appears in
 *      exactly one chain at a time (enforced by the operations in
 *      `src/fx-chain.ts`). The chain itself carries no host link — the
 *      attachment is held by the host (e.g. `Track.chainId`).
 */
export type FxChain = {
  id: FxChainId;
  effects: readonly FxEffect[];
}
