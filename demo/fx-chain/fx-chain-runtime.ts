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

    // Replace a stale runtime (other code or other context): release its node first.
    destroyEffectRuntime(effectId);
    effectRuntimes.set(effectId, runtime);
    return runtime;
  });
}

/** Retrieve the live runtime state for one effect. */
export function getEffectRuntime(effectId: FxEffectId): FxEffectRuntime | undefined {
  return effectRuntimes.get(effectId);
}

/**
 * Purpose: Register an externally-compiled runtime under a given effect ID.
 * How: Store the runtime in the map, updating its effectId field.
 */
export function registerEffectRuntime(effectId: FxEffectId, runtime: FxEffectRuntime): void {
  effectRuntimes.set(effectId, { ...runtime, effectId });
}

/**
 * Purpose: Disconnect and remove the runtime state for one effect.
 * How: Disconnect the AudioWorkletNode from the graph and remove from the map.
 */
export function destroyEffectRuntime(effectId: FxEffectId): void {
  const runtime = effectRuntimes.get(effectId);
  if (!runtime) {
    return;
  }
  if (runtime.node) {
    try {
      runtime.node.disconnect();
    } catch {
      // already disconnected
    }
  }
  effectRuntimes.delete(effectId);
}

/**
 * Purpose: Release the runtimes of effects that no longer exist (another session was loaded).
 * How: Destroy every runtime whose effect id is not in `keep`.
 */
export function retainEffectRuntimes(keep: ReadonlySet<FxEffectId>): void {
  for (const effectId of [...effectRuntimes.keys()]) {
    if (!keep.has(effectId)) {
      destroyEffectRuntime(effectId);
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
