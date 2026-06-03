/****************************** resource-storage.ts ***************************
 *
 * Purpose: Group every per-resource data the demo caches in memory: the decoded
 *          audio buffers, the original imported file payloads, the session-
 *          render linkage metadata, the waveform pyramids, the waveform GPU
 *          texture banks, the set of resource ids retained across archive
 *          round-trips, and the reverse index from imported file signature to
 *          resource id used for dedup. Also hosts the two shared write paths:
 *          `getOrCreateAudioBuffer` (playback-ready buffer with test-tone
 *          fallback) and `cacheWaveformPyramid` (pyramid + derived GPU
 *          texture bank).
 * How: Implemented as a class so the interface (seven per-resource maps
 *      + two write methods) reads at a glance. The maps stay publicly
 *      readable — consumers do `demoState.resources.audioBuffers.get(id)`
 *      everywhere — but all mutations go through instance methods (for
 *      the pyramid / audio-buffer caches) or through the map's own API
 *      (for the other caches).
 *
 ******************************************************************************/
import type { AudioResource } from "../src/domain/audio-resource.js";
import type { SessionRenderResourceLink } from "./session-archive.js";
import type { ImportedResourceSource } from "./state.js";
import { demoState } from "./state.js";
import { invalidateWaveformSlidingBuffers } from "./daw-render/daw-render-runtime.js";
import { buildWaveformPyramid, buildWaveformTextureBank } from "./waveform.js";
import type { ResourceWaveformTextureBank, WaveformPyramid } from "./waveform-view/waveform-types.js";

const TEST_TONE_FREQUENCY_HZ = 1000;
const TEST_TONE_AMPLITUDE = 0.2;

export class ResourceStorage {
  /** Decoded PCM audio data for each imported or rendered resource. */
  audioBuffers: Map<string, AudioBuffer> = new Map();
  /** Original file bytes + metadata so archives can round-trip the original asset. */
  sourceFiles: Map<string, ImportedResourceSource> = new Map();
  /** For resources rendered from another session, the linkage back to that session. */
  sessionRenders: Map<string, SessionRenderResourceLink> = new Map();
  /** Pre-computed multi-resolution waveform data for each resource. */
  waveformPyramids: Map<string, WaveformPyramid> = new Map();
  /** GPU texture banks derived from each pyramid, used by the waveform renderer. */
  waveformTextureBanks: Map<string, ResourceWaveformTextureBank> = new Map();
  /** Ids marked to survive archive round-trips even if the current document no longer references them. */
  retainedIds: Set<string> = new Set();
  /** Reverse lookup: imported file signature -> existing resource id, used to dedup re-imports. */
  importedBySignature: Map<string, string> = new Map();

  /**
   * Purpose: Resolve one resource to a playback-ready AudioBuffer.
   * How: Reuse a decoded imported buffer when available, otherwise synthesize a
   *      test-tone buffer from the resource dimensions (used when the source file
   *      is missing — e.g. a generated or not-yet-decoded resource). The result
   *      is cached both as buffer and as a fresh waveform pyramid.
   */
  getOrCreateAudioBuffer(resource: AudioResource): AudioBuffer | null {
    const audioContext = demoState.audio.context;
    if (!audioContext) {
      return null;
    }

    const cached = this.audioBuffers.get(resource.id);
    if (cached) {
      return cached;
    }

    const buffer = audioContext.createBuffer(resource.channels, resource.length, resource.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const channelData = buffer.getChannelData(channel);
      for (let frame = 0; frame < channelData.length; frame += 1) {
        channelData[frame] = TEST_TONE_AMPLITUDE * Math.sin((2 * Math.PI * TEST_TONE_FREQUENCY_HZ * frame) / resource.sampleRate);
      }
    }
    this.audioBuffers.set(resource.id, buffer);
    this.cacheWaveformPyramid(resource.id, buildWaveformPyramid(buffer));
    return buffer;
  }

  /**
   * Purpose: Store a waveform pyramid for one resource and derive its GPU
   *          texture bank in one shot. Also invalidates the waveform sliding
   *          buffers so the next render frame picks up the new pyramid.
   */
  cacheWaveformPyramid(resourceId: string, pyramid: WaveformPyramid): void {
    this.waveformPyramids.set(resourceId, pyramid);
    this.waveformTextureBanks.set(resourceId, buildWaveformTextureBank(pyramid));
    invalidateWaveformSlidingBuffers();
  }
}
