/******************************* render-debug.ts ********************************
 *
 * Purpose: Provide render-time performance logging and debug diagnostics.
 * How: Gate all output behind feature flags in demoState and throttle rare
 *      warnings to avoid flooding the console during interactive gestures.
 *
 * @invariant: no log output when perfLoggingEnabled is false.
 *
 ******************************************************************************/
import { demoState } from "../state.js";
import { formatCurrentAbsoluteTimeLabel } from "../format.js";
import { recordPerfCounter } from "../perf.js";

// Purpose: Label one of the heavy timeline rebuild passes for debug instrumentation.
// How: Closed string union matching the pass kinds tracked by `measureRebuildPass`.
export type RebuildPassKind = "geometry" | "clip";

type RebuildPassInstrumentation = {
  kind: RebuildPassKind;
  run(): void;
  slowDetails(): Record<string, number | string | boolean | null>;
  rareCostDetails(): Record<string, number | string | boolean | null>;
};

// Purpose: Snapshot the key render-loop metrics for external diagnostics.
// How: Record geometry, clip, and window change flags alongside size counters.
export type PanRenderDebugSnapshot = {
  geometryChanged: boolean;
  clipGeometryChanged: boolean;
  geometryWindowChanged: boolean;
  clipWindowChanged: boolean;
  freezeGeometryDuringPan: boolean;
  gridWidthPx: number;
  geometryRenderWidthPx: number;
  clipRenderWidthPx: number;
  totalClipCount: number;
  renderedClipCount: number;
  viewStartCoord: number;
  viewEndCoord: number;
};

// Purpose: Label the role of a primary-division sliding buffer slot.
// How: Closed string union matching the three slot roles plus unknown.
export type PrimaryDivisionBufferRole = "left" | "right" | "reserve" | "unknown";

// Purpose: Label the rendering layer a primary division draw belongs to.
// How: Distinguish grid lines from waveform content.
export type PrimaryDivisionDrawLayer = "grid" | "waveform";

const rareRenderLogTimestampsMs = new Map<string, number>();
const RARE_RENDER_LOG_THROTTLE_MS = 400;
const RARE_RENDER_LOG_THRESHOLD_MS = 32;
const PAN_DEBUG_REBUILD_LOG_THRESHOLD_MS = 12;
const loggedWaveformBackendKeys = new Set<string>();
let primaryDivisionDrawSequence = 0;
let latestPanRenderDebugSnapshot: PanRenderDebugSnapshot | null = null;

// Purpose: Check whether pan-specific debug output is currently enabled.
// How: Require both the global perf flag and an active pan gesture.
export function isPanDebugEnabled(): boolean {
  return demoState.devFlags.perfLogging && demoState.rulerDragState?.mode === "pan";
}

// Purpose: Check whether general render debug output is currently enabled.
// How: Read the global perf-logging flag from demoState.
export function isRenderDebugEnabled(): boolean {
  return demoState.devFlags.perfLogging;
}

// Purpose: Emit a debug-level log entry during an active pan gesture.
// How: Guard with isPanDebugEnabled then forward to console.debug.
function logPanDebug(event: string, details: Record<string, number | string | boolean | null>): void {
  if (!isPanDebugEnabled()) {
    return;
  }
  console.debug(`[pan-debug] ${event}`, details);
}

// Purpose: Time one heavy timeline rebuild pass and emit the standard pan-debug + rare-cost log entries.
// How: Run the pass, measure its duration, then forward the call-site-provided details to the
//      pan-debug counter, the slow-rebuild log, and the rare-render-cost log.
export function measureRebuildPass(instrumentation: RebuildPassInstrumentation): void {
  const startMs = performance.now();
  instrumentation.run();
  const durationMs = performance.now() - startMs;
  if (isPanDebugEnabled()) {
    recordPerfCounter(`pan.rebuild.${instrumentation.kind}.durationMs`, durationMs);
    if (durationMs >= PAN_DEBUG_REBUILD_LOG_THRESHOLD_MS) {
      logPanDebug(`${instrumentation.kind}-rebuild-slow`, {
        durationMs: Number(durationMs.toFixed(3)),
        ...instrumentation.slowDetails(),
      });
    }
  }
  logRareRenderCost(`${instrumentation.kind}-rebuild`, durationMs, instrumentation.rareCostDetails());
}

// Purpose: Emit a throttled warning when a render operation exceeds a cost threshold.
// How: Skip if disabled, below threshold, or within the throttle window for this event key.
export function logRareRenderCost(
  event: string,
  durationMs: number,
  details: Record<string, number | string | boolean | null>,
  thresholdMs = RARE_RENDER_LOG_THRESHOLD_MS,
): void {
  if (!isRenderDebugEnabled()) {
    return;
  }
  if (durationMs < thresholdMs) {
    return;
  }
  const throttleKey = `${event}:z${demoState.viewport.timeScale.zoomLevelIndex}`;
  const now = performance.now();
  const lastTimestampMs = rareRenderLogTimestampsMs.get(throttleKey) ?? -Infinity;
  if (now - lastTimestampMs < RARE_RENDER_LOG_THROTTLE_MS) {
    return;
  }
  rareRenderLogTimestampsMs.set(throttleKey, now);
  console.warn(`[rare-render] ${event}`, {
    zoomLevel: demoState.viewport.timeScale.zoomLevelIndex,
    durationMs: Number(durationMs.toFixed(3)),
    ...details,
  });
}

// Purpose: Translate a buffer-role tag to a human-readable French label.
// How: Switch on the four role values.
function formatPrimaryDivisionBufferRole(role: PrimaryDivisionBufferRole): string {
  switch (role) {
    case "left":
      return "buffer gauche";
    case "right":
      return "buffer droit";
    case "reserve":
      return "buffer offline";
    default:
      return "buffer inconnu";
  }
}

// Purpose: Log a primary-division draw event for sliding-buffer diagnostics.
// How: Emit a console.debug entry with the division index, layer, role, and time range.
export function logPrimaryDivisionDraw(
  layer: PrimaryDivisionDrawLayer,
  role: PrimaryDivisionBufferRole,
  reason: string,
  primaryIndex: number,
  primaryStepCoord: number,
): void {
  if (!isRenderDebugEnabled()) {
    return;
  }
  const startCoord = primaryIndex * primaryStepCoord;
  const endCoord = startCoord + primaryStepCoord;
  primaryDivisionDrawSequence += 1;
  console.debug("[primary-division-draw]", {
    chronologicalIndex: primaryIndex,
    drawSequence: primaryDivisionDrawSequence,
    layer,
    role,
    buffer: formatPrimaryDivisionBufferRole(role),
    reason,
    primaryIndex,
    startCoord,
    endCoord,
    startLabel: formatCurrentAbsoluteTimeLabel(
      startCoord,
      demoState.project.timebase,
      demoState.viewport.timeScale.pixelsPerSample,
    ),
    endLabel: formatCurrentAbsoluteTimeLabel(
      endCoord,
      demoState.project.timebase,
      demoState.viewport.timeScale.pixelsPerSample,
    ),
  });
}

// Purpose: Expose the latest timeline-render debug snapshot to the pan loop diagnostics.
// How: Return a shallow copy of the render snapshot captured during the last timeline frame.
export function getPanRenderDebugSnapshot(): PanRenderDebugSnapshot | null {
  return latestPanRenderDebugSnapshot ? { ...latestPanRenderDebugSnapshot } : null;
}

// Purpose: Store a new debug snapshot for external access.
// How: Replace the module-level snapshot reference.
export function setLatestPanRenderDebugSnapshot(snapshot: PanRenderDebugSnapshot): void {
  latestPanRenderDebugSnapshot = snapshot;
}

// Purpose: Log the waveform rendering backend choice for one clip (deduplicated).
// How: Build a composite key from zoom, clip, and backend; skip if already logged.
export function logWaveformBackendChoice(
  model: { id: string; resourceId: string; isSelected: boolean },
  backend: "gpu-envelope-minmax" | "cpu-envelope-minmax" | "cpu-envelope-mean" | "cpu-detailed" | "pending-envelope",
  details: {
    selected: boolean;
    textureLevelAvailable: boolean;
    bucketSizeSamples: number | null;
    activeBucketSizeSamples: number | null;
  },
): void {
  if (!isRenderDebugEnabled()) {
    return;
  }
  const key = [
    demoState.viewport.timeScale.zoomLevelIndex,
    model.id,
    backend,
    details.selected ? "selected" : "normal",
    details.textureLevelAvailable ? "texture" : "no-texture",
    details.bucketSizeSamples ?? "none",
    details.activeBucketSizeSamples ?? "none",
  ].join(";");
  if (loggedWaveformBackendKeys.has(key)) {
    return;
  }
  loggedWaveformBackendKeys.add(key);
  console.debug("[waveform-backend]", {
    clipId: model.id,
    resourceId: model.resourceId,
    zoomLevel: demoState.viewport.timeScale.zoomLevelIndex,
    backend,
    selected: details.selected,
    textureLevelAvailable: details.textureLevelAvailable,
    bucketSizeSamples: details.bucketSizeSamples,
    activeBucketSizeSamples: details.activeBucketSizeSamples,
  });
}
