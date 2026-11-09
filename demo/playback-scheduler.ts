/***************************** playback-scheduler.ts **************************
 *
 * Purpose: Drive the per-track plan scheduler that bridges the transport cursor
 *          and the Web Audio clock. Given an active playback session, wakes
 *          each track periodically so its prepared next plan activates on
 *          time, retires its previous plan, and builds the successor. Also
 *          offers the two conversions between transport coordinates and
 *          AudioContext time used by the transport loop and by the session
 *          lifecycle code.
 * How: Exposed as a class so the interface — one internal scheduler timer,
 *      five public methods (step / stop / buildPlan / activatePlan /
 *      transportCoordAt), six private helpers — is visible at a glance. The
 *      scheduler reads `demoState.audio.context`, `demoState.playbackSession`,
 *      `demoState.trackPlayers`, `demoState.project`, and `demoState.viewport`
 *      directly. It does not own the session anchor; it runs as long as
 *      demoState.playbackSession is non-null and the transport is playing.
 *
 ******************************************************************************/
import type { Project } from "../src/domain/project.js";
import { clipEnd, getClipSourceStartSample } from "../src/domain/clip.js";
import { TRACK_IDS, type TrackId } from "../src/domain/track-id.js";
import { demoState } from "./state.js";
import { START_STOP_FADE_SECONDS } from "./audio-engine.js";
import { TrackAudio } from "./track/track-audio.js";
import type {
  TrackPlaybackEvent,
  TrackPlaybackPlan,
} from "./track/track-playback.js";

const MIN_PLAN_DURATION_SECONDS = 2;
const PLAN_ACTIVATION_LEAD_SECONDS = 1;
const SCHEDULER_PERIOD_MS = 250;

export class PlaybackScheduler {
  #timeoutId: number | null = null;

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Purpose: Keep the per-track plan scheduler alive while playback is active.
   * How: Convert the absolute audio clock to an integer transport position,
   *      wake each track player, and reschedule the next tick. Stops the
   *      scheduler if no playback session / audio context / playing transport.
   */
  step(): void {
    const audioContext = demoState.audio.context;
    if (!demoState.playbackSession.isActive || !audioContext || demoState.project.timeline.transport !== "Playing") {
      this.stop();
      return;
    }

    const currentTransportCoord = this.transportCoordAt(audioContext.currentTime);
    const minPlanDurationCoord = demoState.viewport.timeScale.toTimeCoord(MIN_PLAN_DURATION_SECONDS);
    const planActivationLeadCoord = demoState.viewport.timeScale.toTimeCoord(PLAN_ACTIVATION_LEAD_SECONDS);
    for (const trackId of TRACK_IDS) {
      this.#wakeTrack(trackId, currentTransportCoord, minPlanDurationCoord, planActivationLeadCoord);
    }

    // Keep the scheduler alive as long as the transport is playing, even when
    // all clips have ended. This lets effect tails (reverb, echo) decay
    // naturally through the still-connected audio graph.
    this.#timeoutId = window.setTimeout(() => this.step(), SCHEDULER_PERIOD_MS);
  }

  /** Stop the periodic tick and cancel every prepared or active track plan. */
  stop(): void {
    if (this.#timeoutId !== null) {
      window.clearTimeout(this.#timeoutId);
    }
    this.#timeoutId = null;
    this.#stopTrackPlayers();
  }

  /**
   * Purpose: Prepare a scheduled plan of Web Audio events for one track starting at `anchorTime`.
   * How: Walk the clips to collect buffer-source events covering at least `minDurationCoord`
   *      from the anchor, honoring the current playback clip filter, and return the plan
   *      (not yet activated on the audio graph).
   */
  buildPlan(
    track: Project["timeline"]["tracks"][number],
    anchorTime: number,
    minDurationCoord: number,
  ): TrackPlaybackPlan | null {
    const audioContext = demoState.audio.context;
    if (!audioContext) {
      return null;
    }

    let firstIndex = -1;
    for (let index = 0; index < track.clips.length; index += 1) {
      if (clipEnd(demoState.project, track.clips[index]!) > anchorTime) {
        firstIndex = index;
        break;
      }
    }
    if (firstIndex === -1) {
      return null;
    }

    const horizon = anchorTime + minDurationCoord;
    const events: TrackPlaybackEvent[] = [];
    let coveredUntil = anchorTime;
    for (let index = firstIndex; index < track.clips.length; index += 1) {
      const clip = track.clips[index]!;
      if (clip.start >= horizon && coveredUntil >= horizon) {
        break;
      }

      if (demoState.playSelection.clipFilter && !demoState.playSelection.clipFilter.has(clip.id)) {
        continue;
      }

      const audioBuffer = demoState.resources.getOrCreateAudioBuffer(clip.resource);
      if (!audioBuffer) {
        continue;
      }

      const effectiveStart = Math.max(anchorTime, clip.start);
      const effectiveStop = clipEnd(demoState.project, clip);
      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      const gain = audioContext.createGain();
      gain.gain.value = 0;

      events.push({
        clipId: clip.id,
        sourceNode,
        gain,
        startOffsetInPlan: effectiveStart - anchorTime,
        stopOffsetInPlan: effectiveStop - anchorTime,
        // Timeline coords -> resource frames (exact integer conversion, PLAYERSPEC):
        // coords equal frames only when internalTimeFactor === 1 (e.g. 48 kHz, not 44.1 kHz).
        offsetInBufferFrames: getClipSourceStartSample(clip) + Math.floor(
          (Math.max(effectiveStart - clip.start, 0) * clip.resource.sampleRate) / demoState.project.timebase.internalTimeRate,
        ),
      });
      coveredUntil = Math.max(coveredUntil, effectiveStop);
    }

    return {
      trackId: track.id,
      anchorTime,
      endTime: Math.max(anchorTime + minDurationCoord, coveredUntil),
      events,
      activated: false,
    };
  }

  /**
   * Purpose: Translate one prepared track plan into concrete scheduled Web Audio calls.
   * How: Convert the plan's integer offsets to absolute audio times, connect each node,
   *      apply gain ramps, and call start/stop once.
   */
  activatePlan(plan: TrackPlaybackPlan): void {
    const audioContext = demoState.audio.context;
    const trackOutputGain = TrackAudio.ensureOutputGain(plan.trackId, (ctx) => demoState.audio.ensureMasterGain(ctx));
    if (!audioContext || !demoState.playbackSession.isActive || !trackOutputGain || plan.activated) {
      return;
    }

    for (const event of plan.events) {
      const audioBuffer = event.sourceNode.buffer;
      if (!audioBuffer) {
        continue;
      }

      const startCoord = plan.anchorTime + event.startOffsetInPlan;
      const stopCoord = plan.anchorTime + event.stopOffsetInPlan;
      const startTime = this.#audioTimeAt(startCoord);
      const stopTime = this.#audioTimeAt(stopCoord);
      if (!(startTime < stopTime)) {
        continue;
      }

      const offsetSeconds = event.offsetInBufferFrames / audioBuffer.sampleRate;
      event.sourceNode.connect(event.gain);
      event.gain.connect(trackOutputGain);

      const duration = stopTime - startTime;
      const fadeDuration = Math.min(START_STOP_FADE_SECONDS, duration / 2);
      const fadeInEnd = startTime + fadeDuration;
      const fadeOutStart = stopTime - fadeDuration;
      event.gain.gain.setValueAtTime(0, startTime);
      event.gain.gain.linearRampToValueAtTime(1, fadeInEnd);
      event.gain.gain.setValueAtTime(1, fadeOutStart);
      event.gain.gain.linearRampToValueAtTime(0, stopTime);

      event.sourceNode.onended = () => {
        event.sourceNode.disconnect();
        event.gain.disconnect();
      };

      event.sourceNode.start(startTime, offsetSeconds, duration);
      event.sourceNode.stop(stopTime);
    }

    plan.activated = true;
  }

  /**
   * Purpose: Convert an AudioContext time to the corresponding transport coordinate for the active session.
   * How: Measure elapsed audio time since session start and map it to the project's internal timebase.
   */
  transportCoordAt(audioTime: number): number {
    const transportStart = demoState.playbackSession.transportStartCoord;
    const audioStart = demoState.playbackSession.audioStartTime;
    if (transportStart === null || audioStart === null) {
      return demoState.project.timeline.cursor;
    }
    return transportStart + demoState.viewport.timeScale.toTimeCoord(
      Math.max(audioTime - audioStart, 0),
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Purpose: Convert a transport coordinate to the corresponding AudioContext time in the active session.
   * How: Measure transport offset from session start and express it as real seconds on the audio clock.
   */
  #audioTimeAt(transportCoord: number): number {
    const transportStart = demoState.playbackSession.transportStartCoord;
    const audioStart = demoState.playbackSession.audioStartTime;
    if (transportStart === null || audioStart === null) {
      throw new Error("Invariant violation: missing playback session");
    }
    return audioStart + demoState.viewport.timeScale.fromTimeCoord(
      Math.max(transportCoord - transportStart, 0),
    );
  }

  /**
   * Purpose: Advance one track player's plan chain when its current plan approaches the activation lead threshold.
   * How: Activate the prepared next plan, move the current plan to the retiring list, and build a fresh successor.
   */
  #wakeTrack(
    trackId: TrackId,
    currentTransportCoord: number,
    minPlanDurationCoord: number,
    planActivationLeadCoord: number,
  ): void {
    const trackPlayer = demoState.trackPlayers.get(trackId);
    if (!trackPlayer) {
      return;
    }

    trackPlayer.retiringPlans = trackPlayer.retiringPlans.filter(
      (plan) => currentTransportCoord < this.#planReleaseTime(plan),
    );
    if (!trackPlayer.activePlan) {
      return;
    }

    if (
      trackPlayer.nextPlan
      && !trackPlayer.nextPlan.activated
      && currentTransportCoord >= trackPlayer.activePlan.endTime - planActivationLeadCoord
    ) {
      this.activatePlan(trackPlayer.nextPlan);
      trackPlayer.retiringPlans.push(trackPlayer.activePlan);
      trackPlayer.activePlan = trackPlayer.nextPlan;
      const track = demoState.project.timeline.tracks.find((candidate) => candidate.id === trackId);
      trackPlayer.nextPlan = track ? this.buildPlan(track, trackPlayer.activePlan.endTime, minPlanDurationCoord) : null;
      return;
    }

    if (currentTransportCoord >= this.#planAudioEndTime(trackPlayer.activePlan) && !trackPlayer.nextPlan) {
      trackPlayer.retiringPlans.push(trackPlayer.activePlan);
      trackPlayer.activePlan = null;
    }
  }

  #planAudioEndTime(plan: TrackPlaybackPlan): number {
    if (plan.events.length === 0) {
      return plan.anchorTime;
    }
    const lastEvent = plan.events[plan.events.length - 1]!;
    return plan.anchorTime + lastEvent.stopOffsetInPlan;
  }

  #planReleaseTime(plan: TrackPlaybackPlan): number {
    return this.#planAudioEndTime(plan) + demoState.viewport.timeScale.toTimeCoord(START_STOP_FADE_SECONDS);
  }

  /**
   * Purpose: Stop one prepared or active plan and release its Web Audio node references.
   * How: Fade out activated events briefly, stop them if possible, and disconnect all nodes.
   */
  #stopPlan(plan: TrackPlaybackPlan): void {
    const audioContext = demoState.audio.context;
    for (const event of plan.events) {
      if (plan.activated && audioContext) {
        const now = audioContext.currentTime;
        const stopTime = now + START_STOP_FADE_SECONDS;
        const gainParam = event.gain.gain as AudioParam & {
          cancelAndHoldAtTime?: (cancelTime: number) => void;
        };
        if (typeof gainParam.cancelAndHoldAtTime === "function") {
          gainParam.cancelAndHoldAtTime(now);
        } else {
          gainParam.cancelScheduledValues(now);
          gainParam.setValueAtTime(gainParam.value, now);
        }
        event.gain.gain.linearRampToValueAtTime(0, stopTime);
        try {
          event.sourceNode.stop(stopTime);
        } catch {
          // Ignore nodes that have already ended.
        }
      } else {
        event.sourceNode.disconnect();
        event.gain.disconnect();
      }
    }
  }

  /**
   * Purpose: Stop every plan owned by every track player and clear the plan state.
   * How: Stop active, next, and retiring plans; disconnect output chains on a delay;
   *      then rebuild the empty track-player map via TrackAudio.resetPlayers.
   */
  #stopTrackPlayers(): void {
    const outputGainsToDisconnect: GainNode[] = [];
    // effectInputGain feeds the persistent FX nodes: without an explicit
    // disconnect, each stop/restart would leave one more orphan GainNode
    // attached to the first effect of the chain.
    const effectInputGainsToDisconnect: GainNode[] = [];
    const outputPannersToDisconnect: StereoPannerNode[] = [];
    for (const trackPlayer of demoState.trackPlayers.values()) {
      if (trackPlayer.activePlan) {
        this.#stopPlan(trackPlayer.activePlan);
      }
      if (trackPlayer.nextPlan) {
        this.#stopPlan(trackPlayer.nextPlan);
      }
      for (const retiringPlan of trackPlayer.retiringPlans) {
        this.#stopPlan(retiringPlan);
      }
      if (trackPlayer.silentKeepAlive) {
        try { trackPlayer.silentKeepAlive.stop(); } catch { /* already stopped */ }
        trackPlayer.silentKeepAlive.disconnect();
        trackPlayer.silentKeepAlive = null;
      }
      if (trackPlayer.effectInputGain) {
        effectInputGainsToDisconnect.push(trackPlayer.effectInputGain);
      }
      if (trackPlayer.outputGain) {
        outputGainsToDisconnect.push(trackPlayer.outputGain);
      }
      if (trackPlayer.outputPanner) {
        outputPannersToDisconnect.push(trackPlayer.outputPanner);
      }
    }
    if (
      effectInputGainsToDisconnect.length > 0
      || outputGainsToDisconnect.length > 0
      || outputPannersToDisconnect.length > 0
    ) {
      window.setTimeout(() => {
        for (const effectInputGain of effectInputGainsToDisconnect) {
          effectInputGain.disconnect();
        }
        for (const outputGain of outputGainsToDisconnect) {
          outputGain.disconnect();
        }
        for (const outputPanner of outputPannersToDisconnect) {
          outputPanner.disconnect();
        }
      }, Math.ceil(START_STOP_FADE_SECONDS * 1000) + 100);
    }
    TrackAudio.resetPlayers();
  }
}
