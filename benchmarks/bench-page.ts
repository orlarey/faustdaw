/******************************** bench-page.ts ********************************
 *
 * Purpose: Page set-up shared by the browser benchmarks: open the demo full
 *          screen, turn on the perf instrumentation, generate the dense
 *          project, and measure the frames actually produced during a pan.
 * How: Wait for `body[data-app-ready=true]` (set by demo/main.ts once the
 *      bootstrap is over), enter the Fullscreen API and check that the window
 *      covers the screen, then go through the two window hooks the demo
 *      exposes: `__webdawPerf` (demo/perf.ts) and `__webdawBench`
 *      (demo/bench-hooks.ts). The `__webdawPerf` timers measure JavaScript
 *      only; the paint and the composition of the frame, which grow with the
 *      number of pixels, show in the intervals between animation frames
 *      (`requestAnimationFrame` timestamps), summarized by `summarizeFrames`.
 *
 ******************************************************************************/
import { expect, type Page } from "@playwright/test";

/** The dense scenario of the benchmarks: 2000 clips of 0.1–2 s, 0.2 s apart, over the 8 tracks. */
export const DENSE_PROJECT = { count: 2000, minLength: 0.1, maxLength: 2, gap: 0.2 };

/** The display a benchmark ran on. */
export type DisplayInfo = {
  fullscreen: boolean;
  cssPx: [number, number];
  devicePixelRatio: number;
  devicePx: [number, number];
  /** The timeline grid, in CSS px. */
  timelineCssPx: [number, number];
  webglRenderer: string | null;
};

/** Open the demo on a fresh draft, full screen, and wait until it is ready. */
export async function openDemo(page: Page): Promise<DisplayInfo> {
  await page.goto("/demo/");
  await expect(page.locator("body")).toHaveAttribute("data-app-ready", "true", { timeout: 30_000 });
  await expect(page.locator("#timeline-ruler")).toBeVisible();
  const display = await page.evaluate(async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
    // Let the resize settle (the demo re-renders on the next animation frame).
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const grid = document.getElementById("timeline-grid")!.getBoundingClientRect();
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const dpr = window.devicePixelRatio;
    return {
      fullscreen: document.fullscreenElement !== null,
      cssPx: [window.innerWidth, window.innerHeight] as [number, number],
      screenPx: [screen.width, screen.height] as [number, number],
      devicePixelRatio: dpr,
      devicePx: [Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr)] as [number, number],
      timelineCssPx: [Math.round(grid.width), Math.round(grid.height)] as [number, number],
      webglRenderer: info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null,
    };
  });
  expect(display.fullscreen, "the DAW window is full screen").toBe(true);
  expect(display.cssPx, "the window covers the screen").toEqual(display.screenPx);
  const { screenPx: _screen, ...rest } = display;
  return rest;
}

/** Turn the perf instrumentation on (it also clears what was recorded). */
export async function enablePerf(page: Page): Promise<void> {
  await page.evaluate(() => {
    const perf = (window as unknown as { __webdawPerf?: { enable: () => void } }).__webdawPerf;
    if (!perf) throw new Error("Missing window.__webdawPerf");
    perf.enable();
  });
}

/** Replace the project by the dense one and return its clip count. */
export async function generateDenseProject(page: Page): Promise<number> {
  const count = await page.evaluate((options) => {
    const bench = (window as unknown as {
      __webdawBench?: { generateClips: (options: object) => number; clipCount: () => number };
    }).__webdawBench;
    if (!bench) throw new Error("Missing window.__webdawBench");
    bench.generateClips(options);
    return bench.clipCount();
  }, DENSE_PROJECT);
  expect(count).toBe(DENSE_PROJECT.count);
  // Let the first frames (waveform textures, sliding buffers) settle before measuring.
  await page.waitForTimeout(300);
  return count;
}

/** The frames produced during a gesture. */
export type FrameStats = {
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** Intervals longer than 1.5 frames of 60 Hz (25 ms): at least one frame was missed. */
  longFrames: number;
  fps: number;
};

const LONG_FRAME_MS = 25;

/** Summarize intervals between animation frames, in ms. */
export function summarizeFrames(intervals: readonly number[]): FrameStats {
  const sorted = [...intervals].sort((left, right) => left - right);
  const at = (q: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    frames: sorted.length,
    meanMs: sorted.length === 0 ? 0 : total / sorted.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    maxMs: sorted.length === 0 ? 0 : sorted[sorted.length - 1]!,
    longFrames: sorted.filter((value) => value > LONG_FRAME_MS).length,
    fps: total === 0 ? 0 : (1000 * sorted.length) / total,
  };
}

/** Start recording animation-frame intervals in the page (until `stopFrameRecorder`). */
export async function startFrameRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const recorder = { intervals: [] as number[], last: null as number | null, running: true };
    (window as unknown as { __benchFrames?: typeof recorder }).__benchFrames = recorder;
    const step = (timestamp: number) => {
      if (!recorder.running) return;
      if (recorder.last !== null) recorder.intervals.push(timestamp - recorder.last);
      recorder.last = timestamp;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Stop the recorder and return the intervals between the frames it saw. */
export async function stopFrameRecorder(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const recorder = (window as unknown as { __benchFrames?: { intervals: number[]; running: boolean } }).__benchFrames;
    if (!recorder) throw new Error("No frame recorder");
    recorder.running = false;
    return recorder.intervals;
  });
}
