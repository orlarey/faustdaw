import { defineConfig } from "@playwright/test";

import base from "./playwright.bench.config.js";

// The same benchmarks against a server already running on port 4183 (npm run serve).
export default defineConfig({ ...base, webServer: undefined });
