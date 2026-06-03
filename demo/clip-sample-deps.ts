/******************************* clip-sample-deps.ts ***************************
 *
 * Purpose: Build a `ClipSampleDeps` bundle backed by the demo PCM cache so
 *          selection operations can read clip samples and publish processed
 *          outputs as new audio resources.
 * How: `sampleStore.read` slices the cached AudioBuffer for a resource id
 *      into per-channel Float32Arrays. `resourceSink.create` materializes a
 *      new AudioBuffer, registers all companion view-state caches (PCM,
 *      source bytes, waveform pyramid, retention), and imports the resource
 *      into the provided project.
 *
 * Uniqueness note: the id allocator checks the **passed** project, not
 * `demoState.project`, because callers fold operations over successive
 * intermediate projects that may already contain freshly-created resources.
 *
 ******************************************************************************/
import type { ClipSampleDeps } from "../src/domain/clip-operations.js";
import { importAudioResource, type AudioResource } from "../src/domain/audio-resource.js";
import { demoState, type ImportedResourceSource } from "./state.js";
import { audioBufferToWavBytes } from "./session-archive.js";
import { buildWaveformPyramid } from "./waveform.js";

function createGeneratedWavResourceSource(
  fileName: string,
  fileBytes: Uint8Array,
  lastModified = Date.now(),
): ImportedResourceSource {
  return {
    fileName,
    mimeType: "audio/wav",
    lastModified,
    bytes: fileBytes,
  };
}

export function makeClipSampleDeps(): ClipSampleDeps {
  return {
    sampleStore: {
      read(resourceId, startSample, length) {
        const buffer = demoState.resources.audioBuffers.get(resourceId);
        if (!buffer) {
          throw new Error(`Audio for resource "${resourceId}" is not loaded`);
        }
        const channels: Float32Array[] = [];
        for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
          const source = buffer.getChannelData(ch).subarray(startSample, startSample + length);
          channels.push(new Float32Array(source));
        }
        return channels;
      },
    },
    resourceSink: {
      create(project, samples, sampleRate, name) {
        const audioContext = demoState.audio.context ?? demoState.audio.ensureContext();
        if (!audioContext) {
          throw new Error("Web Audio is not available in this browser");
        }
        const channelCount = samples.length;
        const lengthSamples = samples[0]?.length ?? 0;
        if (channelCount === 0 || lengthSamples === 0) {
          throw new Error("Cannot publish an empty resource");
        }
        const buffer = audioContext.createBuffer(channelCount, lengthSamples, sampleRate);
        for (let ch = 0; ch < channelCount; ch += 1) {
          buffer.getChannelData(ch).set(samples[ch]!);
        }
        const baseName = name.trim() || `resource-${project.resources.size + 1}`;
        let resourceId = baseName;
        let suffix = 2;
        while (project.resources.has(resourceId)) {
          resourceId = `${baseName}-${suffix}`;
          suffix += 1;
        }
        const resource: AudioResource = {
          id: resourceId,
          sampleRate,
          channels: channelCount,
          length: lengthSamples,
        };
        const nextProject = importAudioResource(project, resource);
        demoState.resources.audioBuffers.set(resourceId, buffer);
        demoState.resources.sourceFiles.set(
          resourceId,
          createGeneratedWavResourceSource(`${resourceId}.wav`, audioBufferToWavBytes(buffer)),
        );
        demoState.resources.sessionRenders.delete(resourceId);
        demoState.resources.retainedIds.add(resourceId);
        demoState.resources.cacheWaveformPyramid(resourceId, buildWaveformPyramid(buffer));
        return { project: nextProject, resource };
      },
    },
  };
}
