/********************************* fx-chain.ts **********************************
 *
 * Purpose: Implement pure domain operations on FX chains. Each chain is
 *          identified by an `FxChainId` and lives in `Project.chains` ;
 *          tracks reference their chain via `Track.chainId`.
 * How: Expose functions that add, remove, reorder, bypass, and update
 *      FX effect instances within an immutable project snapshot. All
 *      operations key on `chainId` directly — they don't know (or care)
 *      what hosts the chain.
 *
 *****************************************************************************/
import type { FxChain, FxChainId, FxEffect, FxEffectId, FxParam, FxResource } from "./domain/fx-chain.js";
import type { Project } from "./domain/project.js";

// ---------------------------------------------------------------------------
// Chain access
// ---------------------------------------------------------------------------

/**
 * Purpose: Read one FX chain by id.
 * How: Lookup in `project.chains`. Throws if the chain does not exist —
 *      callers are expected to operate on chain ids that came from the
 *      project (e.g. `track.chainId`).
 */
export function getChain(project: Project, chainId: FxChainId): FxChain {
  const chain = project.chains.get(chainId);
  if (!chain) {
    throw new Error(`Precondition violation: FX chain "${chainId}" not found`);
  }
  return chain;
}

function replaceChain(project: Project, nextChain: FxChain): Project {
  const nextChains = new Map(project.chains);
  nextChains.set(nextChain.id, nextChain);
  return { ...project, chains: nextChains };
}

// ---------------------------------------------------------------------------
// FX resource operations
// ---------------------------------------------------------------------------

/**
 * Purpose: Import an FX resource into the project catalog.
 * How: Return a new project with the resource added to fxResources.
 */
export function importFxResource(project: Project, resource: FxResource): Project {
  const nextFxResources = new Map(project.fxResources);
  nextFxResources.set(resource.id, resource);
  return { ...project, fxResources: nextFxResources };
}

// ---------------------------------------------------------------------------
// FX effect instance operations — all key on `chainId`
// ---------------------------------------------------------------------------

/**
 * Purpose: Append an FX effect instance to the end of a chain.
 * How: Return a new project with the effect appended to the target chain.
 */
export function addEffect(project: Project, chainId: FxChainId, effect: FxEffect): Project {
  const chain = getChain(project, chainId);
  if (chain.effects.some((existing) => existing.id === effect.id)) {
    throw new Error(`Precondition violation: effect "${effect.id}" already exists on chain "${chainId}"`);
  }
  return replaceChain(project, { ...chain, effects: [...chain.effects, effect] });
}

/**
 * Purpose: Remove an FX effect instance from a chain.
 * How: Return a new project with the identified effect filtered out.
 */
export function removeEffect(project: Project, chainId: FxChainId, effectId: FxEffectId): Project {
  const chain = getChain(project, chainId);
  const nextEffects = chain.effects.filter((effect) => effect.id !== effectId);
  if (nextEffects.length === chain.effects.length) {
    throw new Error(`Precondition violation: effect "${effectId}" not found on chain "${chainId}"`);
  }
  return replaceChain(project, { ...chain, effects: nextEffects });
}

/**
 * Purpose: Replace the parameters of one FX effect on a chain.
 * How: Return a new project with the identified effect's parameters replaced.
 */
export function updateEffectParameters(
  project: Project,
  chainId: FxChainId,
  effectId: FxEffectId,
  parameters: readonly FxParam[],
): Project {
  const chain = getChain(project, chainId);
  const nextEffects = chain.effects.map((effect) =>
    effect.id === effectId ? { ...effect, parameters } : effect,
  );
  return replaceChain(project, { ...chain, effects: nextEffects });
}

/**
 * Purpose: Update a single parameter value on one FX effect.
 * How: Return a new project with the identified parameter's value replaced.
 */
export function updateEffectParamValue(
  project: Project,
  chainId: FxChainId,
  effectId: FxEffectId,
  address: string,
  value: number,
): Project {
  const chain = getChain(project, chainId);
  const nextEffects = chain.effects.map((effect) => {
    if (effect.id !== effectId) {
      return effect;
    }
    const nextParams = effect.parameters.map((param) =>
      param.address === address ? { ...param, value } : param,
    );
    return { ...effect, parameters: nextParams };
  });
  return replaceChain(project, { ...chain, effects: nextEffects });
}

/**
 * Purpose: Swap an FX effect with its predecessor in the chain.
 * How: Return a new project with the two adjacent effects swapped.
 */
export function moveEffectUp(project: Project, chainId: FxChainId, effectId: FxEffectId): Project {
  const chain = getChain(project, chainId);
  const index = chain.effects.findIndex((e) => e.id === effectId);
  if (index < 0) {
    throw new Error(`Precondition violation: effect "${effectId}" not found on chain "${chainId}"`);
  }
  if (index === 0) {
    return project;
  }
  const nextEffects = [...chain.effects];
  [nextEffects[index - 1], nextEffects[index]] = [nextEffects[index]!, nextEffects[index - 1]!];
  return replaceChain(project, { ...chain, effects: nextEffects });
}

/**
 * Purpose: Swap an FX effect with its successor in the chain.
 * How: Return a new project with the two adjacent effects swapped.
 */
export function moveEffectDown(project: Project, chainId: FxChainId, effectId: FxEffectId): Project {
  const chain = getChain(project, chainId);
  const index = chain.effects.findIndex((e) => e.id === effectId);
  if (index < 0) {
    throw new Error(`Precondition violation: effect "${effectId}" not found on chain "${chainId}"`);
  }
  if (index >= chain.effects.length - 1) {
    return project;
  }
  const nextEffects = [...chain.effects];
  [nextEffects[index], nextEffects[index + 1]] = [nextEffects[index + 1]!, nextEffects[index]!];
  return replaceChain(project, { ...chain, effects: nextEffects });
}

/**
 * Purpose: Move an FX effect to an arbitrary position in the chain.
 * How: Remove the effect from its current index and splice it at the target index.
 */
export function moveEffect(project: Project, chainId: FxChainId, effectId: FxEffectId, toIndex: number): Project {
  const chain = getChain(project, chainId);
  const fromIndex = chain.effects.findIndex((e) => e.id === effectId);
  if (fromIndex < 0) {
    throw new Error(`Precondition violation: effect "${effectId}" not found on chain "${chainId}"`);
  }
  if (fromIndex === toIndex) {
    return project;
  }
  const nextEffects = [...chain.effects];
  const [moved] = nextEffects.splice(fromIndex, 1);
  nextEffects.splice(toIndex, 0, moved!);
  return replaceChain(project, { ...chain, effects: nextEffects });
}

/**
 * Purpose: Toggle the bypass state of an FX effect.
 * How: Return a new project with the identified effect's bypassed flag flipped.
 */
export function toggleEffectBypass(project: Project, chainId: FxChainId, effectId: FxEffectId): Project {
  const chain = getChain(project, chainId);
  const nextEffects = chain.effects.map((effect) =>
    effect.id === effectId ? { ...effect, bypassed: !effect.bypassed } : effect,
  );
  return replaceChain(project, { ...chain, effects: nextEffects });
}
