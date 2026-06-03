/**************************** fx-chain-runtime.ts ******************************
 *
 * Purpose: Registry of live FxEffect runtimes (AudioWorkletNode + UI metadata).
 * How: Keep a map keyed by FxEffectId. `compileFxEffect` orchestrates
 *      compilation through the faust-compiler module and inserts the result
 *      here. Consumers look up, register, destroy, or bulk-clear runtimes.
 *
 *****************************************************************************/
import type { FxEffectId } from "../../src/domain/fx-chain.js";
import { queueFaustCompilation } from "./faust-compiler.js";

export type FxEffectRuntime = {
  effectId: FxEffectId;
  node: AudioWorkletNode | null;
  generator: any | null;
  ui: any[] | null;
};

const effectRuntimes = new Map<FxEffectId, FxEffectRuntime>();

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
  if (existing) {
    return existing;
  }

  return queueFaustCompilation(async ({ compiler, createGenerator }) => {
    // Re-check after waiting — another caller may have compiled this effect.
    const existingAfterWait = effectRuntimes.get(effectId);
    if (existingAfterWait) {
      return existingAfterWait;
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
    };

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
