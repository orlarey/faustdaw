/******************************* bench-hooks.ts ********************************
 *
 * Purpose: Give the browser benchmarks (benchmarks/*.spec.ts) a dense project
 *          without going through the import UI: `window.__webdawBench`.
 * How: `generateClips` builds a project of `count` clips spread round-robin
 *      over the fixed tracks, each `minLength..maxLength` seconds long with
 *      `gap` seconds between consecutive clips of a track (the lengths follow
 *      the deterministic sequence of the Node benchmark, scripts/bench.mjs).
 *      The clips share a small pool of test-tone resources, whose audio
 *      buffers and waveform pyramids are built here so that waveforms are
 *      drawn, then the project replaces the current one and is rendered.
 *      Compiled with the demo, so a refactor that breaks it breaks the build
 *      rather than silently breaking the benchmarks.
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import { importAudioResource, type AudioResource } from "../src/domain/audio-resource.js";
import { placeClip } from "../src/domain/clip.js";
import { initProject } from "../src/domain/project.js";
import { TRACK_IDS } from "../src/domain/track-id.js";
import { demoState } from "./state.js";
import { render } from "./daw-render/daw-render-runtime.js";
import { buildWaveformPyramid } from "./waveform.js";

/** The shape of a generated project. */
export type BenchClipOptions = {
  count: number;
  minLength: number;
  maxLength: number;
  gap: number;
  /** Distinct resources the clips share (each clip uses a slice of one). */
  resources: number;
};

const DEFAULT_OPTIONS: BenchClipOptions = { count: 2000, minLength: 0.1, maxLength: 2, gap: 0.2, resources: 16 };
const TONE_HZ = 220;

/** A stereo test tone of `length` frames, as an AudioBuffer built without an audio context. */
function toneBuffer(length: number, sampleRate: number, harmonic: number): AudioBuffer {
  const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let frame = 0; frame < length; frame += 1) {
      const envelope = 1 - frame / length;
      data[frame] = 0.5 * envelope * Math.sin((2 * Math.PI * TONE_HZ * harmonic * frame) / sampleRate);
    }
  }
  return buffer;
}

/**
 * Purpose: Replace the current project by a dense generated one and render it.
 * How: See the file header. Returns the number of clips placed.
 */
export function generateBenchClips(elements: Elements, partial: Partial<BenchClipOptions> = {}): number {
  const options = { ...DEFAULT_OPTIONS, ...partial };
  const base = initProject(demoState.project.id);
  base.timebase = demoState.project.timebase;
  const sampleRate = base.timebase.sampleRate;
  let project = base;

  const resources: AudioResource[] = [];
  for (let index = 0; index < options.resources; index += 1) {
    const length = Math.ceil(options.maxLength * sampleRate);
    const resource: AudioResource = { id: `bench-${index}`, sampleRate, channels: 2, length };
    const buffer = toneBuffer(length, sampleRate, 1 + (index % 4));
    project = importAudioResource(project, resource);
    demoState.resources.audioBuffers.set(resource.id, buffer);
    demoState.resources.cacheWaveformPyramid(resource.id, buildWaveformPyramid(buffer));
    resources.push(resource);
  }

  const lengthRange = Math.max(options.maxLength - options.minLength, 0);
  const cursors = new Map(TRACK_IDS.map((trackId) => [trackId, 0]));
  for (let index = 0; index < options.count; index += 1) {
    const trackId = TRACK_IDS[index % TRACK_IDS.length]!;
    const ratio = ((index * 37) % 1000) / 1000;
    const lengthSamples = Math.max(1, Math.round((options.minLength + lengthRange * ratio) * sampleRate));
    const resource = resources[index % resources.length]!;
    const start = cursors.get(trackId) ?? 0;
    const placed = placeClip(project, `bench-clip-${index}`, resource, start, trackId);
    // Slice the shared resource to the clip length (placeClip places the whole resource).
    const track = placed.timeline.tracks.find((candidate) => candidate.id === trackId)!;
    const clips = track.clips.map((clip) => (
      clip.id === `bench-clip-${index}` ? { ...clip, sourceStartSample: 0, sourceLengthSamples: lengthSamples } : clip
    ));
    project = {
      ...placed,
      timeline: {
        ...placed.timeline,
        tracks: placed.timeline.tracks.map((candidate) => (candidate.id === trackId ? { ...candidate, clips } : candidate)),
      },
    };
    const durationCoord = Math.round((lengthSamples / sampleRate) * project.timebase.internalTimeRate);
    cursors.set(trackId, start + durationCoord + project.timebase.toTimeCoord(options.gap));
  }

  demoState.project = project;
  demoState.clipRenderStable.dirty = true;
  render(elements);
  return options.count;
}

/**
 * Purpose: Expose the benchmark hooks on the window.
 * How: `__webdawBench.generateClips(options)`, `__webdawBench.clipCount()`.
 */
export function installBenchHooks(elements: Elements): void {
  (globalThis as typeof globalThis & {
    __webdawBench?: {
      generateClips: (options?: Partial<BenchClipOptions>) => number;
      clipCount: () => number;
    };
  }).__webdawBench = {
    generateClips: (options) => generateBenchClips(elements, options),
    clipCount: () => demoState.project.timeline.tracks.reduce((total, track) => total + track.clips.length, 0),
  };
}
