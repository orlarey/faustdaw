/**************************** track/track-activity.ts ****************************
 *
 * Purpose: Estimate one track's current visual activity level from playback and waveform state.
 * How: Resolve the active clip on the track, sample the finest waveform buckets around the
 *      current play position, then fold the result with the live track gain.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { TrackId } from "../../src/domain/track-id.js";
import {
  findActiveClipInTrack,
  getClipSourceLengthSamples,
  getClipSourceStartSample,
} from "../../src/domain/clip.js";
import { demoState } from "../state.js";
import { getTrackEffectiveGain } from "./track-runtime.js";

// Purpose: Estimate one track activity value from the cached waveform envelope instead of real-time audio analysis.
// How: Sample the finest available pyramid buckets around the current play position, then combine that amplitude with the track gain.
export function estimateTrackActivityLevel(project: Project, trackId: TrackId): number {
  const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    return 0;
  }

  const activeClip = findActiveClipInTrack(project, track.clips, project.timeline.cursor);
  if (!activeClip) {
    return 0;
  }

  // In play-selection mode, only selected clips contribute to the meter.
  if (demoState.playSelection.clipFilter && !demoState.playSelection.clipFilter.has(activeClip.id)) {
    return 0;
  }

  const pyramid = demoState.resources.waveformPyramids.get(activeClip.resource.id);
  const finestLevel = pyramid?.levels[0];
  if (!finestLevel || finestLevel.mins.length === 0) {
    return 0.2;
  }

  const clipOffsetCoord = project.timeline.cursor - activeClip.start;
  const clipOffsetFrames = Math.floor((clipOffsetCoord / project.timebase.internalTimeRate) * activeClip.resource.sampleRate);
  const clipSourceStartSample = getClipSourceStartSample(activeClip);
  const clipSourceLengthSamples = getClipSourceLengthSamples(activeClip);
  const clampedFrameIndex = Math.max(
    clipSourceStartSample,
    Math.min(clipSourceStartSample + clipSourceLengthSamples - 1, clipSourceStartSample + clipOffsetFrames),
  );
  const bucketIndex = Math.max(
    0,
    Math.min(
      finestLevel.mins.length - 1,
      Math.floor(clampedFrameIndex / finestLevel.samplesPerBucket),
    ),
  );

  let amplitude = 0;
  const bucketStart = Math.max(0, bucketIndex - 1);
  const bucketEnd = Math.min(finestLevel.mins.length - 1, bucketIndex + 1);
  for (let index = bucketStart; index <= bucketEnd; index += 1) {
    amplitude = Math.max(
      amplitude,
      Math.abs(finestLevel.mins[index] ?? 0),
      Math.abs(finestLevel.maxs[index] ?? 0),
      Math.abs(finestLevel.means[index] ?? 0),
    );
  }

  const trackGain = getTrackEffectiveGain(trackId);
  const gainedAmplitude = Math.max(0, Math.min(1, amplitude * trackGain));
  return Math.pow(gainedAmplitude, 0.6);
}
