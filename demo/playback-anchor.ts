/******************************* playback-anchor.ts ****************************
 *
 * Purpose: Place a playback run on the audio clock so that every source
 *          starts exactly where it should, relative to the others.
 * How: Two pure functions.
 *      - playbackAnchorTime: the audio time the start cursor maps to. It lies
 *        a lead ahead of currentTime: by the time start() calls reach the
 *        render thread, it has moved past currentTime, and Web Audio starts a
 *        past `when` at once without advancing the offset, so the sources
 *        sounding at the start would begin late while those scheduled later
 *        stay exact (tracks drift apart). It is rounded up to a whole frame,
 *        so every event of the run lands on a whole frame too.
 *      - scheduledAudioTime: anchor + offset, moved SCHEDULE_FRAME_BIAS of a
 *        frame earlier. An event meant for frame N must not land at N + ε
 *        (floating-point rounding of seconds). The source itself starts
 *        sub-sample accurately at N, but its event gain is created at 0 and
 *        raised by setValueAtTime(1, t), and an AudioParam event takes effect
 *        at the first frame whose time is >= t (Web Audio spec): at N + ε the
 *        gain is still 0 on frame N, so the clip's first sample is lost (a
 *        one-sample hole where split halves rejoin). At N - 1e-4 the step
 *        takes effect on frame N; the source's sub-sample interpolation this
 *        implies is 1e-4 of a frame (-80 dB), far above the rounding error of
 *        the sum (~1e-8 frame after an hour at 48 kHz).
 *
 ******************************************************************************/

/** Lead between a (re)start and the audio time of the start cursor. */
export const PLAYBACK_START_LEAD_SECONDS = 0.03;

/** Fraction of a frame every scheduled time is moved earlier by. */
export const SCHEDULE_FRAME_BIAS = 1e-4;

export function playbackAnchorTime(currentTime: number, sampleRate: number, leadSeconds: number): number {
  return Math.ceil((currentTime + leadSeconds) * sampleRate) / sampleRate;
}

export function scheduledAudioTime(anchorTime: number, offsetSeconds: number, sampleRate: number): number {
  return anchorTime + offsetSeconds - SCHEDULE_FRAME_BIAS / sampleRate;
}
