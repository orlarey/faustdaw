/************************ waveform-view/waveform-painter.ts ************************
 *
 * Purpose: Paint waveform content for already projected clip render models.
 * How: Resize one waveform canvas, choose detailed or envelope rendering, and
 *      draw waveforms plus onset markers without owning any scrolling state.
 *
 ******************************************************************************/
import { type ClipRenderModel } from "../clip/clip.js";
import { measurePerf, recordPerfCounter } from "../perf.js";
import { getRasterCanvasContext, prepareRasterCanvas } from "../raster-canvas.js";
import { demoState } from "../state.js";
import type {
  ResourceWaveformTextureBank,
  WaveformLevel,
  WaveformPyramid,
  WaveformTextureLevel,
} from "./waveform-types.js";
import type { ExactTimelineScale } from "../time-scale.js";
import { logWaveformBackendChoice } from "../timeline/timeline-debug.js";
import {
  getExactWaveformBucketSizeSamples,
  getWaveformEnvelopeLevel,
  getWaveformTextureLevel,
  shouldRenderDetailedWaveform,
} from "../waveform.js";
import {
  drawEnvelopeWaveformsWithGpu,
  getWaveformGpuMaxTextureWidth,
  type GpuEnvelopeWaveformJob,
} from "../waveform-gpu.js";

const WAVEFORM_MEAN_POLYLINE_MAX_BUCKET_SAMPLES = 60;

export function prepareWaveformCanvas(
  canvas: HTMLCanvasElement,
  widthPx: number,
  heightPx: number,
): CanvasRenderingContext2D | null {
  return prepareRasterCanvas(canvas, widthPx, heightPx);
}

export function getWaveformCanvasContext(
  canvas: HTMLCanvasElement,
  widthPx: number,
  heightPx: number,
  clear: boolean,
): CanvasRenderingContext2D | null {
  return getRasterCanvasContext(canvas, widthPx, heightPx, clear);
}

/**
 * Purpose: Read one mono-projected sample from a multi-channel AudioBuffer.
 * How: Arithmetic mean across channels — same projection as the pyramid's
 *      `buildWaveformLevelFromChannels`, so detailed and envelope renderers
 *      operate on identical data.
 */
function getDetailedWaveformSample(audioBuffer: AudioBuffer, frameIndex: number): number {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  let sum = 0;
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    sum += audioBuffer.getChannelData(channel)[frameIndex] ?? 0;
  }
  return sum / channelCount;
}

/**
 * Purpose: Draw the detailed regime as a polyline that walks every visible
 *          source sample, capturing peaks correctly even when several
 *          samples land in the same pixel (samplesPerPixel up to
 *          `WAVEFORM_DETAIL_MAX_SAMPLES_PER_PIXEL` ≈ 12).
 * How: Translate the visible clip range into source frame indices, then
 *      iterate frame-by-frame over `[startFrame, endFrame)`. Each sample
 *      contributes one polyline vertex projected through clip-space. At
 *      samplesPerPixel close to 1 the result is identical to a one-vertex-
 *      per-pixel render ; at higher ratios the vertex density inside each
 *      pixel column produces a thicker line that mirrors the actual
 *      oscillations rather than the aliased per-pixel sample previously
 *      picked.
 */
function drawDetailedClipWaveform(
  context: CanvasRenderingContext2D,
  audioBuffer: AudioBuffer,
  model: ClipRenderModel,
  canvasWidthPx: number,
): void {
  const innerLeftPx = model.leftPx;
  const innerTopPx = model.topPx + 4;
  const innerWidthPx = Math.max(model.widthPx, 0);
  const innerHeightPx = Math.max(model.heightPx - 8, 0);
  const sourceLengthSamples = Math.max(model.sourceLengthSamples, 0);
  if (innerWidthPx <= 1 || innerHeightPx <= 1 || sourceLengthSamples <= 0) {
    return;
  }

  const centerYPx = innerTopPx + innerHeightPx / 2;
  const amplitudeScale = innerHeightPx * 0.42;
  const visibleLeftPx = Math.max(innerLeftPx, 0);
  const visibleRightPx = Math.min(innerLeftPx + innerWidthPx, canvasWidthPx);
  const visibleWidthPx = visibleRightPx - visibleLeftPx;
  if (visibleWidthPx <= 1) {
    return;
  }

  const visibleStartRatio = (visibleLeftPx - innerLeftPx) / innerWidthPx;
  const visibleEndRatio = (visibleRightPx - innerLeftPx) / innerWidthPx;
  const startFrame = Math.max(
    0,
    Math.floor(model.sourceStartSample + visibleStartRatio * sourceLengthSamples) - 1,
  );
  const endFrame = Math.min(
    audioBuffer.length,
    Math.ceil(model.sourceStartSample + visibleEndRatio * sourceLengthSamples) + 1,
  );
  if (endFrame <= startFrame) return;

  const sampleCount = endFrame - startFrame;
  recordPerfCounter("render.timeline.waveforms.detailed.samples", sampleCount);
  const xOriginPx = innerLeftPx - (model.sourceStartSample / sourceLengthSamples) * innerWidthPx;
  const xPerSample = innerWidthPx / sourceLengthSamples;

  // Hoist channel arrays outside the per-frame loop : at 12 samples/pixel
  // this saves ~12 getChannelData() calls per displayed pixel.
  const channelCount = audioBuffer.numberOfChannels;
  const channels: Float32Array[] = new Array(channelCount);
  for (let c = 0; c < channelCount; c += 1) {
    channels[c] = audioBuffer.getChannelData(c);
  }

  context.beginPath();
  const monoDivisor = Math.max(1, channelCount);
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    let sum = 0;
    for (let c = 0; c < channelCount; c += 1) {
      sum += channels[c]?.[frame] ?? 0;
    }
    const sample = sum / monoDivisor;
    const x = xOriginPx + frame * xPerSample;
    const y = centerYPx - sample * amplitudeScale;
    if (frame === startFrame) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

/**
 * Purpose: Render the envelope sub-regime as a single closed `band` rather
 *          than N independent vertical bars. This removes the « peigne »
 *          artefact at small bucket sizes (sPB=2, 3, 4, …) and keeps a
 *          stable amplitude visual at any bucket size — adjacent buckets
 *          are connected by polyline edges so the silhouette evolves
 *          smoothly even when the data oscillates rapidly.
 * How: For each visible bucket walk the top edge `centerY − max·scale`
 *      forward, then the bottom edge `centerY − min·scale` backward, close
 *      the path, and fill. The fill colour reuses the caller's stroke
 *      colour so the band picks up the standard waveform tint without
 *      requiring a separate fillStyle setup site.
 */
function drawEnvelopeBandClipWaveform(
  context: CanvasRenderingContext2D,
  pyramid: WaveformPyramid,
  textureBank: ResourceWaveformTextureBank | null,
  model: ClipRenderModel,
  bucketSizeSamples: number,
  canvasWidthPx: number,
): void {
  const innerLeftPx = model.leftPx;
  const innerTopPx = model.topPx + 4;
  const innerWidthPx = Math.max(model.widthPx, 0);
  const innerHeightPx = Math.max(model.heightPx - 8, 0);
  const totalFrames = model.sourceLengthSamples;
  if (innerWidthPx <= 1 || innerHeightPx <= 1 || pyramid.levels.length === 0 || totalFrames <= 0) {
    return;
  }

  const level = getWaveformEnvelopeLevel(bucketSizeSamples, pyramid);
  if (!level) {
    return;
  }
  const textureLevel = textureBank ? getWaveformTextureLevel(bucketSizeSamples, textureBank) : null;
  const centerYPx = innerTopPx + innerHeightPx / 2;
  const amplitudeScale = innerHeightPx * 0.42;
  const activeBucketSizeSamples = textureLevel?.bucketSizeSamples ?? level.samplesPerBucket;
  const bucketCount = textureLevel?.bucketCount ?? level.mins.length;
  const clipSourceStartSample = model.sourceStartSample;
  const clipSourceEndSample = clipSourceStartSample + totalFrames;
  const visibleLeftPx = Math.max(innerLeftPx, 0);
  const visibleRightPx = Math.min(innerLeftPx + innerWidthPx, canvasWidthPx);
  if (visibleRightPx - visibleLeftPx <= 1) {
    return;
  }

  const firstBucket = Math.max(
    0,
    Math.floor((clipSourceStartSample + ((visibleLeftPx - innerLeftPx) / innerWidthPx) * totalFrames) / activeBucketSizeSamples),
  );
  const lastBucketExclusive = Math.min(
    bucketCount,
    Math.ceil((clipSourceStartSample + ((visibleRightPx - innerLeftPx) / innerWidthPx) * totalFrames) / activeBucketSizeSamples),
  );
  const visibleBucketCount = Math.max(0, lastBucketExclusive - firstBucket);
  recordPerfCounter("render.timeline.waveforms.envelope.buckets", visibleBucketCount);
  if (visibleBucketCount <= 0) return;

  const packedMinMax = textureLevel?.packedMinMax ?? null;
  const previousFillStyle = context.fillStyle;
  context.fillStyle = context.strokeStyle;
  context.beginPath();
  // Top edge — forward through max[i].
  for (let bucketIndex = firstBucket; bucketIndex < lastBucketExclusive; bucketIndex += 1) {
    const bucketCenterSample = Math.min(
      clipSourceEndSample,
      Math.max(clipSourceStartSample, bucketIndex * activeBucketSizeSamples + activeBucketSizeSamples * 0.5),
    ) - clipSourceStartSample;
    const x = innerLeftPx + (bucketCenterSample / totalFrames) * innerWidthPx;
    const packedIndex = bucketIndex * 2;
    const max = packedMinMax ? (packedMinMax[packedIndex + 1] ?? 0) : (level.maxs[bucketIndex] ?? 0);
    const yTop = centerYPx - max * amplitudeScale;
    if (bucketIndex === firstBucket) context.moveTo(x, yTop);
    else context.lineTo(x, yTop);
  }
  // Bottom edge — backward through min[i].
  for (let bucketIndex = lastBucketExclusive - 1; bucketIndex >= firstBucket; bucketIndex -= 1) {
    const bucketCenterSample = Math.min(
      clipSourceEndSample,
      Math.max(clipSourceStartSample, bucketIndex * activeBucketSizeSamples + activeBucketSizeSamples * 0.5),
    ) - clipSourceStartSample;
    const x = innerLeftPx + (bucketCenterSample / totalFrames) * innerWidthPx;
    const packedIndex = bucketIndex * 2;
    const min = packedMinMax ? (packedMinMax[packedIndex] ?? 0) : (level.mins[bucketIndex] ?? 0);
    const yBottom = centerYPx - min * amplitudeScale;
    context.lineTo(x, yBottom);
  }
  context.closePath();
  context.fill();
  context.fillStyle = previousFillStyle;
}

function drawClipOnsetMarkersToContext(
  context: CanvasRenderingContext2D,
  models: readonly ClipRenderModel[],
  canvasWidthPx: number,
): void {
  context.save();
  context.strokeStyle = "rgba(250, 244, 168, 0.9)";
  context.lineWidth = 1;
  for (const model of models) {
    if (!model.onsetSamples || model.onsetSamples.length === 0 || model.widthPx <= 2 || model.heightPx <= 6) {
      continue;
    }
    const visibleLeftPx = Math.max(model.leftPx, 0);
    const visibleRightPx = Math.min(model.leftPx + model.widthPx, canvasWidthPx);
    if (visibleRightPx - visibleLeftPx <= 1 || model.sourceLengthSamples <= 0) {
      continue;
    }
    context.save();
    context.beginPath();
    context.rect(model.leftPx, model.topPx, Math.max(model.widthPx, 0), Math.max(model.heightPx, 0));
    context.clip();
    for (const onsetSample of model.onsetSamples) {
      if (onsetSample <= 0 || onsetSample >= model.sourceLengthSamples) {
        continue;
      }
      const x = model.leftPx + (onsetSample / model.sourceLengthSamples) * model.widthPx;
      if (x < visibleLeftPx || x > visibleRightPx) {
        continue;
      }
      context.beginPath();
      context.moveTo(x, model.topPx + 2);
      context.lineTo(x, model.topPx + model.heightPx - 2);
      context.stroke();
    }
    context.restore();
  }
  context.restore();
}

export function drawClipWaveformsToContext(
  context: CanvasRenderingContext2D,
  models: readonly ClipRenderModel[],
  canvasWidthPx: number,
  renderScale: ExactTimelineScale,
  mode: "auto" | "envelope" = "auto",
): void {
  type EnvelopeWaveformJob = {
    model: ClipRenderModel;
    pyramid: WaveformPyramid;
    textureBank: ResourceWaveformTextureBank | null;
    bucketSizeSamples: number;
    gpuJob: GpuEnvelopeWaveformJob | null;
  };

  context.lineWidth = 1;
  context.strokeStyle = "rgba(255, 244, 244, 0.9)";
  const gpuEnvelopeJobs: GpuEnvelopeWaveformJob[] = [];
  const gpuEnvelopeFallbackJobs: EnvelopeWaveformJob[] = [];

  for (const model of models) {
    const audioBuffer = demoState.resources.audioBuffers.get(model.resourceId);
    if (!audioBuffer || audioBuffer.length <= 0 || model.widthPx <= 1) {
      continue;
    }
    const pyramid = demoState.resources.waveformPyramids.get(model.resourceId);
    const textureBank = demoState.resources.waveformTextureBanks.get(model.resourceId) ?? null;
    const samplesPerPixel = renderScale.zoomSamples / renderScale.zoomPixels;
    const exactBucketSizeSamples = getExactWaveformBucketSizeSamples(
      renderScale.zoomPixels,
      renderScale.zoomSamples,
    );
    const shouldForceEnvelope = mode === "envelope" && exactBucketSizeSamples !== null;
    const envelopeBucketSizeSamples = exactBucketSizeSamples ?? 1;
    const exactEnvelopeLevel = exactBucketSizeSamples !== null && pyramid
      ? pyramid.levels.find((level) => level.samplesPerBucket === exactBucketSizeSamples) ?? null
      : null;

    // The detailed regime fires when the zoom is fine enough (few enough
    // samples per device pixel) OR as a fallback when the envelope pyramid
    // level isn't built yet (the worker is still computing). Audio samples
    // are always available synchronously, so detailed is a safe fallback.
    const envelopeAvailable = pyramid !== undefined && exactEnvelopeLevel !== null;
    const useDetailed = !shouldForceEnvelope
      && (exactBucketSizeSamples === null || shouldRenderDetailedWaveform(samplesPerPixel));
    const envelopeFallbackToDetailed = !useDetailed && !envelopeAvailable;

    if (useDetailed || envelopeFallbackToDetailed) {
      logWaveformBackendChoice(model, "cpu-detailed", {
        selected: model.isSelected,
        textureLevelAvailable: false,
        bucketSizeSamples: exactBucketSizeSamples,
        activeBucketSizeSamples: null,
      });
      context.save();
      context.beginPath();
      context.rect(model.leftPx, model.topPx, Math.max(model.widthPx, 0), Math.max(model.heightPx, 0));
      context.clip();
      recordPerfCounter("render.timeline.waveforms.detailed.clips", 1);
      measurePerf("render.timeline.waveforms.detailed.draw", () => {
        drawDetailedClipWaveform(context, audioBuffer, model, canvasWidthPx);
      });
      context.restore();
      continue;
    }

    if (!pyramid || !exactEnvelopeLevel) {
      logWaveformBackendChoice(model, "pending-envelope", {
        selected: model.isSelected,
        textureLevelAvailable: false,
        bucketSizeSamples: exactBucketSizeSamples,
        activeBucketSizeSamples: null,
      });
      continue;
    }

    const textureLevel = textureBank ? getWaveformTextureLevel(envelopeBucketSizeSamples, textureBank) : null;
    const activeBucketSizeSamples = textureLevel?.bucketSizeSamples ?? envelopeBucketSizeSamples;
    // The GPU min/max shader is delegated to once the bucket size is large
    // enough that a CPU band fill becomes the slower path. We also reject
    // jobs whose `bucketCount` overflows a single texture row : `texImage2D`
    // silently zero-fills oversized widths, which would draw a flat-zero
    // waveform — better to fall through to the CPU band renderer.
    const gpuMaxTextureWidth = getWaveformGpuMaxTextureWidth();
    const gpuEligible = !demoState.devFlags.disableGpuWaveform
      && model.sourceStartSample === 0
      && model.sourceLengthSamples === audioBuffer.length
      && textureLevel
      && textureLevel.bucketCount <= gpuMaxTextureWidth
      && activeBucketSizeSamples > WAVEFORM_MEAN_POLYLINE_MAX_BUCKET_SAMPLES;
    const envelopeJob: EnvelopeWaveformJob = {
      model,
      pyramid,
      textureBank,
      bucketSizeSamples: envelopeBucketSizeSamples,
      gpuJob: gpuEligible
        ? {
            resourceId: model.resourceId,
            textureLevel: textureLevel!,
            totalFrames: audioBuffer.length,
            leftPx: model.leftPx,
            topPx: model.topPx,
            widthPx: model.widthPx,
            heightPx: model.heightPx,
          }
        : null,
    };

    if (envelopeJob.gpuJob) {
      logWaveformBackendChoice(model, "gpu-envelope-minmax", {
        selected: model.isSelected,
        textureLevelAvailable: textureLevel !== null,
        bucketSizeSamples: envelopeBucketSizeSamples,
        activeBucketSizeSamples,
      });
      gpuEnvelopeJobs.push(envelopeJob.gpuJob);
      gpuEnvelopeFallbackJobs.push(envelopeJob);
      recordPerfCounter("render.timeline.waveforms.envelope.gpu.clips", 1);
      continue;
    }

    logWaveformBackendChoice(model, "cpu-envelope-minmax", {
      selected: model.isSelected,
      textureLevelAvailable: textureLevel !== null,
      bucketSizeSamples: envelopeBucketSizeSamples,
      activeBucketSizeSamples,
    });
    context.save();
    context.beginPath();
    context.rect(model.leftPx, model.topPx, Math.max(model.widthPx, 0), Math.max(model.heightPx, 0));
    context.clip();
    recordPerfCounter("render.timeline.waveforms.envelope.clips", 1);
    measurePerf("render.timeline.waveforms.envelope.draw", () => {
      drawEnvelopeBandClipWaveform(
        context,
        envelopeJob.pyramid,
        envelopeJob.textureBank,
        envelopeJob.model,
        envelopeJob.bucketSizeSamples,
        canvasWidthPx,
      );
    });
    context.restore();
  }

  if (gpuEnvelopeJobs.length === 0) {
    drawClipOnsetMarkersToContext(context, models, canvasWidthPx);
    return;
  }

  const canvasHeightPx = context.canvas.height / Math.max(window.devicePixelRatio || 1, 1);
  const renderedWithGpu = measurePerf("render.timeline.waveforms.envelope.gpu.draw", () =>
    drawEnvelopeWaveformsWithGpu(context, canvasWidthPx, canvasHeightPx, gpuEnvelopeJobs),
  );
  if (renderedWithGpu) {
    drawClipOnsetMarkersToContext(context, models, canvasWidthPx);
    return;
  }

  for (const envelopeJob of gpuEnvelopeFallbackJobs) {
    logWaveformBackendChoice(envelopeJob.model, "cpu-envelope-minmax", {
      selected: envelopeJob.model.isSelected,
      textureLevelAvailable: envelopeJob.textureBank !== null,
      bucketSizeSamples: envelopeJob.bucketSizeSamples,
      activeBucketSizeSamples: envelopeJob.bucketSizeSamples,
    });
    context.save();
    context.beginPath();
    context.rect(
      envelopeJob.model.leftPx,
      envelopeJob.model.topPx,
      Math.max(envelopeJob.model.widthPx, 0),
      Math.max(envelopeJob.model.heightPx, 0),
    );
    context.clip();
    recordPerfCounter("render.timeline.waveforms.envelope.clips", 1);
    measurePerf("render.timeline.waveforms.envelope.draw", () => {
      drawEnvelopeBandClipWaveform(
        context,
        envelopeJob.pyramid,
        envelopeJob.textureBank,
        envelopeJob.model,
        envelopeJob.bucketSizeSamples,
        canvasWidthPx,
      );
    });
    context.restore();
  }
  drawClipOnsetMarkersToContext(context, models, canvasWidthPx);
}
