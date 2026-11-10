/****************************** track/track-audio.ts ******************************
 *
 * Purpose: Expose the public audio-runtime API attached to demo tracks.
 * How: Forward each public operation to the internal runtime ADT that owns track players and output nodes.
 *
 ******************************************************************************/
import type { TrackId } from "../../src/domain/track-id.js";
import {
  ensureTrackOutputRuntime,
  getTrackEffectiveGain,
  resetTrackMixRuntime,
  resetTrackPlayersRuntime,
  syncAllTrackOutputRuntime,
  syncTrackOutputRuntime,
  whenTrackChainSettled,
} from "./track-runtime.js";

export class TrackAudio {
  // Purpose: Reset every shared track player to its empty runtime state while preserving user controls.
  // How: Delegate to the internal runtime ADT that rebuilds the fixed track-player map.
  static resetPlayers(): void {
    resetTrackPlayersRuntime();
  }

  // Purpose: Compute the effective gain currently applied to one track after mute and solo rules.
  // How: Delegate to the internal runtime ADT that reads the shared track-player map.
  static effectiveGain(trackId: TrackId): number {
    return getTrackEffectiveGain(trackId);
  }

  // Purpose: Synchronize one track output chain with the current mix controls.
  // How: Delegate to the internal runtime ADT that pushes gain and pan into existing nodes.
  static syncOutput(trackId: TrackId): void {
    syncTrackOutputRuntime(trackId);
  }

  // Purpose: Synchronize every track output chain with the current mix controls.
  // How: Delegate to the internal runtime ADT that iterates the fixed track set.
  static syncAllOutputs(): void {
    syncAllTrackOutputRuntime();
  }

  // Purpose: Reset all stored track mix controls to their default values.
  // How: Delegate to the internal runtime ADT that clears mix controls and resynchronizes outputs.
  static resetMix(): void {
    resetTrackMixRuntime();
  }

  // Purpose: Ensure one track has a connected output gain chain feeding the master output.
  // How: Delegate to the internal runtime ADT while accepting the master-output callback owned by the caller.
  static ensureOutputGain(
    trackId: TrackId,
    ensureMasterOutputGain: (audioContext: AudioContext) => GainNode,
  ): GainNode | null {
    return ensureTrackOutputRuntime(trackId, ensureMasterOutputGain);
  }

  // Purpose: Run a callback once any pending effect-path swap of the track is wired.
  // How: Delegate to the internal runtime ADT (at once when no swap is pending).
  static whenChainSettled(trackId: TrackId, callback: () => void): void {
    whenTrackChainSettled(trackId, callback);
  }
}
