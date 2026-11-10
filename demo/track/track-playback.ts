/**************************** track-playback.ts *******************************
 *
 * Purpose: Types and tuning for live track playback — playback sessions,
 *          scheduled audio events, per-track playback plans, and per-track
 *          player mix/solo/mute state plus audio-graph node slots.
 * How: Declare the playback-related types and the default track/master gain
 *      constants. Mutable instances live on demoState (for now); the
 *      operations that build and drive these plans live in track/*, notably
 *      track-audio.ts and track-runtime.ts.
 *
 ******************************************************************************/
import type { TimeCoord } from "../../src/domain/timebase.js";
import { TRACK_IDS, type TrackId } from "../../src/domain/track-id.js";

/**
 * Purpose: The anchor data for one active playback session bound to the audio
 *          clock. Owned by the PlaybackSession class in demo/playback-session.ts;
 *          exported here because the type predates the class extraction and is
 *          referenced by track-playback consumers.
 * How: Map one transport coordinate to one audio reference time; the scheduler
 *      uses these two points to convert between the transport and the audio
 *      clock.
 */
export type PlaybackSessionAnchor = {
  transportStartCoord: TimeCoord;
  audioStartTime: number;
};

/**
 * Purpose: Represent one already-prepared audio event inside a track playback plan.
 * How: Store the precreated source/gain nodes together with the exact integer offsets that define this playback slice.
 */
export type TrackPlaybackEvent = {
  clipId: string;
  sourceNode: AudioBufferSourceNode;
  gain: GainNode;
  startOffsetInPlan: TimeCoord;
  stopOffsetInPlan: TimeCoord;
  offsetInBufferFrames: number;
  /** True iff playback enters this clip mid-way (Play/Seek inside it): the only start that gets a fade-in (PLAYERSPEC, Septième Décision). */
  fadeIn: boolean;
};

/**
 * Purpose: Represent one bounded prepared playback plan for a track.
 * How: Store its temporal coverage, ordered prepared events, and whether it has already been scheduled on the audio clock.
 */
export type TrackPlaybackPlan = {
  trackId: TrackId;
  anchorTime: TimeCoord;
  endTime: TimeCoord;
  events: TrackPlaybackEvent[];
  activated: boolean;
  /** Loop iteration the plan belongs to (PlaybackSession.scheduleLoopWrap); absent outside loops. */
  loopIteration?: number;
};

/**
 * Purpose: Keep the live playback planning state of one track.
 * How: Store the currently active plan, the next prepared plan, and any retiring plans that are still fading out.
 */
export type TrackPlayerState = {
  level: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  effectInputGain: GainNode | null;
  outputGain: GainNode | null;
  outputPanner: StereoPannerNode | null;
  silentKeepAlive: ConstantSourceNode | null;
  activePlan: TrackPlaybackPlan | null;
  nextPlan: TrackPlaybackPlan | null;
  retiringPlans: TrackPlaybackPlan[];
};

// ---------------------------------------------------------------------------
// Default levels
// ---------------------------------------------------------------------------

export const TRACK_COUNT = TRACK_IDS.length;
export const DEFAULT_TRACK_LEVEL = 10 ** (-3 / 20);
export const DEFAULT_MASTER_LEVEL = 1;
