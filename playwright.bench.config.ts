import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./benchmarks",
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  // One page at a time: two benchmarks sharing the CPU would measure each other.
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4183",
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        // A Chromium other than the one bundled with this Playwright version (e.g. a pre-installed one).
        ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
      },
    },
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
