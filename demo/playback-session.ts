/****************************** playback-session.ts ***************************
 *
 * Purpose: Own the lifecycle of one playback run bound to the Web Audio clock.
 *          Holds the anchor that maps the transport cursor to the audio
 *          reference time, and exposes the three operations that drive it —
 *          start, stop, restartIfNeeded.
 * How: Implemented as a class so the interface is readable at a glance.
 *      The anchor is private; the scheduler and transport-loop read
 *      `transportStartCoord` / `audioStartTime` via getters. start() resets
 *      effect runtimes, rebuilds per-track plans via the scheduler, and
 *      kicks the scheduler tick. stop() stops the scheduler and clears the
 *      anchor. restartIfNeeded() is the idempotent re-sync used by edit
 *      gestures (clip drag, ruler) when the timeline cursor or content
 *      changes during playback.
 *
 ******************************************************************************/
import type { TimeCoord } from "../src/domain/timebase.js";
import { TRACK_IDS } from "../src/domain/track-id.js";
import { demoState } from "./state.js";
import { clearAllEffectRuntimes } from "./fx-chain/fx-chain-runtime.js";
import { TrackAudio } from "./track/track-audio.js";
import type { PlaybackSessionAnchor } from "./track/track-playback.js";
import { View } from "./view/view.js";

const MIN_PLAN_DURATION_SECONDS = 2;

export class PlaybackSession {
  #anchor: PlaybackSessionAnchor | null = null;

  // -------------------------------------------------------------------------
  // Read access
  // -------------------------------------------------------------------------

  get isActive(): boolean {
    return this.#anchor !== null;
  }

  get transportStartCoord(): TimeCoord | null {
    return this.#anchor?.transportStartCoord ?? null;
  }

  get audioStartTime(): number | null {
    return this.#anchor?.audioStartTime ?? null;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Purpose: Bind the current playback run to the audio clock and start periodic scheduling.
   * How: Reset any prior session, create a fresh anchor from the current cursor and audio
   *      time, then build + activate the initial per-track plans and step the scheduler.
   *      `resetEffects` defaults to true so a fresh playback starts from clean DSP state ;
   *      pass `false` for soft restarts (e.g. loop iterations) so reverb tails and delay
   *      lines continue across the wrap.
   */
  start(options: { resetEffects?: boolean } = {}): void {
    const { resetEffects = true } = options;
    const audioContext = demoState.audio.context;
    this.stop();
    demoState.transportLoop.resetTimingCounters();
    View.resetRulerPanAccumulator();
    if (!audioContext || audioContext.state !== "running" || demoState.project.timeline.transport !== "Playing") {
      return;
    }

    if (resetEffects) clearAllEffectRuntimes();
    this.#anchor = {
      transportStartCoord: demoState.project.timeline.cursor,
      audioStartTime: audioContext.currentTime,
    };
    TrackAudio.resetPlayers();

    // Ensure every track has an audio output chain (including the silent
    // keep-alive source) so that effect tails keep processing after clips end.
    for (const trackId of TRACK_IDS) {
      TrackAudio.ensureOutputGain(trackId, (ctx) => demoState.audio.ensureMasterGain(ctx));
    }

    const minPlanDurationCoord = demoState.viewport.timeScale.toTimeCoord(MIN_PLAN_DURATION_SECONDS);
    for (const track of demoState.project.timeline.tracks) {
      const trackPlayer = demoState.trackPlayers.get(track.id);
      if (!trackPlayer) {
        continue;
      }

      const activePlan = demoState.scheduler.buildPlan(track, demoState.project.timeline.cursor, minPlanDurationCoord);
      if (!activePlan) {
        continue;
      }
      demoState.scheduler.activatePlan(activePlan);
      trackPlayer.activePlan = activePlan;
      trackPlayer.nextPlan = demoState.scheduler.buildPlan(track, activePlan.endTime, minPlanDurationCoord);
    }
    demoState.scheduler.step();
  }

  /** Stop the scheduler and clear the anchor. */
  stop(): void {
    demoState.scheduler.stop();
    this.#anchor = null;
  }

  /** Rebind playback to the current cursor after a discrete timeline edit during playback. */
  restartIfNeeded(): void {
    if (demoState.project.timeline.transport !== "Playing") {
      return;
    }
    this.start();
  }
}
