import { expect, test } from "@playwright/test";

type PerfRow = {
  metric: string;
  count: number;
  meanMs: number;
  maxMs: number;
  totalMs: number;
};

type PerfReport = {
  timestamp: number;
  metricCount: number;
  rows: PerfRow[];
};

type PerfApi = {
  history: () => PerfReport[];
  reset: () => void;
  snapshot: () => Record<
    string,
    {
      count: number;
      totalMs: number;
      maxMs: number;
    }
  >;
};

type AggregatedPerfRow = {
  metric: string;
  count: number;
  totalMs: number;
  meanMs: number;
  maxMs: number;
};

function aggregateReports(reports: PerfReport[]): AggregatedPerfRow[] {
  const aggregates = new Map<string, AggregatedPerfRow>();
  for (const report of reports) {
    for (const row of report.rows) {
      const current = aggregates.get(row.metric);
      if (current) {
        current.count += row.count;
        current.totalMs += row.totalMs;
        current.maxMs = Math.max(current.maxMs, row.maxMs);
        continue;
      }

      aggregates.set(row.metric, {
        metric: row.metric,
        count: row.count,
        totalMs: row.totalMs,
        meanMs: 0,
        maxMs: row.maxMs,
      });
    }
  }

  return Array.from(aggregates.values())
    .map((row) => ({
      ...row,
      meanMs: row.totalMs / row.count,
    }))
    .sort((left, right) => right.totalMs - left.totalMs);
}

function aggregateSnapshot(
  snapshot: Record<string, { count: number; totalMs: number; maxMs: number }>,
): AggregatedPerfRow[] {
  return Object.entries(snapshot)
    .map(([metric, aggregate]) => ({
      metric,
      count: aggregate.count,
      totalMs: aggregate.totalMs,
      meanMs: aggregate.totalMs / aggregate.count,
      maxMs: aggregate.maxMs,
    }))
    .sort((left, right) => right.totalMs - left.totalMs);
}

async function setCheckbox(page: Parameters<typeof test>[0]["page"], selector: string, checked: boolean): Promise<void> {
  const checkbox = page.locator(selector);
  await expect(checkbox).toBeVisible();
  if ((await checkbox.isChecked()) !== checked) {
    await checkbox.click();
  }
}

test("bench dense ruler pan", async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  await page.goto("/demo/");
  await page.waitForLoadState("networkidle");

  await setCheckbox(page, "#perf-logging-enabled", true);
  await page.evaluate(() => {
    const perfApi = (window as typeof window & { __webdawPerf?: PerfApi }).__webdawPerf;
    perfApi?.reset();
  });

  await page.locator("#generator-prefix").fill("stress");
  await page.locator("#generator-mode").selectOption("round-robin");
  await page.locator("#generator-count").fill("2000");
  await page.locator("#generator-min-length").fill("0.1");
  await page.locator("#generator-max-length").fill("2");
  await page.locator("#generator-gap").fill("0.2");
  await page.locator("#generator-form button[type='submit']").click();

  await page.waitForFunction(() => {
    return document.querySelectorAll("#clips-layer .clip-block").length > 0;
  });

  await page.evaluate(() => {
    const perfApi = (window as typeof window & { __webdawPerf?: PerfApi }).__webdawPerf;
    perfApi?.reset();
  });

  const ruler = page.locator("#timeline-ruler");
  await expect(ruler).toBeVisible();
  const box = await ruler.boundingBox();
  if (!box) {
    throw new Error("Missing timeline ruler bounds");
  }

  const startX = box.x + box.width * 0.7;
  const endX = box.x + box.width * 0.2;
  const y = box.y + box.height * 0.5;
  const steps = 24;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const x = startX + (endX - startX) * progress;
    await page.mouse.move(x, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);

  const perfData = await page.evaluate(() => {
    const perfApi = (window as typeof window & { __webdawPerf?: PerfApi }).__webdawPerf;
    return {
      history: perfApi?.history() ?? [],
      snapshot: perfApi?.snapshot() ?? {},
    };
  });
  const reports = perfData.history;
  const aggregated = reports.length > 0 ? aggregateReports(reports) : aggregateSnapshot(perfData.snapshot);

  const result = {
    scenario: "dense-ruler-pan",
    reportCount: reports.length,
    aggregated,
    raw: reports,
    snapshot: perfData.snapshot,
  };

  await testInfo.attach("dense-ruler-pan", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });

  console.log("[bench-json]", JSON.stringify(result));

  expect(result.aggregated.length).toBeGreaterThan(0);
});
