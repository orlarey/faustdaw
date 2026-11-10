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
import { PLAYBACK_START_LEAD_SECONDS, loopWrapAudioTime, playbackAnchorTime, scheduledAudioTime } from "./playback-anchor.js";

const MIN_PLAN_DURATION_SECONDS = 2;

export class PlaybackSession {
  #anchor: PlaybackSessionAnchor | null = null;
  // Between scheduleLoopWrap and the wrap itself, #anchor already maps the
  // next iteration (for scheduling) while the cursor still follows `previous`.
  #pendingWrap: { audioTime: number; previous: PlaybackSessionAnchor } | null = null;
  #loopIteration = 0;

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

  /** True between scheduleLoopWrap and the audio time of the wrap. */
  get hasPendingLoopWrap(): boolean {
    return this.#pendingWrap !== null;
  }

  /**
   * Purpose: The anchor that maps `audioTime` to the cursor shown to the user.
   * How: Before a pre-scheduled loop wrap, the iteration that is still sounding
   *      (`previous`); from the wrap on, the current anchor. Clears the pending
   *      wrap once `audioTime` has reached it.
   */
  displayAnchorAt(audioTime: number): PlaybackSessionAnchor | null {
    const pending = this.#pendingWrap;
    if (pending) {
      if (audioTime < pending.audioTime) {
        return pending.previous;
      }
      this.#pendingWrap = null;
    }
    return this.#anchor;
  }

  /** Audio time (no schedule bias) at which `coord` plays under the current anchor. */
  audioTimeOfCoord(coord: TimeCoord): number | null {
    const anchor = this.#anchor;
    if (!anchor) {
      return null;
    }
    return anchor.audioStartTime + demoState.viewport.timeScale.fromTimeCoord(coord - anchor.transportStartCoord);
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
    this.#pendingWrap = null;
  }

  /**
   * Purpose: Schedule the next loop iteration to start exactly where the current
   *          one ends, instead of stopping and restarting once the wrap is seen.
   * How: The wrap is the audio time of `loopEndCoord` under the current anchor,
   *      on a whole frame. The anchor moves to (loopStartCoord, wrap) and the
   *      next iteration's plans are built and activated against it now, so their
   *      sources start sample-exactly at the wrap. The plans still sounding keep
   *      playing (anything they hold past the wrap is stopped at the wrap) and
   *      are kept for Stop; those of the iteration before have ended and are
   *      released. Effect runtimes are untouched, so tails continue.
   *      Returns false when there is nothing to schedule against.
   */
  scheduleLoopWrap(loopStartCoord: TimeCoord, loopEndCoord: TimeCoord): boolean {
    const audioContext = demoState.audio.context;
    const anchor = this.#anchor;
    if (!audioContext || !anchor || this.#pendingWrap) {
      return false;
    }
    const sampleRate = audioContext.sampleRate;
    const timeScale = demoState.viewport.timeScale;
    const wrapAudioTime = loopWrapAudioTime(
      anchor.audioStartTime,
      timeScale.fromTimeCoord(loopEndCoord - anchor.transportStartCoord),
      sampleRate,
    );
    const wrapStopTime = scheduledAudioTime(wrapAudioTime, 0, sampleRate);
    const endingIteration = this.#loopIteration;
    const nextIteration = endingIteration + 1;

    const minPlanDurationCoord = timeScale.toTimeCoord(MIN_PLAN_DURATION_SECONDS);
    const newPlans: TrackPlaybackPlan[] = [];
    for (const track of demoState.project.timeline.tracks) {
      const trackPlayer = demoState.trackPlayers.get(track.id);
      if (!trackPlayer) {
        continue;
      }
      // Plans from before the ending iteration have finished: release them.
      trackPlayer.retiringPlans = trackPlayer.retiringPlans.filter(
        (plan) => (plan.loopIteration ?? endingIteration) >= endingIteration,
      );
      for (const plan of [trackPlayer.activePlan, trackPlayer.nextPlan]) {
        if (!plan) {
          continue;
        }
        if (!plan.activated) {
          // Prepared but never scheduled: its nodes were never connected.
          continue;
        }
        plan.loopIteration ??= endingIteration;
        // Nothing of the ending iteration may sound past the wrap.
        for (const event of plan.events) {
          const stopAudioTime = scheduledAudioTime(
            anchor.audioStartTime,
            timeScale.fromTimeCoord(Math.max(plan.anchorTime + event.stopOffsetInPlan - anchor.transportStartCoord, 0)),
            sampleRate,
          );
          if (stopAudioTime > wrapStopTime) {
            try {
              event.sourceNode.stop(wrapStopTime);
            } catch {
              // Already stopped or never started.
            }
          }
        }
        trackPlayer.retiringPlans.push(plan);
      }
      trackPlayer.activePlan = null;
      trackPlayer.nextPlan = null;
      const activePlan = demoState.scheduler.buildPlan(track, loopStartCoord, minPlanDurationCoord);
      if (!activePlan) {
        continue;
      }
      activePlan.loopIteration = nextIteration;
      trackPlayer.activePlan = activePlan;
      trackPlayer.nextPlan = demoState.scheduler.buildPlan(track, activePlan.endTime, minPlanDurationCoord);
      if (trackPlayer.nextPlan) {
        trackPlayer.nextPlan.loopIteration = nextIteration;
      }
      newPlans.push(activePlan);
    }

    this.#pendingWrap = { audioTime: wrapAudioTime, previous: anchor };
    this.#anchor = { transportStartCoord: loopStartCoord, audioStartTime: wrapAudioTime };
    this.#loopIteration = nextIteration;
    for (const plan of newPlans) {
      demoState.scheduler.activatePlan(plan);
    }
    return true;
  }

  /** Rebind playback to the current cursor after a discrete timeline edit during playback. */
  restartIfNeeded(): void {
    if (demoState.project.timeline.transport !== "Playing") {
      return;
    }
    this.start();
  }
}
