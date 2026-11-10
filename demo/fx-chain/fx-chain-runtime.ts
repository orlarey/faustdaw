/**************************** fx-chain-runtime.ts ******************************
 *
 * Purpose: Registry of live FxEffect runtimes (AudioWorkletNode + UI metadata).
 * How: Keep a map keyed by FxEffectId. `compileFxEffect` orchestrates
 *      compilation through the faust-compiler module and inserts the result
 *      here. Consumers look up, register, destroy, or bulk-clear runtimes.
 *      An effect id alone does not identify a DSP: ids (`fx-1`, ...) repeat
 *      across sessions, an undone code edit keeps its id, and a sample-rate
 *      change replaces the AudioContext. A runtime is therefore reused only
 *      while it is *current*: same Faust code, node in the live context.
 *
 *****************************************************************************/
import type { FxEffectId } from "../../src/domain/fx-chain.js";
import { queueFaustCompilation } from "./faust-compiler.js";

export type FxEffectRuntime = {
  effectId: FxEffectId;
  node: AudioWorkletNode | null;
  generator: any | null;
  ui: any[] | null;
  /** Faust source the node was compiled from (absent: unknown, never current). */
  code?: string;
};

const effectRuntimes = new Map<FxEffectId, FxEffectRuntime>();

/*
 * Retired nodes. A node replaced (recompiled) or removed while a track's
 * current path still goes through it keeps its connections until that path
 * is rewired without it. Disconnecting it at once cut the sound from one
 * sample to the next, and left the track's output gain without input: an
 * AudioParam's automation only advances while its node has a connected input
 * (Chrome), so the fade around the rewire (track-runtime.ts) never ran and
 * the sound came back as abruptly.
 */
const retiredEffectNodes = new Set<AudioNode>();
// The effect nodes each wired path (one per track) currently goes through.
const wiredEffectNodes = new Map<string, ReadonlySet<AudioNode>>();

function disconnectNode(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // already disconnected
  }
}

/** Disconnect every retired node that no wired path goes through any more. */
function releaseRetiredEffectNodes(): void {
  for (const node of retiredEffectNodes) {
    let wired = false;
    for (const nodes of wiredEffectNodes.values()) {
      if (nodes.has(node)) {
        wired = true;
        break;
      }
    }
    if (!wired) {
      disconnectNode(node);
      retiredEffectNodes.delete(node);
    }
  }
}

function retireEffectNode(node: AudioNode): void {
  retiredEffectNodes.add(node);
  releaseRetiredEffectNodes();
}

/**
 * Purpose: Record the effect nodes a path (`pathId`: the track) was just wired
 *          through, and release the retired nodes it no longer uses.
 */
export function noteWiredEffectNodes(pathId: string, nodes: Iterable<AudioNode>): void {
  wiredEffectNodes.set(pathId, new Set(nodes));
  releaseRetiredEffectNodes();
}

/** Store `runtime` under `effectId`, retiring the node it replaces. */
function replaceEffectRuntime(effectId: FxEffectId, runtime: FxEffectRuntime): void {
  const previousNode = effectRuntimes.get(effectId)?.node;
  effectRuntimes.set(effectId, runtime);
  if (runtime.node) {
    retiredEffectNodes.delete(runtime.node); // in use again
  }
  if (previousNode && previousNode !== runtime.node) {
    retireEffectNode(previousNode);
  }
}

/**
 * Purpose: Decide whether a compiled runtime still implements `code` in `audioContext`.
 * How: Same source text, and a node created by that very context, which must not be closed.
 */
export function isEffectRuntimeCurrent(
  runtime: FxEffectRuntime,
  code: string,
  audioContext: BaseAudioContext,
): boolean {
  return runtime.code === code
    && runtime.node !== null
    && runtime.node.context === audioContext
    && audioContext.state !== "closed";
}

/**
 * Purpose: True iff `effectId` has a runtime that can be reused for `code` in `audioContext`.
 * How: Look the runtime up and apply `isEffectRuntimeCurrent`.
 */
export function hasCurrentEffectRuntime(
  effectId: FxEffectId,
  code: string,
  audioContext: BaseAudioContext,
): boolean {
  const runtime = effectRuntimes.get(effectId);
  return runtime !== undefined && isEffectRuntimeCurrent(runtime, code, audioContext);
}

/**
 * Purpose: Compile one Faust DSP source and create a live AudioWorkletNode.
 * How: Use the faust-compiler queue to serialize compilation, then create an
 *      AudioWorkletNode bound to the given AudioContext and register it.
 */
export async function compileFxEffect(
  effectId: FxEffectId,
  name: string,
  code: string,
  audioContext: AudioContext,
): Promise<FxEffectRuntime> {
  const existing = effectRuntimes.get(effectId);
  if (existing && isEffectRuntimeCurrent(existing, code, audioContext)) {
    return existing;
  }

  return queueFaustCompilation(async ({ compiler, createGenerator }) => {
    // Re-check after waiting — another caller may have compiled this effect.
    const existingAfterWait = effectRuntimes.get(effectId);
    if (existingAfterWait && isEffectRuntimeCurrent(existingAfterWait, code, audioContext)) {
      return existingAfterWait;
    }
    if (audioContext.state === "closed") {
      // The context was replaced (sample-rate change) while this compilation waited.
      throw new Error(`"${name}": audio context closed before compilation`);
    }

    console.log(`[faust] Compiling "${name}"…`);
    const generator = createGenerator();
    const compiled = await generator.compile(compiler, name, code, "-ftz 2");
    if (!compiled) {
      throw new Error(`Faust compilation failed for "${name}"`);
    }
    console.log(`[faust] "${name}" compiled, creating AudioWorkletNode…`);

    const node: AudioWorkletNode = await generator.createNode(audioContext);
    if (!node) {
      throw new Error(`Failed to create AudioWorkletNode for "${name}"`);
    }
    console.log(`[faust] "${name}" AudioWorkletNode created`);

    // Validate channel count: only 1 or 2 inputs/outputs are supported.
    const faustNode = node as any;
    const numIn = typeof faustNode.getNumInputs === "function" ? faustNode.getNumInputs() : -1;
    const numOut = typeof faustNode.getNumOutputs === "function" ? faustNode.getNumOutputs() : -1;
    if (numIn < 1 || numIn > 2 || numOut < 1 || numOut > 2) {
      faustNode.disconnect?.();
      throw new Error(
        `"${name}" has unsupported channel layout (${numIn}→${numOut}). Only 1 or 2 inputs/outputs are accepted.`,
      );
    }

    const ui = generator.getUI?.() ?? null;

    const runtime: FxEffectRuntime = {
      effectId,
      node,
      generator,
      ui,
      code,
    };

    // Replace a stale runtime (other code or other context). Its node is
    // released once no wired path goes through it any more.
    replaceEffectRuntime(effectId, runtime);
    return runtime;
  });
}

/** Retrieve the live runtime state for one effect. */
export function getEffectRuntime(effectId: FxEffectId): FxEffectRuntime | undefined {
  return effectRuntimes.get(effectId);
}

/**
 * Purpose: Register an externally-compiled runtime under a given effect ID.
 * How: Store the runtime in the map, updating its effectId field; the node it
 *      replaces is retired (released once no wired path goes through it).
 */
export function registerEffectRuntime(effectId: FxEffectId, runtime: FxEffectRuntime): void {
  replaceEffectRuntime(effectId, { ...runtime, effectId });
}

/**
 * Purpose: Remove the runtime state for one effect.
 * How: Remove it from the map and retire its node: disconnected at once when
 *      no wired path goes through it, else when its track is rewired without
 *      it (the track then fades instead of being cut).
 */
export function destroyEffectRuntime(effectId: FxEffectId): void {
  const runtime = effectRuntimes.get(effectId);
  if (!runtime) {
    return;
  }
  effectRuntimes.delete(effectId);
  if (runtime.node) {
    retireEffectNode(runtime.node);
  }
}

/**
 * Purpose: Release the runtimes of effects that no longer exist (another session was loaded).
 * How: Disconnect at once and forget every runtime whose effect id is not in
 *      `keep`, and every node still in retirement (the previous session's).
 */
export function retainEffectRuntimes(keep: ReadonlySet<FxEffectId>): void {
  for (const node of retiredEffectNodes) {
    disconnectNode(node);
  }
  retiredEffectNodes.clear();
  for (const [effectId, runtime] of [...effectRuntimes.entries()]) {
    if (!keep.has(effectId)) {
      effectRuntimes.delete(effectId);
      if (runtime.node) {
        disconnectNode(runtime.node);
      }
    }
  }
}

/**
 * Purpose: Reset the internal DSP state of all compiled effect nodes.
 * How: Call instanceClear() on each AudioWorkletNode to zero delay lines
 *      and internal buffers without resetting parameters or constants.
 */
export function clearAllEffectRuntimes(): void {
  for (const runtime of effectRuntimes.values()) {
    const node = runtime.node as any;
    if (node && typeof node.instanceClear === "function") {
      node.instanceClear();
    }
  }
}
