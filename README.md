# faustdaw

**WARNING: under development**

Live demo: https://orlarey.github.io/faustdaw/

A browser-based DAW built on a formal domain model ([SPEC.md](./SPEC.md)).
Started as a single-track, single-clip prototype and incrementally refined into
a multitrack audio workstation with effects, mixing, and non-destructive editing.

## Features

### Multitrack timeline

- 8 audio tracks with independent clip lanes
- Drag-and-drop clip positioning with magnetism and alignment guides
- Option+Drag to duplicate clips
- Multi-clip selection (Shift+Click, marquee rectangle)
- Cursor and cut markers (draggable), user-creatable cue markers with labels

### Clip operations

All clip operations follow the unified `SelectionOperation` pattern
(see [SELECTIONOPERATIONS.md](./SELECTIONOPERATIONS.md)):

- **Split** at cut marker position
- **Merge** contiguous clips (same track, PCM concatenation or re-slice)
- **Crossfade** contiguous clips (linear ramp)
- **Delete** selected clips
- **Rename** a clip
- **Play Selection** (play only selected clips)

### Mixing

- Per-track volume fader and pan knob
- Per-track mute and solo
- Master volume fader

### Faust DSP effects

- Per-track effect chain
- Drag-and-drop `.dsp` file import
- Live parameter controls via Orbit UI
- Effect bypassing
- Faust compiler integration via faustwasm

### Audio import and export

- Drag-and-drop audio file import (any format FFmpeg handles)
- FFmpeg WASM decoding (MP3, FLAC, OGG, WAV, ...)
- Real-time WAV mixdown export

### Session management

- Save / load sessions as ZIP archives
- Undo / redo (serializable session document)
- Local session workspace (IndexedDB)
- Nested sessions (open / update from source session)

### Visualization

- Multi-resolution waveform pyramids with GPU-accelerated texture rendering
- Per-track activity meters (waveform envelope estimation)
- Onset detection with sensitivity and spacing controls

## Commands

```sh
npm run build
npm test
npm run serve
npm run bench
npm run bench:browser
npm run bench:browser:compare
```

## Structure

```text
src/
  daw.ts                  domain model and operations
  domain/
    selection/            Selection class and SelectionOperation pattern
      operations/         concrete operations (delete, split, merge, ...)
    clip-operations.ts    low-level clip primitives (concatenate, crossfade)
  marker/                 marker management

demo/
  index.html              browser harness
  interactions.ts         UI adapter and event wiring
  clip-context-menu.ts    declarative context menu factory
  track/                  track rendering, audio routing, activity meters
  fx-chain/               Faust effect panel and runtime
  timeline/               timeline scene, waveform preview, drag overlay
  state.ts                mutable demo state

test/                     unit tests
benchmarks/               Playwright browser benchmarks
scripts/                  deploy and bench scripts
```

## Getting started

1. `npm run build`
2. `npm run serve`
3. Open `http://localhost:4183/demo/`

## Keyboard shortcuts

| Key                          | Action                                    |
| ---------------------------- | ----------------------------------------- |
| `Space`                      | Toggle Play / Stop                        |
| `Shift`+Click ruler          | Seek to nearest tertiary division         |
| `Shift`+Click clip           | Toggle clip in selection                  |
| `Cmd/Ctrl`+`Z`               | Undo                                      |
| `Shift`+`Cmd/Ctrl`+`Z`       | Redo                                      |
| `Ctrl`+`Y`                   | Redo                                      |
| `Home`                       | Return cursor to 0                        |
| `Return`                     | Return cursor to last play start          |
| `+` / `-`                    | Zoom in / out                             |
| `Left` / `Right`             | Pan timeline view                         |
| `Shift`+`Left`/`Right`       | Pan timeline view (large step)            |
| `Option`+Drag clip           | Duplicate clip                            |
| `Delete` / `Backspace`       | Delete selected clips                     |
| `Esc`                        | Close context menu / dismiss transient UI |

### Clip context menu shortcuts

| Key | Action               |
| --- | -------------------- |
| `S` | Split at cut         |
| `M` | Merge contiguous     |
| `X` | Crossfade contiguous |
| `P` | Play selection       |

## Deployment

Published via GitHub Pages: every push to `main` triggers
[.github/workflows/pages.yml](./.github/workflows/pages.yml), which compiles
TypeScript and publishes the repository as a static site at
https://orlarey.github.io/faustdaw/.

## Benchmarks

- `npm run bench` -- reproducible benchmark of domain hot paths
- `npm run bench -- --json` -- machine-readable output
- `npm run bench:browser` -- browser perf bench suite (headless Chromium)
- `npm run bench:browser:compare` -- stabilized empty-vs-dense pan comparison
