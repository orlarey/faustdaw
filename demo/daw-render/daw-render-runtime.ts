/******************************** daw-render/daw-render-runtime.ts ********************************
 *
 * Purpose: Own the global DAW render passes that compose the view chrome with the timeline scene.
 * How: Update shared UI panels and status fields at DAW level, then delegate scene drawing
 *      to the timeline subsystem so timeline-render no longer owns the whole application shell.
 *
 ******************************************************************************/
import type { Elements } from "../bind-elements.js";
import type { Project } from "../../src/domain/project.js";
import { demoState } from "../state.js";
import { measurePerf } from "../perf.js";
import { getTotalClipCount } from "../project-index.js";
import { TimelineScene } from "../timeline/timeline-scene.js";
import { DAWRenderSurface } from "./daw-render-surface.js";
import { formatCurrentAbsoluteTimeLabel } from "../format.js";
import { logRareRenderCost } from "../timeline/timeline-debug.js";

let lastTimelineFrameTimestamp: number | null = null;
let smoothedFrameDurationMs: number | null = null;

function sampleTimelineFrameRate(): number | null {
  const now = performance.now();
  if (lastTimelineFrameTimestamp === null) {
    lastTimelineFrameTimestamp = now;
    return null;
  }

  const frameDurationMs = now - lastTimelineFrameTimestamp;
  lastTimelineFrameTimestamp = now;
  if (frameDurationMs <= 0) {
    return null;
  }

  smoothedFrameDurationMs =
    smoothedFrameDurationMs === null
      ? frameDurationMs
      : smoothedFrameDurationMs * 0.8 + frameDurationMs * 0.2;

  return smoothedFrameDurationMs > 0 ? 1000 / smoothedFrameDurationMs : null;
}

function resetTimelineFrameRate(): void {
  lastTimelineFrameTimestamp = null;
  smoothedFrameDurationMs = null;
}

export function pushRenderLog(message: string): void {
  const timestamp = new Date().toLocaleTimeString("fr-FR", { hour12: false });
  demoState.logEntries.unshift(`${timestamp} - ${message}`);
  demoState.logEntries.splice(12);
}

/**
 * Purpose: Apply a pure project transition and flush render + log.
 * How: Run the transition, log the label, render. On error, log the error and still render.
 */
export function applyTransition(label: string, transition: () => Project, elements: Elements): void {
  try {
    demoState.project = transition();
    pushRenderLog(label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushRenderLog(`ERROR: ${message}`);
  }
  render(elements);
}

function renderZoomIndicator(surface: DAWRenderSurface): void {
  surface.hideZoomIndicator();
  resetTimelineFrameRate();
}

function syncSharedTransportFields(surface: DAWRenderSurface): void {
  surface.syncTransportFields({
    timecode: formatCurrentAbsoluteTimeLabel(
      demoState.project.timeline.cursor,
      demoState.project.timebase,
      demoState.viewport.timeScale.pixelsPerSample,
    ),
    isPlaying: demoState.project.timeline.transport === "Playing",
  });
}

export function renderGestureOverlayFrame(elements: Elements): void {
  measurePerf("renderGestureOverlayFrame", () => {
    const surface = DAWRenderSurface.fromElements(elements);
    const fps = sampleTimelineFrameRate();
    surface.hideZoomIndicator();
    if (fps !== null) {
      void fps;
    }
  });
}

export function renderFrame(elements: Elements): void {
  measurePerf("renderTimelineFrame", () => {
    const surface = DAWRenderSurface.fromElements(elements);
    demoState.viewport.syncTimebase(demoState.project.timebase);
    syncSharedTransportFields(surface);
    demoState.footer.syncZoomOnly(elements);
    renderZoomIndicator(surface);
    TimelineScene.render(elements, demoState.project);
  });
}

export function renderWaveformPreviewFrame(elements: Elements): void {
  measurePerf("renderTimelineWaveformPreviewFrame", () => {
    demoState.viewport.syncTimebase(demoState.project.timebase);
    TimelineScene.renderWaveformPreview(elements);
  });
}

export function renderClipDragFrame(elements: Elements): void {
  measurePerf("renderClipDragFrame", () => {
    const surface = DAWRenderSurface.fromElements(elements);
    demoState.viewport.syncTimebase(demoState.project.timebase);
    syncSharedTransportFields(surface);
    demoState.footer.syncZoomOnly(elements);
    TimelineScene.renderClipDrag(elements);
  });
}

export function render(elements: Elements): void {
  measurePerf("render", () => {
    const surface = DAWRenderSurface.fromElements(elements);
    const renderStartMs = performance.now();
    demoState.viewport.syncTimebase(demoState.project.timebase);
    syncSharedTransportFields(surface);
    demoState.footer.sync(elements);
    renderZoomIndicator(surface);
    TimelineScene.resetForFullRender();
    TimelineScene.render(elements, demoState.project);
    logRareRenderCost("render-full", performance.now() - renderStartMs, {
      totalClipCount: getTotalClipCount(demoState.project),
      transport: demoState.project.timeline.transport,
    }, 48);
  });
}

export function invalidateWaveformSlidingBuffers(): void {
  TimelineScene.invalidateWaveformSlidingBuffers();
}
