/**************************** clip-drag-gesture.ts ****************************
 *
 * Purpose: Clip drag-and-drop + marquee selection on the timeline grid. Owns
 *          the pointer event cycle, the drag state machine (preview, snap,
 *          alignment guides, raster window), edge auto-scroll during drag,
 *          the marquee rectangle overlay, and the commit-on-release flow
 *          (move or duplicate).
 * How: `wireClipDragging(elements, ctx)` installs pointer listeners on the
 *      timeline grid. The closure reads/writes `demoState.dragState` and
 *      `demoState.selectionRectState` directly. Side effects beyond clip
 *      geometry (selection mutation, undo history, transport resync, read-
 *      only gate, footer status) are injected via the `ctx` object.
 *      `stopClipAutoScroll` and `getHitClipIdFromGridPointer` are also
 *      exported for reuse by session-archive teardown and the context
 *      menu respectively.
 *
 ******************************************************************************/
import type { Elements } from "../bind-elements.js";
import { demoState } from "../state.js";
import type { Clip } from "../../src/domain/clip.js";
import {
  clipEnd,
  getClip,
  placeClipInstance,
  removeClip,
} from "../../src/domain/clip.js";
import type { Project } from "../../src/domain/project.js";
import type { TimeCoord } from "../../src/domain/timebase.js";
import { TRACK_IDS, type TrackId } from "../../src/domain/track-id.js";
import type { SessionDocument } from "../session-document.js";
import {
  clearSelectedClips,
  getCurrentSelection,
  getOrderedSelectedClipIds,
  setSelectedClipIds,
  toggleSelectedClipId,
} from "../selection-state.js";
import { canCurrentTabWriteSession } from "../session-permissions.js";
import { createNextClipId } from "../clip-id.js";
import {
  commitCurrentSessionDocumentChange,
  createCurrentSessionDocument,
} from "../session-history.js";
import { EDGE_SCROLL_ZONE_PX } from "./gesture-state.js";
import { CLIP_ALIGNMENT_GUIDE_MAGNETISM_PX, applyClipMagnetism } from "../magnetism.js";
import { resolveClipAlignmentTarget } from "../placement.js";
import { captureClipPresentationInputs } from "../clip/clip-presentation-inputs.js";
import { getIndexedClip } from "../project-index.js";
import { Timeline } from "../timeline/timeline.js";
import { TimelineProjection } from "../timeline/timeline-projection.js";
import { View } from "../view/view.js";
import { invalidateWaveformSlidingBuffers, renderClipDragFrame, renderFrame, render } from "../daw-render/daw-render-runtime.js";
import { getVisibleClipRangeCached } from "../visible-range-cache.js";

const { getTimeFromGridClientX, getTrackIdFromGridClientY } = View;


// ---------------------------------------------------------------------------
// Auto-scroll: clip drag
// ---------------------------------------------------------------------------

/**
 * Purpose: Compute the auto-scroll speed during a clip drag based on pointer distance from the grid edge.
 * How: Measure how deep the pointer is inside the left/right edge activation zones and apply a quadratic intensity curve.
 */
function getClipEdgeScrollSpeed(): number {
  if (!demoState.dragState) {
    return 0;
  }
  const leftZoneEndPx = demoState.dragState.gridLeftPx + EDGE_SCROLL_ZONE_PX;
  const rightZoneStartPx = demoState.dragState.gridRightPx - EDGE_SCROLL_ZONE_PX;
  if (demoState.dragState.lastPointerX >= rightZoneStartPx) {
    const intensity = Math.min((demoState.dragState.lastPointerX - rightZoneStartPx) / EDGE_SCROLL_ZONE_PX, 1);
    return demoState.viewport.getEdgeScrollMaxSpeed() * intensity * intensity;
  }
  if (demoState.dragState.lastPointerX <= leftZoneEndPx) {
    if (demoState.viewport.viewStartCoord <= 0) {
      return 0;
    }
    if (demoState.dragState.lastNonZeroDeltaX >= 0) {
      return 0;
    }
    const intensity = Math.min((leftZoneEndPx - demoState.dragState.lastPointerX) / EDGE_SCROLL_ZONE_PX, 1);
    const softenedIntensity = Math.max((intensity - 0.2) / 0.8, 0);
    return -demoState.viewport.getEdgeScrollMaxSpeed() * softenedIntensity * softenedIntensity * softenedIntensity;
  }
  return 0;
}

/**
 * Purpose: Cancel the clip auto-scroll animation loop.
 * How: Cancel the pending animation frame and clear the tracking fields.
 */
export function stopClipAutoScroll(): void {
  if (demoState.clipAutoScrollFrameId !== null) {
    cancelAnimationFrame(demoState.clipAutoScrollFrameId);
  }
  demoState.clipAutoScrollFrameId = null;
  demoState.clipAutoScrollTimestamp = null;
}

/**
 * Purpose: Advance one frame of clip auto-scroll during an edge drag.
 * How: Compute time delta from the last frame, shift the view and clip preview, then schedule the next frame.
 */
function stepClipAutoScroll(timestamp: number, elements: Elements): void {
  if (!demoState.dragState) {
    stopClipAutoScroll();
    return;
  }
  const speed = getClipEdgeScrollSpeed();
  if (speed === 0) {
    stopClipAutoScroll();
    renderClipDragFrame(elements);
    return;
  }
  const previousTimestamp = demoState.clipAutoScrollTimestamp ?? timestamp;
  const deltaSeconds = (timestamp - previousTimestamp) / 1000;
  demoState.clipAutoScrollTimestamp = timestamp;
  const vp = demoState.viewport;
  const deltaCoord = vp.timeScale.toTimeCoord(speed * deltaSeconds);
  const newStart = speed < 0
    ? Math.max(0, vp.viewStartCoord + deltaCoord)
    : vp.clampStartCoord(vp.viewStartCoord + deltaCoord);
  vp.viewStartCoord = newStart;
  refreshDragAlignmentGuideWindow(demoState.project);
  const nextStart = Math.max(
    0,
    getTimeFromGridClientX(demoState.dragState.lastPointerX, elements) - demoState.dragState.pointerOffsetCoord,
  );
  demoState.dragState.rawPreviewStart = nextStart;
  demoState.dragState.previewStart = resolveDraggedClipStart(nextStart);
  refreshDragRasterWindow(elements);
  demoState.dragState.previewTrackId = getTrackIdFromCachedGridClientY(demoState.dragState.lastPointerY);
  renderFrame(elements);
  demoState.clipAutoScrollFrameId = requestAnimationFrame((nextTimestamp) => stepClipAutoScroll(nextTimestamp, elements));
}

/**
 * Purpose: Start the clip auto-scroll loop if the pointer is near the grid edge.
 * How: Check for a non-zero edge speed and schedule the first animation frame.
 */
function startClipAutoScrollIfNeeded(elements: Elements): void {
  if (!demoState.dragState || demoState.clipAutoScrollFrameId !== null) {
    return;
  }
  if (getClipEdgeScrollSpeed() === 0) {
    return;
  }
  demoState.clipAutoScrollFrameId = requestAnimationFrame((timestamp) => stepClipAutoScroll(timestamp, elements));
}

// ---------------------------------------------------------------------------
// Drag preview geometry
// ---------------------------------------------------------------------------

/**
 * Purpose: Compute the updated clip start from a pointer move during a clip drag.
 * How: Convert the horizontal pixel delta to a coordinate offset, clamp it to time zero, and apply magnetism.
 */
function getDraggedClipStart(event: PointerEvent, elements: Elements): TimeCoord {
  if (!demoState.dragState) {
    throw new Error("Invariant violation: missing drag state");
  }
  if (demoState.dragState.gridWidthPx <= 0) {
    return demoState.dragState.previewStart;
  }
  const deltaX = event.clientX - demoState.dragState.lastPointerX;
  demoState.dragState.lastPointerX = event.clientX;
  demoState.dragState.lastDeltaX = deltaX;
  if (deltaX !== 0) {
    demoState.dragState.lastNonZeroDeltaX = deltaX;
  }
  demoState.dragState.lastPointerY = event.clientY;
  let nextStart = getTimeFromGridClientX(event.clientX, elements) - demoState.dragState.pointerOffsetCoord;
  nextStart = Math.max(0, nextStart);
  demoState.dragState.rawPreviewStart = nextStart;
  const previewStart = resolveDraggedClipStart(nextStart);
  demoState.dragState.previewStart = previewStart;
  updateDragPreviewPlacements(demoState.dragState);
  refreshDragRasterWindow(elements);
  return previewStart;
}

/**
 * Purpose: Resolve the snapped preview start for the currently dragged clip group.
 * How: Apply exact-grid magnetism first, then align the full selection bounding box against visible clip edges when one guide is close enough.
 */
function resolveDraggedClipStart(candidateStart: TimeCoord): TimeCoord {
  if (!demoState.dragState) {
    return candidateStart;
  }
  const snappedStart = applyClipMagnetism(candidateStart);
  const pixelsPerCoord = demoState.viewport.viewDurationCoord > 0
    ? demoState.dragState.gridWidthPx / demoState.viewport.viewDurationCoord
    : 0;
  if (pixelsPerCoord <= 0) {
    return snappedStart;
  }
  const alignment = resolveClipAlignmentTarget(
    snappedStart,
    demoState.dragState.sourceGroupDurationCoord,
    demoState.dragState.alignmentGuideCoords,
    pixelsPerCoord,
    CLIP_ALIGNMENT_GUIDE_MAGNETISM_PX,
  );
  return alignment.activeTarget?.snappedStartCoord ?? snappedStart;
}

/**
 * Purpose: Convert a vertical pointer position to a track identifier using cached grid metrics.
 * How: Reuse the geometry captured at drag start so pointer moves do not trigger layout reads.
 */
function getTrackIdFromCachedGridClientY(clientY: number): TrackId {
  if (!demoState.dragState || demoState.dragState.gridHeightPx <= 0) {
    return TRACK_IDS[0];
  }
  const relativeY = Math.min(
    Math.max(clientY - demoState.dragState.gridTopPx, 0),
    Math.max(demoState.dragState.gridHeightPx - 1, 0),
  );
  const trackIndex = Math.min(
    Math.floor((relativeY / demoState.dragState.gridHeightPx) * TRACK_IDS.length),
    TRACK_IDS.length - 1,
  );
  const requestedGroupMinTrackIndex = trackIndex - demoState.dragState.pointerOffsetTrack;
  const groupTrackSpan = demoState.dragState.sourceGroupMaxTrackIndex - demoState.dragState.sourceGroupMinTrackIndex;
  const clampedGroupMinTrackIndex = Math.max(
    0,
    Math.min(requestedGroupMinTrackIndex, TRACK_IDS.length - 1 - groupTrackSpan),
  );
  return TRACK_IDS[clampedGroupMinTrackIndex] ?? TRACK_IDS[0];
}

/**
 * Purpose: Capture clip edge dates over one explicit time window for later alignment guides.
 * How: Enumerate clips intersecting the requested interval, exclude selected ids when needed, and keep unique start/end coordinates.
 */
function collectClipAlignmentGuideCoords(
  current: Project,
  windowStartCoord: TimeCoord,
  windowEndCoord: TimeCoord,
  excludedClipIds: readonly string[],
): TimeCoord[] {
  const guideCoords = new Set<TimeCoord>();
  const excludedClipIdSet = new Set(excludedClipIds);

  for (const track of current.timeline.tracks) {
    const range = getVisibleClipRangeCached(current, track, windowStartCoord, windowEndCoord);
    for (let index = range.first; index <= range.last; index += 1) {
      const clip = track.clips[index]!;
      if (excludedClipIdSet.has(clip.id)) {
        continue;
      }
      guideCoords.add(clip.start);
      guideCoords.add(clipEnd(current, clip));
    }
  }

  return Array.from(guideCoords).sort((left, right) => left - right);
}

function refreshDragAlignmentGuideWindow(current: Project): void {
  const dragState = demoState.dragState;
  if (!dragState) {
    return;
  }
  const vp = demoState.viewport;
  const viewStartCoord = vp.viewStartCoord;
  const viewEndCoord = viewStartCoord + vp.viewDurationCoord;
  const needsRefresh =
    viewStartCoord < dragState.alignmentGuideWindowStartCoord
    || viewEndCoord > dragState.alignmentGuideWindowEndCoord;
  if (!needsRefresh) {
    return;
  }
  const nextWindowStartCoord = viewStartCoord - vp.viewDurationCoord;
  const nextWindowEndCoord = viewEndCoord + vp.viewDurationCoord;
  dragState.alignmentGuideWindowStartCoord = nextWindowStartCoord;
  dragState.alignmentGuideWindowEndCoord = nextWindowEndCoord;
  dragState.alignmentGuideCoords = collectClipAlignmentGuideCoords(
    current,
    nextWindowStartCoord,
    nextWindowEndCoord,
    dragState.duplicateOnDrag ? [] : dragState.clipIds,
  );
}

function getDragRasterBounds(
  grabSourceCoord: TimeCoord,
  sourceGroupStart: TimeCoord,
  sourceGroupEnd: TimeCoord,
): { startCoord: TimeCoord; endCoord: TimeCoord } {
  const viewWidthCoord = demoState.viewport.viewDurationCoord;
  const visibleDragRegionStart = grabSourceCoord - viewWidthCoord;
  const visibleDragRegionEnd = grabSourceCoord + viewWidthCoord;
  const startCoord = Math.max(sourceGroupStart, visibleDragRegionStart);
  const endCoord = Math.min(sourceGroupEnd, visibleDragRegionEnd);
  if (endCoord <= startCoord) {
    return {
      startCoord: sourceGroupStart,
      endCoord: sourceGroupEnd,
    };
  }
  return { startCoord, endCoord };
}

function getCurrentDragSourceGrabCoord(
  dragState: NonNullable<typeof demoState.dragState>,
  elements: Elements,
): TimeCoord {
  const pointerTime = getTimeFromGridClientX(dragState.lastPointerX, elements);
  const dragOffsetCoord = dragState.previewStart - dragState.sourceGroupStart;
  return pointerTime - dragOffsetCoord;
}

function refreshDragRasterWindow(elements: Elements): void {
  const dragState = demoState.dragState;
  if (!dragState) {
    return;
  }
  const sourceGroupEnd = dragState.sourceGroupStart + dragState.sourceGroupDurationCoord;
  const dragOffsetCoord = dragState.previewStart - dragState.sourceGroupStart;
  const vp = demoState.viewport;
  const visibleSourceStartCoord = vp.viewStartCoord - dragOffsetCoord;
  const visibleSourceEndCoord = vp.viewStartCoord + vp.viewDurationCoord - dragOffsetCoord;
  const needsRefresh =
    visibleSourceStartCoord <= dragState.dragRasterStartCoord
    || visibleSourceEndCoord >= dragState.dragRasterEndCoord;
  if (!needsRefresh) {
    return;
  }
  const currentGrabSourceCoord = getCurrentDragSourceGrabCoord(dragState, elements);
  const nextBounds = getDragRasterBounds(
    currentGrabSourceCoord,
    dragState.sourceGroupStart,
    sourceGroupEnd,
  );
  dragState.dragRasterStartCoord = nextBounds.startCoord;
  dragState.dragRasterEndCoord = nextBounds.endCoord;
}

// ---------------------------------------------------------------------------
// Marquee selection
// ---------------------------------------------------------------------------

/**
 * Purpose: Keep the marquee rectangle DOM in sync with the current selection gesture.
 * How: Project the client-space gesture bounds into grid-local coordinates and update one absolutely positioned overlay box.
 */
function syncSelectionRectangle(elements: Elements): void {
  const selectionRectState = demoState.selectionRectState;
  if (!selectionRectState) {
    elements.selectionRectangle.hidden = true;
    return;
  }

  const left = Math.max(0, Math.min(selectionRectState.startPointerX, selectionRectState.lastPointerX) - selectionRectState.gridLeftPx);
  const top = Math.max(0, Math.min(selectionRectState.startPointerY, selectionRectState.lastPointerY) - selectionRectState.gridTopPx);
  const right = Math.min(
    selectionRectState.gridWidthPx,
    Math.max(selectionRectState.startPointerX, selectionRectState.lastPointerX) - selectionRectState.gridLeftPx,
  );
  const bottom = Math.min(
    selectionRectState.gridHeightPx,
    Math.max(selectionRectState.startPointerY, selectionRectState.lastPointerY) - selectionRectState.gridTopPx,
  );
  elements.selectionRectangle.style.left = `${left.toFixed(4)}px`;
  elements.selectionRectangle.style.top = `${top.toFixed(4)}px`;
  elements.selectionRectangle.style.width = `${Math.max(right - left, 0).toFixed(4)}px`;
  elements.selectionRectangle.style.height = `${Math.max(bottom - top, 0).toFixed(4)}px`;
  elements.selectionRectangle.hidden = !selectionRectState.active;
}

/**
 * Purpose: Select every visible clip whose on-screen box intersects the current marquee rectangle.
 * How: Compare the marquee bounds against the current clip block client rectangles and keep intersecting ids.
 */
function collectMarqueeSelectedClipIds(): string[] {
  const selectionRectState = demoState.selectionRectState;
  if (!selectionRectState || !selectionRectState.active) {
    return [];
  }

  const vp = demoState.viewport;
  const gridWidthPx = vp.timeScale.getGridWidthPx(selectionRectState.gridWidthPx);
  const gridHeightPx = selectionRectState.gridHeightPx;
  const viewDurationCoord = vp.viewDurationCoord;
  if (gridWidthPx <= 0 || gridHeightPx <= 0 || viewDurationCoord <= 0) {
    return [];
  }

  const localLeftPx = Math.max(
    0,
    Math.min(selectionRectState.startPointerX, selectionRectState.lastPointerX) - selectionRectState.gridLeftPx,
  );
  const localTopPx = Math.max(
    0,
    Math.min(selectionRectState.startPointerY, selectionRectState.lastPointerY) - selectionRectState.gridTopPx,
  );
  const localRightPx = Math.min(
    gridWidthPx,
    Math.max(selectionRectState.startPointerX, selectionRectState.lastPointerX) - selectionRectState.gridLeftPx,
  );
  const localBottomPx = Math.min(
    gridHeightPx,
    Math.max(selectionRectState.startPointerY, selectionRectState.lastPointerY) - selectionRectState.gridTopPx,
  );
  if (localRightPx - localLeftPx <= 0 || localBottomPx - localTopPx <= 0) {
    return [];
  }

  const pixelsPerCoord = gridWidthPx / viewDurationCoord;
  const laneHeightPx = gridHeightPx / TRACK_IDS.length;
  const clipHeightPx = Math.max(laneHeightPx - 16, 0);
  const clipTopInsetPx = Math.max((laneHeightPx - clipHeightPx) / 2, 0);
  const rectStartCoord = vp.viewStartCoord + localLeftPx / pixelsPerCoord;
  const rectEndCoord = vp.viewStartCoord + localRightPx / pixelsPerCoord;
  const selectedClipIds: string[] = [];

  for (const [trackIndex, track] of demoState.project.timeline.tracks.entries()) {
    const clipTopPx = trackIndex * laneHeightPx + clipTopInsetPx;
    const clipBottomPx = clipTopPx + clipHeightPx;
    if (clipTopPx >= localBottomPx || clipBottomPx <= localTopPx) {
      continue;
    }

    const range = getVisibleClipRangeCached(demoState.project, track, rectStartCoord, rectEndCoord);
    for (let clipIndex = range.first; clipIndex <= range.last; clipIndex += 1) {
      const clip = track.clips[clipIndex]!;
      const clipLeftPx = (clip.start - vp.viewStartCoord) * pixelsPerCoord;
      const clipRightPx = clipLeftPx + (clipEnd(demoState.project, clip) - clip.start) * pixelsPerCoord;
      const visibleLeftPx = Math.max(clipLeftPx, 0);
      const visibleRightPx = Math.min(clipRightPx, gridWidthPx);
      if (visibleLeftPx < localRightPx && visibleRightPx > localLeftPx) {
        selectedClipIds.push(clip.id);
      }
    }
  }

  return selectedClipIds;
}

function updateMarqueeSelection(elements: Elements): void {
  const marqueeClipIds = collectMarqueeSelectedClipIds();
  const selectionChanged = setSelectedClipIds(marqueeClipIds);
  if (selectionChanged) {
    renderFrame(elements);
  }
}

// ---------------------------------------------------------------------------
// Hit test
// ---------------------------------------------------------------------------

export function getHitClipIdFromGridPointer(clientX: number, clientY: number, elements: Elements): string | null {
  const gridRect = elements.timelineGrid.getBoundingClientRect();
  View.syncExactTimelineViewport(elements);
  const view = View.captureRenderView();
  const projection = TimelineProjection.fromView(view);
  const timeCoord = getTimeFromGridClientX(clientX, elements);
  const trackId = getTrackIdFromGridClientY(clientY, elements);
  const trackIndex = TRACK_IDS.indexOf(trackId);
  if (trackIndex < 0) {
    return null;
  }
  const localTrackYPx = clientY - gridRect.top - trackIndex * projection.laneHeightPx;
  const clip = Timeline.fromProject(demoState.project).hitTestClip({
    projection,
    timeCoord,
    trackId,
    localTrackYPx,
    dragState: demoState.dragState,
    presentationInputs: captureClipPresentationInputs(),
  });
  return clip?.id() ?? null;
}

// ---------------------------------------------------------------------------
// Commit-on-release
// ---------------------------------------------------------------------------

/**
 * Purpose: Derive one preview placement map for the full dragged clip group from the lead preview position.
 * How: Apply the snapped lead start and the clamped lead track delta to every selected clip's original placement.
 */
function updateDragPreviewPlacements(dragState: typeof demoState.dragState): void {
  if (!dragState) {
    return;
  }
  const previewTrackIndex = TRACK_IDS.indexOf(dragState.previewTrackId);
  const trackDelta = previewTrackIndex - dragState.sourceGroupMinTrackIndex;
  const startDelta = dragState.previewStart - dragState.sourceGroupStart;
  const nextPreviewPlacements = new Map<string, { start: TimeCoord; trackId: TrackId }>();

  for (const [clipId, sourcePlacement] of dragState.sourcePlacements.entries()) {
    const sourceTrackIndex = TRACK_IDS.indexOf(sourcePlacement.trackId);
    const nextTrackId = TRACK_IDS[sourceTrackIndex + trackDelta] ?? sourcePlacement.trackId;
    nextPreviewPlacements.set(clipId, {
      start: sourcePlacement.start + startDelta,
      trackId: nextTrackId,
    });
  }

  dragState.previewPlacements = nextPreviewPlacements;
}

/**
 * Purpose: Move a group of clips as one operation without transient self-collisions between selected clips.
 * How: Remove every selected clip first, then place them back in target order using their requested final coordinates.
 */
function moveClipGroup(
  current: Project,
  placements: readonly { clipId: string; start: TimeCoord; trackId: TrackId }[],
): Project {
  const sourceClips = new Map(
    placements.map(({ clipId }) => [clipId, getClip(current, clipId)]),
  );

  let nextProject = current;
  for (const { clipId } of placements) {
    nextProject = removeClip(nextProject, clipId);
  }

  const orderedPlacements = [...placements].sort((left, right) => {
    const trackDelta = TRACK_IDS.indexOf(left.trackId) - TRACK_IDS.indexOf(right.trackId);
    return trackDelta !== 0 ? trackDelta : left.start - right.start;
  });

  for (const placement of orderedPlacements) {
    const sourceClip = sourceClips.get(placement.clipId);
    if (!sourceClip) {
      continue;
    }
    nextProject = placeClipInstance(nextProject, sourceClip, placement.start, placement.trackId);
  }

  return nextProject;
}

// ---------------------------------------------------------------------------
// Pointer event wiring
// ---------------------------------------------------------------------------

/**
 * Purpose: Set up the pointer event cycle for clip drag-and-drop on the timeline grid.
 * How: Listen for pointerdown on clip blocks, track movement with pointer capture, and commit with moveClip on release.
 */
export function wireClipDragging(elements: Elements): void {
  const clearSelectionRect = (): void => {
    demoState.selectionRectState = null;
    syncSelectionRectangle(elements);
  };

  elements.timelineGrid.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    const clipId = getHitClipIdFromGridPointer(event.clientX, event.clientY, elements);
    if (!clipId) {
      if (demoState.geometryWindow.keepWarm) {
        demoState.geometryWindow.keepWarm = false;
        renderFrame(elements);
      }
      const gridRect = elements.timelineGrid.getBoundingClientRect();
      demoState.selectionRectState = {
        pointerId: event.pointerId,
        startPointerX: event.clientX,
        startPointerY: event.clientY,
        lastPointerX: event.clientX,
        lastPointerY: event.clientY,
        gridLeftPx: gridRect.left,
        gridTopPx: gridRect.top,
        gridWidthPx: gridRect.width,
        gridHeightPx: gridRect.height,
        active: false,
      };
      syncSelectionRectangle(elements);
      elements.timelineGrid.setPointerCapture(event.pointerId);
      return;
    }
    event.preventDefault();
    if (!canCurrentTabWriteSession()) {
      if (event.shiftKey) {
        toggleSelectedClipId(demoState.project, clipId);
      } else {
        setSelectedClipIds([clipId]);
      }
      demoState.footer.setStatus(`Session "${demoState.session.name}" is open read-only in this tab`, "error");
      renderFrame(elements);
      return;
    }
    if (event.shiftKey) {
      toggleSelectedClipId(demoState.project, clipId);
      renderFrame(elements);
      return;
    }

    const selectedClipIds =
      demoState.selection.ids.has(clipId) && demoState.selection.ids.size > 1
        ? [clipId, ...getOrderedSelectedClipIds(demoState.project).filter((selectedClipId) => selectedClipId !== clipId)]
        : [clipId];
    setSelectedClipIds(selectedClipIds);
    const clickedClipRef = getIndexedClip(demoState.project, clipId);
    if (!clickedClipRef) {
      renderFrame(elements);
      return;
    }
    const duplicateOnDrag = event.altKey;
    const gridRect = elements.timelineGrid.getBoundingClientRect();
    const grabTime = getTimeFromGridClientX(event.clientX, elements);
    const previewClipIds = new Map(
      selectedClipIds.map((selectedClipId) => [selectedClipId, duplicateOnDrag ? createNextClipId() : selectedClipId]),
    );
    const sourcePlacements = new Map(
      selectedClipIds.map((selectedClipId) => {
        const selectedClip = getClip(demoState.project, selectedClipId);
        const selectedClipRef = getIndexedClip(demoState.project, selectedClipId);
        return [selectedClipId, {
          start: selectedClip.start,
          trackId: selectedClipRef?.trackId ?? TRACK_IDS[0],
        }];
      }),
    );
    const sourceSelection = getCurrentSelection();
    const sourceTimeRange = sourceSelection.timeRange()!;
    const sourceTrackRange = sourceSelection.trackRange()!;
    const sourceGroupStart = sourceTimeRange.startCoord;
    const sourceGroupEnd = sourceTimeRange.endCoord;
    const sourceGroupMinTrackIndex = sourceTrackRange.minIndex;
    const sourceGroupMaxTrackIndex = sourceTrackRange.maxIndex;
    const clickedTrackIndex = clickedClipRef.trackIndex;
    const sourceGroupDurationCoord = sourceGroupEnd - sourceGroupStart;
    const vpRef = demoState.viewport;
    const alignmentGuideWindowStartCoord = vpRef.viewStartCoord - vpRef.viewDurationCoord;
    const alignmentGuideWindowEndCoord =
      vpRef.viewStartCoord + vpRef.viewDurationCoord * 2;
    const initialDragRasterBounds = getDragRasterBounds(
      grabTime,
      sourceGroupStart,
      sourceGroupEnd,
    );
    demoState.dragState = {
      clipId,
      clipIds: selectedClipIds,
      previewClipId: previewClipIds.get(clipId) ?? clipId,
      previewClipIds,
      previewDetachedFromBackground: false,
      duplicateOnDrag,
      pointerId: event.pointerId,
      grabTime,
      pointerOffsetCoord: grabTime - sourceGroupStart,
      pointerOffsetTrack: clickedTrackIndex - sourceGroupMinTrackIndex,
      lastPointerX: event.clientX,
      lastDeltaX: 0,
      lastNonZeroDeltaX: 0,
      lastPointerY: event.clientY,
      gridLeftPx: gridRect.left,
      gridRightPx: gridRect.right,
      gridTopPx: gridRect.top,
      gridWidthPx: gridRect.width,
      gridHeightPx: gridRect.height,
      sourceGroupStart,
      sourceGroupDurationCoord,
      sourceGroupMinTrackIndex,
      sourceGroupMaxTrackIndex,
      dragRasterStartCoord: initialDragRasterBounds.startCoord,
      dragRasterEndCoord: initialDragRasterBounds.endCoord,
      alignmentGuideWindowStartCoord,
      alignmentGuideWindowEndCoord,
      rawPreviewStart: sourceGroupStart,
      previewStart: sourceGroupStart,
      previewTrackId: TRACK_IDS[sourceGroupMinTrackIndex] ?? clickedClipRef.trackId,
      previewPlacements: new Map(sourcePlacements),
      sourcePlacements,
      alignmentGuideCoords: collectClipAlignmentGuideCoords(
        demoState.project,
        alignmentGuideWindowStartCoord,
        alignmentGuideWindowEndCoord,
        duplicateOnDrag ? [] : selectedClipIds,
      ),
    };
    demoState.clipRenderStable.dirty = true;
    elements.timelineGrid.setPointerCapture(event.pointerId);
    startClipAutoScrollIfNeeded(elements);
    renderFrame(elements);
  });

  elements.timelineGrid.addEventListener("pointermove", (event) => {
    if (demoState.selectionRectState && event.pointerId === demoState.selectionRectState.pointerId) {
      demoState.selectionRectState.lastPointerX = event.clientX;
      demoState.selectionRectState.lastPointerY = event.clientY;
      if (!demoState.selectionRectState.active) {
        const deltaX = event.clientX - demoState.selectionRectState.startPointerX;
        const deltaY = event.clientY - demoState.selectionRectState.startPointerY;
        if (Math.hypot(deltaX, deltaY) >= 4) {
          demoState.selectionRectState.active = true;
        }
      }
      syncSelectionRectangle(elements);
      updateMarqueeSelection(elements);
      return;
    }
    if (!demoState.dragState || event.pointerId !== demoState.dragState.pointerId) {
      return;
    }
    getDraggedClipStart(event, elements);
    demoState.dragState.previewTrackId = getTrackIdFromCachedGridClientY(event.clientY);
    updateDragPreviewPlacements(demoState.dragState);
    renderClipDragFrame(elements);
    startClipAutoScrollIfNeeded(elements);
  });

  const finishDrag = (event: PointerEvent, options?: { recomputePreviewFromEvent?: boolean }): void => {
    if (demoState.selectionRectState && event.pointerId === demoState.selectionRectState.pointerId) {
      if (!demoState.selectionRectState.active) {
        const clearedSelection = clearSelectedClips();
        if (clearedSelection) {
          renderFrame(elements);
        }
      }
      if (elements.timelineGrid.hasPointerCapture(event.pointerId)) {
        elements.timelineGrid.releasePointerCapture(event.pointerId);
      }
      clearSelectionRect();
      return;
    }
    if (!demoState.dragState || event.pointerId !== demoState.dragState.pointerId) {
      return;
    }
    if (options?.recomputePreviewFromEvent ?? true) {
      getDraggedClipStart(event, elements);
      demoState.dragState.previewTrackId = getTrackIdFromCachedGridClientY(event.clientY);
      updateDragPreviewPlacements(demoState.dragState);
    }
    stopClipAutoScroll();
    const previousSessionDocument = createCurrentSessionDocument();
    let actionLabel: string | null = null;
    if (demoState.dragState.duplicateOnDrag) {
      const duplicatedPlacements = demoState.dragState.clipIds.map((selectedClipId) => {
        const sourceClip = getClip(demoState.project, selectedClipId);
        const previewPlacement = demoState.dragState?.previewPlacements.get(selectedClipId);
        const previewClipId = demoState.dragState?.previewClipIds.get(selectedClipId);
        return previewPlacement && previewClipId
          ? {
              clipId: previewClipId,
              clip: sourceClip,
              start: previewPlacement.start,
              trackId: previewPlacement.trackId,
            }
          : null;
      }).filter((placement): placement is { clipId: string; clip: Clip; start: TimeCoord; trackId: TrackId } => placement !== null);
      if (duplicatedPlacements.length === 0) {
        demoState.dragState = null;
        demoState.clipRenderStable.dirty = true;
        render(elements);
        return;
      }
      demoState.project = duplicatedPlacements.reduce(
        (project, placement) => placeClipInstance(
          project,
          {
            ...placement.clip,
            id: placement.clipId,
          },
          placement.start,
          placement.trackId,
        ),
        demoState.project,
      );
      // Duplicated clips have fresh ids the waveform sliding buffer does not
      // know about, so force a rebuild before the next render.
      invalidateWaveformSlidingBuffers();
      setSelectedClipIds(duplicatedPlacements.map((placement) => placement.clipId));
      const duplicationLabel = duplicatedPlacements.length === 1 ? "Duplicate clip" : "Duplicate clips";
      const leadPlacement = duplicatedPlacements.find((placement) => placement.clipId === demoState.dragState?.previewClipId) ?? duplicatedPlacements[0];
      if (leadPlacement) {
        actionLabel = `${duplicationLabel} to ${demoState.viewport.timeScale.fromTimeCoord(leadPlacement.start).toFixed(2)} s / ${leadPlacement.trackId}`;
      }
    } else {
      const finalPlacements = demoState.dragState.clipIds.map((selectedClipId) => {
        const previewPlacement = demoState.dragState?.previewPlacements.get(selectedClipId);
        const sourcePlacement = demoState.dragState?.sourcePlacements.get(selectedClipId);
        return {
          clipId: selectedClipId,
          start: previewPlacement?.start ?? sourcePlacement?.start ?? 0,
          trackId: previewPlacement?.trackId ?? sourcePlacement?.trackId ?? TRACK_IDS[0],
        };
      });
      demoState.project = moveClipGroup(demoState.project, finalPlacements);
      setSelectedClipIds(demoState.dragState.clipIds);
      const movementLabel = demoState.dragState.clipIds.length > 1 ? "Move clips" : "Move clip";
      const leadPlacement = finalPlacements.find((placement) => placement.clipId === demoState.dragState?.clipId) ?? finalPlacements[0];
      if (leadPlacement) {
        actionLabel = `${movementLabel} to ${demoState.viewport.timeScale.fromTimeCoord(leadPlacement.start).toFixed(2)} s / ${leadPlacement.trackId}`;
      }
    }
    if (elements.timelineGrid.hasPointerCapture(event.pointerId)) {
      elements.timelineGrid.releasePointerCapture(event.pointerId);
    }
    demoState.dragState = null;
    demoState.clipRenderStable.dirty = true;
    if (actionLabel) {
      commitCurrentSessionDocumentChange(actionLabel, previousSessionDocument, elements);
    } else {
      render(elements);
    }
    demoState.playbackSession.restartIfNeeded();
  };

  elements.timelineGrid.addEventListener("pointerup", finishDrag);
  elements.timelineGrid.addEventListener("pointercancel", (event) => {
    stopClipAutoScroll();
    finishDrag(event, { recomputePreviewFromEvent: false });
  });
}
