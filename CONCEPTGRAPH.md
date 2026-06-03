# Concept Graph

High-level view of the main concepts in webdaw and how they relate. Each concept is annotated with its line count (`~N LOC`) so the relative weight of each subsystem is visible at a glance.

## LOC summary (by concept group)

| Group                         |         LOC |
| ----------------------------- | ----------: |
| Input / interactions          |      ~6 910 |
| Render pipeline (timeline)    |      ~3 260 |
| Session / workspace           |      ~1 950 |
| Domain (project + markers)    |      ~1 740 |
| UI state + viewport + scale   |      ~1 660 |
| Waveform (samples + view)     |      ~1 430 |
| Misc bootstrap / utils        |      ~1 280 |
| Grid view (buffers + lines)   |      ~1 160 |
| FX chain                      |        ~880 |
| Clip rendering                |        ~720 |
| Track rendering               |        ~550 |
| Onset detection               |        ~310 |
| **Total (src/ + demo/)**      | **~21 850** |

## 1. Layered overview

```mermaid
flowchart TB
  subgraph DOMAIN["Domain (src/) — ~1 740 LOC"]
    Project["Project<br/>daw.ts — 677"]
    DomainTypes["Timeline / Track / Clip / FxEffect /<br/>Timebase / AudioResource / ...<br/>domain/*.ts — 282"]
    Marker["Marker + MarkerManager<br/>src/marker/ — 777"]
  end

  subgraph UISTATE["UI state (demo/) — ~1 660 LOC"]
    DemoState["demoState<br/>state.ts — 405"]
    Viewport["TimelineViewport + View + ruler-gesture<br/>demo/view/ — 680"]
    TimeScale["TimeScale<br/>time-scale.ts — 575"]
  end

  subgraph RENDER["Render pipeline (demo/) — ~3 260 LOC"]
    DAWRenderRuntime["DAWRenderRuntime + Surface<br/>daw-render/ — 216"]
    TimelineSubsys["TimelineScene · FrameContext · FrameRunner ·<br/>branch effects · Surface · DragOverlay · ...<br/>demo/timeline/ — 3 042"]
  end

  subgraph LEAVES["Render leaves"]
    ClipGroup["Clip<br/>demo/clip/ — 719"]
    TrackGroup["Track<br/>demo/track/ — 553"]
    GridGroup["Grid view<br/>demo/grid-view/ — 1 158"]
    WaveGroup["Waveform samples + view + GPU<br/>demo/waveform*.ts + waveform-view/ — 1 429"]
    OnsetGroup["Onset detection<br/>onsets.ts — 311"]
    FxGroup["FX chain<br/>demo/fx-chain/ — 881"]
  end

  subgraph SESSION["Session / workspace — ~1 950 LOC"]
    SessionDocument["SessionDocument — 303"]
    SessionArchive["SessionArchive — 543"]
    SessionWorkspace["SessionWorkspace — 982"]
    SessionViewStateNode["SessionViewState — 119"]
  end

  subgraph INPUT["Input — ~6 910 LOC"]
    Interactions["Interactions<br/>interactions.ts — 6 678"]
    Magnetism["magnetism.ts — 144"]
    Placement["placement.ts — 85"]
  end

  DOMAIN -->|read by| RENDER
  UISTATE -->|captured into| RENDER
  RENDER --> LEAVES
  LEAVES -->|paint| DOM[(DOM / Canvas)]

  INPUT -->|mutates| UISTATE
  INPUT -->|domain ops| DOMAIN
  INPUT -->|trigger| RENDER

  SESSION <-->|load / save| DOMAIN
  SESSION <-->|view state| UISTATE
```

## 2. Domain model (~1 740 LOC)

```mermaid
flowchart LR
  Project["Project<br/>(677 in daw.ts)"] --> Timeline["Timeline (17)"]
  Project --> Timebase["Timebase (58)"]
  Timeline --> Transport["TransportState (5)"]
  Timeline --> Cursor["cursor: TimeCoord"]
  Timeline --> Tracks["tracks[] (fixed)"]
  Tracks --> Track["Track (18)"]
  Track --> Clips["clips[]"]
  Track --> Effects["effects[]"]
  Clips --> Clip["Clip (22)"]
  Effects --> FxEffect["FxEffect (32)"]
  Clip --> AudioResource["AudioResource (16)"]
  Project --> Identifiers["identifiers (21)"]
  Project --> Output["Output (25)"]
  Project --> TrackId["TrackId (20)"]
  Project --> TrackHelpers["track-helpers (26)"]

  subgraph MARKERS["Markers — 777 LOC"]
    MarkerManager["MarkerManager (388)"] --> Marker["Marker (389)"]
    Marker --> CursorMarker["cursor"]
    Marker --> CutMarker["cut"]
    Marker --> LastPlayMarker["last-play"]
  end

  Timeline -.cursor coord.-> MarkerManager
```

## 3. Render pipeline — main hot path (~3 260 LOC)

```mermaid
flowchart TB
  Main["main.ts bootstrap (175)"] --> Interactions["interactions.ts (6 678)"]
  Interactions --> RenderCall["render() / renderFrame()"]
  RenderCall --> DAWRenderRuntime["DAWRenderRuntime (149)"]
  DAWRenderRuntime --> DAWRenderSurface["DAWRenderSurface (67)"]
  DAWRenderRuntime --> TimelineScene["TimelineScene (392)"]

  TimelineScene --> Capture["captureClipPresentationInputs (54)"]
  TimelineScene --> Builder["TimelineFrameContextBuilder.prepare"]

  Builder --> FrameContext["TimelineFrameContext (206)"]
  FrameContext --> FramePlan["TimelineFramePlan (126)"]
  FrameContext --> FrameSequence["TimelineFrameSequence (68)"]
  FrameContext --> Projection["TimelineProjection (128)"]
  FrameContext --> GridFrame["GridViewFrame"]
  FrameContext --> WaveformFrame["WaveformViewFrame"]
  FrameContext --> PresentationInputs["ClipPresentationInputs"]

  TimelineScene --> FrameRunner["TimelineFrameRunner (141)"]
  FrameContext -.consumed by.-> FrameRunner

  FrameRunner --> Chrome["TimelineChrome (55)"]
  FrameRunner --> Surface["TimelineSurface (149)"]
  FrameRunner -->|direct-zoom| BranchEffects["TimelineBranchEffects (127)"]
  FrameRunner -->|steady| SteadyEffects["TimelineSteadyEffects (66)"]
  FrameRunner -->|rebuild| ClipEffects["TimelineClipEffects (111)"]

  BranchEffects --> SceneSurface["TimelineSceneSurface (129)"]
  SteadyEffects --> SceneSurface
  ClipEffects --> SceneSurface
  SceneSurface --> DragOverlay["TimelineDragOverlay (253)"]
  SceneSurface --> WaveformView["WaveformView (295)"]
  SceneSurface --> GridView["GridView (135)"]
  SceneSurface --> TimelineClipFacade["TimelineClip (268)"]

  DragFrame["TimelineDragFrame (63)"]
  GeometryEffects["TimelineGeometryEffects (85)"]
  FrameEffects["TimelineFrameEffects (71)"]
  WaveformPreview["TimelineWaveformPreview (53)"]
  RenderHistory["TimelineRenderHistory (131)"]
  DomModels["TimelineDomModels (136)"]
  SceneState["TimelineSceneState (82)"]
  TimelineDebug["timeline-debug (229)"]
  TimelineFacade["Timeline facade (125)"]

  TimelineScene -.drag path.-> DragFrame
  TimelineScene -.waveform preview.-> WaveformPreview
  TimelineScene -.geometry rebuild.-> GeometryEffects
  TimelineScene -.history.-> RenderHistory
  TimelineScene -.state.-> SceneState
```

## 4. Clip rendering — leaf (~720 LOC)

```mermaid
flowchart LR
  TimelineClipFacade["TimelineClip<br/>clip.ts — 268"] --> BuildModel["buildClipRenderModel<br/>clip-render-model.ts — 189"]
  PresentationInputs["ClipPresentationInputs<br/>clip-presentation-inputs.ts — 54"] --> Resolve["resolveClipRenderPresentation"]
  BuildModel --> Resolve
  Resolve --> RenderModel["ClipRenderModel<br/>geometry + labels + flags"]
  RenderModel --> ClipRaster["ClipRaster<br/>clip-raster.ts — 178"]
  RenderModel --> DragPreview["clip-drag-preview.ts — 30"]

  subgraph INPUTS["ClipPresentationInputs sources"]
    SelectedClips["selectedClipIds"]
    SessionRenders["sessionRenderResources"]
    Workspaces["workspaceSessions"]
    OnsetEditor["clipOnsetEditorState"]
    OnsetAnnotations["clipOnsetAnnotations"]
    SourceFiles["resourceSourceFiles"]
    AudioBuffers["resourceAudioBuffers"]
  end

  INPUTS --> PresentationInputs
  OnsetAnnotations -.feed from.-> Onsets["onsets.ts — 311"]
```

## 5. Track / FX / Audio / Waveform runtime

```mermaid
flowchart TB
  subgraph TRACK["Track — 553 LOC"]
    TrackFacade["Track (183)"] --> TrackRender["TrackRender (43)"]
    TrackRender --> TrackPixmap["TrackPixmap (37)"]
    TrackRender --> TrackActivity["TrackActivity (67)"]
    TrackFacade --> TrackRuntime["TrackRuntime (148)"]
    TrackFacade --> TrackAudio["TrackAudio (56)"]
    TrackFacade --> TrackOrder["TrackOrder (19)"]
  end

  subgraph FX["FX chain — 881 LOC"]
    FxChainRuntime["FxChainRuntime (194)"] --> FxChainAudio["FxChainAudio (90)"]
    FxChainRuntime --> FxChainPanel["FxChainPanel (597)"]
  end

  subgraph WAVE["Waveform — 1 429 LOC"]
    WaveformWorker["waveform-worker.ts (38)"] --> WaveformSamples["waveform.ts (323)"]
    WaveformSamples --> WaveformPyramids["resourceWaveformPyramids"]
    WaveformPyramids --> WaveformPainter["waveform-painter.ts (393)"]
    WaveformPainter --> WaveformGpu["waveform-gpu.ts (380)"]
    WaveformPainter --> WaveformViewNode["WaveformView (295)"]
  end

  subgraph GRID["Grid view — 1 158 LOC"]
    GridView["grid-view.ts (135)"] --> GridBuffers["grid-view-buffers.ts (1 023)"]
  end

  TrackAudio --> FxChainAudio
  TrackRender --> WaveformViewNode
  TrackRender --> GridView
```

## 6. Session lifecycle (~1 950 LOC)

```mermaid
flowchart LR
  Archive[(".webdaw archive bytes")] -->|parseSessionArchive| SessionArchive["SessionArchive (543)"]
  SessionArchive -->|restore| SessionDocument["SessionDocument (303)"]
  SessionDocument -->|initProject / placeClip / ...| Project["Project (677)"]
  SessionDocument --> SessionViewStateNode["SessionViewState (119)"]
  SessionViewStateNode --> TimelineViewport["TimelineViewport (259)"]

  Project -->|save| SessionDocument
  SessionDocument -->|buildSessionArchiveBytes| SessionArchive
  SessionArchive --> Archive

  SessionWorkspace["SessionWorkspace (982)"] -->|metadata · leases| SessionDocument
```

## 7. Input → state → render loop (~6 910 LOC)

```mermaid
flowchart LR
  User((User)) --> DOM["DOM events"]
  DOM --> Interactions["interactions.ts<br/>6 678 LOC"]
  Interactions --> Magnetism["magnetism.ts (144)"]
  Interactions --> Placement["placement.ts (85)"]
  Interactions -->|domain ops| Project["Project snapshot"]
  Interactions -->|mutate| DemoState["demoState · viewport · dragState"]
  Interactions -->|trigger| RenderCall["render() / renderFrame()"]
  RenderCall --> TimelineScene
  TimelineScene --> DOMUpdate["DOM / canvas paint"]
  DOMUpdate --> User
```

---

## Observations

- **`interactions.ts` dwarfs everything** at ~6 680 LOC — nearly a third of the codebase. It's the primary splitting candidate if the demo UI module is ever decomposed.
- The **render pipeline + render leaves** (timeline + clip + track + grid + waveform + daw-render) add up to ~8 560 LOC — the second-largest region.
- **Domain (`src/`) stays small** at ~1 740 LOC despite covering the entire immutable project model. Notably, the marker subsystem alone (`src/marker/`) is ~780 LOC, almost half of the domain.
- **`grid-view-buffers.ts` (1 023 LOC)** is the largest single render-path file — it owns the sliding-buffer mechanism that both the grid and waveform views ride on.
- The new **`clip-presentation-inputs.ts`** is only 54 LOC, but it factors the inputs that used to be read straight from `demoState` inside `clip-render-model.ts` (189 LOC).

## Legend

- **Domain (src/)** is the pure, immutable project model. Every render pass reads a `Project` snapshot.
- **UI state (demo/state.ts + viewport)** is the only mutable demo-side state; it is captured into a `DAWRenderView` and `ClipPresentationInputs` at the render boundary.
- **Render pipeline** builds one `TimelineFrameContext` per frame and dispatches a single branch to paint effects — everything downstream works off that immutable context.
- **Session** round-trips a project to/from a portable archive plus view-state metadata.
- **Input** is the only path that mutates state; it then triggers a render.
