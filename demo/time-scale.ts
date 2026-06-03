/********************************** time-scale.ts ***********************************
 *
 * Purpose: Own the mapping between time in samples and screen pixels at a given zoom level.
 * How: Pair a zoom level index with a timebase, and expose conversion, snapping,
 *      and zoom-change methods as a single cohesive service.
 *      Also owns the discrete exact zoom lattice used by the DAW timeline view.
 *
 ******************************************************************************/
import type { Timebase, TimeCoord } from "../src/domain/timebase.js";

// ---------------------------------------------------------------------------
// Time unit definitions — canonical list of human time divisions
// ---------------------------------------------------------------------------

/**
 * Purpose: Enumerate the canonical time unit names used in timeline scale levels.
 * How: Declare a closed string union matching the six supported time divisions.
 */
export type TimeUnitName = "hour" | "minute" | "second" | "tenth" | "centisecond" | "millisecond";

/**
 * Purpose: Pair a time unit name with its real-time duration in seconds.
 * How: Store the unit name and its duration so coordinate helpers can compute step sizes.
 */
export type TimeUnit = {
  name: TimeUnitName;
  duration: number;
};

/**
 * Purpose: Define one candidate scale level from the TIMELINESPEC ordered list.
 * How: Combine a primary/secondary unit pair, the secondary grouping factor, and the secondary base (60 or 10).
 */
export type TimelineScaleLevel = {
  primary: TimeUnit;
  secondary: TimeUnit;
  grouping: number;
  secondaryBase: 60 | 10;
};

export const TIME_UNITS: TimeUnit[] = [
  { name: "hour", duration: 3600 },
  { name: "minute", duration: 60 },
  { name: "second", duration: 1 },
  { name: "tenth", duration: 0.1 },
  { name: "centisecond", duration: 0.01 },
  { name: "millisecond", duration: 0.001 },
];

// ---------------------------------------------------------------------------
// ExactTimelineScale type and zoom lattice
// ---------------------------------------------------------------------------

export type ExactTimelineScale = {
  levelIndex: number;
  pixelsPerSample: number;
  zoomPixels: number;
  zoomSamples: number;
  sampleCoord: number;
  tertiaryStepSamples: number;
  secondaryStepSamples: number;
  primaryStepSamples: number;
  secondaryUnit: "e" | "m" | "c" | "d" | "s" | "M" | "H";
  primaryUnit: "e" | "m" | "c" | "d" | "s" | "M" | "H";
  secondaryLabelSamplesPerUnit: number;
  tertiaryStepCoord: number;
  secondaryStepCoord: number;
  primaryStepCoord: number;
  tertiarySpacingPx: number;
  secondarySpacingPx: number;
  primarySpacingPx: number;
};

const EXACT_TIMELINE_SCALE_LEVELS = [
  {
    levelIndex: 0,
    pixelsPerSample: 16,
    zoomPixels: 16,
    zoomSamples: 1,
    tertiaryStepSamples: 1,
    secondaryStepSamples: 12,
    primaryStepSamples: 48,
    secondaryUnit: "e",
    primaryUnit: "m",
    secondaryLabelSamplesPerUnit: 1,
  },
  {
    levelIndex: 1,
    pixelsPerSample: 12,
    zoomPixels: 12,
    zoomSamples: 1,
    tertiaryStepSamples: 1,
    secondaryStepSamples: 12,
    primaryStepSamples: 48,
    secondaryUnit: "e",
    primaryUnit: "m",
    secondaryLabelSamplesPerUnit: 1,
  },
  {
    levelIndex: 2,
    pixelsPerSample: 8,
    zoomPixels: 8,
    zoomSamples: 1,
    tertiaryStepSamples: 1,
    secondaryStepSamples: 12,
    primaryStepSamples: 48,
    secondaryUnit: "e",
    primaryUnit: "m",
    secondaryLabelSamplesPerUnit: 1,
  },
  {
    levelIndex: 3,
    pixelsPerSample: 4,
    zoomPixels: 4,
    zoomSamples: 1,
    tertiaryStepSamples: 2,
    secondaryStepSamples: 12,
    primaryStepSamples: 48,
    secondaryUnit: "e",
    primaryUnit: "m",
    secondaryLabelSamplesPerUnit: 1,
  },
  {
    levelIndex: 4,
    pixelsPerSample: 3,
    zoomPixels: 3,
    zoomSamples: 1,
    tertiaryStepSamples: 3,
    secondaryStepSamples: 12,
    primaryStepSamples: 48,
    secondaryUnit: "e",
    primaryUnit: "m",
    secondaryLabelSamplesPerUnit: 1,
  },
  {
    levelIndex: 5,
    pixelsPerSample: 1,
    zoomPixels: 1,
    zoomSamples: 1,
    tertiaryStepSamples: 8,
    secondaryStepSamples: 48,
    primaryStepSamples: 480,
    secondaryUnit: "m",
    primaryUnit: "c",
    secondaryLabelSamplesPerUnit: 48,
  },
  {
    levelIndex: 6,
    pixelsPerSample: 0.5,
    zoomPixels: 1,
    zoomSamples: 2,
    tertiaryStepSamples: 16,
    secondaryStepSamples: 96,
    primaryStepSamples: 480,
    secondaryUnit: "m",
    primaryUnit: "c",
    secondaryLabelSamplesPerUnit: 48,
  },
  {
    levelIndex: 7,
    pixelsPerSample: 1 / 3,
    zoomPixels: 1,
    zoomSamples: 3,
    tertiaryStepSamples: 24,
    secondaryStepSamples: 96,
    primaryStepSamples: 480,
    secondaryUnit: "m",
    primaryUnit: "c",
    secondaryLabelSamplesPerUnit: 48,
  },
  {
    levelIndex: 8,
    pixelsPerSample: 0.25,
    zoomPixels: 1,
    zoomSamples: 4,
    tertiaryStepSamples: 32,
    secondaryStepSamples: 96,
    primaryStepSamples: 480,
    secondaryUnit: "m",
    primaryUnit: "c",
    secondaryLabelSamplesPerUnit: 48,
  },
  {
    levelIndex: 9,
    pixelsPerSample: 1 / 6,
    zoomPixels: 1,
    zoomSamples: 6,
    tertiaryStepSamples: 48,
    secondaryStepSamples: 480,
    primaryStepSamples: 4800,
    secondaryUnit: "c",
    primaryUnit: "d",
    secondaryLabelSamplesPerUnit: 480,
  },
  {
    levelIndex: 10,
    pixelsPerSample: 1 / 8,
    zoomPixels: 1,
    zoomSamples: 8,
    tertiaryStepSamples: 80,
    secondaryStepSamples: 480,
    primaryStepSamples: 4800,
    secondaryUnit: "c",
    primaryUnit: "d",
    secondaryLabelSamplesPerUnit: 480,
  },
  {
    levelIndex: 11,
    pixelsPerSample: 1 / 12,
    zoomPixels: 1,
    zoomSamples: 12,
    tertiaryStepSamples: 120,
    secondaryStepSamples: 480,
    primaryStepSamples: 4800,
    secondaryUnit: "c",
    primaryUnit: "d",
    secondaryLabelSamplesPerUnit: 480,
  },
  {
    levelIndex: 12,
    pixelsPerSample: 1 / 16,
    zoomPixels: 1,
    zoomSamples: 16,
    tertiaryStepSamples: 160,
    secondaryStepSamples: 480,
    primaryStepSamples: 4800,
    secondaryUnit: "c",
    primaryUnit: "d",
    secondaryLabelSamplesPerUnit: 480,
  },
  {
    levelIndex: 13,
    pixelsPerSample: 1 / 24,
    zoomPixels: 1,
    zoomSamples: 24,
    tertiaryStepSamples: 240,
    secondaryStepSamples: 480,
    primaryStepSamples: 4800,
    secondaryUnit: "c",
    primaryUnit: "d",
    secondaryLabelSamplesPerUnit: 480,
  },
  {
    levelIndex: 14,
    pixelsPerSample: 1 / 32,
    zoomPixels: 1,
    zoomSamples: 32,
    tertiaryStepSamples: 320,
    secondaryStepSamples: 4800,
    primaryStepSamples: 48_000,
    secondaryUnit: "d",
    primaryUnit: "s",
    secondaryLabelSamplesPerUnit: 4_800,
  },
  {
    levelIndex: 15,
    pixelsPerSample: 1 / 48,
    zoomPixels: 1,
    zoomSamples: 48,
    tertiaryStepSamples: 480,
    secondaryStepSamples: 4_800,
    primaryStepSamples: 48_000,
    secondaryUnit: "d",
    primaryUnit: "s",
    secondaryLabelSamplesPerUnit: 4_800,
  },
  {
    levelIndex: 16,
    pixelsPerSample: 1 / 60,
    zoomPixels: 1,
    zoomSamples: 60,
    tertiaryStepSamples: 480,
    secondaryStepSamples: 4_800,
    primaryStepSamples: 48_000,
    secondaryUnit: "d",
    primaryUnit: "s",
    secondaryLabelSamplesPerUnit: 4_800,
  },
  {
    levelIndex: 17,
    pixelsPerSample: 1 / 80,
    zoomPixels: 1,
    zoomSamples: 80,
    tertiaryStepSamples: 800,
    secondaryStepSamples: 4_800,
    primaryStepSamples: 48_000,
    secondaryUnit: "d",
    primaryUnit: "s",
    secondaryLabelSamplesPerUnit: 4_800,
  },
  {
    levelIndex: 18,
    pixelsPerSample: 1 / 96,
    zoomPixels: 1,
    zoomSamples: 96,
    tertiaryStepSamples: 960,
    secondaryStepSamples: 4_800,
    primaryStepSamples: 48_000,
    secondaryUnit: "d",
    primaryUnit: "s",
    secondaryLabelSamplesPerUnit: 4_800,
  },
  {
    levelIndex: 19,
    pixelsPerSample: 1 / 120,
    zoomPixels: 1,
    zoomSamples: 120,
    tertiaryStepSamples: 960,
    secondaryStepSamples: 4_800,
    primaryStepSamples: 48_000,
    secondaryUnit: "d",
    primaryUnit: "s",
    secondaryLabelSamplesPerUnit: 4_800,
  },
  {
    levelIndex: 20,
    pixelsPerSample: 1 / 160,
    zoomPixels: 1,
    zoomSamples: 160,
    tertiaryStepSamples: 1_600,
    secondaryStepSamples: 4_800,
    primaryStepSamples: 48_000,
    secondaryUnit: "d",
    primaryUnit: "s",
    secondaryLabelSamplesPerUnit: 4_800,
  },
  {
    levelIndex: 21,
    pixelsPerSample: 1 / 240,
    zoomPixels: 1,
    zoomSamples: 240,
    tertiaryStepSamples: 2_400,
    secondaryStepSamples: 4_800,
    primaryStepSamples: 48_000,
    secondaryUnit: "d",
    primaryUnit: "s",
    secondaryLabelSamplesPerUnit: 4_800,
  },
  {
    levelIndex: 22,
    pixelsPerSample: 1 / 480,
    zoomPixels: 1,
    zoomSamples: 480,
    tertiaryStepSamples: 4_800,
    secondaryStepSamples: 48_000,
    primaryStepSamples: 2_880_000,
    secondaryUnit: "s",
    primaryUnit: "M",
    secondaryLabelSamplesPerUnit: 48_000,
  },
  {
    levelIndex: 23,
    pixelsPerSample: 1 / 720,
    zoomPixels: 1,
    zoomSamples: 720,
    tertiaryStepSamples: 7_200,
    secondaryStepSamples: 144_000,
    primaryStepSamples: 2_880_000,
    secondaryUnit: "s",
    primaryUnit: "M",
    secondaryLabelSamplesPerUnit: 48_000,
  },
  {
    levelIndex: 24,
    pixelsPerSample: 1 / 960,
    zoomPixels: 1,
    zoomSamples: 960,
    tertiaryStepSamples: 9_600,
    secondaryStepSamples: 144_000,
    primaryStepSamples: 2_880_000,
    secondaryUnit: "s",
    primaryUnit: "M",
    secondaryLabelSamplesPerUnit: 48_000,
  },
  {
    levelIndex: 25,
    pixelsPerSample: 1 / 1200,
    zoomPixels: 1,
    zoomSamples: 1200,
    tertiaryStepSamples: 9_600,
    secondaryStepSamples: 144_000,
    primaryStepSamples: 2_880_000,
    secondaryUnit: "s",
    primaryUnit: "M",
    secondaryLabelSamplesPerUnit: 48_000,
  },
  {
    levelIndex: 26,
    pixelsPerSample: 1 / 1440,
    zoomPixels: 1,
    zoomSamples: 1440,
    tertiaryStepSamples: 14_400,
    secondaryStepSamples: 144_000,
    primaryStepSamples: 2_880_000,
    secondaryUnit: "s",
    primaryUnit: "M",
    secondaryLabelSamplesPerUnit: 48_000,
  },
  {
    levelIndex: 27,
    pixelsPerSample: 1 / 1800,
    zoomPixels: 1,
    zoomSamples: 1800,
    tertiaryStepSamples: 14_400,
    secondaryStepSamples: 144_000,
    primaryStepSamples: 2_880_000,
    secondaryUnit: "s",
    primaryUnit: "M",
    secondaryLabelSamplesPerUnit: 48_000,
  },
  {
    levelIndex: 28,
    pixelsPerSample: 1 / 2400,
    zoomPixels: 1,
    zoomSamples: 2400,
    tertiaryStepSamples: 24_000,
    secondaryStepSamples: 144_000,
    primaryStepSamples: 2_880_000,
    secondaryUnit: "s",
    primaryUnit: "M",
    secondaryLabelSamplesPerUnit: 48_000,
  },
  {
    levelIndex: 29,
    pixelsPerSample: 1 / 2880,
    zoomPixels: 1,
    zoomSamples: 2880,
    tertiaryStepSamples: 28_800,
    secondaryStepSamples: 144_000,
    primaryStepSamples: 2_880_000,
    secondaryUnit: "s",
    primaryUnit: "M",
    secondaryLabelSamplesPerUnit: 48_000,
  },
  {
    levelIndex: 30,
    pixelsPerSample: 1 / 3600,
    zoomPixels: 1,
    zoomSamples: 3600,
    tertiaryStepSamples: 28_800,
    secondaryStepSamples: 144_000,
    primaryStepSamples: 2_880_000,
    secondaryUnit: "s",
    primaryUnit: "M",
    secondaryLabelSamplesPerUnit: 48_000,
  },
  {
    levelIndex: 31,
    pixelsPerSample: 1 / 4800,
    zoomPixels: 1,
    zoomSamples: 4800,
    tertiaryStepSamples: 48_000,
    secondaryStepSamples: 144_000,
    primaryStepSamples: 2_880_000,
    secondaryUnit: "s",
    primaryUnit: "M",
    secondaryLabelSamplesPerUnit: 48_000,
  },
  {
    levelIndex: 32,
    pixelsPerSample: 1 / 7200,
    zoomPixels: 1,
    zoomSamples: 7200,
    tertiaryStepSamples: 72_000,
    secondaryStepSamples: 144_000,
    primaryStepSamples: 2_880_000,
    secondaryUnit: "s",
    primaryUnit: "M",
    secondaryLabelSamplesPerUnit: 48_000,
  },
] as const;

// ---------------------------------------------------------------------------
// TimeScale class
// ---------------------------------------------------------------------------

// Purpose: Represent the mapping between time (in samples/coords) and pixels at a given zoom level.
// How: Own the mutable zoom level index and timebase, expose conversion, snapping, and zoom-change methods directly.
export class TimeScale {
  #zoomLevelIndex: number;
  #timebase: Timebase;

  constructor(zoomLevelIndex: number, timebase: Timebase) {
    this.#zoomLevelIndex = TimeScale.clampZoomLevel(zoomLevelIndex);
    this.#timebase = timebase;
  }

  // --- Accessors ---

  get zoomLevelIndex(): number {
    return this.#zoomLevelIndex;
  }

  get timebase(): Timebase {
    return this.#timebase;
  }

  get pixelsPerSample(): number {
    return EXACT_TIMELINE_SCALE_LEVELS[this.#zoomLevelIndex]!.pixelsPerSample;
  }

  get sampleCoord(): number {
    return this.#timebase.internalTimeFactor;
  }

  // --- Zoom ---

  // Purpose: Change the zoom level, clamped to the lattice bounds.
  // How: Clamp, short-circuit if unchanged, update.
  setZoomLevel(levelIndex: number): boolean {
    const clamped = TimeScale.clampZoomLevel(levelIndex);
    if (clamped === this.#zoomLevelIndex) return false;
    this.#zoomLevelIndex = clamped;
    return true;
  }

  // Purpose: Step the zoom level by one increment.
  // How: Delegate to setZoomLevel with an offset.
  stepZoomLevel(delta: -1 | 1): boolean {
    return this.setZoomLevel(this.#zoomLevelIndex + delta);
  }

  // --- Conversions ---

  // Purpose: Return the full derived scale descriptor for the current zoom level and timebase.
  // How: Delegate to the static lattice lookup with owned state.
  getScale(): ExactTimelineScale {
    return TimeScale.getExactTimelineScale(this.#zoomLevelIndex, this.#timebase);
  }

  // Purpose: Return the snapped grid width for a given viewport width at the current zoom level.
  // How: Keep only the largest multiple of pixels-per-sample that fits inside the viewport, with a minimum of one sample.
  getGridWidthPx(viewportWidthPx: number): number {
    const widthPx = Math.floor(Math.max(0, viewportWidthPx));
    const pps = this.pixelsPerSample;
    const snappedWidthPx = Math.floor(widthPx / pps) * pps;
    return Math.max(pps, snappedWidthPx);
  }

  // Purpose: Return the visible duration in coords for a given viewport width at the current zoom level.
  // How: Convert the snapped grid width into a whole number of visible samples, then map that count to internal coordinates.
  getDurationCoord(viewportWidthPx: number): number {
    const visibleSamples = Math.max(1, Math.floor(this.getGridWidthPx(viewportWidthPx) / this.pixelsPerSample));
    return visibleSamples * this.#timebase.internalTimeFactor;
  }

  // Purpose: Snap a time coordinate to the nearest sample boundary.
  // How: Divide by the sample coordinate quantum, round to the nearest sample index, then convert back.
  snapToSample(timeCoord: number): number {
    const sampleCoord = this.#timebase.internalTimeFactor;
    return Math.round(timeCoord / sampleCoord) * sampleCoord;
  }

  // --- Time coordinate conversions ---

  // Purpose: Convert seconds to exact integer timeline coordinates using the owned timebase.
  toTimeCoord(seconds: number): TimeCoord {
    return Math.round(seconds * this.#timebase.internalTimeRate);
  }

  // Purpose: Convert integer timeline coordinates back to seconds using the owned timebase.
  fromTimeCoord(coord: TimeCoord): number {
    return coord / this.#timebase.internalTimeRate;
  }

  // Purpose: Update the timebase after a project change (e.g. sample rate).
  // How: Replace the stored timebase reference.
  setTimebase(timebase: Timebase): void {
    this.#timebase = timebase;
  }

  // Purpose: Format the current zoom level for UI display.
  // How: Return the compact Z<n> format.
  formatZoomLevel(): string {
    return `Z${this.#zoomLevelIndex}`;
  }

  // --- Static ---

  static readonly levelCount = EXACT_TIMELINE_SCALE_LEVELS.length;
  static readonly levels = EXACT_TIMELINE_SCALE_LEVELS;

  // Purpose: Clamp a requested zoom level index within the implemented lattice bounds.
  // How: Bound the index between 0 and the last available exact level.
  static clampZoomLevel(levelIndex: number): number {
    return Math.min(Math.max(levelIndex, 0), EXACT_TIMELINE_SCALE_LEVELS.length - 1);
  }

  // Purpose: Construct the exact-timeline scale descriptor for any (level, timebase) pair without owning state.
  // How: Look up the level definition, inject the sample-coordinate quantum, and derive all coordinate and pixel spacings.
  static getExactTimelineScale(levelIndex: number, context: Timebase): ExactTimelineScale {
    const sampleCoord = context.internalTimeFactor;
    const level = EXACT_TIMELINE_SCALE_LEVELS[TimeScale.clampZoomLevel(levelIndex)]!;
    return {
      levelIndex: level.levelIndex,
      pixelsPerSample: level.pixelsPerSample,
      zoomPixels: level.zoomPixels,
      zoomSamples: level.zoomSamples,
      sampleCoord,
      tertiaryStepSamples: level.tertiaryStepSamples,
      secondaryStepSamples: level.secondaryStepSamples,
      primaryStepSamples: level.primaryStepSamples,
      secondaryUnit: level.secondaryUnit,
      primaryUnit: level.primaryUnit,
      secondaryLabelSamplesPerUnit: level.secondaryLabelSamplesPerUnit,
      tertiaryStepCoord: level.tertiaryStepSamples * sampleCoord,
      secondaryStepCoord: level.secondaryStepSamples * sampleCoord,
      primaryStepCoord: level.primaryStepSamples * sampleCoord,
      tertiarySpacingPx: level.tertiaryStepSamples * level.pixelsPerSample,
      secondarySpacingPx: level.secondaryStepSamples * level.pixelsPerSample,
      primarySpacingPx: level.primaryStepSamples * level.pixelsPerSample,
    };
  }
}
