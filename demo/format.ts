/********************************* format.ts ***********************************
 *
 * Purpose: Decompose internal time coordinates into human-readable labels.
 * How: Break an absolute time coordinate into hours, minutes, seconds and
 *      sub-second fields, then format them as ruler labels per TIMELINESPEC.
 *
 ******************************************************************************/
import type { Timebase } from "../src/domain/timebase.js";

// ---------------------------------------------------------------------------
// Arithmetic helpers
// ---------------------------------------------------------------------------

/**
 * Purpose: Perform a floored integer division.
 * How: Use Math.floor to ensure the result rounds toward negative infinity.
 */
export function floorDivide(dividend: number, divisor: number): number {
  return Math.floor(dividend / divisor);
}

/**
 * Purpose: Compute a modulo that always returns a non-negative result.
 * How: Adjust the standard JS remainder by adding the divisor before re-applying modulo.
 */
export function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

// ---------------------------------------------------------------------------
// Time decomposition
// ---------------------------------------------------------------------------

/**
 * Purpose: Split an internal time coordinate into sign, hours, minutes, seconds, and sub-second fields.
 * How: Successively divide the absolute value by each unit's coordinate size and collect the remainders.
 */
export function decomposeAbsoluteTime(timeCoord: number, timebase: Timebase) {
  const normalized = timeCoord === 0 ? 0 : timeCoord;
  const sign = normalized < 0 ? "-" : "";
  const absoluteCoord = Math.abs(normalized);
  let remaining = absoluteCoord;
  const hourCoord = 3600 * timebase.internalTimeRate;
  const minuteCoord = 60 * timebase.internalTimeRate;
  const secondCoord = timebase.internalTimeRate;
  const tenthCoord = timebase.internalTimeRate / 10;
  const centisecondCoord = timebase.internalTimeRate / 100;
  const millisecondCoord = timebase.internalTimeRate / 1000;

  const hours = floorDivide(remaining, hourCoord);
  remaining -= hours * hourCoord;
  const minutes = floorDivide(remaining, minuteCoord);
  remaining -= minutes * minuteCoord;
  const seconds = floorDivide(remaining, secondCoord);
  remaining -= seconds * secondCoord;
  const tenths = floorDivide(remaining, tenthCoord);
  const centiseconds = floorDivide(remaining, centisecondCoord);
  const milliseconds = floorDivide(remaining, millisecondCoord);
  const millisecondsWithinCentisecond = milliseconds % 10;
  const millisecondsRemainderCoord = positiveModulo(absoluteCoord, millisecondCoord);
  const extraSamples = floorDivide(millisecondsRemainderCoord, timebase.internalTimeFactor);

  return {
    sign,
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
    tenth: String(tenths),
    centisecond: String(centiseconds).padStart(2, "0"),
    millisecond: String(millisecondsWithinCentisecond),
    extraSamples,
  };
}

function getExtendedTimeSuffixWidth(timebase: Timebase): number {
  return Math.max(2, String(Math.ceil(timebase.sampleRate / 1000)).length);
}

// ---------------------------------------------------------------------------
// Label formatting
// ---------------------------------------------------------------------------

export type AbsoluteTimeLabelOptions = {
  showExtraSamples?: boolean;
};

/**
 * Purpose: Format a full-precision absolute time label (HH:MM:SS.mmm[+ee]) with controllable sample residue display.
 * How: Decompose the time, concatenate all fields down to the millisecond, and append the sample residue only when enabled and non-zero.
 */
export function formatAbsoluteTimeLabel(
  timeCoord: number,
  timebase: Timebase,
  options: AbsoluteTimeLabelOptions = {},
): string {
  const fields = decomposeAbsoluteTime(timeCoord, timebase);
  const baseLabel = `${fields.sign}${fields.hours}:${fields.minutes}:${fields.seconds}.${fields.centisecond}${fields.millisecond}`;
  if (options.showExtraSamples === false || fields.extraSamples <= 0) {
    return baseLabel;
  }
  return `${baseLabel}+${String(fields.extraSamples).padStart(getExtendedTimeSuffixWidth(timebase), "0")}`;
}

/**
 * Purpose: Decide whether one explicit zoom level exposes per-sample residue in time labels.
 * How: Compare the inverse of the provided pixels-per-sample ratio against a fixed threshold.
 */
function shouldShowSampleResidueAtZoom(pixelsPerSample: number): boolean {
  return pixelsPerSample > 0 && (1 / pixelsPerSample) < 48;
}

/**
 * Purpose: Format an absolute time label whose sample residue toggle follows one explicit zoom density.
 * How: Derive the residue flag from the caller-provided pixels-per-sample ratio.
 */
export function formatCurrentAbsoluteTimeLabel(
  timeCoord: number,
  timebase: Timebase,
  pixelsPerSample: number,
): string {
  return formatAbsoluteTimeLabel(timeCoord, timebase, {
    showExtraSamples: shouldShowSampleResidueAtZoom(pixelsPerSample),
  });
}

/**
 * Purpose: Parse an absolute time label in HH:MM:SS.mmm[+ee] form into an internal time coordinate.
 * How: Validate the textual shape, decode each field, then convert the assembled signed seconds value and optional sample residue through the shared timebase.
 */
export function parseAbsoluteTimeLabel(value: string, timebase: Timebase): number {
  const trimmed = value.trim();
  const match = /^(-)?(\d{2,}):([0-5]\d):([0-5]\d)\.(\d{3})(?:\+(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error('Expected timecode in "HH:MM:SS.MMM" or "HH:MM:SS.MMM+EE" format');
  }

  const [, signToken, hoursToken, minutesToken, secondsToken, millisecondsToken, extraSamplesToken] = match;
  const sign = signToken ? -1 : 1;
  const hours = Number(hoursToken);
  const minutes = Number(minutesToken);
  const seconds = Number(secondsToken);
  const milliseconds = Number(millisecondsToken);
  const extraSamples = extraSamplesToken ? Number(extraSamplesToken) : 0;
  if (!Number.isInteger(extraSamples) || extraSamples < 0) {
    throw new Error("Invalid sample residue");
  }
  const totalMilliseconds = (((hours * 60 + minutes) * 60) + seconds) * 1000 + milliseconds;
  return sign * (Math.round((totalMilliseconds / 1000) * timebase.internalTimeRate) + extraSamples * timebase.internalTimeFactor);
}
