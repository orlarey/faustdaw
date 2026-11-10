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
import type { PlaybackSessionAnchor, TrackPlaybackPlan } from "./track/track-playback.js";
import { View } from "./view/view.js";
import { PLAYBACK_START_LEAD_SECONDS, playbackAnchorTime } from "./playback-anchor.js";

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
   *      lines continue across the wrap. `leadSeconds` (see playback-anchor.ts) keeps
   *      every source start in the future; plans are built before the anchor is taken
   *      so the lead only has to cover the hop to the render thread.
   */
  start(options: { resetEffects?: boolean; leadSeconds?: number } = {}): void {
    const { resetEffects = true, leadSeconds = PLAYBACK_START_LEAD_SECONDS } = options;
    const audioContext = demoState.audio.context;
    this.stop();
    demoState.transportLoop.resetTimingCounters();
    View.resetRulerPanAccumulator();
    if (!audioContext || audioContext.state !== "running" || demoState.project.timeline.transport !== "Playing") {
      return;
    }

    if (resetEffects) clearAllEffectRuntimes();
    TrackAudio.resetPlayers();

    // Ensure every track has an audio output chain (including the silent
    // keep-alive source) so that effect tails keep processing after clips end.
    for (const trackId of TRACK_IDS) {
      TrackAudio.ensureOutputGain(trackId, (ctx) => demoState.audio.ensureMasterGain(ctx));
    }

    const minPlanDurationCoord = demoState.viewport.timeScale.toTimeCoord(MIN_PLAN_DURATION_SECONDS);
    const activePlans: TrackPlaybackPlan[] = [];
    for (const track of demoState.project.timeline.tracks) {
      const trackPlayer = demoState.trackPlayers.get(track.id);
      if (!trackPlayer) {
        continue;
      }

      const activePlan = demoState.scheduler.buildPlan(track, demoState.project.timeline.cursor, minPlanDurationCoord);
      if (!activePlan) {
        continue;
      }
      trackPlayer.activePlan = activePlan;
      trackPlayer.nextPlan = demoState.scheduler.buildPlan(track, activePlan.endTime, minPlanDurationCoord);
      activePlans.push(activePlan);
    }

    this.#anchor = {
      transportStartCoord: demoState.project.timeline.cursor,
      audioStartTime: playbackAnchorTime(audioContext.currentTime, audioContext.sampleRate, leadSeconds),
    };
    for (const activePlan of activePlans) {
      demoState.scheduler.activatePlan(activePlan);
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
