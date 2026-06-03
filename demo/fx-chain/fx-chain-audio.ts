/***************************** fx-chain-audio.ts ********************************
 *
 * Purpose: Wire and manage the audio-graph connections for per-track FX chains.
 * How: Chain non-bypassed Faust AudioWorkletNodes between a track's input and
 *      output gain nodes, and provide helpers to capture and restore parameter
 *      values from compiled nodes.
 *
 *****************************************************************************/
import type { FxEffectId, FxParam } from "../../src/domain/fx-chain.js";
import type { TrackId } from "../../src/domain/track-id.js";
import { getEffectRuntime } from "./fx-chain-runtime.js";
import { demoState } from "../state.js";

/**
 * Purpose: Wire the Faust effect nodes between an input and output node for one track.
 * How: Look up the track's effects from the project model, chain the non-bypassed runtime
 *      AudioWorkletNodes in order, and fall back to a direct connection when no effects apply.
 *      During Transform Preview, the track containing the previewed clip uses the Transform
 *      Chain instead of its own effects — track effects are bypassed.
 *      Before wiring, every candidate effect node is disconnected so rewires after a reorder
 *      don't leave stale edges behind (those would form feedback loops).
 */
export function wireTrackEffectChain(trackId: TrackId, inputNode: GainNode, outputNode: GainNode): void {
  // During Transform Preview, replace the target track's effects with Transform Chain
  const preview = demoState.faustTransformPreview;
  if (preview) {
    const isPreviewTrack = demoState.project.timeline.tracks.some(
      (t) => t.id === trackId && t.clips.some((c) => c.id === preview.clipId),
    );
    if (isPreviewTrack) {
      disconnectChainRuntimes(demoState.transformChain);
      let currentNode: AudioNode = inputNode;
      for (const effect of demoState.transformChain) {
        if (effect.bypassed) continue;
        const runtime = getEffectRuntime(effect.id);
        if (!runtime?.node) continue;
        currentNode.connect(runtime.node);
        currentNode = runtime.node;
      }
      currentNode.connect(outputNode);
      return;
    }
  }

  const track = demoState.project.timeline.tracks.find((t) => t.id === trackId);
  const chain = track ? demoState.project.chains.get(track.chainId) : undefined;
  const effects = chain?.effects ?? [];
  if (effects.length === 0) {
    inputNode.connect(outputNode);
    return;
  }

  disconnectChainRuntimes(effects);
  let currentNode: AudioNode = inputNode;
  for (const effect of effects) {
    if (effect.bypassed) {
      continue;
    }
    const runtime = getEffectRuntime(effect.id);
    if (!runtime?.node) {
      continue;
    }
    currentNode.connect(runtime.node);
    currentNode = runtime.node;
  }
  currentNode.connect(outputNode);
}

/**
 * Purpose: Clear all outgoing connections of the runtime nodes of a chain before rewiring.
 * How: Call disconnect() on each live AudioWorkletNode. Swallow errors for nodes that had
 *      no outgoing edges.
 */
function disconnectChainRuntimes(chain: ReadonlyArray<{ id: FxEffectId }>): void {
  for (const effect of chain) {
    const runtime = getEffectRuntime(effect.id);
    if (!runtime?.node) continue;
    try {
      runtime.node.disconnect();
    } catch {
      // already disconnected
    }
  }
}

/**
 * Purpose: Extract parameter metadata (address, min, max, step, label, default) from a compiled Faust node.
 * How: Read descriptors from the Faust node. The `value` field is set to the descriptor's
 *      `init` (default) because the main-thread Faust node's `getParamValue` reads
 *      `AudioParam.value` which is NOT updated by `setValueAtTime` — it always returns
 *      the initial default. Callers that need the live value must track it themselves.
 */
export function captureEffectParameters(node: AudioWorkletNode): FxParam[] {
  const faustNode = node as any;
  const descriptors: any[] = faustNode.getDescriptors?.() ?? [];
  return descriptors.map((desc: any) => ({
    address: desc.address ?? "",
    value: desc.init ?? 0,
    min: desc.min ?? 0,
    max: desc.max ?? 1,
    default: desc.init ?? 0,
    step: desc.step ?? 0.01,
    label: desc.label ?? desc.address ?? "",
  }));
}

/**
 * Purpose: Restore saved parameter values onto a recompiled Faust node.
 * How: For each saved parameter, call setParamValue on the node if the address still exists.
 */
export function restoreEffectParameters(node: AudioWorkletNode, savedParams: readonly FxParam[]): void {
  const faustNode = node as any;
  for (const param of savedParams) {
    if (faustNode.setParamValue) {
      faustNode.setParamValue(param.address, param.value);
    }
  }
}
