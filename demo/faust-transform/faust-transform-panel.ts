/**************************** faust-transform-panel.ts *************************
 *
 * Purpose: Manage the Faust Transform overlay panel — the full-screen
 *          semi-transparent UI for building and previewing a Transform Chain.
 * How: Provide a `wireTransformPanel` entry point called from wireEvents,
 *      plus helpers for opening/closing the panel, managing Orbit UI instances,
 *      and triggering preview/bounce workflows.
 *
 *****************************************************************************/
import type { Elements } from "../bind-elements.js";
import type { FxEffect, FxParam } from "../../src/domain/fx-chain.js";
import { demoState } from "../state.js";
import { compileAndAttachEffect } from "../fx-chain/fx-chain-panel.js";
import {
  importDspFileAsEffect,
  createBlankEffect,
  getFirstDspFile,
  getEffectName,
  getEffectCode,
} from "../fx-chain/faust-resource.js";
import { presetTrackingSystem } from "../preset-tracking.js";
import {
  computeCodeHash,
  computeUIHash,
  listPresetsByUIHash,
  savePreset,
  deletePreset,
  loadTrajectory,
  saveTrajectory,
  type PresetRecord,
  type TrajectoryRecord as WebdawTrajectoryRecord,
  type TrajectoryEvent as WebdawTrajectoryEvent,
} from "../preset-storage.js";
import type {
  OrbitUI as OrbitUIType,
  Preset as OrbitPreset,
  TrajectoryRecord as OrbitTrajectoryRecord,
  TrajectoryEvent as OrbitTrajectoryEvent,
} from "faust-orbit-ui";
import { openEditor } from "../faust-editor/faust-editor.js";
import {
  compileFxEffect,
  getEffectRuntime,
  destroyEffectRuntime,
  hasCurrentEffectRuntime,
} from "../fx-chain/fx-chain-runtime.js";
import { ensureFaustCompiler } from "../fx-chain/faust-compiler.js";
import { captureEffectParameters, restoreEffectParameters } from "../fx-chain/fx-chain-audio.js";
import { TrackAudio } from "../track/track-audio.js";
import type { TrackId } from "../../src/domain/track-id.js";
import { updateEffectParamValue } from "../../src/fx-chain.js";
import { pushRenderLog, render } from "../daw-render/daw-render-runtime.js";
import { bounceTransformChain } from "./faust-offline-bounce.js";
import { replaceClipAudio } from "../../src/domain/clip-operations.js";
import { Selection } from "../../src/domain/selection/selection.js";
import { getCurrentSelection } from "../selection-state.js";
import {
  persistCurrentSessionDocument,
} from "../session-history.js";
import {
  addChainChangeListener,
  recordChainOp,
  TRANSFORM_CHAIN_ID,
} from "../chain-undo.js";
import {
  addFaustFxChangeListener,
  paramsEqual,
  recordFaustFxOp,
} from "../faust-fx-undo.js";
import {
  clearReorderInsertion,
  computeInsertIndex,
  showReorderInsertion,
} from "../fx-panel-reorder.js";
import { registerOrbitUI, unregisterOrbitUI } from "../orbit-ui-registry.js";
import { commitSelectionTransition } from "../menu-operation.js";
import { makeClipSampleDeps } from "../clip-sample-deps.js";
import { startPreviewClip, stopPreview } from "../preview-playback.js";
import { createNextClipId } from "../clip-id.js";
import { normalizeErrorMessage } from "../error-message.js";
import { isFileDrag } from "../drag-predicates.js";

/**
 * Purpose: TransformPanelContext is now empty — all former callbacks resolve
 *          to direct imports of the corresponding concepts (audio-engine,
 *          track-audio, session-history, apply-selection-operation,
 *          clip-sample-deps, preview-playback, clip-id, error-message,
 *          drag-predicates, footer-view). Kept as a type alias for
 *          wireTransformPanel's signature stability; can be removed in a
 *          follow-up.
 */
export type TransformPanelContext = Record<string, never>;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

// Transform-chain-specific effect runtimes (separate from track effects).
// We use the same compileFxEffect, but with a synthetic trackId.
const TRANSFORM_TRACK_ID = "__transform__" as any;

/**
 * Purpose: Stable pseudo-session id used by the preset-tracking system for
 *          every Transform Chain effect instance. Lets the Transform Chain
 *          preset library accumulate across opens/closes of the panel.
 */
const TRANSFORM_SESSION_ID = "__transform__";

// ---------------------------------------------------------------------------
// TransformGestureBridge — gesture / param-change adapter for one effect
// instance in the Faust Transform panel. Wires OrbitUI's onParamChange,
// onInteractionStart, onInteractionEnd callbacks to live writes on
// `demoState.transformChain` + node + faust-fx undo recording.
// ---------------------------------------------------------------------------

class TransformGestureBridge {
  #paramsBefore: ReadonlyArray<FxParam> | null = null;

  constructor(
    private readonly effectId: string,
    private readonly node: any,
    private readonly elements: Elements,
    private readonly getOrbitInstance: () => OrbitUIType | null,
  ) {}

  begin(): void {
    const live = demoState.transformChain.find((e) => e.id === this.effectId);
    this.#paramsBefore = live ? live.parameters : null;
  }

  apply(configuration: Readonly<Record<string, number>>): void {
    for (const [address, value] of Object.entries(configuration)) {
      this.#writeParam(address, value);
    }
    const orbit = this.getOrbitInstance();
    if (orbit) orbit.setParams(configuration);
  }

  /** Single-param write — used by the orbit-ui's per-tick drag callback. */
  setParam(address: string, value: number): void {
    this.#writeParam(address, value);
  }

  end(): void {
    const before = this.#paramsBefore;
    this.#paramsBefore = null;
    if (before) {
      const live = demoState.transformChain.find((e) => e.id === this.effectId);
      if (live && !paramsEqual(before, live.parameters)) {
        persistCurrentSessionDocument(this.elements);
        recordFaustFxOp(
          { kind: "faustFx", effectId: this.effectId },
          { kind: "params", before, after: live.parameters },
        );
      }
    }
  }

  getCurrentConfig(): Record<string, number> {
    const live = demoState.transformChain.find((e) => e.id === this.effectId);
    const config: Record<string, number> = {};
    if (live) for (const p of live.parameters) config[p.address] = p.value;
    return config;
  }

  #writeParam(address: string, value: number): void {
    if (this.node.setParamValue) this.node.setParamValue(address, value);
    const idx = demoState.transformChain.findIndex((e) => e.id === this.effectId);
    if (idx >= 0) {
      const eff = demoState.transformChain[idx]!;
      const updatedParams = eff.parameters.map((p) =>
        p.address === address ? { ...p, value } : p,
      );
      demoState.transformChain = [
        ...demoState.transformChain.slice(0, idx),
        { ...eff, parameters: updatedParams },
        ...demoState.transformChain.slice(idx + 1),
      ];
    }
  }
}

// ---------------------------------------------------------------------------
// IDB ↔ OrbitUI shape adapters
// ---------------------------------------------------------------------------

function adaptWebdawPresetToOrbit(r: PresetRecord): OrbitPreset {
  const out: OrbitPreset = {
    uiHash: r.uiHash,
    configHash: r.configHash,
    configuration: r.configuration,
    lastSeenAt: r.lastSeenAt,
  };
  if (r.name !== undefined) (out as { name?: string }).name = r.name;
  return out;
}

function adaptOrbitEventToWebdaw(e: OrbitTrajectoryEvent): WebdawTrajectoryEvent {
  const out: WebdawTrajectoryEvent = {
    timestamp: e.timestampMs,
    configuration: e.configuration,
    ...(e.transitionTimeMs !== undefined ? { transitionTime: e.transitionTimeMs } : {}),
    ...(e.transitionLevel !== undefined ? { transitionLevel: e.transitionLevel } : {}),
    ...(e.loopContext !== undefined ? { loopContext: e.loopContext } : {}),
  };
  return out;
}

function adaptWebdawEventToOrbit(e: WebdawTrajectoryEvent): OrbitTrajectoryEvent {
  const out: OrbitTrajectoryEvent = {
    timestampMs: e.timestamp,
    configuration: e.configuration,
    ...(e.transitionTime !== undefined ? { transitionTimeMs: e.transitionTime } : {}),
    ...(e.transitionLevel !== undefined ? { transitionLevel: e.transitionLevel } : {}),
    ...(e.loopContext !== undefined ? { loopContext: e.loopContext } : {}),
  };
  return out;
}

/**
 * Purpose: Diff the OrbitUI library snapshot against IDB and apply the
 *          minimum set of writes (add / update / delete). The snapshot
 *          arrives on every internal mutation (auto-promotion, rename,
 *          delete, undo, redo) — diffing keeps `firstSeenAt` stable and
 *          avoids touching unchanged records.
 * How: Index both sets by `configHash`. Save records whose `name` /
 *      `lastSeenAt` / `configuration` differs ; delete records that
 *      vanished. After IDB writes, broadcast via the shared pub-sub bus
 *      so fx-chain panels (and other transform instances on the same
 *      uiHash) refresh.
 */
async function syncLibraryToIDB(
  uiHash: string,
  orbitRecords: readonly OrbitPreset[],
): Promise<void> {
  const existing = await listPresetsByUIHash(uiHash);
  const existingByHash = new Map(existing.map((r) => [r.configHash, r]));
  const incomingHashes = new Set<string>();

  for (const record of orbitRecords) {
    if (record.uiHash !== uiHash) continue;
    incomingHashes.add(record.configHash);
    const prev = existingByHash.get(record.configHash);
    const firstSeenAt = prev?.firstSeenAt ?? record.lastSeenAt;
    const next: PresetRecord = {
      uiHash: record.uiHash,
      configHash: record.configHash,
      configuration: record.configuration,
      firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      ...(record.name !== undefined ? { name: record.name } : {}),
    };
    if (
      !prev
      || prev.lastSeenAt !== next.lastSeenAt
      || prev.name !== next.name
    ) {
      await savePreset(next);
    }
  }
  for (const old of existing) {
    if (!incomingHashes.has(old.configHash)) {
      await deletePreset(uiHash, old.configHash);
    }
  }
  presetTrackingSystem.notifyLibraryChange(uiHash);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Purpose: Wire all event listeners for the Transform overlay panel.
 * How: Called once from wireEvents in interactions.ts.
 */
export function wireTransformPanel(elements: Elements, _context: TransformPanelContext): void {
  // Make the panel list focusable (without entering the tab order) so
  // we can route focus back into the panel after innerHTML rebuilds —
  // critical for chain-scope Cmd+Z continuity. See `syncTransformPanelList`.
  elements.transformPanelList.tabIndex = -1;

  // --- OrbitUI lazy loader ---
  let orbitUIConstructor: { new (root: HTMLElement, opts: any): OrbitUIType } | null = null;
  type OrbitInstanceEntry = {
    instance: OrbitUIType;
    bridge: TransformGestureBridge;
    codeHash: string;
  };
  const activeOrbitInstances = new Map<string, OrbitInstanceEntry>();

  // Cross-panel library-change broadcast: when fx-chain (or library undo
  // scope, or another transform instance) mutates the IDB for a uiHash we
  // own, reload the affected OrbitUI instance(s) so the calque + recall
  // menu stay in sync. We re-use presetTrackingSystem's promotion
  // listener as the pub-sub bus — it is keyed by uiHash regardless of
  // who emits.
  presetTrackingSystem.addPromotionListener(async (uiHash) => {
    const matches: OrbitInstanceEntry[] = [];
    for (const entry of activeOrbitInstances.values()) {
      if (entry.instance.uiHash === uiHash) matches.push(entry);
    }
    if (matches.length === 0) return;
    const records = await listPresetsByUIHash(uiHash);
    const orbitRecords = records.map(adaptWebdawPresetToOrbit);
    for (const entry of matches) entry.instance.setLibrary(orbitRecords);
  });

  // React to chain-scope undo/redo : refresh this panel + rewire preview
  // audio whenever a Transform Chain op is applied or reverted by the
  // chain-undo scope. The chain-undo's keyboard handler is wired once in
  // wireFxPanel ; both panels share it.
  addChainChangeListener((key) => {
    if (key.chainId !== TRANSFORM_CHAIN_ID) return;
    void recompileTransformChainEffects(elements).then(() => {
      rewirePreviewTrackAudio();
      syncTransformPanelList();
      render(elements);
    });
  });

  // React to faust-fx-scope undo/redo on a Transform Chain effect :
  // mirror the post-undo parameters into the Faust node + orbit-ui.
  // The faust-fx keyboard handler is wired once in wireFxPanel.
  addFaustFxChangeListener((key) => {
    const entry = activeOrbitInstances.get(key.effectId);
    if (!entry) return;
    entry.bridge.apply(entry.bridge.getCurrentConfig());
  });

  async function loadOrbitUI(): Promise<{ new (root: HTMLElement, opts: any): OrbitUIType }> {
    if (orbitUIConstructor) return orbitUIConstructor;
    const url = new URL("./vendor/faust-orbit-ui/index.js", document.baseURI).href;
    const mod = await import(/* @vite-ignore */ url);
    orbitUIConstructor = mod.OrbitUI;
    if (!orbitUIConstructor) throw new Error("OrbitUI export missing from faust-orbit-ui");
    return orbitUIConstructor;
  }

  function destroyAllOrbitInstances(): void {
    for (const [effectId, entry] of activeOrbitInstances.entries()) {
      try { entry.bridge.end(); } catch { /* nothing */ }
      try { entry.instance.destroy(); } catch { /* already destroyed */ }
      unregisterOrbitUI(effectId);
    }
    activeOrbitInstances.clear();
  }

  /**
   * Purpose: Rewire the audio graph of the track that currently hosts the preview clip.
   * How: Locate the track containing the preview clip and call TrackAudio.ensureOutputGain,
   *      which clears stale runtime-node edges and rebuilds the FX chain in its current order.
   */
  function rewirePreviewTrackAudio(): void {
    const preview = demoState.faustTransformPreview;
    if (!preview) return;
    const previewTrack = demoState.project.timeline.tracks.find(
      (t) => t.clips.some((c) => c.id === preview.clipId),
    );
    if (!previewTrack) return;
    TrackAudio.ensureOutputGain(previewTrack.id as TrackId, (c) => demoState.audio.ensureMasterGain(c));
  }

  // --- Panel rendering ---

  function syncTransformPanelList(): void {
    // Snapshot focus location — innerHTML rebuilds below detach the
    // focused element. We capture whether focus was on the chain itself,
    // on a specific slot, or elsewhere — so we can restore it after the
    // async overlay rebuild (which would otherwise grab focus via
    // overlay.setVisible → canvas.focus).
    const focusWasInPanel = elements.transformPanel.contains(document.activeElement);
    const focusState: { kind: "chain" | "slot" | "other"; slotId?: string } = (() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return { kind: "other" };
      if (active === elements.transformPanelList) return { kind: "chain" };
      const slot = active.closest<HTMLElement>(".fx-panel-effect");
      if (slot?.dataset.effectId) return { kind: "slot", slotId: slot.dataset.effectId };
      return { kind: "other" };
    })();
    destroyAllOrbitInstances();
    const listEl = elements.transformPanelList;
    const chain = demoState.transformChain;

    if (chain.length === 0) {
      listEl.innerHTML = `<div class="fx-panel-empty">Drop .dsp files here to add effects</div>`;
      if (focusWasInPanel && document.activeElement === document.body) {
        listEl.focus();
      }
      return;
    }

    listEl.innerHTML = chain
      .map(
        (effect) =>
          `<div class="fx-panel-effect" tabindex="-1" data-effect-id="${effect.id}" data-bypassed="${effect.bypassed}">` +
          `<div class="fx-panel-effect-header" draggable="true">` +
          `<span class="fx-panel-effect-name">${getEffectName(effect)}</span>` +
          `<span class="fx-panel-effect-channels" id="fx-channels-${effect.id}"></span>` +
          `<button class="fx-ctrl fx-ctrl-edit" data-effect-id="${effect.id}" title="Edit code">&#9998;</button>` +
          `<button class="fx-ctrl fx-ctrl-bypass${effect.bypassed ? " fx-ctrl-bypass--bypassed" : ""}" data-effect-id="${effect.id}" title="Toggle bypass"><span class="material-symbols-outlined">power_settings_new</span></button>` +
          `<button class="fx-ctrl fx-ctrl-delete" data-effect-id="${effect.id}" title="Remove">&#10005;</button>` +
          `</div>` +
          `<div class="fx-panel-effect-orbit" tabindex="-1" id="transform-orbit-${effect.id}"></div>` +
          `</div>`,
      )
      .join("");

    // Restore focus into the panel if the rebuild detached it (mirror
    // of the snapshot at the top of this function).
    if (focusWasInPanel && document.activeElement === document.body) {
      listEl.focus();
    }

    // Create orbit-ui for each effect (async, non-blocking)
    void (async () => {
      try {
        // Ensure every Transform Chain effect has a compiled runtime ready
        // before we try to read its UI / node. After a fresh page reload
        // this is fire-and-forget started from session-restore, so the
        // first-press of T can race with compilation. Awaiting here makes
        // the panel reliably populated on every open.
        await recompileTransformChainEffects(elements);
        const OrbitUI = await loadOrbitUI();
        for (const effect of chain) {
          const runtime = getEffectRuntime(effect.id);
          if (!runtime?.ui || !runtime.node) continue;
          const container = document.getElementById(`transform-orbit-${effect.id}`);
          if (!container) continue;

          const node = runtime.node as any;
          // Display channel count label (e.g. "1→2") in the effect header
          const channelsEl = document.getElementById(`fx-channels-${effect.id}`);
          if (channelsEl && typeof node.getNumInputs === "function") {
            channelsEl.textContent = `${node.getNumInputs()}→${node.getNumOutputs()}`;
          }
          const effectId = effect.id;
          let instance: OrbitUIType | null = null;
          const bridge = new TransformGestureBridge(
            effectId,
            node,
            elements,
            () => instance,
          );

          const effectCode = getEffectCode(effect) ?? "";
          const codeHash = await computeCodeHash(effectCode);

          const orbit = new OrbitUI(container, {
            uiDescriptor: runtime.ui,
            onParamChange: (path: string, value: number) => bridge.setParam(path, value),
            onInteractionStart: () => bridge.begin(),
            onInteractionEnd: () => bridge.end(),
            onLibraryChange: (records: readonly OrbitPreset[]) => {
              void syncLibraryToIDB(orbit.uiHash, records);
            },
            onTrajectoryChange: (record: OrbitTrajectoryRecord) => {
              const webdaw: WebdawTrajectoryRecord = {
                sessionId: TRANSFORM_SESSION_ID,
                effectInstanceId: effectId,
                codeHash,
                events: record.events.map(adaptOrbitEventToWebdaw),
                headIndex: record.headIndex,
                cursorIndex: record.cursorIndex,
                updatedAt: record.updatedAt,
              };
              void saveTrajectory(webdaw);
            },
          });
          instance = orbit;

          // Expose the uiHash on the container for the global Cmd+Z router
          // (preset-library-undo / faust-fx-undo read this attribute to
          // identify which scope owns the keystroke).
          container.dataset.uiHash = orbit.uiHash;

          // Push the live audio configuration so the orbit dots reflect
          // the actual node state, not the JSON `init` defaults.
          if (effect.parameters.length > 0) {
            const currentValues: Record<string, number> = {};
            for (const param of effect.parameters) {
              currentValues[param.address] = param.value;
            }
            orbit.setParams(currentValues);
          }

          activeOrbitInstances.set(effect.id, { instance: orbit, bridge, codeHash });
          registerOrbitUI(effect.id, orbit);

          // Hydrate the library + trajectory from IDB. Trajectory is
          // session-scoped (TRANSFORM_SESSION_ID + effectId) and only
          // restored when the codeHash matches — a recompile invalidates
          // the previous trajectoire (PRESETSPEC: « cohérence avec le
          // code »).
          void (async () => {
            const [presets, traj] = await Promise.all([
              listPresetsByUIHash(orbit.uiHash),
              loadTrajectory(TRANSFORM_SESSION_ID, effectId),
            ]);
            if (presets.length > 0) {
              orbit.setLibrary(presets.map(adaptWebdawPresetToOrbit));
            }
            if (traj && traj.codeHash === codeHash) {
              orbit.setTrajectory({
                uiHash: orbit.uiHash,
                events: traj.events.map(adaptWebdawEventToOrbit),
                headIndex: traj.headIndex,
                cursorIndex: traj.cursorIndex,
                updatedAt: traj.updatedAt,
              });
            }
          })();
        }
      } catch (error) {
        console.error("[transform-panel] Failed to create orbit-ui instances:", error);
      }
      // Restore focus after the async overlay rebuild — overrides any
      // focus stolen by overlay.setVisible(true) during restoration.
      if (focusState.kind === "chain") {
        elements.transformPanelList.focus();
      } else if (focusState.kind === "slot" && focusState.slotId) {
        const slot = elements.transformPanelList.querySelector<HTMLElement>(
          `.fx-panel-effect[data-effect-id="${focusState.slotId}"]`,
        );
        const orbit = slot?.querySelector<HTMLElement>(".fx-panel-effect-orbit");
        if (orbit) orbit.focus();
        else slot?.focus();
      }
    })();
  }

  function updateStatus(message: string): void {
    elements.transformPanelStatus.textContent = message;
  }

  // --- Open/close the overlay ---

  function openPanel(): void {
    const sel = demoState.selection.ids;
    if (sel.size !== 1) return;
    const clipId = [...sel][0]!;

    // Stop current transport before entering preview
    demoState.transportLoop.stop(elements);

    elements.transformPanel.hidden = false;
    syncTransformPanelList();
    updateStatus(demoState.transformChain.length > 0 ? "Previewing (looping)" : "Drop .dsp files to add effects");

    // Place focus inside the panel so Cmd+Z routes to the transform
    // chain scope. The scope itself persists across open/close cycles
    // (see chain-undo.ts), but Cmd+Z would otherwise fall through to
    // project undo until the user clicks somewhere in the panel.
    elements.transformPanelList.focus();

    // Set preview state
    demoState.faustTransformPreview = {
      clipId,
      transformNodes: [],
      selectedEffectIndex: 0,
    };

    // Start looping playback on the selected clip
    void startPreviewClip(clipId, elements);
  }

  function closePanel(): void {
    destroyAllOrbitInstances();
    stopPreview(elements);
    elements.transformPanel.hidden = true;
    demoState.faustTransformPreview = null;
    render(elements);
  }

  // --- Draggable panel via header ---

  const panelContent = elements.transformPanel.querySelector(".transform-panel-content") as HTMLElement;
  const panelHeader = elements.transformPanel.querySelector(".transform-panel-header") as HTMLElement;
  {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    panelHeader.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      dragging = true;
      const rect = panelContent.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panelContent.style.position = "fixed";
      panelContent.style.left = `${e.clientX - offsetX}px`;
      panelContent.style.top = `${e.clientY - offsetY}px`;
      panelContent.style.margin = "0";
    });

    window.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  // --- Click anywhere in the window (except on a slot or an interactive
  //     control) → focus the chain. Without this, focus could stay on a
  //     previously-focused slot when the user clicks the header / footer
  //     / new-effect button area, and Cmd+Z would still target the slot
  //     scope instead of the chain.
  panelContent.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".fx-panel-effect")) return;
    if (target.closest("button, input, select, textarea, [contenteditable]")) return;
    requestAnimationFrame(() => elements.transformPanelList.focus());
  });

  // --- Effect controls (bypass, delete) via event delegation ---

  elements.transformPanelList.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest(".fx-ctrl") as HTMLElement | null;
    if (!target) return;
    const effectId = target.dataset.effectId;
    if (!effectId) return;

    if (target.classList.contains("fx-ctrl-edit")) {
      void openEditor(effectId, "__transform__", elements, {
        rewireTrackAudio: rewirePreviewTrackAudio,
        refreshPanel: () => syncTransformPanelList(),
      });
      return;
    }
    const idx = demoState.transformChain.findIndex((e) => e.id === effectId);
    if (idx < 0) return;
    const eff = demoState.transformChain[idx]!;
    if (target.classList.contains("fx-ctrl-bypass")) {
      demoState.transformChain = [
        ...demoState.transformChain.slice(0, idx),
        { ...eff, bypassed: !eff.bypassed },
        ...demoState.transformChain.slice(idx + 1),
      ];
      persistCurrentSessionDocument(elements);
      pushRenderLog("Toggle Transform Chain bypass");
      recordChainOp({ chainId: TRANSFORM_CHAIN_ID }, { kind: "bypass", effectId });
    } else if (target.classList.contains("fx-ctrl-delete")) {
      destroyEffectRuntime(effectId);
      demoState.transformChain = demoState.transformChain.filter((e) => e.id !== effectId);
      persistCurrentSessionDocument(elements);
      pushRenderLog("Remove Transform Chain effect");
      recordChainOp(
        { chainId: TRANSFORM_CHAIN_ID },
        { kind: "remove", effect: eff, index: idx },
      );
    } else {
      return;
    }
    rewirePreviewTrackAudio();
    syncTransformPanelList();
    render(elements);
  });

  // --- Click on effect header → focus the effect.
  //     Click in the empty area of the chain → focus the chain itself
  //     (so Cmd+Z routes to the chain scope after one inspected an
  //     effect — the focus would otherwise stay on the previous slot).
  elements.transformPanelList.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement;
    const header = target.closest(".fx-panel-effect-header") as HTMLElement | null;
    if (header) {
      const effectEl = header.closest(".fx-panel-effect") as HTMLElement | null;
      if (effectEl) {
        requestAnimationFrame(() => {
          const orbitRoot = effectEl.querySelector<HTMLElement>(".fx-panel-effect-orbit");
          if (orbitRoot) orbitRoot.focus();
          else effectEl.focus();
        });
      }
      return;
    }
    if (!target.closest(".fx-panel-effect")) {
      requestAnimationFrame(() => elements.transformPanelList.focus());
    }
  });

  // --- Drag-to-reorder ---

  let draggedEffectId: string | null = null;

  elements.transformPanelList.addEventListener("dragstart", (event) => {
    const effectEl = (event.target as HTMLElement).closest(".fx-panel-effect") as HTMLElement | null;
    if (!effectEl) return;
    draggedEffectId = effectEl.dataset.effectId ?? null;
    effectEl.classList.add("fx-panel-effect--dragging");
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });

  elements.transformPanelList.addEventListener("dragend", (event) => {
    const effectEl = (event.target as HTMLElement).closest(".fx-panel-effect") as HTMLElement | null;
    if (effectEl) effectEl.classList.remove("fx-panel-effect--dragging");
    draggedEffectId = null;
    clearReorderInsertion(elements.transformPanelList);
  });

  elements.transformPanelList.addEventListener("dragover", (event) => {
    if (draggedEffectId) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const insertIndex = computeInsertIndex(elements.transformPanelList, event.clientX, draggedEffectId);
      showReorderInsertion(elements.transformPanelList, draggedEffectId, insertIndex);
    } else if (isFileDrag(event.dataTransfer)) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
  });

  elements.transformPanelList.addEventListener("drop", async (event) => {
    // Handle reorder drop
    if (draggedEffectId) {
      event.preventDefault();
      const chain = demoState.transformChain;
      const fromIndex = chain.findIndex((e) => e.id === draggedEffectId);
      if (fromIndex < 0) return;
      const toIndex = computeInsertIndex(elements.transformPanelList, event.clientX, draggedEffectId);
      if (toIndex === fromIndex) return;
      const draggedId = draggedEffectId;
      const moved = [...chain];
      const [item] = moved.splice(fromIndex, 1);
      moved.splice(toIndex, 0, item!);
      demoState.transformChain = moved;
      persistCurrentSessionDocument(elements);
      pushRenderLog("Reorder Transform Chain");
      recordChainOp(
        { chainId: TRANSFORM_CHAIN_ID },
        { kind: "move", effectId: draggedId, fromIndex, toIndex },
      );
      rewirePreviewTrackAudio();
      syncTransformPanelList();
      render(elements);
      return;
    }

    // Handle .dsp file drop
    const droppedDspFile = getFirstDspFile(event.dataTransfer?.files ?? null);
    if (!droppedDspFile) return;
    event.preventDefault();
    event.stopPropagation();

    try {
      const code = await droppedDspFile.text();
      const { effect } = importDspFileAsEffect(droppedDspFile, code);
      demoState.transformChain = [...demoState.transformChain, effect];
      const effectName = getEffectName(effect);
      persistCurrentSessionDocument(elements);
      pushRenderLog(`Add "${effectName}" to Transform Chain`);
      syncTransformPanelList();
      demoState.footer.setStatus(`Compiling "${effectName}"…`);
      render(elements);

      // Compile the effect so Orbit UI can display params
      const audioContext = demoState.audio.ensureContext();
      if (audioContext) {
        try {
          await compileFxEffect(effect.id, effectName, code, audioContext);
        } catch (compileError) {
          // Compilation failed — remove the effect from the transform chain
          demoState.transformChain = demoState.transformChain.filter((e) => e.id !== effect.id);
          destroyEffectRuntime(effect.id);
          persistCurrentSessionDocument(elements);
          syncTransformPanelList();
          render(elements);
          throw compileError;
        }
        const runtime = getEffectRuntime(effect.id);
        if (runtime?.node) {
          const descriptorParams = captureEffectParameters(runtime.node);
          // Update transform chain with captured params
          const idx = demoState.transformChain.findIndex((e) => e.id === effect.id);
          if (idx >= 0) {
            demoState.transformChain = [
              ...demoState.transformChain.slice(0, idx),
              { ...demoState.transformChain[idx]!, parameters: descriptorParams },
              ...demoState.transformChain.slice(idx + 1),
            ];
          }
        }
        // Record the add op only after successful compilation, with the
        // post-compile FxEffect (parameters captured) so redo restores
        // a usable state.
        const idxFinal = demoState.transformChain.findIndex((e) => e.id === effect.id);
        const compiledEffect = idxFinal >= 0 ? demoState.transformChain[idxFinal]! : effect;
        recordChainOp(
          { chainId: TRANSFORM_CHAIN_ID },
          { kind: "add", effect: compiledEffect, index: idxFinal },
        );
        demoState.footer.setStatus(`"${effectName}" ready in Transform Chain`);
        rewirePreviewTrackAudio();
        syncTransformPanelList();
      }
    } catch (error) {
      const message = normalizeErrorMessage(error);
      demoState.footer.setStatus(message, "error");
      pushRenderLog(`ERROR: ${message}`);
      render(elements);
    }
  });

  // --- Apply (bounce) button ---

  elements.transformPanelApply.addEventListener("click", async () => {
    const sel = demoState.selection.ids;
    if (sel.size !== 1) {
      demoState.footer.setStatus("Select exactly one clip to transform", "error");
      return;
    }
    const clipId = [...sel][0]!;
    const activeEffects = demoState.transformChain.filter((e) => !e.bypassed);
    if (activeEffects.length === 0) {
      demoState.footer.setStatus("No active effects in Transform Chain", "error");
      return;
    }

    // Stop preview playback before bouncing to avoid audio interference
    stopPreview(elements);

    updateStatus("Bouncing…");
    demoState.footer.setStatus("Bouncing Transform Chain…");

    try {
      // Collect factories from compiled runtimes
      const effectFactories = new Map<string, any>();
      for (const effect of activeEffects) {
        const runtime = getEffectRuntime(effect.id);
        if (runtime?.generator?.factory) {
          effectFactories.set(effect.id, runtime.generator.factory);
        } else {
          throw new Error(`Effect "${getEffectName(effect)}" is not compiled`);
        }
      }

      // Load faustwasm module
      await ensureFaustCompiler();
      const faustwsamUrl = new URL("./vendor/faustwasm/index.js", document.baseURI).href;
      const faustWasmModule = await import(/* @vite-ignore */ faustwsamUrl);

      // Read clip PCM
      const deps = makeClipSampleDeps();
      const clip = demoState.project.timeline.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === clipId);
      if (!clip) throw new Error("Clip not found");

      const startSample = clip.sourceStartSample ?? 0;
      const lengthSamples = clip.sourceLengthSamples ?? clip.resource.length;
      const clipSamples = deps.sampleStore.read(clip.resource.id, startSample, lengthSamples);
      const sampleRate = clip.resource.sampleRate;

      // Bounce
      const result = await bounceTransformChain(
        clipSamples,
        sampleRate,
        demoState.transformChain,
        faustWasmModule,
        effectFactories,
      );

      // Build chain label
      const chainLabel = activeEffects.map((e) => getEffectName(e)).join("+");

      // Commit the transformed clip as a single undo entry.
      const currentSelection = getCurrentSelection();
      const targetClip = [...currentSelection.clips()][0];
      if (targetClip) {
        const originalName = (targetClip.name ?? targetClip.resource.id).trim() || targetClip.resource.id;
        const resultName = `${originalName} (${chainLabel})`;
        commitSelectionTransition(
          `Transform clip (${chainLabel})`,
          () => {
            const transitionResult = replaceClipAudio(
              currentSelection.project,
              targetClip,
              result.samples,
              deps,
              createNextClipId,
              resultName,
            );
            return Selection.of(transitionResult.project, [transitionResult.clip.id]);
          },
          elements,
        );
      }

      demoState.footer.setStatus(`Transform applied: ${chainLabel}`);
      updateStatus("Applied");
      render(elements);

      // Close panel after successful apply
      closePanel();
    } catch (error) {
      const message = normalizeErrorMessage(error);
      demoState.footer.setStatus(message, "error");
      updateStatus("Error");
      pushRenderLog(`ERROR: ${message}`);
      render(elements);
    }
  });

  // --- New blank effect ---
  elements.transformPanelNew.addEventListener("click", async () => {
    const effect = createBlankEffect();
    demoState.transformChain = [...demoState.transformChain, effect];
    const effectName = getEffectName(effect);
    persistCurrentSessionDocument(elements);
    pushRenderLog(`Add new "${effectName}" to Transform Chain`);
    syncTransformPanelList();
    demoState.footer.setStatus(`Compiling "${effectName}"…`);
    render(elements);
    const audioContext = demoState.audio.ensureContext();
    if (audioContext) {
      const resource = demoState.project.fxResources.get(effect.fxResourceId);
      const code = resource?.code ?? "";
      try {
        await compileFxEffect(effect.id, effectName, code, audioContext);
      } catch (compileError) {
        demoState.transformChain = demoState.transformChain.filter((e) => e.id !== effect.id);
        destroyEffectRuntime(effect.id);
        persistCurrentSessionDocument(elements);
        syncTransformPanelList();
        render(elements);
        const message = typeof compileError === "object" && compileError && "message" in compileError
          ? (compileError as Error).message : String(compileError);
        demoState.footer.setStatus(message, "error");
        pushRenderLog(`ERROR: ${message}`);
        return;
      }
      const runtime = getEffectRuntime(effect.id);
      if (runtime?.node) {
        const descriptorParams = captureEffectParameters(runtime.node);
        const idx = demoState.transformChain.findIndex((e) => e.id === effect.id);
        if (idx >= 0) {
          demoState.transformChain = [
            ...demoState.transformChain.slice(0, idx),
            { ...demoState.transformChain[idx]!, parameters: descriptorParams },
            ...demoState.transformChain.slice(idx + 1),
          ];
        }
      }
      // Record the add op only after successful compilation, with the
      // post-compile FxEffect (parameters captured) so redo restores
      // a usable state.
      const idxFinal = demoState.transformChain.findIndex((e) => e.id === effect.id);
      const compiledEffect = idxFinal >= 0 ? demoState.transformChain[idxFinal]! : effect;
      recordChainOp(
        { chainId: TRANSFORM_CHAIN_ID },
        { kind: "add", effect: compiledEffect, index: idxFinal },
      );
      rewirePreviewTrackAudio();
      syncTransformPanelList();
    }
    demoState.footer.setStatus(`Effect "${effectName}" ready`);
    // Open editor immediately
    void openEditor(effect.id, TRANSFORM_TRACK_ID, elements, {
      rewireTrackAudio: rewirePreviewTrackAudio,
      refreshPanel: () => syncTransformPanelList(),
    });
  });

  // --- Cancel / close buttons ---

  elements.transformPanelCancel.addEventListener("click", () => {
    closePanel();
  });

  elements.transformPanelClose.addEventListener("click", () => {
    closePanel();
  });

  // --- Keyboard shortcuts (Escape = cancel, Enter = apply) ---

  document.addEventListener("keydown", (event) => {
    if (elements.transformPanel.hidden) return;
    // Don't intercept keys when the Faust editor is open
    if (!elements.faustEditor.hidden) return;
    if (event.key === "Escape") {
      closePanel();
    } else if (event.key === "Enter") {
      elements.transformPanelApply.click();
    }
  });

  // --- Expose openPanel for the context menu ---
  _openTransformPanel = openPanel;
}

// ---------------------------------------------------------------------------
// External entry point for context menu / drag-and-drop
// ---------------------------------------------------------------------------

let _openTransformPanel: (() => void) | null = null;

export function openTransformPanel(): void {
  if (_openTransformPanel) _openTransformPanel();
}

/**
 * Purpose: Recompile all Transform Chain effects that lack a runtime.
 * How: Called after session restore to recompile saved effects.
 */
export async function recompileTransformChainEffects(_elements: Elements): Promise<void> {
  const audioContext = demoState.audio.ensureContext();
  if (!audioContext) return;

  for (const effect of demoState.transformChain) {
    const name = getEffectName(effect);
    const code = demoState.project.fxResources.get(effect.fxResourceId)?.code ?? "";
    if (!code) continue;
    // Reuse only a current runtime (same code, live context); ids repeat across sessions.
    if (hasCurrentEffectRuntime(effect.id, code, audioContext)) {
      const node = getEffectRuntime(effect.id)?.node;
      if (node && effect.parameters.length > 0) {
        restoreEffectParameters(node, effect.parameters);
      }
      continue;
    }
    try {
      await compileFxEffect(effect.id, name, code, audioContext);
      const runtime = getEffectRuntime(effect.id);
      if (runtime?.node && effect.parameters.length > 0) {
        restoreEffectParameters(runtime.node, effect.parameters);
      }
    } catch (error) {
      console.warn(`[transform] Failed to recompile "${name}":`, error);
    }
  }
}
