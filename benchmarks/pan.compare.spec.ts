import { expect, test, type Page } from "@playwright/test";

import { enablePerf, generateDenseProject, openDemo } from "./bench-page.js";

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

type ScenarioResult = {
  scenario: "empty" | "dense";
  iterations: number;
  warmupIterations: number;
  runs: AggregatedPerfRow[][];
  summary: AggregatedPerfRow[];
};

type ComparisonRow = {
  metric: string;
  emptyTotalMs: number;
  denseTotalMs: number;
  deltaTotalMs: number;
  ratioTotalMs: number | null;
  emptyMeanMs: number;
  denseMeanMs: number;
  deltaMeanMs: number;
  ratioMeanMs: number | null;
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

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summarizeRuns(runs: AggregatedPerfRow[][]): AggregatedPerfRow[] {
  const perMetric = new Map<string, AggregatedPerfRow[]>();
  for (const run of runs) {
    for (const row of run) {
      const rows = perMetric.get(row.metric);
      if (rows) {
        rows.push(row);
      } else {
        perMetric.set(row.metric, [row]);
      }
    }
  }

  return Array.from(perMetric.entries())
    .map(([metric, rows]) => ({
      metric,
      count: rows.length,
      totalMs: median(rows.map((row) => row.totalMs)),
      meanMs: median(rows.map((row) => row.meanMs)),
      maxMs: median(rows.map((row) => row.maxMs)),
    }))
    .sort((left, right) => right.totalMs - left.totalMs);
}

async function resetPerf(page: Page): Promise<void> {
  await page.evaluate(() => {
    const perfApi = (window as typeof window & { __webdawPerf?: PerfApi }).__webdawPerf;
    perfApi?.reset();
  });
}

async function readPerf(page: Page): Promise<PerfReport[]> {
  return page.evaluate(() => {
    const perfApi = (window as typeof window & { __webdawPerf?: PerfApi }).__webdawPerf;
    return perfApi?.history() ?? [];
  });
}

async function readPerfSnapshot(
  page: Page,
): Promise<Record<string, { count: number; totalMs: number; maxMs: number }>> {
  return page.evaluate(() => {
    const perfApi = (window as typeof window & { __webdawPerf?: PerfApi }).__webdawPerf;
    return perfApi?.snapshot() ?? {};
  });
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

async function measureSteadyPanSnapshot(
  page: Page,
): Promise<Record<string, { count: number; totalMs: number; maxMs: number }>> {
  return page.evaluate(async () => {
    const ruler = document.getElementById("timeline-ruler") as HTMLElement | null;
    if (!ruler) {
      throw new Error("Missing timeline ruler");
    }
    const perfApi = (window as typeof window & { __webdawPerf?: PerfApi }).__webdawPerf;
    if (!perfApi) {
      throw new Error("Missing perf API");
    }
    const rect = ruler.getBoundingClientRect();
    const startX = rect.left + rect.width * 0.72;
    const endX = rect.left + rect.width * 0.18;
    const y = rect.top + rect.height * 0.5;
    const startupSteps = 6;
    const measuredSteps = 18;
    const totalSteps = startupSteps + measuredSteps;
    const pointerId = 1;

    const dispatch = (type: string, clientX: number) => {
      ruler.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        buttons: type === "pointerup" ? 0 : 1,
        button: 0,
        clientX,
        clientY: y,
      }));
    };

    dispatch("pointerdown", startX);
    for (let step = 1; step <= startupSteps; step += 1) {
      const progress = step / totalSteps;
      const x = startX + (endX - startX) * progress;
      dispatch("pointermove", x);
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }

    // Measure only the steady-state middle of the drag, excluding the
    // initial gesture lock and the release/final settle.
    perfApi.reset();

    for (let step = startupSteps + 1; step <= totalSteps; step += 1) {
      const progress = step / totalSteps;
      const x = startX + (endX - startX) * progress;
      dispatch("pointermove", x);
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }

    const snapshot = perfApi.snapshot();
    dispatch("pointerup", endX);
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    return snapshot;
  });
}

async function runScenario(page: Page, scenario: "empty" | "dense"): Promise<ScenarioResult> {
  const WARMUP_ITERATIONS = 1;
  const MEASURED_ITERATIONS = 5;

  await openDemo(page);
  await enablePerf(page);

  if (scenario === "dense") {
    await generateDenseProject(page);
  }

  await page.mouse.move(20, 20);
  await page.waitForTimeout(50);
  const runs: AggregatedPerfRow[][] = [];

  for (let iteration = 0; iteration < WARMUP_ITERATIONS + MEASURED_ITERATIONS; iteration += 1) {
    await resetPerf(page);
    const snapshot = await measureSteadyPanSnapshot(page);
    const aggregated = aggregateSnapshot(snapshot);
    if (aggregated.length === 0) {
      throw new Error(`No perf metrics collected for scenario: ${scenario}, iteration: ${iteration}`);
    }
    if (iteration >= WARMUP_ITERATIONS) {
      runs.push(aggregated);
    }
  }

  return {
    scenario,
    iterations: MEASURED_ITERATIONS,
    warmupIterations: WARMUP_ITERATIONS,
    runs,
    summary: summarizeRuns(runs),
  };
}

function buildComparison(empty: ScenarioResult, dense: ScenarioResult): ComparisonRow[] {
  const emptyMap = new Map(empty.summary.map((row) => [row.metric, row]));
  const denseMap = new Map(dense.summary.map((row) => [row.metric, row]));
  const metrics = new Set<string>([
    ...emptyMap.keys(),
    ...denseMap.keys(),
  ]);

  return Array.from(metrics)
    .map((metric) => {
      const emptyRow = emptyMap.get(metric);
      const denseRow = denseMap.get(metric);
      const emptyTotalMs = emptyRow?.totalMs ?? 0;
      const denseTotalMs = denseRow?.totalMs ?? 0;
      const emptyMeanMs = emptyRow?.meanMs ?? 0;
      const denseMeanMs = denseRow?.meanMs ?? 0;

      return {
        metric,
        emptyTotalMs,
        denseTotalMs,
        deltaTotalMs: denseTotalMs - emptyTotalMs,
        ratioTotalMs: emptyTotalMs > 0 ? denseTotalMs / emptyTotalMs : denseTotalMs > 0 ? null : 1,
        emptyMeanMs,
        denseMeanMs,
        deltaMeanMs: denseMeanMs - emptyMeanMs,
        ratioMeanMs: emptyMeanMs > 0 ? denseMeanMs / emptyMeanMs : denseMeanMs > 0 ? null : 1,
      };
    })
    .sort((left, right) => right.deltaTotalMs - left.deltaTotalMs);
}

test("compare steady-state ruler pan cost between empty and dense project", async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  const empty = await runScenario(page, "empty");
  const dense = await runScenario(page, "dense");
  const comparison = buildComparison(empty, dense);

  const result = {
    scenarios: {
      empty,
      dense,
    },
    comparison,
  };

  await testInfo.attach("pan-compare", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });

  console.log("[bench-json]", JSON.stringify(result));

  expect(comparison.length).toBeGreaterThan(0);
});
