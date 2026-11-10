/***************************** track/track-runtime.ts *****************************
 *
 * Purpose: Manage the live runtime state attached to demo tracks.
 * How: Read and mutate the shared demo track-player map, deriving effective gain,
 *      syncing output nodes, and rebuilding per-track runtime chains when needed.
 *
 ******************************************************************************/
import { TRACK_IDS, type TrackId } from "../../src/domain/track-id.js";
import { trackEffectChainKey, wireTrackEffectChain } from "../fx-chain/fx-chain-audio.js";
import { DEFAULT_TRACK_LEVEL } from "./track-playback.js";
import { demoState } from "../state.js";
import { setParamImmediately, setParamSmoothly } from "../audio-param-smoothing.js";
import type { TrackPlayerState } from "./track-playback.js";

/**
 * Fade of the track output around a change of its effect path during
 * playback (bypass, add, remove, reorder). Rewiring at once switched the
 * signal from one sample to the next: a click. The output approaches 0 with
 * this time constant (setTargetAtTime starts from the value actually reached,
 * even when the render thread is already past the call time; a linear ramp
 * from a held point would jump), the path is rewired once the rendered time
 * is past CHAIN_SWAP_SETTLE_SECONDS (8 time constants: 0.03 % left), then the
 * output returns smoothly.
 */
const CHAIN_SWAP_TIME_CONSTANT_SECONDS = 0.001;
const CHAIN_SWAP_SETTLE_SECONDS = 8 * CHAIN_SWAP_TIME_CONSTANT_SECONDS;
// One render quantum: the fade starts at the first quantum after the call.
const RENDER_QUANTUM_FRAMES = 128;

// The effect path each track player was last wired with.
const wiredChainKeys = new WeakMap<TrackPlayerState, string>();
// Track players whose rewire waits for the fade-out, with what to run after it.
const pendingChainSwaps = new WeakMap<TrackPlayerState, Array<() => void>>();

// Purpose: Rebuild every track player with preserved user controls and cleared runtime nodes/plans.
// How: Allocate a fresh fixed track-player map from TRACK_IDS while carrying over level, pan, mute, and solo flags.
export function resetTrackPlayersRuntime(): void {
  const previousTrackPlayers = demoState.trackPlayers;
  demoState.trackPlayers = new Map(
    TRACK_IDS.map((trackId) => {
      const previousTrackPlayer = previousTrackPlayers.get(trackId);
      return [trackId, {
        level: previousTrackPlayer?.level ?? DEFAULT_TRACK_LEVEL,
        pan: previousTrackPlayer?.pan ?? 0,
        muted: previousTrackPlayer?.muted ?? false,
        solo: previousTrackPlayer?.solo ?? false,
        effectInputGain: null,
        outputGain: null,
        outputPanner: null,
        silentKeepAlive: null,
        activePlan: null,
        nextPlan: null,
        retiringPlans: [],
      }];
    }),
  );
}

// Purpose: Find the unique soloed track, if any, in the current runtime mix state.
// How: Scan the shared track-player map and return the first track whose solo flag is enabled.
function getSoloTrackId(): TrackId | null {
  for (const [trackId, trackPlayer] of demoState.trackPlayers.entries()) {
    if (trackPlayer.solo) {
      return trackId;
    }
  }
  return null;
}

// Purpose: Compute the effective gain currently applied to one track after mute and solo rules.
// How: Read the stored track player, then zero every non-soloed track when any solo is active or mute the track when needed.
//      During Transform Preview, the preview track is forced to unity gain (volume/mute/solo bypassed).
export function getTrackEffectiveGain(trackId: TrackId): number {
  const trackPlayer = demoState.trackPlayers.get(trackId);
  if (!trackPlayer) {
    return 0;
  }

  // During Transform Preview, force unity gain on the preview track
  const preview = demoState.faustTransformPreview;
  if (preview) {
    const isPreviewTrack = demoState.project.timeline.tracks.some(
      (t) => t.id === trackId && t.clips.some((c) => c.id === preview.clipId),
    );
    if (isPreviewTrack) return 1;
  }

  const soloTrackId = getSoloTrackId();
  if (soloTrackId !== null) {
    return soloTrackId === trackId ? trackPlayer.level : 0;
  }
  return trackPlayer.muted ? 0 : trackPlayer.level;
}

// Purpose: Synchronize one track output chain with the current mix controls.
// How: Push the current effective gain and pan values into the already-created output nodes when they exist.
//      During Transform Preview, the preview track is forced to center pan.
export function syncTrackOutputRuntime(trackId: TrackId, options: { immediate?: boolean } = {}): void {
  const trackPlayer = demoState.trackPlayers.get(trackId);
  if (!trackPlayer) {
    return;
  }
  // Smoothly during playback (no click on mute / solo / volume / pan), at
  // once for nodes just created (see audio-param-smoothing.ts).
  const setParam = (param: AudioParam, value: number, context: BaseAudioContext): void => {
    if (options.immediate) {
      setParamImmediately(param, value);
    } else {
      setParamSmoothly(param, value, context);
    }
  };
  // While an effect-path swap fades out, the old path must stay at 0: the
  // swap applies the current gain once the new path is wired.
  if (trackPlayer.outputGain && !pendingChainSwaps.has(trackPlayer)) {
    setParam(trackPlayer.outputGain.gain, getTrackEffectiveGain(trackId), trackPlayer.outputGain.context);
  }
  if (trackPlayer.outputPanner) {
    // During Transform Preview, force center pan on the preview track
    const preview = demoState.faustTransformPreview;
    if (preview) {
      const isPreviewTrack = demoState.project.timeline.tracks.some(
        (t) => t.id === trackId && t.clips.some((c) => c.id === preview.clipId),
      );
      if (isPreviewTrack) {
        setParam(trackPlayer.outputPanner.pan, 0, trackPlayer.outputPanner.context);
        return;
      }
    }
    setParam(trackPlayer.outputPanner.pan, trackPlayer.pan, trackPlayer.outputPanner.context);
  }
}

// Purpose: Synchronize every track output chain with the current mix controls.
// How: Iterate the fixed track id list and apply the one-track synchronization routine to each runtime chain.
export function syncAllTrackOutputRuntime(): void {
  for (const trackId of TRACK_IDS) {
    syncTrackOutputRuntime(trackId);
  }
}

// Purpose: Reset all stored track mix controls to their default values.
// How: Overwrite level, pan, mute, and solo on every shared track player, then resynchronize the output chains.
export function resetTrackMixRuntime(): void {
  for (const trackPlayer of demoState.trackPlayers.values()) {
    trackPlayer.level = DEFAULT_TRACK_LEVEL;
    trackPlayer.pan = 0;
    trackPlayer.muted = false;
    trackPlayer.solo = false;
  }
  syncAllTrackOutputRuntime();
}

// Purpose: Ensure one track has an output gain and panner chain connected to the master output.
// How: Lazily create the nodes, wire effectInputGain → [FX chain] → outputGain → panner → master,
//      then synchronize their current control values. Returns the node clips should connect to.
export function ensureTrackOutputRuntime(
  trackId: TrackId,
  ensureMasterOutputGain: (audioContext: AudioContext) => GainNode,
): GainNode | null {
  const audioContext = demoState.audio.context;
  const trackPlayer = demoState.trackPlayers.get(trackId);
  if (!audioContext || !trackPlayer) {
    return null;
  }

  if (!trackPlayer.effectInputGain) {
    trackPlayer.effectInputGain = audioContext.createGain();
  }
  // Fresh output nodes start at their defaults (gain 1, pan 0): set them at
  // once, never approach from there.
  const createdOutput = !trackPlayer.outputGain || !trackPlayer.outputPanner;
  if (!trackPlayer.outputGain) {
    trackPlayer.outputGain = audioContext.createGain();
  }
  if (!trackPlayer.outputPanner) {
    trackPlayer.outputPanner = audioContext.createStereoPanner();
  }
  const chainKey = trackEffectChainKey(trackId, audioContext);
  const wiredKey = wiredChainKeys.get(trackPlayer);
  if (pendingChainSwaps.has(trackPlayer)) {
    // A swap is fading out: it will wire the path as it is then.
    return trackPlayer.effectInputGain;
  }
  if (!createdOutput && wiredKey !== undefined && wiredKey !== chainKey && audioContext.state === "running") {
    const fadeStart = audioContext.currentTime;
    trackPlayer.outputGain.gain.setTargetAtTime(0, fadeStart, CHAIN_SWAP_TIME_CONSTANT_SECONDS);
    // Wait on the rendered time, not the wall clock: the audio thread renders
    // in bursts, and a rewire issued before the fade is rendered lands in the
    // same burst as the fade and cuts the sound.
    const settledAt = fadeStart + CHAIN_SWAP_SETTLE_SECONDS + RENDER_QUANTUM_FRAMES / audioContext.sampleRate;
    pendingChainSwaps.set(trackPlayer, []);
    const finishSwap = (): void => {
      if (audioContext.state === "running" && audioContext.currentTime < settledAt) {
        window.setTimeout(finishSwap, 2);
        return;
      }
      const afterSwap = pendingChainSwaps.get(trackPlayer) ?? [];
      pendingChainSwaps.delete(trackPlayer);
      if (demoState.trackPlayers.get(trackId) === trackPlayer && demoState.audio.context === audioContext) {
        wireTrackOutputRuntime(trackId, trackPlayer, audioContext, ensureMasterOutputGain);
        syncTrackOutputRuntime(trackId);
      }
      for (const run of afterSwap) run();
    };
    window.setTimeout(finishSwap, Math.ceil(CHAIN_SWAP_SETTLE_SECONDS * 1000));
    return trackPlayer.effectInputGain;
  }
  wireTrackOutputRuntime(trackId, trackPlayer, audioContext, ensureMasterOutputGain);
  syncTrackOutputRuntime(trackId, { immediate: createdOutput });
  return trackPlayer.effectInputGain;
}

/**
 * Purpose: Run `callback` once any pending effect-path swap of `trackId` is
 *          wired (at once when there is none). An effect being removed is
 *          destroyed through it, so it keeps sounding until the fade-out ends
 *          instead of being cut before it.
 */
export function whenTrackChainSettled(trackId: TrackId, callback: () => void): void {
  const trackPlayer = demoState.trackPlayers.get(trackId);
  const pending = trackPlayer ? pendingChainSwaps.get(trackPlayer) : undefined;
  if (pending) {
    pending.push(callback);
  } else {
    callback();
  }
}

/**
 * Purpose: (Re)connect effectInputGain → [FX chain] → outputGain → panner →
 *          master for one track player, and record the path it was wired with.
 */
function wireTrackOutputRuntime(
  trackId: TrackId,
  trackPlayer: TrackPlayerState,
  audioContext: AudioContext,
  ensureMasterOutputGain: (audioContext: AudioContext) => GainNode,
): void {
  if (!trackPlayer.effectInputGain || !trackPlayer.outputGain || !trackPlayer.outputPanner) {
    return;
  }
  if (trackPlayer.effectInputGain.numberOfOutputs > 0) {
    trackPlayer.effectInputGain.disconnect();
  }
  if (trackPlayer.outputGain.numberOfOutputs > 0) {
    trackPlayer.outputGain.disconnect();
  }
  if (trackPlayer.outputPanner.numberOfOutputs > 0) {
    trackPlayer.outputPanner.disconnect();
  }

  // Wire the FX chain: effectInputGain → [FX1 → ... → FXn] → outputGain
  wireTrackEffectChain(trackId, trackPlayer.effectInputGain, trackPlayer.outputGain);
  wiredChainKeys.set(trackPlayer, trackEffectChainKey(trackId, audioContext));

  // Purpose: Keep the audio graph alive even when no clips are playing.
  // How: A silent ConstantSourceNode connected to effectInputGain forces the
  //      Web Audio engine to keep processing the effect chain continuously.
  if (!trackPlayer.silentKeepAlive) {
    const keepAlive = audioContext.createConstantSource();
    keepAlive.offset.value = 0;
    keepAlive.connect(trackPlayer.effectInputGain);
    keepAlive.start();
    trackPlayer.silentKeepAlive = keepAlive;
  }

  const masterOutputGain = ensureMasterOutputGain(audioContext);
  trackPlayer.outputGain.connect(trackPlayer.outputPanner);
  trackPlayer.outputPanner.connect(masterOutputGain);
}

