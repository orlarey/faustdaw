/******************************** bench-page.ts ********************************
 *
 * Purpose: Page set-up shared by the browser benchmarks: open the demo, turn
 *          on the perf instrumentation, generate the dense project.
 * How: Wait for `body[data-app-ready=true]` (set by demo/main.ts once the
 *      bootstrap is over), then go through the two window hooks the demo
 *      exposes: `__webdawPerf` (demo/perf.ts) and `__webdawBench`
 *      (demo/bench-hooks.ts).
 *
 ******************************************************************************/
import { expect, type Page } from "@playwright/test";

/** The dense scenario of the benchmarks: 2000 clips of 0.1–2 s, 0.2 s apart, over the 8 tracks. */
export const DENSE_PROJECT = { count: 2000, minLength: 0.1, maxLength: 2, gap: 0.2 };

/** Open the demo on a fresh draft and wait until it is ready. */
export async function openDemo(page: Page): Promise<void> {
  await page.goto("/demo/");
  await expect(page.locator("body")).toHaveAttribute("data-app-ready", "true", { timeout: 30_000 });
  await expect(page.locator("#timeline-ruler")).toBeVisible();
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
