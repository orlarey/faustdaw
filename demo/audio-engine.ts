/******************************* audio-engine.ts ******************************
 *
 * Purpose: Own the live WebAudio root graph as a single object: the
 *          AudioContext, the silent keep-alive source/gain pair (which
 *          prevents iOS Safari from suspending the context between user
 *          gestures), and the master output gain between the tracks and
 *          destination. Exposes the lifecycle operations — create/tear-down
 *          the context, ensure the master gain, start/stop the silent
 *          engine, swap the context when the project sample rate changes.
 * How: Implemented as a class so the interface (fields + operations) is
 *      readable at a glance per FUNCTIONALCOUPLINGv3. The four live nodes
 *      are private; external code reads the context and the master gain
 *      through getters when it needs to build its own downstream nodes.
 *      Writes to the four fields happen only inside this class. Reads
 *      `demoState.masterLevel` for mix level projection (a demo-wide mix
 *      control that the audio engine does not own).
 *
 ******************************************************************************/
import { demoState } from "./state.js";
import { DEFAULT_MASTER_LEVEL } from "./track/track-playback.js";
import { TrackAudio } from "./track/track-audio.js";

/** Short fade applied when starting/stopping the silent engine or track plans. */
export const START_STOP_FADE_SECONDS = 0.005;

export class AudioEngine {
  #context: AudioContext | null = null;
  #silentSource: ConstantSourceNode | null = null;
  #silentGain: GainNode | null = null;
  #masterGain: GainNode | null = null;
  #shutdownTimeoutId: number | null = null;

  // -------------------------------------------------------------------------
  // Read access
  // -------------------------------------------------------------------------

  get context(): AudioContext | null {
    return this.#context;
  }

  get masterGain(): GainNode | null {
    return this.#masterGain;
  }

  // -------------------------------------------------------------------------
  // Context + master gain
  // -------------------------------------------------------------------------

  /**
   * Purpose: Ensure the demo owns one AudioContext whose sample rate matches the project timebase.
   * How: Lazily create the context with the target sample rate and reuse it across decode and playback.
   */
  ensureContext(): AudioContext | null {
    if (typeof AudioContext === "undefined") {
      return null;
    }
    const targetSampleRate = demoState.project.timebase.sampleRate;
    if (!this.#context) {
      this.#context = new AudioContext({ sampleRate: targetSampleRate });
    }
    return this.#context;
  }

  /**
   * Purpose: Ensure the master output gain is connected between the tracks and the destination.
   * How: Lazily create the GainNode and connect it to the context's destination, then project the
   *      current master level into it.
   */
  ensureMasterGain(context: AudioContext): GainNode {
    if (!this.#masterGain) {
      this.#masterGain = context.createGain();
      this.#masterGain.connect(context.destination);
    }
    this.syncMasterGain();
    return this.#masterGain;
  }

  /** Project the current demoState.masterLevel into the master gain node, if it exists. */
  syncMasterGain(): void {
    if (this.#masterGain) {
      this.#masterGain.gain.value = demoState.masterLevel;
    }
  }

  /** Reset the stored master level to default and re-project it into the gain node. */
  resetMasterLevel(): void {
    demoState.masterLevel = DEFAULT_MASTER_LEVEL;
    this.syncMasterGain();
  }

  // -------------------------------------------------------------------------
  // Silent keep-alive engine + deferred shutdown
  // -------------------------------------------------------------------------

  /** Cancel any deferred audio-context shutdown from a previous stop. */
  clearDeferredShutdown(): void {
    if (this.#shutdownTimeoutId !== null) {
      window.clearTimeout(this.#shutdownTimeoutId);
    }
    this.#shutdownTimeoutId = null;
  }

  /**
   * Purpose: Start a minimal silent Web Audio graph so browser audio playback is initialized.
   * How: Create or resume an AudioContext, then run a ConstantSourceNode through a zero-gain node to the destination.
   */
  async startSilent(): Promise<void> {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    this.clearDeferredShutdown();
    if (context.state === "suspended") {
      await context.resume();
    }
    if (this.#silentSource) {
      return;
    }

    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    const silentSource = context.createConstantSource();
    silentSource.offset.value = 0;
    silentSource.connect(silentGain);
    silentGain.connect(context.destination);
    silentSource.start();

    silentSource.onended = () => {
      if (this.#silentSource === silentSource) {
        this.#silentSource = null;
      }
      if (this.#silentGain === silentGain) {
        this.#silentGain = null;
      }
    };

    this.#silentGain = silentGain;
    this.#silentSource = silentSource;
  }

  /**
   * Purpose: Stop the current silent audio signal and suspend the audio context.
   * How: Stop and disconnect the constant source, disconnect the mute gain, and suspend the context if it is running.
   */
  stopSilent(): void {
    this.clearDeferredShutdown();
    if (this.#silentSource) {
      try {
        this.#silentSource.stop();
      } catch {
        // Ignore double-stop attempts when the source has already ended.
      }
      this.#silentSource.disconnect();
      this.#silentSource = null;
    }
    if (this.#silentGain) {
      this.#silentGain.disconnect();
      this.#silentGain = null;
    }
    if (this.#context?.state === "running") {
      const context = this.#context;
      this.#shutdownTimeoutId = window.setTimeout(() => {
        if (context.state === "running") {
          void context.suspend();
        }
        this.#shutdownTimeoutId = null;
      }, Math.ceil(START_STOP_FADE_SECONDS * 1000));
    }
  }

  // -------------------------------------------------------------------------
  // Sample-rate swap
  // -------------------------------------------------------------------------

  /**
   * Purpose: Tear down the current AudioContext when the project sample rate changed.
   * How: If the current context is already closed, clear the cached nodes. Otherwise,
   *      clear deferred shutdown, drop silent + master nodes, reset track players, and
   *      close the current context. The caller rebuilds players on the next scheduler
   *      wake-up.
   */
  async releaseIfSampleRateChanged(targetSampleRate: number): Promise<void> {
    const current = this.#context;
    if (!current) {
      return;
    }
    if (current.state === "closed") {
      this.#context = null;
      this.#masterGain = null;
      TrackAudio.resetPlayers();
      return;
    }
    if (current.sampleRate === targetSampleRate) {
      return;
    }

    this.clearDeferredShutdown();
    this.#silentSource = null;
    this.#silentGain = null;
    if (this.#masterGain) {
      this.#masterGain.disconnect();
      this.#masterGain = null;
    }
    this.#context = null;
    TrackAudio.resetPlayers();
    try {
      await current.close();
    } catch {
      // Ignore close failures; the session load can still proceed with a fresh context later.
    }
  }
}
