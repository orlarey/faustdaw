/**
 * Purpose: Define the exact integer time coordinate system used across the DAW domain.
 * How: Represent time as integer coordinates backed by a derived timebase that stays aligned with the project sample rate.
 */
export type TimeCoord = number;

/**
 * Purpose: Compute the greatest common divisor needed to derive the minimal internal timeline resolution.
 * How: Apply the Euclidean algorithm on the positive integer operands until the remainder becomes zero.
 */
function gcd(left: number, right: number): number {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));

  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a;
}

/**
 * Purpose: Own the exact conversion factors between audio samples, internal coordinates, and seconds.
 * How: Store the source sample rate, derive the minimal internal multiplicative factor, and expose conversion methods.
 */
export class Timebase {
  readonly sampleRate: number;
  readonly internalTimeFactor: number;
  readonly internalTimeRate: number;

  constructor(sampleRate: number) {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
      throw new Error("Precondition violation: sampleRate must be a positive integer");
    }
    this.sampleRate = sampleRate;
    this.internalTimeFactor = 1000 / gcd(sampleRate, 1000);
    this.internalTimeRate = sampleRate * this.internalTimeFactor;
  }

  /**
   * Purpose: Convert a duration expressed in seconds into exact integer timeline coordinates.
   * How: Multiply the second value by the internal timeline rate and round to the nearest integer coordinate.
   */
  toTimeCoord(seconds: number): TimeCoord {
    return Math.round(seconds * this.internalTimeRate);
  }

  /**
   * Purpose: Convert integer timeline coordinates back into seconds for UI and tests.
   * How: Divide the coordinate by the internal timeline rate.
   */
  fromTimeCoord(timeCoord: TimeCoord): number {
    return timeCoord / this.internalTimeRate;
  }
}

