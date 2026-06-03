/*********************************** perf.ts ***********************************
 *
 * Purpose: Provide optional runtime performance instrumentation for the demo.
 * How: Aggregate named timing samples while instrumentation is enabled, then
 *      periodically print compact summaries to the browser console.
 *
 ******************************************************************************/
import { demoState } from "./state.js";

type PerfAggregate = {
  count: number;
  totalMs: number;
  maxMs: number;
};

type PerfCounterAggregate = {
  count: number;
  total: number;
  max: number;
};

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
  counterRows: PerfCounterRow[];
};

type PerfCounterRow = {
  metric: string;
  count: number;
  mean: number;
  max: number;
  total: number;
};

const aggregates = new Map<string, PerfAggregate>();
const counters = new Map<string, PerfCounterAggregate>();
const history: PerfReport[] = [];
let lastFlushTimestamp = performance.now();
const PERF_FLUSH_INTERVAL_MS = 1000;

function getAggregate(name: string): PerfAggregate {
  let aggregate = aggregates.get(name);
  if (!aggregate) {
    aggregate = { count: 0, totalMs: 0, maxMs: 0 };
    aggregates.set(name, aggregate);
  }
  return aggregate;
}

function getCounterAggregate(name: string): PerfCounterAggregate {
  let aggregate = counters.get(name);
  if (!aggregate) {
    aggregate = { count: 0, total: 0, max: 0 };
    counters.set(name, aggregate);
  }
  return aggregate;
}

function flushPerfAggregates(): void {
  if (!demoState.devFlags.perfLogging || (aggregates.size === 0 && counters.size === 0)) {
    return;
  }

  const rows: PerfRow[] = Array.from(aggregates.entries())
    .map(([name, aggregate]) => ({
      metric: name,
      count: aggregate.count,
      meanMs: aggregate.totalMs / aggregate.count,
      maxMs: aggregate.maxMs,
      totalMs: aggregate.totalMs,
    }))
    .sort((left, right) => right.totalMs - left.totalMs);
  const counterRows: PerfCounterRow[] = Array.from(counters.entries())
    .map(([name, aggregate]) => ({
      metric: name,
      count: aggregate.count,
      mean: aggregate.total / aggregate.count,
      max: aggregate.max,
      total: aggregate.total,
    }))
    .sort((left, right) => right.total - left.total);
  const report: PerfReport = {
    timestamp: Date.now(),
    metricCount: rows.length,
    rows,
    counterRows,
  };
  history.push(report);

  console.groupCollapsed(`[perf] ${rows.length} timers / ${counterRows.length} counters`);
  if (rows.length > 0) {
    console.table(rows);
  }
  if (counterRows.length > 0) {
    console.table(counterRows);
  }
  console.log("[perf-json]", JSON.stringify(report));
  console.groupEnd();
  aggregates.clear();
  counters.clear();
  lastFlushTimestamp = performance.now();
}

function maybeFlushPerfAggregates(): void {
  if (!demoState.devFlags.perfLogging) {
    if (aggregates.size > 0) {
      aggregates.clear();
    }
    if (counters.size > 0) {
      counters.clear();
    }
    lastFlushTimestamp = performance.now();
    return;
  }

  const now = performance.now();
  if (now - lastFlushTimestamp >= PERF_FLUSH_INTERVAL_MS) {
    flushPerfAggregates();
  }
}

/**
 * Purpose: Record one named duration sample for later console reporting.
 * How: Update the aggregate counters for that metric and flush periodically.
 */
function recordPerf(name: string, durationMs: number): void {
  if (!demoState.devFlags.perfLogging) {
    return;
  }

  const aggregate = getAggregate(name);
  aggregate.count += 1;
  aggregate.totalMs += durationMs;
  aggregate.maxMs = Math.max(aggregate.maxMs, durationMs);
  maybeFlushPerfAggregates();
}

/**
 * Purpose: Record one named numeric counter sample for later console reporting.
 * How: Update the aggregate counters for that metric and flush periodically.
 */
export function recordPerfCounter(name: string, value: number): void {
  if (!demoState.devFlags.perfLogging) {
    return;
  }

  const aggregate = getCounterAggregate(name);
  aggregate.count += 1;
  aggregate.total += value;
  aggregate.max = Math.max(aggregate.max, value);
  maybeFlushPerfAggregates();
}

/**
 * Purpose: Measure the duration of one synchronous code section.
 * How: Time the callback with performance.now, record the sample if enabled, and return the callback result.
 */
export function measurePerf<T>(name: string, fn: () => T): T {
  if (!demoState.devFlags.perfLogging) {
    return fn();
  }

  const start = performance.now();
  try {
    return fn();
  } finally {
    recordPerf(name, performance.now() - start);
  }
}

/**
 * Purpose: Reset the aggregated instrumentation state when logging is disabled or re-enabled.
 * How: Clear all accumulated metrics and restart the flush timer from now.
 */
function resetPerfLogging(): void {
  aggregates.clear();
  counters.clear();
  history.length = 0;
  lastFlushTimestamp = performance.now();
}

/**
 * Purpose: Expose the latest aggregate snapshot to the browser console for ad hoc inspection.
 * How: Return a serializable copy of the in-memory aggregate map.
 */
function getPerfSnapshot(): Record<string, PerfAggregate> {
  return Object.fromEntries(
    Array.from(aggregates.entries()).map(([name, aggregate]) => [name, { ...aggregate }]),
  );
}

/**
 * Purpose: Expose the latest numeric counter snapshot to the browser console for ad hoc inspection.
 * How: Return a serializable copy of the in-memory counter map.
 */
function getPerfCounterSnapshot(): Record<string, PerfCounterAggregate> {
  return Object.fromEntries(
    Array.from(counters.entries()).map(([name, aggregate]) => [name, { ...aggregate }]),
  );
}

/**
 * Purpose: Expose the flushed performance reports accumulated so far.
 * How: Return a deep-copy-friendly array of aggregated flush reports.
 */
function getPerfHistory(): PerfReport[] {
  return history.map((report) => ({
    timestamp: report.timestamp,
    metricCount: report.metricCount,
    rows: report.rows.map((row) => ({ ...row })),
    counterRows: report.counterRows.map((row) => ({ ...row })),
  }));
}

/**
 * Purpose: Return the most recent flushed performance report.
 * How: Read the tail of the report history or null when nothing has been flushed yet.
 */
function getLastPerfReport(): PerfReport | null {
  const report = history[history.length - 1];
  if (!report) {
    return null;
  }
  return {
    timestamp: report.timestamp,
    metricCount: report.metricCount,
    rows: report.rows.map((row) => ({ ...row })),
    counterRows: report.counterRows.map((row) => ({ ...row })),
  };
}

/**
 * Purpose: Toggle runtime perf logging from the browser console without editing the source.
 * How: Update the shared demo-state flag and reset accumulated metrics so the next samples are easy to interpret.
 */
function setPerfLoggingEnabled(enabled: boolean): void {
  demoState.devFlags.perfLogging = enabled;
  resetPerfLogging();
}

/**
 * Purpose: Toggle geometry freezing during ruler pan from the browser console.
 * How: Update the shared demo-state flag so pan can reuse the existing geometry until the gesture ends.
 */
function setFreezeGeometryDuringPan(enabled: boolean): void {
  demoState.devFlags.freezeGeometryDuringPan = enabled;
}

(globalThis as typeof globalThis & {
  __webdawPerf?: {
    snapshot: typeof getPerfSnapshot;
    counters: typeof getPerfCounterSnapshot;
    history: typeof getPerfHistory;
    last: typeof getLastPerfReport;
    reset: typeof resetPerfLogging;
    enable: () => void;
    disable: () => void;
    enabled: () => boolean;
    freezeGeometryDuringPan: (enabled: boolean) => void;
    geometryFrozen: () => boolean;
    disableGpuWaveforms: (enabled: boolean) => void;
    gpuWaveformsDisabled: () => boolean;
  };
}).__webdawPerf = {
  snapshot: getPerfSnapshot,
  counters: getPerfCounterSnapshot,
  history: getPerfHistory,
  last: getLastPerfReport,
  reset: resetPerfLogging,
  enable: () => setPerfLoggingEnabled(true),
  disable: () => setPerfLoggingEnabled(false),
  enabled: () => demoState.devFlags.perfLogging,
  freezeGeometryDuringPan: (enabled: boolean) => setFreezeGeometryDuringPan(enabled),
  geometryFrozen: () => demoState.devFlags.freezeGeometryDuringPan,
  disableGpuWaveforms: (enabled: boolean) => {
    demoState.devFlags.disableGpuWaveform = enabled;
  },
  gpuWaveformsDisabled: () => demoState.devFlags.disableGpuWaveform,
};

(globalThis as typeof globalThis & {
  __webdawDebug?: {
    getSessionRevision: () => string | null;
    getSession: () => {
      sessionId: string;
      sessionName: string;
      sessionRevision: string | null;
      sessionInWorkspace: boolean;
    };
  };
}).__webdawDebug = {
  getSessionRevision: () => demoState.session.revision,
  getSession: () => ({
    sessionId: demoState.session.id,
    sessionName: demoState.session.name,
    sessionRevision: demoState.session.revision,
    sessionInWorkspace: demoState.session.inWorkspace,
  }),
};
