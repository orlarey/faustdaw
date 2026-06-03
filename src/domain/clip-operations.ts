/**
 * Purpose: Primitive clip-pair operations shared by higher-level selection
 *          transformations — concatenation (merge without fade) and linear
 *          crossfade. Both produce a single clip covering the timeline span
 *          of the two inputs, reusing or synthesizing a resource as needed.
 * How: Encapsulate the sample-level work (reading PCM, building a new
 *      resource, mixing ramps) behind a dependency-injected `ClipSampleDeps`
 *      so the domain layer never touches `demoState` directly. The caller
 *      (selection operations) just passes (project, a, b) and the primitive
 *      decides how to bounce PCM.
 *
 * Design notes:
 *   - `concatenateClips` has two paths. Fast path: when `b` is the exact
 *     sample-level continuation of `a` inside the same resource, the result
 *     is a simple re-slice with no PCM touched. General path: otherwise,
 *     read both slices, concatenate them in a fresh buffer, publish a new
 *     resource via `resourceSink`, and return a clip pointing to it.
 *   - `crossfadeClips` has *no* fast path: even when `a` and `b` share a
 *     resource, the overlap ramp needs to be materialized in a new buffer.
 *     Semantics: clip length is `|A| + |B| - D`, where `D = durationSamples`.
 *     The ramp runs over the last `D` samples of `A` and the first `D`
 *     samples of `B`, linear 0→1 / 1→0.
 *   - Both primitives assume their inputs are contiguous on the same track
 *     in the given project (i.e. `clipEnd(project, a) === b.start`). They
 *     do *not* validate this — the caller (contiguous-runs.ts) is the gate.
 *   - No knowledge of `Selection` here. These primitives live one level
 *     below the selection concept in the DAG so any future consumer
 *     (automated split, tests, …) can reuse them without dragging in the
 *     selection type.
 */
import { importAudioResource } from "./audio-resource.js";
import {
  getClipSourceLengthSamples,
  getClipSourceStartSample,
  placeClipInstance,
  removeClip,
  getClipTrackId,
} from "./clip.js";
import type { AudioResource } from "./audio-resource.js";
import type { Clip } from "./clip.js";
import type { ClipId, ResourceId } from "./identifiers.js";
import type { Project } from "./project.js";

/**
 * Purpose: Dependency bundle that grants `clip-operations.ts` access to
 *          PCM storage without hard-coding `demoState`.
 * How: Pair a read-only `sampleStore.read` (non-interleaved per-channel
 *      Float32 arrays, matching the Web Audio `AudioBuffer.getChannelData`
 *      convention) with a `resourceSink.create` that owns the full
 *      "publish a new resource into the project" workflow.
 */
export type ClipSampleDeps = {
  /**
   * Purpose: Read `length` PCM samples from a resource starting at
   *          `startSample`, returning one `Float32Array` per channel.
   * How: Backed by the external PCM store (e.g.
   *      `demoState.resourceAudioBuffers`). The returned array's outer
   *      length is the channel count — no separate parameter is needed.
   */
  readonly sampleStore: {
    read(
      resourceId: ResourceId,
      startSample: number,
      length: number,
    ): Float32Array[];
  };

  /**
   * Purpose: Publish a new `AudioResource` backed by the given PCM buffer.
   * How: Allocate a unique id, store the samples in the external PCM cache,
   *      import the resource into `project` via `importAudioResource`, and
   *      return the updated project paired with the newly-created resource
   *      record. Encapsulating the full workflow here avoids leaking
   *      "orphan" resources (registered in the PCM cache but missing from
   *      the project, or vice versa). `samples.length` is the channel count.
   */
  readonly resourceSink: {
    create(
      project: Project,
      samples: Float32Array[],
      sampleRate: number,
      name: string,
    ): { project: Project; resource: AudioResource };
  };
}

/**
 * Purpose: Result bundle returned by every clip-pair primitive.
 * How: Pair the updated project (clips removed/added, resource added on
 *      the general path) with the single clip record the primitive created.
 */
export type ClipPairResult = {
  readonly project: Project;
  readonly clip: Clip;
}

/**
 * Purpose: Concatenate two contiguous clips `a` and `b` from the same
 *          track into one clip covering `[a.start, clipEnd(b))`.
 * How: If `b` is a direct sample continuation of `a` inside the same
 *      resource, re-slice (fast path). Otherwise read both slices, stitch
 *      them together in a new buffer, publish it as a new resource, and
 *      return a clip anchored at `a.start`.
 */
export function concatenateClips(
  project: Project,
  a: Clip,
  b: Clip,
  deps: ClipSampleDeps,
  clipIdFactory: () => ClipId,
): ClipPairResult {
  const aStartSample = getClipSourceStartSample(a);
  const aLengthSamples = getClipSourceLengthSamples(a);
  const bStartSample = getClipSourceStartSample(b);
  const bLengthSamples = getClipSourceLengthSamples(b);
  const trackId = getClipTrackId(project, a.id);

  // Fast path: `b` is exactly the next slice of the same resource as `a`.
  // The merged clip is a metadata-only re-slice, no PCM copy needed —
  // this is the inverse of a prior split.
  if (
    a.resource.id === b.resource.id
    && bStartSample === aStartSample + aLengthSamples
  ) {
    let nextProject = removeClip(project, a.id);
    nextProject = removeClip(nextProject, b.id);
    const merged: Clip = {
      id: clipIdFactory(),
      resource: a.resource,
      start: a.start,
      sourceStartSample: aStartSample,
      sourceLengthSamples: aLengthSamples + bLengthSamples,
      ...(a.name ? { name: a.name } : {}),
    };
    nextProject = placeClipInstance(nextProject, merged, merged.start, trackId);
    return { project: nextProject, clip: merged };
  }

  // General path: read PCM from both clips, stitch into a new buffer,
  // publish a new resource, and point the merged clip at it.
  const aSamples = deps.sampleStore.read(a.resource.id, aStartSample, aLengthSamples);
  const bSamples = deps.sampleStore.read(b.resource.id, bStartSample, bLengthSamples);
  const channels = Math.max(aSamples.length, bSamples.length);
  const totalLength = aLengthSamples + bLengthSamples;
  const concatenated = allocateChannelBuffers(channels, totalLength);
  for (let ch = 0; ch < channels; ch++) {
    const out = concatenated[ch]!;
    const aCh = aSamples[ch] ?? aSamples[0]!;
    const bCh = bSamples[ch] ?? bSamples[0]!;
    out.set(aCh, 0);
    out.set(bCh, aLengthSamples);
  }

  const mergedName = buildPairName(a, b, "merge");
  const sink = deps.resourceSink.create(
    project,
    concatenated,
    a.resource.sampleRate,
    mergedName,
  );
  let nextProject = sink.project;
  nextProject = removeClip(nextProject, a.id);
  nextProject = removeClip(nextProject, b.id);
  const merged: Clip = {
    id: clipIdFactory(),
    resource: sink.resource,
    start: a.start,
    sourceStartSample: 0,
    sourceLengthSamples: totalLength,
    name: mergedName,
  };
  nextProject = placeClipInstance(nextProject, merged, merged.start, trackId);
  return { project: nextProject, clip: merged };
}

/**
 * Purpose: Crossfade two contiguous clips `a` and `b` on the same track
 *          into one clip covering `[a.start, clipEnd(b) - D)` where
 *          `D = durationSamples`, with a linear ramp over the overlap.
 * How: Always bounce a new PCM buffer — even when `a` and `b` share a
 *      resource — because the overlap region needs the ramp mix. The
 *      result has `N_a + N_b - D` samples.
 */
export function crossfadeClips(
  project: Project,
  a: Clip,
  b: Clip,
  durationSamples: number,
  deps: ClipSampleDeps,
  clipIdFactory: () => ClipId,
): ClipPairResult {
  const aStartSample = getClipSourceStartSample(a);
  const aLengthSamples = getClipSourceLengthSamples(a);
  const bStartSample = getClipSourceStartSample(b);
  const bLengthSamples = getClipSourceLengthSamples(b);
  const trackId = getClipTrackId(project, a.id);
  if (
    !Number.isFinite(durationSamples)
    || durationSamples <= 0
    || durationSamples > aLengthSamples
    || durationSamples > bLengthSamples
  ) {
    throw new Error(
      `Precondition violation: crossfade duration ${durationSamples} exceeds clip lengths (${aLengthSamples}, ${bLengthSamples})`,
    );
  }

  const aSamples = deps.sampleStore.read(a.resource.id, aStartSample, aLengthSamples);
  const bSamples = deps.sampleStore.read(b.resource.id, bStartSample, bLengthSamples);
  const channels = Math.max(aSamples.length, bSamples.length);
  const totalLength = aLengthSamples + bLengthSamples - durationSamples;
  const mixed = allocateChannelBuffers(channels, totalLength);

  // Ramp boundaries: the overlap spans samples [aLengthSamples - D, aLengthSamples)
  // of the output, where A's tail fades out and B's head fades in.
  const rampStart = aLengthSamples - durationSamples;
  for (let ch = 0; ch < channels; ch++) {
    const out = mixed[ch]!;
    const aCh = aSamples[ch] ?? aSamples[0]!;
    const bCh = bSamples[ch] ?? bSamples[0]!;

    // Pre-overlap: copy A verbatim.
    for (let i = 0; i < rampStart; i++) {
      out[i] = aCh[i]!;
    }
    // Overlap: linear mix (1 - t) * A + t * B.
    for (let i = 0; i < durationSamples; i++) {
      const t = i / durationSamples;
      const aSample = aCh[rampStart + i]!;
      const bSample = bCh[i]!;
      out[rampStart + i] = (1 - t) * aSample + t * bSample;
    }
    // Post-overlap: copy the rest of B.
    for (let i = durationSamples; i < bLengthSamples; i++) {
      out[rampStart + i] = bCh[i]!;
    }
  }

  const mergedName = buildPairName(a, b, "xfade");
  const sink = deps.resourceSink.create(
    project,
    mixed,
    a.resource.sampleRate,
    mergedName,
  );
  let nextProject = sink.project;
  nextProject = removeClip(nextProject, a.id);
  nextProject = removeClip(nextProject, b.id);
  const merged: Clip = {
    id: clipIdFactory(),
    resource: sink.resource,
    start: a.start,
    sourceStartSample: 0,
    sourceLengthSamples: totalLength,
    name: mergedName,
  };
  nextProject = placeClipInstance(nextProject, merged, merged.start, trackId);
  return { project: nextProject, clip: merged };
}

/**
 * Purpose: Reverse a single clip's audio, producing a new clip at the same
 *          timeline position with reversed PCM data.
 * How: Read the clip's sample slice, reverse each channel in-place, publish
 *      the reversed data as a new resource, and return a clip pointing to it.
 */
export function reverseClip(
  project: Project,
  clip: Clip,
  deps: ClipSampleDeps,
  clipIdFactory: () => ClipId,
): ClipPairResult {
  const startSample = getClipSourceStartSample(clip);
  const lengthSamples = getClipSourceLengthSamples(clip);
  const trackId = getClipTrackId(project, clip.id);

  const samples = deps.sampleStore.read(clip.resource.id, startSample, lengthSamples);
  for (let ch = 0; ch < samples.length; ch++) {
    samples[ch]!.reverse();
  }

  const reversedName = `${(clip.name ?? clip.resource.id).trim() || clip.resource.id} (rev)`;
  const sink = deps.resourceSink.create(project, samples, clip.resource.sampleRate, reversedName);
  let nextProject = sink.project;
  nextProject = removeClip(nextProject, clip.id);
  const reversed: Clip = {
    id: clipIdFactory(),
    resource: sink.resource,
    start: clip.start,
    sourceStartSample: 0,
    sourceLengthSamples: lengthSamples,
    name: reversedName,
  };
  nextProject = placeClipInstance(nextProject, reversed, reversed.start, trackId);
  return { project: nextProject, clip: reversed };
}

/**
 * Purpose: Replace a clip's audio with pre-computed samples. The result
 *          may differ in length from the original (e.g. reverb tail).
 * How: Publish the processed samples as a new resource, remove the
 *      original clip, and place a new clip at the same timeline position.
 *      Same structural pattern as `reverseClip`.
 */
export function replaceClipAudio(
  project: Project,
  clip: Clip,
  processedSamples: Float32Array[],
  deps: ClipSampleDeps,
  clipIdFactory: () => ClipId,
  resultName: string,
): ClipPairResult {
  const trackId = getClipTrackId(project, clip.id);
  const sampleRate = clip.resource.sampleRate;
  const totalLength = processedSamples[0]?.length ?? 0;

  const sink = deps.resourceSink.create(project, processedSamples, sampleRate, resultName);
  let nextProject = sink.project;
  nextProject = removeClip(nextProject, clip.id);
  const replaced: Clip = {
    id: clipIdFactory(),
    resource: sink.resource,
    start: clip.start,
    sourceStartSample: 0,
    sourceLengthSamples: totalLength,
    name: resultName,
  };
  nextProject = placeClipInstance(nextProject, replaced, replaced.start, trackId);
  return { project: nextProject, clip: replaced };
}

// Unused in this module directly but kept exported because selection
// operations reuse the convention when they need to import a resource
// prior to creating a clip pointing at it.
export { importAudioResource };

/**
 * Purpose: Allocate a non-interleaved PCM buffer with one Float32Array per channel.
 * How: Fill each channel slot with a zero-initialized Float32Array of the
 *      requested length. Extracted for readability at the two call sites.
 */
function allocateChannelBuffers(channels: number, lengthSamples: number): Float32Array[] {
  const buffers: Float32Array[] = new Array(channels);
  for (let ch = 0; ch < channels; ch++) {
    buffers[ch] = new Float32Array(lengthSamples);
  }
  return buffers;
}

/**
 * Purpose: Build a readable name for a clip produced from two inputs.
 * How: Combine the two source clip names (or resource ids as fallback)
 *      with a tag that indicates the primitive that produced the result.
 */
function buildPairName(a: Clip, b: Clip, tag: "merge" | "xfade"): string {
  const aName = (a.name ?? a.resource.id).trim() || a.resource.id;
  const bName = (b.name ?? b.resource.id).trim() || b.resource.id;
  return `${aName}+${bName} (${tag})`;
}
