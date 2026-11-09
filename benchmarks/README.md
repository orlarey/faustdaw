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
worker so that two benchmarks never share the CPU:

- `pan.perf.spec.ts`: one drag of the ruler over the dense project, the
  `__webdawPerf` metrics of the whole gesture.
- `pan.compare.spec.ts`: the steady-state middle of the drag (18 moves of
  16 ms, after 6 moves of start-up), 1 warm-up + 5 measured runs, on an empty
  and on the dense project.

The page hooks they use are compiled with the demo: `window.__webdawPerf`
(`demo/perf.ts`: `enable`, `reset`, `snapshot`, `history`) and
`window.__webdawBench` (`demo/bench-hooks.ts`: `generateClips`, `clipCount`),
so a refactor that breaks them breaks the build. The shared set-up is in
`bench-page.ts`.

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

Browser, `pan.compare.spec.ts`, 3 sessions × 5 runs, per run of 18 moves:

| scenario | timeline renders | their total cost | geometry rebuilds |
| --- | --- | --- | --- |
| empty | 4–8 | 1.6–6.6 ms | 1–2 |
| 2000 clips | 4–15 | 1.0–15.7 ms (median 2.7) | 1–9 (median 2) |

The pan preview is a CSS transform of the sliding buffers: most moves render
nothing, and the cost of a pan does not grow with the number of clips (the
dense and empty runs overlap). `performance.now()` is coarsened to 0.1 ms in
the page: a browser cost under 0.1 ms is a sum of rounded samples, not a
measured duration.
