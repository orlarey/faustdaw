/**************************** faust-resource.ts *****************************
 *
 * Purpose: Pure utilities for Faust resources and effect instances — naming,
 *          code extraction, ID generation, and creation from a .dsp file or
 *          a blank template.
 * How: No DOM, no audio. Functions read/mutate demoState.project for the
 *      FxResource map and derive identifiers from it. Consumers: faust-editor,
 *      faust-transform-panel, fx-chain-panel, interactions.
 *
 *****************************************************************************/
import type { FxEffect, FxResourceId } from "../../src/domain/fx-chain.js";
import { importFxResource } from "../../src/fx-chain.js";
import { demoState } from "../state.js";

// ---------------------------------------------------------------------------
// Module-level counters for ID generation
// ---------------------------------------------------------------------------

let nextEffectOrdinal = 1;
let nextFxResourceOrdinal = 1;

function createNextEffectId(): string {
  let effectId = `fx-${nextEffectOrdinal++}`;
  const usedSomewhere = (id: string): boolean => {
    for (const chain of demoState.project.chains.values()) {
      if (chain.effects.some((e) => e.id === id)) return true;
    }
    return demoState.transformChain.some((e) => e.id === id);
  };
  while (usedSomewhere(effectId)) {
    effectId = `fx-${nextEffectOrdinal++}`;
  }
  return effectId;
}

function createNextFxResourceId(): FxResourceId {
  let resourceId = `fxr-${nextFxResourceOrdinal++}`;
  while (demoState.project.fxResources.has(resourceId)) {
    resourceId = `fxr-${nextFxResourceOrdinal++}`;
  }
  return resourceId;
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/**
 * Purpose: Compute a short hash of a string for resource naming.
 * How: Use a simple non-cryptographic hash (djb2) and return 6 hex characters.
 */
function shortCodeHash(code: string): string {
  let hash = 5381;
  for (let i = 0; i < code.length; i++) {
    hash = ((hash << 5) + hash + code.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(-6);
}

/**
 * Purpose: Build a resource name from a base name and code content.
 * How: Append a short hash of the code to the base name for uniqueness.
 */
export function buildFxResourceName(baseName: string, code: string): string {
  return `${baseName}-${shortCodeHash(code)}`;
}

/**
 * Purpose: Extract the declared name from Faust code if present.
 * How: Match `declare name "…";` and return the captured string, or null.
 */
export function extractDeclareName(code: string): string | null {
  const match = code.match(/declare\s+name\s+"([^"]+)"\s*;/);
  return match ? match[1]! : null;
}

/** Default Faust code template for new effects created from scratch. */
const DEFAULT_FAUST_CODE = `declare name "gain";

import("stdfaust.lib");

process = *(g),*(g) with {
  g = hslider("gain", 1, 0, 2, 0.01);
};
`;

function findFxResourceByName(name: string): FxResourceId | null {
  for (const [id, resource] of demoState.project.fxResources) {
    if (resource.name === name) {
      return id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** Look up the FX resource name for an effect instance. */
export function getEffectName(effect: FxEffect): string {
  return demoState.project.fxResources.get(effect.fxResourceId)?.name ?? effect.fxResourceId;
}

/** Look up the FX resource code for an effect instance. */
export function getEffectCode(effect: FxEffect): string {
  return demoState.project.fxResources.get(effect.fxResourceId)?.code ?? "";
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/**
 * Purpose: Import a .dsp file as an FX resource and create an effect instance.
 * How: Reuse an existing FX resource if the name matches, or create a new one.
 *      Then create a new FxEffect referencing the resource.
 */
export function importDspFileAsEffect(file: File, code: string): { effect: FxEffect; isNewResource: boolean } {
  const declaredName = extractDeclareName(code);
  const baseName = declaredName ?? file.name.replace(/\.dsp$/i, "");
  const name = buildFxResourceName(baseName, code);
  let fxResourceId = findFxResourceByName(name);
  let isNewResource = false;
  if (fxResourceId === null) {
    fxResourceId = createNextFxResourceId();
    demoState.project = importFxResource(demoState.project, { id: fxResourceId, name, code });
    isNewResource = true;
  }
  const effect: FxEffect = {
    id: createNextEffectId(),
    fxResourceId,
    parameters: [],
    bypassed: false,
  };
  return { effect, isNewResource };
}

/**
 * Purpose: Create a new blank FX effect with default template code.
 * How: Create a new FxResource with the default code and return a new FxEffect.
 */
export function createBlankEffect(): FxEffect {
  const code = DEFAULT_FAUST_CODE;
  const baseName = extractDeclareName(code) ?? "new";
  const name = buildFxResourceName(baseName, code);
  const fxResourceId = createNextFxResourceId();
  demoState.project = importFxResource(demoState.project, { id: fxResourceId, name, code });
  return {
    id: createNextEffectId(),
    fxResourceId,
    parameters: [],
    bypassed: false,
  };
}

/** Return the first file in a FileList whose name ends in `.dsp`, or null. */
export function getFirstDspFile(fileList: FileList | null): File | null {
  if (!fileList) {
    return null;
  }
  for (const file of Array.from(fileList)) {
    if (/\.dsp$/i.test(file.name)) {
      return file;
    }
  }
  return null;
}
