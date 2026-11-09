# Benchmarks

Two families, both run against the build in `dist/` (`npm run build`).

## Node: domain queries (`npm run bench`)

`scripts/bench.mjs` builds a project of 2000 clips (0.1–2 s, 0.2 s apart,
round-robin over the 8 tracks) and times the queries the timeline runs on each
pan step: visible clip range (cached, and after a seek), project index lookups,
`observeOutput`. Options: `--clips`, `--min-length`, `--max-length`, `--gap`,
`--viewport-seconds`, `--steps`, `--json`.

## Browser: ruler pan (`npm run bench:browser`)

Playwright specs in this folder, served by `npm run serve` (port 4183), one
worker so that two benchmarks never share the CPU.

The display is a 4K screen (3840 × 2160 device pixels) with the DAW window
full screen: the viewport is the whole screen (headless Chromium has no
browser chrome), `window.screen` has the same size, and the page enters the
Fullscreen API; `openDemo` checks both before measuring. Two projects drive
the same 8.3 Mpx:

- `4k-hidpi`: 1920 × 1080 CSS px at devicePixelRatio 2, the usual setting of
  a 4K screen (macOS, Windows at 200 %): every canvas has 4 × the pixels of
  its CSS size;
- `4k-native`: 3840 × 2160 CSS px at devicePixelRatio 1: twice the time span
  in view, twice the clips.

`--project=4k-hidpi` runs one of them. The specs:

- `pan.perf.spec.ts`: one drag of the ruler over the dense project, the
  `__webdawPerf` metrics of the whole gesture.
- `pan.compare.spec.ts`: the steady-state middle of the drag (60 moves of
  16 ms, about one second, after 6 moves of start-up), 1 warm-up + 5
  measured runs, on an empty and on the dense project.

Both report two kinds of numbers. The `__webdawPerf` timers measure the
JavaScript of the render only. The frames actually produced, which also pay
for style, layout, paint and composition and so grow with the number of
pixels, are measured by the intervals between `requestAnimationFrame`
callbacks during the drag: frames, fps, p50, p95, max, and long frames
(> 25 ms, at least one 60 Hz frame missed).

To use a Chromium other than the one bundled with the installed Playwright:

    PW_CHROMIUM_PATH=/path/to/chromium npm run bench:browser

## Baseline (2026-11-09, headless Chromium, cloud container, no GPU)

Node, `npm run bench` (mean per step):

| query | mean |
| --- | --- |
| visible range, pan | 0.004 ms |
| visible range after seek | 0.18 ms |
| project index after seek | 0.16 ms |
| `observeOutput` while playing | 0.32 ms |
| building the 2000-clip project | 530 ms (once) |

Browser, `pan.compare.spec.ts`, 4K full screen (the timeline grid is
1758 × 528 CSS px in `4k-hidpi`, 3678 × 528 in `4k-native`: it does not grow
with the window height, 8 tracks of 66 px), 2 sessions × 5 runs of ~1 s:

| profile | project | fps | p95 frame | max frame | long frames / ~300 | JS of the timeline renders, per run |
| --- | --- | --- | --- | --- | --- | --- |
| 4k-hidpi | empty | 59.6 | 16.8 ms | 33.4 ms | 2 | 1.5–3.9 ms |
| 4k-hidpi | 2000 clips | 58.3–59.6 | 16.8 ms | 66.6 ms | 2–6 | 1.3–9.0 ms, twice ~51 ms |
| 4k-native | empty | 59.6–59.8 | 16.8 ms | 33.4 ms | 1–2 | 1.4–14.3 ms |
| 4k-native | 2000 clips | 59.8 | 16.7 ms | 33.4 ms | 1 | 2.2–15.1 ms |

The pan holds 60 fps at 4K, with or without clips, but the dense HiDPI
profile shows rare spikes: in 2 runs out of 10, a single
`renderTimelineFrame` of 36–47 ms (3 frames missed), mostly outside the
instrumented sub-steps (once 13 ms of `geometryRebuild.sharedGrid.dom`).
Where the rest goes is not measured yet.

Limits: WebGL runs on SwiftShader (software) in this headless Chromium, and
the frame intervals see the main thread and the compositor of the headless
browser, not a real GPU raster; `performance.now()` is coarsened to 0.1 ms
in the page.
