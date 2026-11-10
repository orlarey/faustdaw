/**************************** audio-param-smoothing.ts *************************
 *
 * Purpose: Change a mixer parameter (track gain, mute, solo, pan, master
 *          level) during playback without a click.
 * How: Writing `param.value` is a step from one sample to the next: on a
 *      sustained sound, muting jumped 0.3 between two samples (a click,
 *      where the sound itself never moves more than 0.05). While the context
 *      runs, approach the target instead with setTargetAtTime (time constant
 *      PARAM_SMOOTHING_SECONDS: 95 % in 15 ms). When the context does not run
 *      (nothing is heard), or for nodes just created (their default value
 *      must never be heard: a muted track would leak its first milliseconds),
 *      set the value at once.
 *
 ******************************************************************************/

/** Time constant of the approach to a new mixer value (seconds). */
export const PARAM_SMOOTHING_SECONDS = 0.005;

/** Set `param` to `value` at once, dropping any approach in progress. */
export function setParamImmediately(param: AudioParam, value: number): void {
  param.cancelScheduledValues(0);
  param.value = value;
}

/** Move `param` to `value` without a step while `context` runs; at once otherwise. */
export function setParamSmoothly(param: AudioParam, value: number, context: BaseAudioContext): void {
  if (context.state !== "running") {
    setParamImmediately(param, value);
    return;
  }
  param.setTargetAtTime(value, context.currentTime, PARAM_SMOOTHING_SECONDS);
}
