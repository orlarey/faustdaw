import { defineConfig, devices } from "@playwright/test";

/**
 * A 4K screen (3840 × 2160 device pixels) with the DAW window full screen: the viewport is the whole screen
 * (headless Chromium has no browser chrome) and the page enters the Fullscreen API (benchmarks/bench-page.ts).
 * Two ways to drive the same 8.3 Mpx: the usual HiDPI setting (1920 × 1080 CSS px at devicePixelRatio 2, as
 * macOS and Windows at 200 % scaling do) and the native one (3840 × 2160 CSS px at devicePixelRatio 1, twice
 * the timeline span in view). `--project=4k-hidpi` or `--project=4k-native` runs one of them.
 */
function fullScreen4k(name: string, width: number, height: number, deviceScaleFactor: number) {
  return {
    name,
    use: {
      ...devices["Desktop Chrome"],
      browserName: "chromium" as const,
      viewport: { width, height },
      screen: { width, height },
      deviceScaleFactor,
      // A Chromium other than the one bundled with this Playwright version (e.g. a pre-installed one).
      ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
    },
  };
}

export default defineConfig({
  testDir: "./benchmarks",
  timeout: 180_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  // One page at a time: two benchmarks sharing the CPU would measure each other.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4183",
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    fullScreen4k("4k-hidpi", 1920, 1080, 2),
    fullScreen4k("4k-native", 3840, 2160, 1),
  ],
  webServer: {
    command: "npm run serve",
    url: "http://127.0.0.1:4183/demo/",
    reuseExistingServer: true,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  },
});
