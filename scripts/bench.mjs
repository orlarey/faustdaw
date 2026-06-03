import { performance } from "node:perf_hooks";
import {
  TRACK_IDS,
  clipEnd,
  importAudioResource,
  initProject,
  observeOutput,
  placeClip,
  play,
  seek,
  stop,
  tick,
  toTimeCoord,
} from "../dist/src/daw.js";
import { getIndexedClip, getTotalClipCount } from "../dist/demo/project-index.js";
import { getVisibleClipRangeCached } from "../dist/demo/visible-range-cache.js";

function parseArgs(argv) {
  const options = {
    clips: 2000,
    minLength: 0.1,
    maxLength: 2,
    gap: 0.2,
    viewportSeconds: 60,
    steps: 1000,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--clips" && next) {
      options.clips = Number(next);
      index += 1;
    } else if (token === "--min-length" && next) {
      options.minLength = Number(next);
      index += 1;
    } else if (token === "--max-length" && next) {
      options.maxLength = Number(next);
      index += 1;
    } else if (token === "--gap" && next) {
      options.gap = Number(next);
      index += 1;
    } else if (token === "--viewport-seconds" && next) {
      options.viewportSeconds = Number(next);
      index += 1;
    } else if (token === "--steps" && next) {
      options.steps = Number(next);
      index += 1;
    } else if (token === "--json") {
      options.json = true;
    }
  }

  return options;
}

function formatMetric(name, metric) {
  return [
    `${name}:`,
    `total=${metric.totalMs.toFixed(2)}ms`,
    `mean=${metric.meanMs.toFixed(4)}ms`,
    `p95=${metric.p95Ms.toFixed(4)}ms`,
    `ops/s=${metric.opsPerSecond.toFixed(1)}`,
  ].join(" ");
}

function summarizeSamples(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const totalMs = sorted.reduce((acc, value) => acc + value, 0);
  const meanMs = sorted.length > 0 ? totalMs / sorted.length : 0;
  const p95Index = sorted.length === 0 ? 0 : Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95Ms = sorted.length > 0 ? sorted[p95Index] : 0;
  const opsPerSecond = totalMs > 0 ? (sorted.length * 1000) / totalMs : 0;
  return { totalMs, meanMs, p95Ms, opsPerSecond, samples: sorted.length };
}

function benchRepeated(label, iterations, fn) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    fn(index);
    const end = performance.now();
    samples.push(end - start);
  }
  return [label, summarizeSamples(samples)];
}

function generateProject(options) {
  let project = initProject("bench");
  const sampleRate = 48_000;
  const perTrackCursor = new Map(TRACK_IDS.map((trackId) => [trackId, 0]));
  const lengthRange = Math.max(options.maxLength - options.minLength, 0);

  for (let index = 0; index < options.clips; index += 1) {
    const trackId = TRACK_IDS[index % TRACK_IDS.length];
    const cursor = perTrackCursor.get(trackId) ?? 0;
    const ratio = ((index * 37) % 1000) / 1000;
    const durationSeconds = options.minLength + lengthRange * ratio;
    const durationCoord = Math.max(1, toTimeCoord(durationSeconds, project.timebase));
    const resource = {
      id: `res-${index}`,
      sampleRate,
      channels: 2,
      length: Math.max(1, Math.round(durationSeconds * sampleRate)),
    };
    project = importAudioResource(project, resource);
    project = placeClip(project, `clip-${index}`, resource, cursor, trackId);
    perTrackCursor.set(trackId, cursor + durationCoord + toTimeCoord(options.gap, project.timebase));
  }

  return project;
}

function collectTrackStats(project) {
  return project.timeline.tracks.map((track) => ({
    trackId: track.id,
    clips: track.clips.length,
    firstStart: track.clips[0]?.start ?? null,
    lastEnd: track.clips.length > 0 ? clipEnd(project, track.clips[track.clips.length - 1]) : null,
  }));
}

function runBenchmarks(project, options) {
  const viewportCoord = toTimeCoord(options.viewportSeconds, project.timebase);
  const perTrackMaxEnd = Math.max(
    ...project.timeline.tracks.map((track) => (track.clips.length > 0 ? clipEnd(project, track.clips[track.clips.length - 1]) : 0)),
  );
  const maxStart = Math.max(0, perTrackMaxEnd - viewportCoord);
  const panStep = Math.max(1, Math.floor(maxStart / Math.max(options.steps, 1)));
  const clipIds = project.timeline.tracks.flatMap((track) => track.clips.slice(0, 1).map((clip) => clip.id));
  const playingProject = play(project);

  const metrics = Object.fromEntries([
    benchRepeated("visible_range_pan", options.steps, (index) => {
      const viewStart = Math.min(maxStart, index * panStep);
      const viewEnd = viewStart + viewportCoord;
      for (const track of project.timeline.tracks) {
        getVisibleClipRangeCached(project, track, viewStart, viewEnd);
      }
    }),
    benchRepeated("visible_range_after_seek", options.steps, (index) => {
      const viewStart = Math.min(maxStart, index * panStep);
      const nextProject = seek(project, viewStart);
      const viewEnd = viewStart + viewportCoord;
      for (const track of nextProject.timeline.tracks) {
        getVisibleClipRangeCached(nextProject, track, viewStart, viewEnd);
      }
    }),
    benchRepeated("project_index_seek", options.steps, (index) => {
      const cursor = Math.min(maxStart, index * panStep);
      const nextProject = seek(project, cursor);
      getTotalClipCount(nextProject);
      for (const clipId of clipIds) {
        getIndexedClip(nextProject, clipId);
      }
    }),
    benchRepeated("observe_output_playing", options.steps, (index) => {
      const cursor = Math.min(maxStart, index * panStep);
      const nextProject = tick(seek(playingProject, cursor), 0);
      observeOutput(nextProject);
    }),
  ]);

  return {
    configuration: {
      clips: options.clips,
      tracks: TRACK_IDS.length,
      minLength: options.minLength,
      maxLength: options.maxLength,
      gap: options.gap,
      viewportSeconds: options.viewportSeconds,
      steps: options.steps,
    },
    project: {
      totalClips: getTotalClipCount(project),
      resources: project.resources.size,
      tracks: collectTrackStats(project),
    },
    metrics,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildStart = performance.now();
  const project = generateProject(options);
  const buildMetric = summarizeSamples([performance.now() - buildStart]);
  const report = runBenchmarks(project, options);
  report.metrics.project_build = buildMetric;

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Benchmark configuration:");
  console.log(`  clips=${report.configuration.clips} tracks=${report.configuration.tracks} viewport=${report.configuration.viewportSeconds}s steps=${report.configuration.steps}`);
  console.log(`  lengths=${report.configuration.minLength}s..${report.configuration.maxLength}s gap=${report.configuration.gap}s`);
  console.log("");
  console.log("Project:");
  console.log(`  total clips=${report.project.totalClips} resources=${report.project.resources}`);
  for (const track of report.project.tracks) {
    console.log(`  ${track.trackId}: clips=${track.clips} first=${track.firstStart ?? "-"} lastEnd=${track.lastEnd ?? "-"}`);
  }
  console.log("");
  console.log("Metrics:");
  for (const [name, metric] of Object.entries(report.metrics)) {
    console.log(`  ${formatMetric(name, metric)}`);
  }
}

main();
