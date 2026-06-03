/**************************** clip-render-model.ts ****************************
 *
 * Purpose: Build immutable clip render models from project and timeline state.
 * How: Read clip/session/selection state once, then project one clip into
 *      pixel geometry and derived labels without mutating rendering layers.
 *
 ******************************************************************************/
import type { Project } from "../../src/domain/project.js";
import type { TrackId } from "../../src/domain/track-id.js";
import {
  clipEnd,
  getClipSourceLengthSamples,
  getClipSourceStartSample,
} from "../../src/domain/clip.js";
import { formatCurrentAbsoluteTimeLabel } from "../format.js";
import { trackIdToIndex } from "../track/track-order.js";
import type { TimelineProjection } from "../timeline/timeline-projection.js";
import type { ClipPresentationInputs } from "./clip-presentation-inputs.js";

// Purpose: Represent one fully projected clip block ready for DOM or canvas rendering.
// How: Store clip identity, source slice, labels, geometry, and selection/session flags derived from one immutable snapshot.
// @invariant: widthPx >= 0, heightPx >= 0, and leftPx/topPx are expressed in render-window pixels.
export type ClipRenderModel = {
  id: string;
  resourceId: string;
  sourceStartSample: number;
  sourceLengthSamples: number;
  onsetSamples: readonly number[] | null;
  titleText: string;
  metaText: string;
  startLabel: string;
  endLabel: string;
  leftPx: number;
  widthPx: number;
  topPx: number;
  heightPx: number;
  isDragging: boolean;
  isSelected: boolean;
  isDimmed: boolean;
  isCompact: boolean;
  isMicro: boolean;
  isSessionRender: boolean;
  isSessionRenderLinked: boolean;
  isSessionRenderStale: boolean;
  isTransformTarget: boolean;
  isSessionRenderPending: boolean;
};

export type ClipRenderPresentation = {
  onsetSamples: readonly number[] | null;
  titleText: string;
  metaText: string;
  startLabel: string;
  endLabel: string;
  isSelected: boolean;
  isDimmed: boolean;
  isSessionRender: boolean;
  isSessionRenderLinked: boolean;
  isSessionRenderStale: boolean;
  isTransformTarget: boolean;
  isSessionRenderPending: boolean;
};

// Purpose: Resolve the non-geometric presentation derived from one clip at one effective placement.
// How: Look up session-link, onset-preview, selection, and label state from the provided inputs so raster and model paths share one source of truth.
export function resolveClipRenderPresentation(
  current: Project,
  clip: Project["timeline"]["tracks"][number]["clips"][number],
  effectiveStart: number,
  pixelsPerSample: number,
  inputs: ClipPresentationInputs,
): ClipRenderPresentation {
  const clipDurationCoord = clipEnd(current, clip) - clip.start;
  const clipEndCoord = effectiveStart + clipDurationCoord;
  const sessionRender = inputs.sessionRenderResources.get(clip.resource.id) ?? null;
  const onsetPreview = inputs.clipOnsetEditorState?.clipId === clip.id
    ? inputs.clipOnsetEditorState.previewAnnotation
    : null;
  const onsetAnnotation = onsetPreview ?? inputs.clipOnsetAnnotations.get(clip.id) ?? null;
  const linkedWorkspaceSession = sessionRender ? inputs.workspaceSessions.get(sessionRender.sourceSessionId) ?? null : null;
  const isSessionRenderLinked = linkedWorkspaceSession !== null;
  const isSessionRenderStale = sessionRender !== null
    && linkedWorkspaceSession !== null
    && linkedWorkspaceSession.sessionRevision !== sessionRender.sourceSessionRevision;
  const isSessionRenderPending = sessionRender !== null
    && !inputs.resourceSourceFiles.has(clip.resource.id)
    && !inputs.resourceAudioBuffers.has(clip.resource.id);
  const baseName = clip.name?.trim() || (sessionRender ? sessionRender.sourceSessionName : clip.resource.id);
  const audioBuffer = inputs.resourceAudioBuffers.get(clip.resource.id);
  const channelTag = audioBuffer ? (audioBuffer.numberOfChannels >= 2 ? "[S]" : "[M]") : "";
  const titleText = channelTag ? `${channelTag} ${baseName}` : baseName;
  const startLabel = formatCurrentAbsoluteTimeLabel(effectiveStart, current.timebase, pixelsPerSample);
  const endLabel = formatCurrentAbsoluteTimeLabel(clipEndCoord, current.timebase, pixelsPerSample);
  const metaParts = [`${startLabel} -> ${endLabel}`];
  if (sessionRender) {
    metaParts.push(
      isSessionRenderPending
        ? "pending"
        : !isSessionRenderLinked
        ? "unlinked"
        : isSessionRenderStale
        ? "linked · stale"
        : "linked · sync",
    );
  }

  return {
    onsetSamples: onsetAnnotation?.onsetSamples ?? null,
    titleText,
    metaText: metaParts.join(" • "),
    startLabel,
    endLabel,
    isSelected: inputs.selectedClipIds.has(clip.id),
    isDimmed: inputs.playbackClipFilter !== null && !inputs.playbackClipFilter.has(clip.id),
    isSessionRender: sessionRender !== null,
    isTransformTarget: inputs.transformPreviewClipId === clip.id,
    isSessionRenderLinked,
    isSessionRenderStale,
    isSessionRenderPending,
  };
}

// Purpose: Build the render model for one clip from the current viewport geometry.
// How: Project the clip start/end onto the render window, then derive labels and session-link flags from the provided presentation inputs.
export function buildClipRenderModel(
  current: Project,
  clip: Project["timeline"]["tracks"][number]["clips"][number],
  effectiveStart: number,
  effectiveTrackId: TrackId,
  projection: TimelineProjection,
  renderStartCoord: number,
  inputs: ClipPresentationInputs,
): ClipRenderModel {
  const clipDurationCoord = clipEnd(current, clip) - clip.start;
  const leftPx = (effectiveStart - renderStartCoord) * projection.pixelsPerCoord;
  const widthPx = Math.max(clipDurationCoord * projection.pixelsPerCoord, 0);
  const heightPx = Math.max(projection.laneHeightPx - 16, 0);
  const trackIndex = trackIdToIndex.get(effectiveTrackId) ?? 0;
  const topPx = trackIndex * projection.laneHeightPx + Math.max((projection.laneHeightPx - heightPx) / 2, 0);
  const presentation = resolveClipRenderPresentation(
    current,
    clip,
    effectiveStart,
    projection.pixelsPerSample(current.timebase),
    inputs,
  );

  return {
    id: clip.id,
    resourceId: clip.resource.id,
    sourceStartSample: getClipSourceStartSample(clip),
    sourceLengthSamples: getClipSourceLengthSamples(clip),
    onsetSamples: presentation.onsetSamples,
    titleText: presentation.titleText,
    metaText: presentation.metaText,
    startLabel: presentation.startLabel,
    endLabel: presentation.endLabel,
    leftPx,
    widthPx,
    topPx,
    heightPx,
    isDragging: false,
    isSelected: presentation.isSelected,
    isDimmed: presentation.isDimmed,
    isCompact: false,
    isMicro: false,
    isTransformTarget: presentation.isTransformTarget,
    isSessionRender: presentation.isSessionRender,
    isSessionRenderLinked: presentation.isSessionRenderLinked,
    isSessionRenderStale: presentation.isSessionRenderStale,
    isSessionRenderPending: presentation.isSessionRenderPending,
  };
}

// Purpose: Build one clip render model in track-local coordinates where the containing track already owns the vertical placement.
// How: Reuse the normal clip projection and labels, then center the clip inside one local lane without any track-id lookup.
export function buildLocalClipRenderModel(
  current: Project,
  clip: Project["timeline"]["tracks"][number]["clips"][number],
  effectiveStart: number,
  projection: TimelineProjection,
  renderStartCoord: number,
  inputs: ClipPresentationInputs,
): ClipRenderModel {
  const model = buildClipRenderModel(
    current,
    clip,
    effectiveStart,
    "track-1",
    projection,
    renderStartCoord,
    inputs,
  );
  const localHeightPx = Math.max(projection.laneHeightPx - 16, 0);
  return {
    ...model,
    topPx: Math.max((projection.laneHeightPx - localHeightPx) / 2, 0),
    heightPx: localHeightPx,
  };
}
