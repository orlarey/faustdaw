/****************************** preset-transition.ts **************************
 *
 * Purpose: Pure timing primitive and interpolation helpers for the
 *          continuous configuration glides described in PRESETSPEC.md
 *          §"Transitions dynamiques". Used as the building block for
 *          portamento on cursor navigation (phase 6b) and for the loop
 *          mode (phase 6c).
 * How: `TransitionTimer` carries no audio / config knowledge — it only
 *      tracks `(startTime, durationMs)` and exposes the linear time
 *      ratio α ∈ [0, 1]. Pure `lerpConfig` and `lerpCenter` helpers do
 *      the niveau-0 (per-parameter) and niveau-1 (centre in the 2D
 *      projection) interpolation respectively. Interruption (replacing a
 *      running transition) is a caller-side concern : grab the current
 *      interpolated value via `lerpConfig` at the current α, then start
 *      a fresh transition with that value as the new origin.
 *
 ******************************************************************************/

/**
 * Purpose: Linear time ratio for a fixed-duration transition.
 * How: `start(durationMs, now)` arms the timer at `now`. `alpha(now)`
 *      returns `clamp(0, 1, (now - startTime) / durationMs)`, or `null`
 *      when not started. `durationMs <= 0` short-circuits to α = 1
 *      (instant jump). `stop()` re-arms the timer to inactive.
 */
export class TransitionTimer {
  #startTime: number | null = null;
  #durationMs: number = 0;

  start(durationMs: number, now: number = Date.now()): void {
    this.#startTime = now;
    this.#durationMs = Math.max(0, durationMs);
  }

  alpha(now: number = Date.now()): number | null {
    if (this.#startTime === null) return null;
    if (this.#durationMs <= 0) return 1;
    const t = (now - this.#startTime) / this.#durationMs;
    return Math.max(0, Math.min(1, t));
  }

  /**
   * Purpose: True while the timer is glide-in-progress (α < 1). False once
   *          the transition has reached its target or when inactive.
   * How: Compares `now` against `startTime + durationMs`. A zero-duration
   *      transition is never « in progress » (α was already 1 at start).
   */
  isActive(now: number = Date.now()): boolean {
    if (this.#startTime === null) return false;
    if (this.#durationMs <= 0) return false;
    return now < this.#startTime + this.#durationMs;
  }

  stop(): void {
    this.#startTime = null;
  }
}

/**
 * Purpose: Niveau-0 interpolation — linear blend between two parameter
 *          configurations, addressing one parameter at a time.
 * How: For each address listed in `addresses`, take `start[a] + α·(target[a] − start[a])`,
 *      defaulting missing keys to 0 so the caller can pass partial maps.
 *      The result covers exactly `addresses` and is safe to feed into the
 *      audio node and the domain model.
 */
export function lerpConfig(
  start: Readonly<Record<string, number>>,
  target: Readonly<Record<string, number>>,
  alpha: number,
  addresses: ReadonlyArray<string>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const address of addresses) {
    const s = start[address] ?? 0;
    const t = target[address] ?? 0;
    result[address] = s + (t - s) * alpha;
  }
  return result;
}

/**
 * Purpose: Niveau-1 interpolation — straight line between two centre
 *          positions in the projection's 2D plane. The caller then passes
 *          the resulting point through ψ to obtain the audible config.
 * How: Component-wise linear interpolation. For α = 0 returns `start`,
 *      for α = 1 returns `target`.
 */
export function lerpCenter(
  start: readonly [number, number],
  target: readonly [number, number],
  alpha: number,
): readonly [number, number] {
  return [
    start[0] + (target[0] - start[0]) * alpha,
    start[1] + (target[1] - start[1]) * alpha,
  ];
}
