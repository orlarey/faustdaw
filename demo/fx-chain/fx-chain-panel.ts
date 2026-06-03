/***************************** fx-chain-panel.ts ********************************
 *
 * Purpose: Manage the FX panel UI — list rendering, orbit-ui construction,
 *          open/close, drag-and-drop of .dsp files, and effect controls.
 * How: Provide a wireFxPanel entry point called from wireEvents, plus the
 *      compile-and-attach bridge that both the panel and the grid drop
 *      handler call, and the session-restore recompilation flow.
 *
 *****************************************************************************/
import type { Elements } from "../bind-elements.js";
import type { FxEffect, FxParam } from "../../src/domain/fx-chain.js";
import type { TrackId } from "../../src/domain/track-id.js";
import {
  addEffect,
  removeEffect,
  moveEffect,
  toggleEffectBypass,
  updateEffectParameters,
  updateEffectParamValue,
} from "../../src/fx-chain.js";
import { demoState } from "../state.js";
import { compileFxEffect, getEffectRuntime, destroyEffectRuntime } from "./fx-chain-runtime.js";
import { captureEffectParameters, restoreEffectParameters } from "./fx-chain-audio.js";
import {
  getEffectName,
  getEffectCode,
  createBlankEffect,
  importDspFileAsEffect,
  getFirstDspFile,
} from "./faust-resource.js";
import { openEditor } from "../faust-editor/faust-editor.js";
import { pushRenderLog, render } from "../daw-render/daw-render-runtime.js";
import { TrackAudio } from "../track/track-audio.js";
import {
  persistCurrentSessionDocument,
} from "../session-history.js";
import { normalizeErrorMessage } from "../error-message.js";
import { isFileDrag } from "../drag-predicates.js";
import { presetTrackingSystem } from "../preset-tracking.js";
import {
  computeCodeHash,
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
import { registerOrbitUI, unregisterOrbitUI } from "../orbit-ui-registry.js";
import { wireLibraryUndoKeyboard } from "../preset-library-undo.js";
import {
  addChainChangeListener,
  recordChainOp,
  wireChainUndoKeyboard,
} from "../chain-undo.js";
import {
  addFaustFxChangeListener,
  paramsEqual,
  recordFaustFxOp,
  wireFaustFxUndoKeyboard,
} from "../faust-fx-undo.js";
import {
  clearReorderInsertion,
  computeInsertIndex,
  showReorderInsertion,
} from "../fx-panel-reorder.js";

// ---------------------------------------------------------------------------
// Context — functions injected by the caller (wireEvents in interactions.ts)
// ---------------------------------------------------------------------------

/**
 * Purpose: FxPanelContext is now empty — all former callbacks resolve to
 *          direct imports of the corresponding concepts (audio-engine,
 *          track-audio, session-history, footer-view, drag-predicates,
 *          error-message). Kept as a type alias for wireFxPanel's signature
 *          stability; can be removed in a follow-up.
 */
export type FxPanelContext = Record<string, never>;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

// Tracks the in-flight recompilation promise so that UI code can await it.
let pendingRecompilation: Promise<void> | null = null;

// Context is set once by wireFxPanel.
let ctx: FxPanelContext | null = null;

// Callback used by recompileAllSessionEffects to refresh the panel after compilation.
let syncFxPanelListRef: ((els: Elements) => void) | null = null;

// ---------------------------------------------------------------------------
// FxChainGestureBridge — implements OverlayGestureHandler for one effect
// instance in the FX chain. Holds the parameter-snapshot baseline used to
// build a faust-fx undo entry on gesture end, and centralises the
// audio-node + domain-model writes used by both the orbit-ui's per-param
// drag callback and the calque's whole-config apply.
// ---------------------------------------------------------------------------

class FxChainGestureBridge {
  #paramsBefore: ReadonlyArray<FxParam> | null = null;

  constructor(
    private readonly effectId: string,
    private readonly trackId: TrackId,
    private readonly node: any,
    private readonly elements: Elements,
    /**
     * Deferred orbit-instance accessor — the orbit-ui is constructed
     * AFTER the bridge (its drag-callback references the bridge), so we
     * resolve the instance lazily through this getter rather than
     * assigning it via a setter (which would risk a "calle-before-set"
     * window).
     */
    private readonly getOrbitInstance: () => OrbitUIType | null,
  ) {}

  begin(): void {
    const live = this.#findEffect();
    this.#paramsBefore = live ? live.parameters : null;
  }

  apply(configuration: Readonly<Record<string, number>>): void {
    for (const [address, value] of Object.entries(configuration)) {
      this.#writeParam(address, value);
    }
    const orbit = this.getOrbitInstance();
    if (orbit) orbit.setParams(configuration);
  }

  /**
   * Single-param write — used by the orbit-ui's per-tick drag callback.
   * Distinct from `apply(config)` (which also pushes the new state into
   * the orbit-ui's visual layer) because here the orbit-ui IS the source
   * of the change and updating itself would loop.
   */
  setParam(address: string, value: number): void {
    this.#writeParam(address, value);
  }

  end(): void {
    const before = this.#paramsBefore;
    this.#paramsBefore = null;
    if (before && ctx) {
      const live = this.#findEffect();
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
    const live = this.#findEffect();
    const config: Record<string, number> = {};
    if (live) for (const p of live.parameters) config[p.address] = p.value;
    return config;
  }

  #writeParam(address: string, value: number): void {
    if (this.node.setParamValue) this.node.setParamValue(address, value);
    // Mirror the value into the domain model — Faust's AudioParam.value
    // does not reflect setValueAtTime, so we cannot reconstruct the value
    // by reading it back from the node.
    demoState.project = updateEffectParamValue(
      demoState.project, this.trackId, this.effectId, address, value,
    );
  }

  #findEffect(): FxEffect | undefined {
    const track = demoState.project.timeline.tracks.find((t) => t.id === this.trackId);
    if (!track) return undefined;
    return demoState.project.chains.get(track.chainId)?.effects
      .find((e) => e.id === this.effectId);
  }
}

// ---------------------------------------------------------------------------
// Effect compilation + domain capture (shared by panel drop and grid drop)
// ---------------------------------------------------------------------------

/**
 * Purpose: Compile one Faust effect and wire it into the track's audio graph.
 * How: Delegate to compileFxEffect (serialized WASM queue), optionally restore
 *      saved parameter values, capture live params into the domain model, and rewire audio.
 */
export async function compileAndAttachEffect(
  effect: FxEffect,
  targetTrackId: TrackId,
  elements: Elements,
  savedParameters: readonly FxParam[] | null = null,
): Promise<void> {
  if (!ctx) {
    return;
  }
  const audioContext = demoState.audio.ensureContext();
  if (!audioContext) {
    return;
  }
  const name = getEffectName(effect);
  const code = getEffectCode(effect);
  if (!code) {
    console.warn(`[faust] Skipping "${name}": empty code (fxResourceId="${effect.fxResourceId}")`);
    return;
  }
  const runtime = await compileFxEffect(effect.id, name, code, audioContext);
  if (runtime.node) {
    // Capture parameter metadata (min/max/step/label/default) from the compiled node.
    // Note: values read from the node are unreliable (Faust uses setValueAtTime which
    // does not update AudioParam.value), so we merge saved values over these descriptors.
    const descriptorParams = captureEffectParameters(runtime.node);
    let projectParams = descriptorParams;
    if (savedParameters && savedParameters.length > 0) {
      // Push saved values onto the live node and merge them into the descriptor list.
      restoreEffectParameters(runtime.node, savedParameters);
      const savedValueByAddress = new Map(savedParameters.map((p) => [p.address, p.value]));
      projectParams = descriptorParams.map((p) => {
        const savedValue = savedValueByAddress.get(p.address);
        return savedValue !== undefined ? { ...p, value: savedValue } : p;
      });
    }
    demoState.project = updateEffectParameters(demoState.project, targetTrackId, effect.id, projectParams);
  }
  // Rewire the track's audio chain
  TrackAudio.ensureOutputGain(targetTrackId, (c) => demoState.audio.ensureMasterGain(c));
}

// ---------------------------------------------------------------------------
// Session restore — recompile all effects
// ---------------------------------------------------------------------------

// Guard flag to prevent recompileAllSessionEffects reentrance.
let recompilationInProgress = false;

/**
 * Purpose: Recompile all effects that lack a runtime after session restore or undo/redo.
 * How: Loop over every uncompiled effect and delegate to compileAndAttachEffect with saved params.
 */
export async function recompileAllSessionEffects(elements: Elements): Promise<void> {
  if (recompilationInProgress) {
    return;
  }
  const allEffects: { trackId: TrackId; effect: FxEffect }[] = [];
  for (const track of demoState.project.timeline.tracks) {
    const chain = demoState.project.chains.get(track.chainId);
    if (!chain) continue;
    for (const effect of chain.effects) {
      if (!getEffectRuntime(effect.id)) {
        allEffects.push({ trackId: track.id as TrackId, effect });
      }
    }
  }
  if (allEffects.length === 0) {
    return;
  }
  recompilationInProgress = true;
  let compiledCount = 0;
  try {
    console.log(`[faust] Recompiling ${allEffects.length} effect(s) from restored session…`);
    for (const { trackId, effect } of allEffects) {
      try {
        const savedParams = effect.parameters.length > 0 ? effect.parameters : null;
        await compileAndAttachEffect(effect, trackId, elements, savedParams);
        compiledCount++;
      } catch (error) {
        console.warn(`[faust] Failed to recompile "${getEffectName(effect)}":`, error);
      }
    }
  } finally {
    recompilationInProgress = false;
  }
  // Refresh the FX panel UI only if at least one effect was compiled
  if (compiledCount > 0 && demoState.activeFxTrackId && syncFxPanelListRef) {
    syncFxPanelListRef(elements);
  }
}

/**
 * Purpose: Start a tracked recompilation and return the promise.
 * How: Assign the promise to pendingRecompilation so syncFxPanelList can await it.
 */
export function startRecompilation(elements: Elements): void {
  pendingRecompilation = recompileAllSessionEffects(elements).finally(() => {
    pendingRecompilation = null;
  });
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
 *          minimum set of writes (add / update / delete). Mirror of the
 *          helper in faust-transform-panel.ts — see comments there.
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
// Refresh helper for external callers (e.g. grid drop handler)
// ---------------------------------------------------------------------------

export function refreshFxPanelIfOpen(elements: Elements): void {
  if (demoState.activeFxTrackId && syncFxPanelListRef) {
    syncFxPanelListRef(elements);
  }
}

// ---------------------------------------------------------------------------
// Wire all FX panel event listeners
// ---------------------------------------------------------------------------

export function wireFxPanel(elements: Elements, context: FxPanelContext): void {
  ctx = context;
  // Make the panel list focusable (without entering the tab order) so
  // we can route focus back into the panel after innerHTML rebuilds —
  // critical for chain-scope Cmd+Z continuity. See `syncFxPanelList`.
  elements.fxPanelList.tabIndex = -1;

  // --- OrbitUI lazy loader and instance management ---
  let orbitUIConstructor: { new (root: HTMLElement, opts: any): OrbitUIType } | null = null;
  type OrbitInstanceEntry = {
    instance: OrbitUIType;
    bridge: FxChainGestureBridge;
    codeHash: string;
  };
  const activeOrbitInstances = new Map<string, OrbitInstanceEntry>();

  // Cross-panel library-change broadcast: when another OrbitUI (transform
  // panel or another fx-chain instance) or the legacy library-undo scope
  // mutates IDB for a uiHash we own, reload the affected wrapper(s) so
  // the calque + recall menu stay in sync.
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

  // --- FX panel list rendering ---

  function syncFxPanelList(els: Elements): void {
    // Snapshot whether the focus was inside the panel — the
    // innerHTML rebuild below detaches the focused element. Without
    // this, focus drops onto document.body and the next Cmd+Z misses
    // the chain scope (it falls through to project undo, which
    // restores demoState but doesn't refresh this UI).
    const focusWasInPanel = els.fxPanel.contains(document.activeElement);
    const focusState: { kind: "chain" | "slot" | "other"; slotId?: string } = (() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return { kind: "other" };
      if (active === els.fxPanelList) return { kind: "chain" };
      const slot = active.closest<HTMLElement>(".fx-panel-effect");
      if (slot?.dataset.effectId) return { kind: "slot", slotId: slot.dataset.effectId };
      return { kind: "other" };
    })();
    destroyAllOrbitInstances();
    const trackId = demoState.activeFxTrackId;
    if (!trackId) {
      return;
    }
    const track = demoState.project.timeline.tracks.find((t) => t.id === trackId);
    if (!track) {
      return;
    }
    const trackEffects = demoState.project.chains.get(track.chainId)?.effects ?? [];
    if (trackEffects.length === 0) {
      els.fxPanelList.innerHTML = `<div class="fx-panel-empty">Drop .dsp files here to add effects</div>`;
      if (focusWasInPanel && document.activeElement === document.body) {
        els.fxPanelList.focus();
      }
      return;
    }
    els.fxPanelList.innerHTML = trackEffects
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
          `<div class="fx-panel-effect-orbit" tabindex="-1" id="orbit-${effect.id}"></div>` +
          `</div>`,
      )
      .join("");

    // Restore focus into the panel if the rebuild detached it. Without
    // this, the next Cmd+Z misses the chain scope (see snapshot at the
    // top of this function).
    if (focusWasInPanel && document.activeElement === document.body) {
      els.fxPanelList.focus();
    }

    // Create orbit-ui for each compiled effect (async, non-blocking)
    void (async () => {
      try {
        // Wait for any in-flight recompilation before reading effect runtimes
        if (pendingRecompilation) {
          await pendingRecompilation;
        }
        const OrbitUI = await loadOrbitUI();
        const sessionId = demoState.session.id;
        for (const effect of trackEffects) {
          const runtime = getEffectRuntime(effect.id);
          if (!runtime?.ui || !runtime.node) {
            continue;
          }
          const container = document.getElementById(`orbit-${effect.id}`);
          if (!container) {
            continue;
          }
          const node = runtime.node as any;
          // Display channel count label (e.g. "1→2") in the effect header
          const channelsEl = document.getElementById(`fx-channels-${effect.id}`);
          if (channelsEl && typeof node.getNumInputs === "function") {
            channelsEl.textContent = `${node.getNumInputs()}→${node.getNumOutputs()}`;
          }
          const effectId = effect.id;
          const effectTrackId = trackId;
          let instance: OrbitUIType | null = null;
          const bridge = new FxChainGestureBridge(
            effectId,
            effectTrackId,
            node,
            els,
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
                sessionId,
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
          // session-scoped (sessionId + effectId) and only restored when
          // the codeHash matches — a recompile invalidates the previous
          // trajectoire (PRESETSPEC: « cohérence avec le code »).
          void (async () => {
            const [presets, traj] = await Promise.all([
              listPresetsByUIHash(orbit.uiHash),
              loadTrajectory(sessionId, effectId),
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
        console.error("[orbit-ui] Failed to create orbit-ui instances:", error);
      }
      // Restore focus after the async overlay rebuild — overrides any
      // focus stolen by overlay.setVisible(true) during restoration.
      if (focusState.kind === "chain") {
        els.fxPanelList.focus();
      } else if (focusState.kind === "slot" && focusState.slotId) {
        const slot = els.fxPanelList.querySelector<HTMLElement>(
          `.fx-panel-effect[data-effect-id="${focusState.slotId}"]`,
        );
        const orbit = slot?.querySelector<HTMLElement>(".fx-panel-effect-orbit");
        if (orbit) orbit.focus();
        else slot?.focus();
      }
    })();
  }

  // Register so module-level code (recompileAllSessionEffects) can refresh the panel.
  syncFxPanelListRef = syncFxPanelList;

  // --- Draggable panel via header (mirrors faust-transform-panel) ---
  const panelContent = elements.fxPanel.querySelector<HTMLElement>(".fx-panel-content");
  const panelHeader = elements.fxPanel.querySelector<HTMLElement>(".fx-panel-header");
  if (panelContent && panelHeader) {
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

    // Click anywhere in the window (except on a slot or an interactive
    // control) → focus the chain (mirror of the transform panel).
    panelContent.addEventListener("mousedown", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".fx-panel-effect")) return;
      if (target.closest("button, input, select, textarea, [contenteditable]")) return;
      requestAnimationFrame(() => elements.fxPanelList.focus());
    });
  }

  // --- FX panel effect controls (bypass, delete) via event delegation ---
  // Niveau-1 library-scope undo/redo : installs the Cmd+Z capture-phase
  // handler that pre-empts the project-undo when a calque is focused and
  // its library scope has entries. Routes to OrbitUI's internal scope
  // for migrated panels and to webdaw's LibraryUndoScope otherwise.
  wireLibraryUndoKeyboard();
  // Niveau-2 faust-fx-scope undo/redo : Cmd+Z when focus is on the
  // orbit-ui (no calque active) routes to the effect's faust-fx scope.
  // Registered between the library handler (3b) and the chain handler
  // (1) — the order is library > faust-fx > chain > project.
  wireFaustFxUndoKeyboard(elements);
  // Niveau-1 chain-scope undo/redo : Cmd+Z when focus is in an effect
  // panel (no calque active and no orbit-ui focus) routes to the
  // track's chain scope. The faust-fx handler above peels off the
  // orbit-focused case first.
  wireChainUndoKeyboard(elements);
  // React to faust-fx-scope undo/redo : push the post-undo parameters
  // back onto the Faust node + orbit-ui display. The domain model is
  // already up-to-date (writeParamsForEffect ran in the scope), so we
  // just need to mirror it through the bridge.
  addFaustFxChangeListener((key) => {
    const entry = activeOrbitInstances.get(key.effectId);
    if (!entry) return;
    entry.bridge.apply(entry.bridge.getCurrentConfig());
  });
  // React to chain-scope undo/redo : refresh this panel + rewire track
  // audio whenever a chain op is applied or reverted by the chain-undo
  // scope. We filter on `activeFxTrackId` because the focus-routing in
  // chain-undo only invokes the scope of the currently-active panel.
  addChainChangeListener((key) => {
    const trackId = demoState.activeFxTrackId;
    if (!trackId || key.chainId !== trackId) return;
    void recompileAllSessionEffects(elements).then(() => {
      TrackAudio.ensureOutputGain(trackId, (c) => demoState.audio.ensureMasterGain(c));
      syncFxPanelList(elements);
      render(elements);
    });
  });

  elements.fxPanelList.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest(".fx-ctrl") as HTMLElement | null;
    if (!target) {
      return;
    }
    const trackId = demoState.activeFxTrackId;
    const effectId = target.dataset.effectId;
    if (!trackId || !effectId) {
      return;
    }
    if (target.classList.contains("fx-ctrl-edit")) {
      void openEditor(effectId, trackId, elements, {
        rewireTrackAudio: (tid: string) => TrackAudio.ensureOutputGain(tid as TrackId, (c) => demoState.audio.ensureMasterGain(c)),
        refreshPanel: () => syncFxPanelList(elements),
      });
      return;
    }
    const track = demoState.project.timeline.tracks.find((t) => t.id === trackId);
    const chain = track ? demoState.project.chains.get(track.chainId) : undefined;
    const effect = chain?.effects.find((e) => e.id === effectId);
    if (!track || !chain || !effect) return;
    if (target.classList.contains("fx-ctrl-bypass")) {
      demoState.project = toggleEffectBypass(demoState.project, track.chainId, effectId);
      persistCurrentSessionDocument(elements);
      pushRenderLog(`Toggle bypass on ${trackId}`);
      recordChainOp({ chainId: track.chainId }, { kind: "bypass", effectId });
    } else if (target.classList.contains("fx-ctrl-delete")) {
      const index = chain.effects.findIndex((e) => e.id === effectId);
      destroyEffectRuntime(effectId);
      demoState.project = removeEffect(demoState.project, track.chainId, effectId);
      persistCurrentSessionDocument(elements);
      pushRenderLog(`Remove effect from ${trackId}`);
      recordChainOp({ chainId: track.chainId }, { kind: "remove", effect, index });
    } else {
      return;
    }
    // Rewire the audio chain and refresh the FX panel UI
    TrackAudio.ensureOutputGain(trackId, (c) => demoState.audio.ensureMasterGain(c));
    syncFxPanelList(elements);
    render(elements);
  });

  // --- Click on effect header → focus the effect.
  //     Click in the empty area of the chain → focus the chain itself
  //     (so Cmd+Z routes to the chain scope after one inspected an
  //     effect — the focus would otherwise stay on the previous slot).
  elements.fxPanelList.addEventListener("mousedown", (event) => {
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
      requestAnimationFrame(() => elements.fxPanelList.focus());
    }
  });

  // --- FX panel effect reorder via drag-and-drop on the header ---
  let draggedEffectId: string | null = null;

  elements.fxPanelList.addEventListener("dragstart", (event) => {
    const effectEl = (event.target as HTMLElement).closest(".fx-panel-effect") as HTMLElement | null;
    if (!effectEl) {
      return;
    }
    draggedEffectId = effectEl.dataset.effectId ?? null;
    effectEl.classList.add("fx-panel-effect--dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  });

  elements.fxPanelList.addEventListener("dragend", (event) => {
    const effectEl = (event.target as HTMLElement).closest(".fx-panel-effect") as HTMLElement | null;
    if (effectEl) {
      effectEl.classList.remove("fx-panel-effect--dragging");
    }
    draggedEffectId = null;
    clearReorderInsertion(elements.fxPanelList);
  });

  elements.fxPanelList.addEventListener("dragover", (event) => {
    if (!draggedEffectId) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const insertIndex = computeInsertIndex(elements.fxPanelList, event.clientX, draggedEffectId);
    showReorderInsertion(elements.fxPanelList, draggedEffectId, insertIndex);
  });

  elements.fxPanelList.addEventListener("drop", (event) => {
    if (!draggedEffectId) {
      return;
    }
    event.preventDefault();
    const trackId = demoState.activeFxTrackId;
    if (!trackId) {
      return;
    }
    const track = demoState.project.timeline.tracks.find((t) => t.id === trackId);
    const chain = track ? demoState.project.chains.get(track.chainId) : undefined;
    if (!track || !chain) return;
    const fromIndex = chain.effects.findIndex((e) => e.id === draggedEffectId);
    if (fromIndex < 0) return;
    // computeInsertIndex returns the post-removal target index, which
    // is exactly what `moveEffect` consumes — no from-vs-to bookkeeping.
    const toIndex = computeInsertIndex(elements.fxPanelList, event.clientX, draggedEffectId);
    if (toIndex === fromIndex) return;
    const draggedId = draggedEffectId;
    demoState.project = moveEffect(demoState.project, track.chainId, draggedId, toIndex);
    persistCurrentSessionDocument(elements);
    pushRenderLog(`Reorder effects on ${trackId}`);
    recordChainOp(
      { chainId: track.chainId },
      { kind: "move", effectId: draggedId, fromIndex, toIndex },
    );
    TrackAudio.ensureOutputGain(trackId, (c) => demoState.audio.ensureMasterGain(c));
    syncFxPanelList(elements);
    render(elements);
  });

  // --- FX panel open/close ---
  for (const button of elements.trackFxButtons) {
    button.addEventListener("click", () => {
      const trackId = button.dataset.trackId as TrackId | undefined;
      if (!trackId) {
        return;
      }
      if (demoState.activeFxTrackId === trackId) {
        // Toggle off: close the panel
        destroyAllOrbitInstances();
        demoState.activeFxTrackId = null;
        elements.fxPanel.hidden = true;
        button.setAttribute("aria-pressed", "false");
      } else {
        // Depress previous button if any
        if (demoState.activeFxTrackId !== null) {
          for (const btn of elements.trackFxButtons) {
            btn.setAttribute("aria-pressed", "false");
          }
        }
        demoState.activeFxTrackId = trackId;
        elements.fxPanelTrackLabel.textContent = trackId;
        elements.fxPanel.hidden = false;
        button.setAttribute("aria-pressed", "true");
        syncFxPanelList(elements);
        // Place focus inside the panel so Cmd+Z routes to the chain
        // scope. The scope itself persists per-track (see chain-undo.ts).
        elements.fxPanelList.focus();
      }
    });
  }

  // --- New blank effect ---
  elements.fxPanelNew.addEventListener("click", async () => {
    const trackId = demoState.activeFxTrackId;
    if (!trackId) return;
    const effect = createBlankEffect();
    demoState.project = addEffect(demoState.project, trackId, effect);
    const effectName = getEffectName(effect);
    persistCurrentSessionDocument(elements);
    pushRenderLog(`Add new effect "${effectName}" on ${trackId}`);
    syncFxPanelList(elements);
    demoState.footer.setStatus(`Compiling "${effectName}"…`);
    render(elements);
    try {
      await compileAndAttachEffect(effect, trackId, elements);
    } catch (compileError) {
      demoState.project = removeEffect(demoState.project, trackId, effect.id);
      destroyEffectRuntime(effect.id);
      persistCurrentSessionDocument(elements);
      syncFxPanelList(elements);
      render(elements);
      const message = normalizeErrorMessage(compileError);
      demoState.footer.setStatus(message, "error");
      pushRenderLog(`ERROR: ${message}`);
      return;
    }
    // Record the add op only after successful compilation, with the
    // post-compile FxEffect (parameters captured) so redo restores a
    // usable state.
    const trackAfter = demoState.project.timeline.tracks.find((t) => t.id === trackId);
    const chainAfter = trackAfter ? demoState.project.chains.get(trackAfter.chainId) : undefined;
    const compiledEffect = chainAfter?.effects.find((e) => e.id === effect.id) ?? effect;
    const index = chainAfter?.effects.findIndex((e) => e.id === effect.id) ?? 0;
    recordChainOp(
      { chainId: trackAfter?.chainId ?? trackId },
      { kind: "add", effect: compiledEffect, index },
    );
    demoState.footer.setStatus(`Effect "${effectName}" ready on ${trackId}`);
    syncFxPanelList(elements);
    // Open editor immediately
    void openEditor(effect.id, trackId, elements, {
      rewireTrackAudio: (tid: string) => TrackAudio.ensureOutputGain(tid as TrackId, (c) => demoState.audio.ensureMasterGain(c)),
      refreshPanel: () => syncFxPanelList(elements),
    });
  });

  elements.fxPanelClose.addEventListener("click", () => {
    destroyAllOrbitInstances();
    demoState.activeFxTrackId = null;
    elements.fxPanel.hidden = true;
    for (const btn of elements.trackFxButtons) {
      btn.setAttribute("aria-pressed", "false");
    }
  });

  // --- FX panel drop zone ---
  elements.fxPanelList.addEventListener("dragover", (event) => {
    if (isFileDrag(event.dataTransfer)) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    }
  });

  elements.fxPanelList.addEventListener("drop", async (event) => {
    const droppedDspFile = getFirstDspFile(event.dataTransfer?.files ?? null);
    if (!droppedDspFile || !demoState.activeFxTrackId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const targetTrackId = demoState.activeFxTrackId;
    try {
      const code = await droppedDspFile.text();
      const { effect } = importDspFileAsEffect(droppedDspFile, code);
      demoState.project = addEffect(demoState.project, targetTrackId, effect);
      const effectName = getEffectName(effect);
      persistCurrentSessionDocument(elements);
      pushRenderLog(`Add effect "${effectName}" on ${targetTrackId}`);
      syncFxPanelList(elements);
      demoState.footer.setStatus(`Compiling "${effectName}"…`);
      render(elements);

      try {
        await compileAndAttachEffect(effect, targetTrackId, elements);
      } catch (compileError) {
        // Compilation failed — remove the effect from the project
        demoState.project = removeEffect(demoState.project, targetTrackId, effect.id);
        destroyEffectRuntime(effect.id);
        persistCurrentSessionDocument(elements);
        syncFxPanelList(elements);
        render(elements);
        throw compileError;
      }
      // Record the add op only after successful compilation, with the
      // post-compile FxEffect (parameters captured) so redo restores a
      // usable state.
      const trackAfter = demoState.project.timeline.tracks.find((t) => t.id === targetTrackId);
      const chainAfter = trackAfter ? demoState.project.chains.get(trackAfter.chainId) : undefined;
      const compiledEffect = chainAfter?.effects.find((e) => e.id === effect.id) ?? effect;
      const index = chainAfter?.effects.findIndex((e) => e.id === effect.id) ?? 0;
      recordChainOp(
        { chainId: trackAfter?.chainId ?? targetTrackId },
        { kind: "add", effect: compiledEffect, index },
      );
      demoState.footer.setStatus(`Effect "${effectName}" ready on ${targetTrackId}`);
      if (demoState.activeFxTrackId === targetTrackId) {
        syncFxPanelList(elements);
      }
    } catch (error) {
      const message = normalizeErrorMessage(error);
      demoState.footer.setStatus(message, "error");
      pushRenderLog(`ERROR: ${message}`);
      render(elements);
    }
  });
}
