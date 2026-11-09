/*************************** session-render-resource.ts ************************
 *
 * Purpose: Describe a dropped session render as a resource of the project's
 *          sample rate, the rate its audio is actually decoded at.
 * How: A session renders at its own sample rate (the source's). Dropped into
 *      a project of another rate, the WAV is decoded by the project's
 *      AudioContext, i.e. resampled to the project rate. The resource must
 *      describe that decoded buffer: every slice (split, merge, crossfade,
 *      transform, playback offset) counts frames of the resource and reads
 *      them from the buffer, and a reload rebuilds the resource from the
 *      buffer anyway. The source rate stays in the session-render link.
 *
 ******************************************************************************/

/**
 * Purpose: Length, in frames of the project rate, of a render of
 *          `renderLengthSamples` frames at `renderSampleRate`.
 * How: Same duration, rounded to the nearest frame (decodeAudioData's
 *      resampling may differ by one frame; the buffer is conformed to it).
 */
export function sessionRenderLengthAtRate(
  renderLengthSamples: number,
  renderSampleRate: number,
  targetSampleRate: number,
): number {
  if (renderSampleRate === targetSampleRate) {
    return renderLengthSamples;
  }
  return Math.max(1, Math.round((renderLengthSamples * targetSampleRate) / renderSampleRate));
}

/**
 * Purpose: Make a decoded render buffer exactly `length` frames long, so the
 *          resource and its buffer agree frame for frame.
 * How: Return the buffer unchanged when it already fits; otherwise copy it
 *      into a buffer of `length` frames (trailing zeros, or the last frames
 *      dropped: a rounding difference of about one frame).
 */
export function conformDecodedRenderLength(buffer: AudioBuffer, length: number): AudioBuffer {
  if (buffer.length === length) {
    return buffer;
  }
  const conformed = new AudioBuffer({ length, sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels });
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    conformed.copyToChannel(buffer.getChannelData(channel).subarray(0, length), channel);
  }
  return conformed;
}
