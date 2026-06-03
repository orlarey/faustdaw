/******************************** magnetism.ts *********************************
 *
 * Purpose: Snap timeline edits to the currently visible exact grid.
 * How: Read the active exact zoom level, evaluate tertiary then secondary then
 *      primary snap candidates with fixed pixel tolerances, and quantize the
 *      final result to the exact sample lattice.
 *
 ******************************************************************************/
import type { TimeCoord } from "../src/domain/timebase.js";
import { demoState } from "./state.js";

export const CLIP_MAGNETISM_PX = 4;
export const CLIP_TERTIARY_MAGNETISM_PX = 3;
export const CLIP_ALIGNMENT_GUIDE_MAGNETISM_PX = 4;

type ExactMagnetismGeometry = {
  pixelsPerSample: number;
  sampleCoord: number;
  tertiaryStepCoord: TimeCoord;
  secondaryStepCoord: TimeCoord;
  primaryStepCoord: TimeCoord;
};

let cachedGeometry: ExactMagnetismGeometry | null = null;
let cachedLevelIndex: number | null = null;
let cachedInternalTimeRate: number | null = null;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Purpose: Resolve the active exact-grid geometry needed by snap decisions.
 * How: Cache the active exact zoom level and sample quantum, then expose the three exact step sizes.
 */
function getMagnetismGeometry(): ExactMagnetismGeometry {
  const ts = demoState.viewport.timeScale;
  const levelIndex = ts.zoomLevelIndex;
  const internalTimeRate = ts.timebase.internalTimeRate;
  if (
    cachedGeometry !== null
    && cachedLevelIndex === levelIndex
    && cachedInternalTimeRate === internalTimeRate
  ) {
    return cachedGeometry;
  }

  const exactScale = ts.getScale();
  cachedGeometry = {
    pixelsPerSample: exactScale.pixelsPerSample,
    sampleCoord: exactScale.sampleCoord,
    tertiaryStepCoord: exactScale.tertiaryStepCoord,
    secondaryStepCoord: exactScale.secondaryStepCoord,
    primaryStepCoord: exactScale.primaryStepCoord,
  };
  cachedLevelIndex = levelIndex;
  cachedInternalTimeRate = internalTimeRate;
  return cachedGeometry;
}

// ---------------------------------------------------------------------------
// Snap logic
// ---------------------------------------------------------------------------

/**
 * Purpose: Return the nearest exact grid coordinate for one given step size.
 * How: Round the candidate to the nearest multiple of the supplied step, clamped to non-negative time.
 */
function snapToStep(candidateTime: TimeCoord, stepCoord: TimeCoord): TimeCoord {
  if (stepCoord <= 0) {
    return Math.max(0, candidateTime);
  }
  return Math.max(0, Math.round(candidateTime / stepCoord) * stepCoord);
}

/**
 * Purpose: Measure the pixel distance between a candidate time and one snap target on the active exact grid.
 * How: Convert the coordinate delta to sample delta, then multiply by the active pixels-per-sample ratio.
 */
function getSnapDistancePx(candidateTime: TimeCoord, snappedTime: TimeCoord, geometry: ExactMagnetismGeometry): number {
  return Math.abs(snappedTime - candidateTime) * (geometry.pixelsPerSample / geometry.sampleCoord);
}

/**
 * Purpose: Snap a candidate time with a simple fixed-priority exact-grid strategy.
 * How: Try tertiary first, then secondary, then primary, accepting the first target inside its pixel tolerance.
 */
function applyTimeMagnetism(
  candidateTime: TimeCoord,
  primaryTolerancePx: number,
  tertiaryTolerancePx: number,
): TimeCoord {
  const geometry = getMagnetismGeometry();
  if (geometry.pixelsPerSample >= 1) {
    return candidateTime;
  }
  const tertiarySnap = snapToStep(candidateTime, geometry.tertiaryStepCoord);
  if (getSnapDistancePx(candidateTime, tertiarySnap, geometry) <= tertiaryTolerancePx) {
    return tertiarySnap;
  }

  const secondarySnap = snapToStep(candidateTime, geometry.secondaryStepCoord);
  if (getSnapDistancePx(candidateTime, secondarySnap, geometry) <= primaryTolerancePx) {
    return secondarySnap;
  }

  const primarySnap = snapToStep(candidateTime, geometry.primaryStepCoord);
  if (getSnapDistancePx(candidateTime, primarySnap, geometry) <= primaryTolerancePx) {
    return primarySnap;
  }

  return candidateTime;
}

/**
 * Purpose: Quantize a time coordinate to the exact sample lattice used by the current prototype.
 * How: Round the coordinate to the nearest sample boundary in the active time context.
 */
function quantizeTimeToSample(candidateTime: TimeCoord): TimeCoord {
  return Math.max(0, demoState.viewport.timeScale.snapToSample(candidateTime));
}

// ---------------------------------------------------------------------------
// Public magnetism API
// ---------------------------------------------------------------------------

/**
 * Purpose: Snap a clip start position to the current exact grid.
 * How: Apply the fixed-priority exact-grid snap and then quantize the result to the nearest sample.
 */
export function applyClipMagnetism(candidateStart: TimeCoord): TimeCoord {
  return quantizeTimeToSample(
    applyTimeMagnetism(candidateStart, CLIP_MAGNETISM_PX, CLIP_TERTIARY_MAGNETISM_PX),
  );
}

/**
 * Purpose: Snap a cursor position directly to the nearest tertiary exact-grid division.
 * How: Round to the active tertiary step, then quantize the result to the sample lattice.
 */
export function snapCursorToNearestTertiaryDivision(candidateTime: TimeCoord): TimeCoord {
  const geometry = getMagnetismGeometry();
  return quantizeTimeToSample(snapToStep(candidateTime, geometry.tertiaryStepCoord));
}
