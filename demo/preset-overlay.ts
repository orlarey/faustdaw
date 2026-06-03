/****************************** preset-overlay.ts *****************************
 *
 * Purpose: Niveau-1 calque that draws the preset library of a single effect
 *          instance on top of its orbit-ui and lets the user (a) select and
 *          re-listen to a preset by stepping with the arrow keys,
 *          (b) interpolate between presets continuously by dragging the
 *          centre cross via Shepard, and (c) delete the currently selected
 *          preset through a panel-side trash button.
 * How: Owns a `<canvas>` positioned absolutely on the orbit-ui body. Draws
 *      the presets as black & white points whose luminosity is keyed on
 *      `lastSeenAt`, the manipulable centre cross, and an ambre selection
 *      ring around the cursored preset. Pointer events drive the Shepard
 *      gesture (begin / apply / end on the caller-supplied handler).
 *      Keyboard ←/→ cycles through the preset library in `lastSeenAt`
 *      ascending order ; the selected preset's configuration is written
 *      directly to the audio so the user can A/B individual presets. The
 *      PCA projection and visual bounds are frozen on the first refresh of
 *      a visibility cycle so promotions do not reshuffle the map. An
 *      `OverlayStateListener` callback exposes the current selection so the
 *      panel can update its `K/N` badge and the trash button's enablement.
 *
 ******************************************************************************/
import {
  deletePreset,
  listPresetsByUIHash,
  setPresetName,
  type PresetRecord,
} from "./preset-storage.js";
import {
  computeProjection,
  projectConfig,
  shepardInterpolate,
  type ParamSpec,
  type Projection,
} from "./preset-projection.js";
import { presetTrackingSystem, type PromotionListener } from "./preset-tracking.js";
import { promotePreset } from "./preset-promotion.js";
import { TransitionTimer, lerpCenter } from "./preset-transition.js";
import {
  getLibraryUndoScope,
  loadPresetName,
} from "./preset-library-undo.js";

const DISK_RADIUS_PX = 8;
const RING_RADIUS_PX = 11;
const POINT_HIT_RADIUS_PX = 13;
const PORTAMENTO_DURATION_MS = 400;
const CENTER_RADIUS_PX = 8;
const CENTER_HIT_RADIUS_PX = 14;
const SELECTION_RADIUS_PX = 15;
const MARGIN_PX = 18;
/**
 * Slider range bounds & resolution for the portamento (Tp) and loop (TL)
 * sliders. The DOM input runs on the integer range [0, SLIDER_RES] and maps
 * to milliseconds via a log curve `t = min · (max/min)^(s / SLIDER_RES)` so
 * fine-resolution sits where the ear cares about it (the low-time end) and
 * the long-tail end stays accessible without devouring the slider's middle.
 */
const PORTAMENTO_MIN_MS = 20;
const PORTAMENTO_MAX_MS = 3000;
/**
 * Loop tempo bounds, expressed in BPM. The cycle duration is one bar at
 * 4/4, i.e. `cycleMs = 60_000 · LOOP_BAR_BEATS / BPM`. With 30–240 BPM
 * this covers cycles between 8 s and 1 s — the musically idiomatic range
 * for sound-design preset cycling.
 */
const LOOP_MIN_BPM = 30;
const LOOP_MAX_BPM = 240;
const LOOP_BAR_BEATS = 4;
const SLIDER_RES = 1000;

/**
 * Purpose: Contract between the overlay and its panel-specific gesture
 *          bridge. Implemented by the panel (one bridge per effect
 *          instance) to plumb begin / apply / end into the host's audio
 *          graph, domain model, and autosave history.
 * How: `begin` is invoked once at `pointerdown` (capture session baseline,
 *      pause promotion). `apply` is invoked with a total configuration to
 *      write into the audio node, the domain model and the orbit-ui's
 *      visual state. `end` is invoked at `pointerup` (commit session
 *      history, resume promotion, record commit). `getCurrentConfig`
 *      reads the current audible configuration of the effect from the
 *      domain model so the calque can place its centre on the user's
 *      actual state at toggle-on (no audio discontinuity).
 */
export interface OverlayGestureHandler {
  begin(): void;
  apply(configuration: Readonly<Record<string, number>>): void;
  end(): void;
  getCurrentConfig(): Record<string, number>;
}

/**
 * Purpose: Snapshot the overlay's selection state to its host panel so the
 *          panel can update affordances driven by it (badge, trash).
 * How: `count` is the total number of presets in the library for this
 *      effect's uiHash. `selectedCount` is the size of the selection
 *      set (0 when the calque is closed or no preset is selected).
 *      `visible` says whether the calque is currently shown.
 */
export type OverlayState = {
  readonly count: number;
  readonly selectedCount: number;
  readonly visible: boolean;
};

export type OverlayStateListener = (state: OverlayState) => void;

export class PresetOverlay {
  readonly #outerContainer: HTMLElement;
  readonly #anchor: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #uiHash: string;
  readonly #effectInstanceId: string;
  readonly #paramSpecs: ReadonlyArray<ParamSpec>;
  readonly #handler: OverlayGestureHandler;
  readonly #onStateChange: OverlayStateListener;
  readonly #onPromotion: PromotionListener;
  readonly #onPointerDown: (e: PointerEvent) => void;
  readonly #onPointerMove: (e: PointerEvent) => void;
  readonly #onPointerUp: (e: PointerEvent) => void;
  readonly #onPointerLeave: () => void;
  readonly #onKeyDown: (e: KeyboardEvent) => void;
  readonly #onHeaderClick: (e: Event) => void;
  readonly #onHeaderChange: (e: Event) => void;
  readonly #orbitWrap: HTMLElement | null;
  #visible: boolean = false;
  /** Presets in their projection-frozen draw order (insertion order from IDB). */
  #presets: ReadonlyArray<PresetRecord> = [];
  /** Same presets sorted by lastSeenAt ascending — the centre-step order. */
  #orderedPresets: ReadonlyArray<PresetRecord> = [];
  /** Selection of presets marked for batch operations (deletion). Multi. */
  #selectedConfigHashes: Set<string> = new Set();
  #projection: Projection | null = null;
  #bounds: Bounds | null = null;
  #centerProjection: readonly [number, number] | null = null;
  /**
   * configHash of the preset the cursor is intentionally pinned on (set
   * by click, arrow nav, recall, loop step). Cleared on free drag. Used
   * by `#findIndexUnderCentre` to identify the active preset robustly,
   * even after refresh shuffles cluster-spread positions (a re-promotion
   * bumps lastSeenAt → cluster member ordering changes → visual angles
   * change → position-based lookup would match a neighbour).
   */
  #activePresetHash: string | null = null;
  /**
   * Pointer drag state: `centre` for the Shepard centre drag, `rect` for the
   * shift+drag selection rectangle, `none` when no drag is active.
   */
  #dragMode: "none" | "centre" | "rect" = "none";
  /** Shift+drag selection rectangle in canvas (CSS) pixel coordinates. */
  #selectionRect: { startX: number; startY: number; endX: number; endY: number } | null = null;
  /**
   * configHash of the preset currently under the pointer (no drag in
   * progress). Drives the hover-tooltip label rendered under the disc.
   * Null when the pointer is over empty canvas, the cross, or has left.
   */
  #hoveredPresetHash: string | null = null;
  /** Projection-space point currently anchored at the canvas centre. */
  #viewportCenterProj: readonly [number, number] | null = null;
  /** Zoom factor applied on top of the bounds-fit base scale. */
  #zoom: number = 1;
  /** Portamento timing for cursor-nav glides (PRESETSPEC.md §"Transitions dynamiques"). */
  readonly #transitionTimer: TransitionTimer = new TransitionTimer();
  #transitionStartCenter: readonly [number, number] | null = null;
  #transitionTargetCenter: readonly [number, number] | null = null;
  #transitionRafId: number | null = null;
  /** Inline name editor — appended next to the canvas, shown only while editing. */
  readonly #nameInput: HTMLInputElement;
  /** configHash of the preset whose name is currently being edited (or null). */
  #nameEditingHash: string | null = null;
  /** Right-click context menu — appended to the container, shown on demand. */
  readonly #contextMenu: HTMLDivElement;
  #contextMenuOpen: boolean = false;
  readonly #onDocumentPointerDown: (e: PointerEvent) => void;
  /**
   * Session-local 2D position overrides for presets created via "Add preset".
   * The new preset's configuration is what the audio plays at the cross
   * (Shepard interpolation), but its **canvas position** is set to where the
   * cross was when the user clicked. This makes the new disc appear exactly
   * under the cross — and Shepard's `d = 0` snap then guarantees continuous
   * audio when the cross sits on it. The map is cleared whenever the
   * projection is recomputed (its keys are projection-coords in the current
   * frozen basis ; a new basis would make them meaningless) or when the
   * calque is closed.
   */
  readonly #anchorOverrides: Map<string, readonly [number, number]> = new Map();
  /** Bottom bar that shows the portamento + loop controls while the calque is open. */
  readonly #portamentoBar: HTMLDivElement;
  readonly #portamentoSlider: HTMLInputElement;
  readonly #portamentoValueLabel: HTMLSpanElement;
  readonly #loopButton: HTMLButtonElement;
  readonly #loopSlider: HTMLInputElement;
  readonly #loopValueLabel: HTMLSpanElement;
  #portamentoMs: number = PORTAMENTO_DURATION_MS;
  /**
   * Full cycle duration in milliseconds (one bar at 4/4 in the BPM model
   * exposed by the slider). The per-step duration applied each loop tick
   * is `loopMs / m` where m is the current selection size — selection
   * edits during the loop change the density, not the tempo.
   */
  #loopMs: number = 2000;
  #loopActive: boolean = false;
  /** Index in the snapshotted selection list during the current loop step. */
  #loopIndex: number = 0;
  /** Timestamp at which the current step's hold phase began (null while gliding). */
  #loopHoldStartedAt: number | null = null;

  constructor(
    container: HTMLElement,
    uiHash: string,
    effectInstanceId: string,
    paramSpecs: ReadonlyArray<ParamSpec>,
    handler: OverlayGestureHandler,
    onStateChange: OverlayStateListener = () => {},
  ) {
    this.#outerContainer = container;
    this.#anchor = container.querySelector<HTMLElement>(".orbit-body") ?? container;
    this.#uiHash = uiHash;
    this.#effectInstanceId = effectInstanceId;
    this.#paramSpecs = paramSpecs;
    this.#handler = handler;
    this.#onStateChange = onStateChange;
    this.#canvas = document.createElement("canvas");
    this.#canvas.className = "fx-panel-effect-overlay";
    this.#canvas.style.display = "none";
    this.#canvas.tabIndex = 0;
    this.#anchor.appendChild(this.#canvas);
    const ctx = this.#canvas.getContext("2d");
    if (!ctx) throw new Error("[preset-overlay] failed to acquire 2D canvas context");
    this.#ctx = ctx;

    this.#onPromotion = (promotedUIHash) => {
      if (promotedUIHash !== this.#uiHash) return;
      if (!this.#visible) return;
      void this.refresh();
    };
    presetTrackingSystem.addPromotionListener(this.#onPromotion);

    this.#onPointerDown = (e) => this.#handlePointerDown(e);
    this.#onPointerMove = (e) => this.#handlePointerMove(e);
    this.#onPointerUp = (e) => this.#handlePointerUp(e);
    this.#onPointerLeave = () => this.#handlePointerLeave();
    this.#onKeyDown = (e) => this.#handleKeyDown(e);
    this.#canvas.addEventListener("pointerdown", this.#onPointerDown);
    this.#canvas.addEventListener("pointermove", this.#onPointerMove);
    this.#canvas.addEventListener("pointerup", this.#onPointerUp);
    this.#canvas.addEventListener("pointercancel", this.#onPointerUp);
    this.#canvas.addEventListener("pointerleave", this.#onPointerLeave);
    this.#canvas.addEventListener("keydown", this.#onKeyDown);

    // Capture-phase listeners on the orbit-ui root so we pre-empt orbit-ui's
    // own click / change handlers on the header buttons whenever the calque
    // is active. When the calque is hidden, the early `!this.#visible` check
    // lets the events propagate normally to orbit-ui's level-0 handlers.
    this.#orbitWrap = container.querySelector<HTMLElement>(".orbit-wrap");
    this.#onHeaderClick = (e) => this.#interceptHeaderClick(e);
    this.#onHeaderChange = (e) => this.#interceptHeaderChange(e);
    if (this.#orbitWrap) {
      this.#orbitWrap.addEventListener("click", this.#onHeaderClick, { capture: true });
      this.#orbitWrap.addEventListener("change", this.#onHeaderChange, { capture: true });
    }

    // Portamento bottom bar — overlays the (grayed-out) orbit-ui detail
    // bar while the calque is open and exposes a slider to tune Tp.
    this.#portamentoBar = document.createElement("div");
    this.#portamentoBar.className = "fx-panel-effect-portamento";
    this.#portamentoBar.style.display = "none";
    const titleLabel = document.createElement("span");
    titleLabel.className = "fx-panel-effect-portamento-label fx-panel-effect-portamento-icon";
    titleLabel.textContent = "⤳";
    titleLabel.title = "Portamento";
    this.#portamentoBar.appendChild(titleLabel);
    this.#portamentoSlider = document.createElement("input");
    this.#portamentoSlider.type = "range";
    this.#portamentoSlider.min = "0";
    this.#portamentoSlider.max = String(SLIDER_RES);
    this.#portamentoSlider.step = "1";
    this.#portamentoSlider.value = String(
      valueToLogSlider(this.#portamentoMs, PORTAMENTO_MIN_MS, PORTAMENTO_MAX_MS),
    );
    this.#portamentoBar.appendChild(this.#portamentoSlider);
    this.#portamentoValueLabel = document.createElement("span");
    this.#portamentoValueLabel.className = "fx-panel-effect-portamento-value";
    this.#portamentoValueLabel.textContent = formatMs(this.#portamentoMs);
    this.#portamentoBar.appendChild(this.#portamentoValueLabel);
    this.#portamentoSlider.addEventListener("input", () => {
      const s = Number(this.#portamentoSlider.value);
      if (!Number.isFinite(s)) return;
      const next = logSliderToValue(s, PORTAMENTO_MIN_MS, PORTAMENTO_MAX_MS);
      this.#portamentoMs = next;
      this.#portamentoValueLabel.textContent = formatMs(next);
    });

    // Loop controls — button + TL slider, sharing the same bottom bar.
    this.#loopButton = document.createElement("button");
    this.#loopButton.type = "button";
    this.#loopButton.className = "fx-panel-effect-portamento-loop";
    this.#loopButton.textContent = "▶";
    this.#loopButton.title = "Loop the selection";
    this.#loopButton.disabled = true;
    this.#loopButton.addEventListener("click", () => {
      if (this.#loopActive) this.#stopLoop();
      else this.#startLoop();
    });
    this.#portamentoBar.appendChild(this.#loopButton);
    const loopLabel = document.createElement("span");
    loopLabel.className = "fx-panel-effect-portamento-label fx-panel-effect-portamento-icon";
    loopLabel.textContent = "↻";
    loopLabel.title = "Loop tempo (1 cycle = 1 bar at 4/4)";
    this.#portamentoBar.appendChild(loopLabel);
    this.#loopSlider = document.createElement("input");
    this.#loopSlider.type = "range";
    this.#loopSlider.min = "0";
    this.#loopSlider.max = String(SLIDER_RES);
    this.#loopSlider.step = "1";
    this.#loopSlider.value = String(
      valueToLogSlider(cycleMsToBpm(this.#loopMs), LOOP_MIN_BPM, LOOP_MAX_BPM),
    );
    this.#portamentoBar.appendChild(this.#loopSlider);
    this.#loopValueLabel = document.createElement("span");
    this.#loopValueLabel.className = "fx-panel-effect-portamento-value";
    this.#loopValueLabel.textContent = `${cycleMsToBpm(this.#loopMs)} BPM`;
    this.#portamentoBar.appendChild(this.#loopValueLabel);
    this.#loopSlider.addEventListener("input", () => {
      const s = Number(this.#loopSlider.value);
      if (!Number.isFinite(s)) return;
      const bpm = logSliderToValue(s, LOOP_MIN_BPM, LOOP_MAX_BPM);
      this.#loopMs = bpmToCycleMs(bpm);
      this.#loopValueLabel.textContent = `${bpm} BPM`;
    });

    container.appendChild(this.#portamentoBar);

    // Inline name editor — hidden by default, surfaced over the calque on
    // double-click. Enter / blur saves, Escape cancels, an empty value
    // strips any existing name.
    this.#nameInput = document.createElement("input");
    this.#nameInput.type = "text";
    this.#nameInput.className = "fx-panel-effect-name-edit";
    this.#nameInput.maxLength = 40;
    this.#nameInput.style.display = "none";
    this.#nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.#commitNameEdit(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.#commitNameEdit(false);
      }
      e.stopPropagation();
    });
    this.#nameInput.addEventListener("blur", () => {
      if (this.#nameEditingHash !== null) this.#commitNameEdit(true);
    });
    container.appendChild(this.#nameInput);

    this.#canvas.addEventListener("dblclick", (e) => this.#handleDoubleClick(e));

    // Right-click context menu — small popover anchored over the calque,
    // hidden by default. Surfaces "Add preset" on the centre cross and
    // "Rename…" / "Delete" on a preset disc. Empty space yields no menu.
    this.#contextMenu = document.createElement("div");
    this.#contextMenu.className = "fx-panel-effect-context-menu";
    this.#contextMenu.style.display = "none";
    container.appendChild(this.#contextMenu);
    this.#canvas.addEventListener("contextmenu", (e) => this.#handleContextMenu(e));
    this.#onDocumentPointerDown = (e) => {
      if (!this.#contextMenuOpen) return;
      if (this.#contextMenu.contains(e.target as Node)) return;
      this.#hideContextMenu();
    };
    document.addEventListener("pointerdown", this.#onDocumentPointerDown, { capture: true });
  }

  /**
   * Purpose: Show or hide the calque.
   * How: Toggles the canvas display. When shown, refreshes (fetches presets,
   *      computes projection on first refresh, picks the most-recent preset
   *      as the initial selection so the centre cross sits exactly on it
   *      and the audio plays its configuration). When hidden, drops the
   *      cached projection so the next show recomputes it (a natural
   *      refresh-the-map affordance).
   */
  setVisible(visible: boolean): void {
    if (this.#visible === visible) return;
    this.#visible = visible;
    this.#canvas.style.display = visible ? "block" : "none";
    this.#outerContainer.dataset.overlayActive = visible ? "true" : "false";
    presetTrackingSystem.setOverlayActive(this.#effectInstanceId, visible);
    this.#portamentoBar.style.display = visible ? "" : "none";
    if (visible) {
      void this.refresh();
      this.#canvas.focus();
    } else {
      this.#cancelTransition();
      this.#hideContextMenu();
      this.#projection = null;
      this.#bounds = null;
      this.#centerProjection = null;
      this.#viewportCenterProj = null;
      this.#zoom = 1;
      this.#dragMode = "none";
      this.#selectionRect = null;
      this.#selectedConfigHashes.clear();
      this.#anchorOverrides.clear();
      this.#activePresetHash = null;
      this.#emitState();
    }
  }

  get visible(): boolean {
    return this.#visible;
  }

  /**
   * Purpose: Reload the preset library and redraw.
   * How: Fetch presets, build the lastSeenAt-ascending centre-step order.
   *      On the first refresh of a visibility cycle, also compute the PCA
   *      projection, freeze the bounds, and place the centre cross on the
   *      projection of the current audible configuration so toggling the
   *      calque introduces no audio discontinuity. On subsequent refreshes
   *      (e.g. after a promotion or deletion), reuse the frozen projection
   *      and prune any stale selections.
   */
  async refresh(): Promise<void> {
    try {
      this.#presets = await listPresetsByUIHash(this.#uiHash);
      this.#orderedPresets = [...this.#presets].sort((a, b) => a.lastSeenAt - b.lastSeenAt);

      // Allow projection to evolve while degenerate (kind ≠ full) so the
      // user can build a library from scratch — first shift+click goes from
      // empty → single, second from single → oneD, third from oneD → full.
      // Once full, freeze so subsequent promotions / deletions do not
      // reshuffle the map.
      const needsRecompute = this.#projection === null || this.#projection.kind !== "full";
      if (needsRecompute) {
        // The basis is about to change — anchors recorded in the previous
        // basis are coordinates in a defunct frame, so we drop them.
        this.#anchorOverrides.clear();
        this.#projection = computeProjection(this.#presets, this.#paramSpecs);
        const presetXys = this.#presets.map((p) =>
          projectConfig(p.configuration, this.#projection!),
        );
        this.#bounds = computeBounds(presetXys);
        const currentConfig = this.#handler.getCurrentConfig();
        this.#centerProjection = projectConfig(currentConfig, this.#projection);
        // Initial viewport: bounds centroid (= the same fit-to-extent layout
        // we had before viewport panning was introduced). Zoom resets to 1.
        this.#viewportCenterProj = [
          (this.#bounds.xMin + this.#bounds.xMax) / 2,
          (this.#bounds.yMin + this.#bounds.yMax) / 2,
        ];
        this.#zoom = 1;
      } else {
        // Prune selections AND anchor overrides whose preset no longer
        // exists (deletion path).
        const valid = new Set(this.#orderedPresets.map((p) => p.configHash));
        for (const h of this.#selectedConfigHashes) {
          if (!valid.has(h)) this.#selectedConfigHashes.delete(h);
        }
        for (const h of this.#anchorOverrides.keys()) {
          if (!valid.has(h)) this.#anchorOverrides.delete(h);
        }
      }

      // If the cross was pinned on a specific preset, snap it to that
      // preset's CURRENT visual position — cluster-spread ordering may
      // have changed (a re-promotion bumps lastSeenAt, which shuffles
      // member angles within a cluster), and we want the cross to stay
      // glued to the same preset across refreshes.
      if (this.#activePresetHash) {
        const active = this.#orderedPresets.find(
          (p) => p.configHash === this.#activePresetHash,
        );
        if (active) {
          const xy = this.#presetVisualProjection(active);
          this.#centerProjection = [xy[0], xy[1]];
        } else {
          // Active preset was deleted ; drop the binding.
          this.#activePresetHash = null;
        }
      }

      this.#draw();
      this.#emitState();
    } catch (error) {
      console.warn("[webdaw] preset overlay refresh failed", error);
    }
  }

  /**
   * Purpose: Delete every preset currently in the selection.
   * How: Iterate the selection set (snapshotted before deletion), call the
   *      storage gateway for each, then clear the selection, notify other
   *      badges of the same uiHash so their counts refresh, and refresh
   *      self. Audio is not touched : the centre stays where it was, ψ
   *      simply recomputes against the surviving presets.
   */
  async deleteSelected(): Promise<void> {
    if (!this.#visible) return;
    if (this.#selectedConfigHashes.size === 0) return;
    // Confirmation prompt when the selection contains user-named presets:
    // their loss is harder to recover from than auto-promoted ones, so we
    // mirror the single-delete path's confirm. No prompt when the
    // selection is purely auto-promoted entries (one-click batch is the
    // intended flow there).
    const named = this.#presets.filter(
      (p) =>
        this.#selectedConfigHashes.has(p.configHash)
        && p.name !== undefined
        && p.name.length > 0,
    );
    if (named.length > 0) {
      const total = this.#selectedConfigHashes.size;
      const message = named.length === 1 && total === 1
        ? `Delete preset “${named[0]!.name}”?`
        : named.length === total
          ? `Delete ${total} named presets?`
          : `Delete ${total} presets, including ${named.length} named?`;
      if (!window.confirm(message)) return;
    }
    const hashes = Array.from(this.#selectedConfigHashes);
    // Snapshot the records BEFORE deletion so the undo path can restore
    // them in full (config, timestamps, name).
    const deletedRecords: PresetRecord[] = [];
    for (const configHash of hashes) {
      const record = this.#presets.find((p) => p.configHash === configHash);
      if (record) deletedRecords.push(record);
      try {
        await deletePreset(this.#uiHash, configHash);
      } catch (error) {
        console.warn("[webdaw] preset deletion failed", error);
      }
    }
    if (deletedRecords.length > 0) {
      getLibraryUndoScope(this.#uiHash).record({
        kind: "deleteBatch",
        records: deletedRecords,
      });
    }
    this.#selectedConfigHashes.clear();
    presetTrackingSystem.notifyLibraryChange(this.#uiHash);
    await this.refresh();
  }

  /**
   * Purpose: Apply a preset's configuration to the audio + domain model
   *          using the same gesture plumbing as a niveau-1 click — so the
   *          niveau-0 recall menu can reuse this entry point without
   *          duplicating the begin/apply/end dance or the autosave wiring.
   * How: Wrap apply in begin / end so the change is committed as a single
   *      gesture (autosave, dwell tracker reset). Idempotent : the caller
   *      is free to invoke this without first opening the calque.
   */
  recall(
    configuration: Readonly<Record<string, number>>,
    configHash?: string,
  ): void {
    this.#handler.begin();
    try {
      // When the caller passed the preset's configHash, mirror the
      // direct-click `onPreset` branch in `#handlePointerDown` so a
      // menu-driven recall is observably identical to clicking the disc:
      // selection is replaced, activePresetHash is bound, the cross
      // snaps to the visual position. Visual updates are gated on
      // visibility ; the activePresetHash is bound regardless so the
      // cross still lands on the right disc when the calque is opened
      // later (refresh's snap-to-active handles that path).
      if (configHash) {
        this.#activePresetHash = configHash;
        if (this.#visible && this.#projection) {
          const preset = this.#presets.find((p) => p.configHash === configHash);
          if (preset) {
            this.#selectedConfigHashes.clear();
            this.#selectedConfigHashes.add(configHash);
            const xy = this.#presetVisualProjection(preset);
            this.#centerProjection = [xy[0], xy[1]];
          }
        }
      }
      this.#handler.apply(configuration);
    } finally {
      this.#handler.end();
    }
    if (this.#visible) {
      this.#draw();
      this.#emitState();
    }
  }

  /**
   * Purpose: Return the configuration the audio is currently playing for
   *          this effect — used by the niveau-0 recall menu to mark the
   *          active preset (if any) with a check mark.
   * How: Delegate to the gesture handler's `getCurrentConfig`, which reads
   *      from the live domain model rather than the audio node (the latter
   *      doesn't reflect `setValueAtTime` changes synchronously).
   */
  getCurrentConfig(): Record<string, number> {
    return this.#handler.getCurrentConfig();
  }

  /**
   * Purpose: Detach the overlay from the DOM and unregister listeners.
   * How: Symmetric to the constructor.
   */
  destroy(): void {
    this.#cancelTransition();
    presetTrackingSystem.removePromotionListener(this.#onPromotion);
    presetTrackingSystem.setOverlayActive(this.#effectInstanceId, false);
    this.#canvas.removeEventListener("pointerdown", this.#onPointerDown);
    this.#canvas.removeEventListener("pointermove", this.#onPointerMove);
    this.#canvas.removeEventListener("pointerup", this.#onPointerUp);
    this.#canvas.removeEventListener("pointercancel", this.#onPointerUp);
    this.#canvas.removeEventListener("pointerleave", this.#onPointerLeave);
    this.#canvas.removeEventListener("keydown", this.#onKeyDown);
    if (this.#orbitWrap) {
      this.#orbitWrap.removeEventListener("click", this.#onHeaderClick, { capture: true });
      this.#orbitWrap.removeEventListener("change", this.#onHeaderChange, { capture: true });
    }
    document.removeEventListener("pointerdown", this.#onDocumentPointerDown, { capture: true });
    this.#contextMenu.remove();
    this.#portamentoBar.remove();
    this.#canvas.remove();
  }

  // -------------------------------------------------------------------------
  // Pointer interaction
  // -------------------------------------------------------------------------

  /**
   * Purpose: Standard-feel selection model coupled to the Shepard centre.
   * How:
   *   - **Click on preset** : replace the selection with `{this preset}`
   *     and snap the centre to the preset's true PCA projection (so ψ
   *     yields the exact configuration via d = 0 snap, regardless of the
   *     visual cluster-spread offset). The user can then drag from there.
   *   - **Click on empty space** : clear the selection and drag the
   *     centre to follow the pointer (existing Shepard drag behaviour).
   *   - **Shift+click on preset** : toggle membership in the selection
   *     set, do not move the centre — pure selection-management gesture.
   *   - **Shift+drag on empty space** : selection rectangle (additive).
   *   - Save / name is handled by double-click (`#handleDoubleClick`).
   */
  #handlePointerDown(e: PointerEvent): void {
    if (!this.#visible || !this.#projection) return;
    if (e.button !== 0) return;
    if (this.#contextMenuOpen) this.#hideContextMenu();
    const px = e.offsetX;
    const py = e.offsetY;
    const onPreset = this.#projection.kind !== "empty"
      ? this.#hitTestPreset(px, py)
      : null;

    if (e.shiftKey) {
      if (onPreset) {
        this.#toggleSelection(onPreset.configHash);
        return;
      }
      // Shift on empty space → start a selection rectangle.
      this.#canvas.setPointerCapture(e.pointerId);
      this.#dragMode = "rect";
      this.#selectionRect = { startX: px, startY: py, endX: px, endY: py };
      this.#draw();
      return;
    }

    if (this.#projection.kind === "empty") return;

    // Plain pointer-down : a click pre-empts any in-flight portamento and
    // becomes a centre drag. The selection is replaced atomically with
    // either {this preset} or {} depending on what was hit.
    this.#cancelTransition();
    this.#canvas.setPointerCapture(e.pointerId);
    this.#dragMode = "centre";
    this.#handler.begin();

    if (onPreset) {
      // Replace selection.
      this.#selectedConfigHashes.clear();
      this.#selectedConfigHashes.add(onPreset.configHash);
      this.#activePresetHash = onPreset.configHash;
      // Snap the centre to the preset's VISUAL position (cluster-spread
      // included). Shepard math uses the same visual positions, so the
      // cross sits on the disc AND `d = 0` snap holds → audio matches
      // the preset exactly. Without this, clusters would put the cross
      // on the cluster centroid, not on the disc the user clicked.
      const xy = this.#presetVisualProjection(onPreset);
      this.#centerProjection = [xy[0], xy[1]];
      const config: Record<string, number> = {};
      for (const spec of this.#paramSpecs) {
        config[spec.address] = onPreset.configuration[spec.address] ?? spec.default;
      }
      this.#handler.apply(config);
      this.#draw();
      this.#emitState();
    } else {
      // Clear selection, then start the regular Shepard centre drag at
      // the click pixel.
      this.#selectedConfigHashes.clear();
      this.#activePresetHash = null;
      this.#updateCenterFromPointer(e);
      this.#emitState();
    }
  }

  #handlePointerMove(e: PointerEvent): void {
    if (this.#dragMode === "centre") {
      this.#updateCenterFromPointer(e);
      return;
    }
    if (this.#dragMode === "rect" && this.#selectionRect) {
      this.#selectionRect = {
        ...this.#selectionRect,
        endX: e.offsetX,
        endY: e.offsetY,
      };
      this.#draw();
      return;
    }
    // Hover tracking — surface the preset name as a tooltip when the
    // cross isn't necessarily on the disc. Cheap : only redraws when
    // the hovered hash changes.
    if (!this.#projection || this.#projection.kind === "empty") return;
    const preset = this.#hitTestPreset(e.offsetX, e.offsetY);
    const nextHash = preset?.configHash ?? null;
    if (nextHash !== this.#hoveredPresetHash) {
      this.#hoveredPresetHash = nextHash;
      this.#draw();
    }
  }

  #handlePointerLeave(): void {
    if (this.#hoveredPresetHash !== null) {
      this.#hoveredPresetHash = null;
      this.#draw();
    }
  }

  #handlePointerUp(e: PointerEvent): void {
    if (this.#dragMode === "none") return;
    const mode = this.#dragMode;
    this.#dragMode = "none";
    try {
      this.#canvas.releasePointerCapture(e.pointerId);
    } catch {
      // pointer was not captured — ignore
    }
    if (mode === "centre") {
      this.#handler.end();
      return;
    }
    if (mode === "rect" && this.#selectionRect) {
      this.#commitSelectionRect(this.#selectionRect);
      this.#selectionRect = null;
      this.#draw();
      this.#emitState();
    }
  }

  /**
   * Purpose: Add every preset whose centre falls inside the rectangle to
   *          the selection set (additive — never deselects, so the user
   *          can refine afterwards with individual shift+click toggles).
   * How: Normalise the rectangle, hit-test each preset against the
   *      bounds in canvas-pixel space using the current placement.
   */
  #commitSelectionRect(rect: { startX: number; startY: number; endX: number; endY: number }): void {
    if (!this.#projection || this.#projection.kind === "empty") return;
    const left = Math.min(rect.startX, rect.endX);
    const right = Math.max(rect.startX, rect.endX);
    const top = Math.min(rect.startY, rect.endY);
    const bottom = Math.max(rect.startY, rect.endY);
    if (right - left < 2 && bottom - top < 2) return;
    const canvasRect = this.#canvas.getBoundingClientRect();
    const placement = this.#buildCurrentPlacement(canvasRect.width, canvasRect.height);
    if (!placement) return;
    const visualPositions = this.#computeVisualPositions(placement);
    for (const preset of this.#presets) {
      const pos = visualPositions.get(preset.configHash);
      if (!pos) continue;
      const [cx, cy] = pos;
      if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
        this.#selectedConfigHashes.add(preset.configHash);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Keyboard navigation (centre stepping across presets)
  // -------------------------------------------------------------------------

  /**
   * Purpose: Move the centre cross from preset to preset with ←/→ in the
   *          lastSeenAt-ascending order, snapping ψ to the preset reached.
   *          Selection is untouched — the centre and the selection are two
   *          independent concerns now.
   * How: Find the preset closest to the current centre (or pick the most
   *      recent if the centre is far from any preset), step ±1 in the
   *      ordered list, slide the centre onto the new preset, write its
   *      configuration directly to the audio via `apply`. All four arrows
   *      are still swallowed at this layer so niveau 0 stays inert.
   */
  #handleKeyDown(e: KeyboardEvent): void {
    if (!this.#visible) return;
    if (e.key === "Escape" && this.#contextMenuOpen) {
      e.preventDefault();
      e.stopPropagation();
      this.#hideContextMenu();
      return;
    }
    const isArrow = e.key === "ArrowLeft"
      || e.key === "ArrowRight"
      || e.key === "ArrowUp"
      || e.key === "ArrowDown";
    if (!isArrow) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (!this.#projection || this.#dragMode !== "none") return;
    if (this.#orderedPresets.length === 0) return;
    const currentIndex = this.#findIndexUnderCentre();
    const delta = e.key === "ArrowLeft" ? -1 : 1;
    const n = this.#orderedPresets.length;
    const nextIndex = currentIndex < 0
      ? (e.key === "ArrowLeft" ? n - 1 : 0)
      : (((currentIndex + delta) % n) + n) % n;
    const next = this.#orderedPresets[nextIndex];
    if (!next) return;
    this.#activePresetHash = next.configHash;
    const targetCenter = this.#presetVisualProjection(next);
    this.#startCenterPortamento(targetCenter);
  }

  /**
   * Purpose: Arm the centre portamento — set the start / target and start
   *          the timer. Used by both the user-facing
   *          `#startCenterPortamento` and the internal loop step (the
   *          latter must NOT also schedule a fresh rAF since it's already
   *          inside a tick).
   */
  #armTransition(targetCenter: readonly [number, number]): void {
    if (!this.#projection) return;
    const startCenter = this.#centerProjection ?? [0, 0];
    this.#transitionStartCenter = [startCenter[0], startCenter[1]];
    this.#transitionTargetCenter = [targetCenter[0], targetCenter[1]];
    this.#transitionTimer.start(this.#portamentoMs, performance.now());
  }

  /**
   * Purpose: Glide the manipulable centre cross from its current projection
   *          position to `targetCenter`, applying ψ to the audio at each
   *          animation frame.
   * How: Arm the timer then schedule the rAF loop (idempotent — re-arms
   *      atomically if a transition was already in progress, so rapid
   *      arrow presses chain without audio jumps).
   */
  #startCenterPortamento(targetCenter: readonly [number, number]): void {
    this.#armTransition(targetCenter);
    this.#startTransitionRaf();
  }

  /**
   * Purpose: Drive a portamento glide via requestAnimationFrame, independent
   *          of the transport loop so transitions still play out when the
   *          user is paused.
   * How: Reentrant : if the loop is already running, do nothing. Each tick
   *      advances the centre, applies ψ, and reschedules itself until the
   *      timer reports it's no longer active. The handle is null while a
   *      tick is executing to avoid double-cancel races.
   *
   * Known limitation: rAF (and setTimeout) is throttled to ~1 Hz by
   * browsers when the tab sits in the background, so loop mode degrades
   * to discrete preset-to-preset jumps without the in-between Shepard
   * glide. Detaching the tab into a standalone window restores the
   * nominal behaviour. See PRESETSPEC.md → Mode boucle → "Limitation
   * connue : étranglement du timer en onglet d'arrière-plan" for the
   * cause and the proper fix (audio-clock-driven scheduling).
   */
  #startTransitionRaf(): void {
    if (this.#transitionRafId !== null) return;
    const tick = (): void => {
      this.#transitionRafId = null;
      const stillActive = this.#advanceTransition(performance.now());
      if (stillActive) this.#transitionRafId = requestAnimationFrame(tick);
    };
    this.#transitionRafId = requestAnimationFrame(tick);
  }

  /**
   * Purpose: One animation step of the centre portamento, including the
   *          loop's hold phase between two preset glides.
   * How: While the timer is active (α < 1), lerp the centre, apply ψ, and
   *      keep ticking. Once α reaches 1 the glide is done :
   *        - if loop is off → return false to stop the rAF.
   *        - if loop is on → record `loopHoldStartedAt`, then on each
   *          subsequent tick check whether the hold (TL − Tp) has elapsed
   *          and advance to the next preset of the selection.
   *      Returns true while there is more work to do (in-glide or
   *      loop-hold) so the caller reschedules the next rAF.
   */
  #advanceTransition(now: number): boolean {
    if (
      !this.#projection
      || !this.#transitionStartCenter
      || !this.#transitionTargetCenter
    ) {
      return this.#loopActive ? this.#tickLoopHold(now) : false;
    }
    const alpha = this.#transitionTimer.alpha(now);
    if (alpha === null) return this.#loopActive ? this.#tickLoopHold(now) : false;
    this.#centerProjection = lerpCenter(
      this.#transitionStartCenter,
      this.#transitionTargetCenter,
      alpha,
    );
    const rect = this.#canvas.getBoundingClientRect();
    const placement = this.#buildCurrentPlacement(rect.width, rect.height);
    if (placement) {
      const config = this.#computeShepardConfig(placement);
      this.#handler.apply(config);
    }
    this.#draw();
    if (alpha < 1) return true;
    return this.#loopActive ? this.#tickLoopHold(now) : false;
  }

  /**
   * Purpose: Drive the loop's hold phase between two glides and trigger
   *          the next step when (TL − Tp) ms have elapsed.
   * How: Returns true to keep the rAF ticking. Reads the selection set
   *      fresh at every step (édition à chaud — the selection can change
   *      while the loop runs). When the selection becomes empty, the
   *      loop stops itself.
   */
  #tickLoopHold(now: number): boolean {
    const hashes = Array.from(this.#selectedConfigHashes);
    if (hashes.length === 0) {
      this.#stopLoop();
      return false;
    }
    if (this.#loopHoldStartedAt === null) {
      this.#loopHoldStartedAt = now;
      return true;
    }
    // `#loopMs` is the full cycle duration ; the per-step duration is
    // `cycle / m` where m is the current selection size — adding or
    // removing presets during the loop changes the density, not the
    // tempo. The per-step is floor-clamped to Tp so a too-large
    // portamento doesn't underflow into a negative hold.
    const tp = Math.max(0, this.#portamentoMs);
    const perStep = Math.max(this.#loopMs / hashes.length, tp);
    const holdMs = Math.max(0, perStep - tp);
    if (now - this.#loopHoldStartedAt < holdMs) return true;
    // Hold elapsed — advance to the next preset of the (live) selection.
    this.#loopHoldStartedAt = null;
    this.#loopIndex = (this.#loopIndex + 1) % hashes.length;
    this.#armNextLoopStep();
    return true;
  }

  /**
   * Purpose: Glide to the preset at `#loopIndex` of the current selection.
   * How: Arm the transition (no rAF restart — we're inside a tick) so the
   *      outer loop reschedules naturally on its `stillActive` return.
   */
  #armNextLoopStep(): void {
    if (!this.#projection) return;
    const hashes = Array.from(this.#selectedConfigHashes);
    if (hashes.length === 0) {
      this.#stopLoop();
      return;
    }
    const targetHash = hashes[this.#loopIndex % hashes.length];
    if (!targetHash) return;
    const target = this.#presets.find((p) => p.configHash === targetHash);
    if (!target) {
      // Preset was deleted between two steps. Restart at index 0 next tick.
      this.#loopIndex = 0;
      return;
    }
    this.#activePresetHash = target.configHash;
    const targetCenter = this.#presetVisualProjection(target);
    this.#armTransition(targetCenter);
  }

  /**
   * Purpose: Start cycling through the current selection at TL intervals.
   * How: Reset the loop index, glide to the first selected preset, kick
   *      the rAF loop. Idempotent : if loop is already active, no-op.
   */
  #startLoop(): void {
    if (this.#loopActive) return;
    if (this.#selectedConfigHashes.size === 0) return;
    this.#loopActive = true;
    this.#loopHoldStartedAt = null;
    this.#loopIndex = 0;
    this.#loopButton.textContent = "■";
    this.#loopButton.title = "Stop loop";
    this.#armNextLoopStep();
    this.#startTransitionRaf();
  }

  /** Stop the loop. The currently-running glide finishes naturally. */
  #stopLoop(): void {
    if (!this.#loopActive) return;
    this.#loopActive = false;
    this.#loopHoldStartedAt = null;
    this.#loopButton.textContent = "▶";
    this.#loopButton.title = "Loop the selection";
  }

  /** Cancel any in-flight portamento — invoked from setVisible(false) and destroy(). */
  #cancelTransition(): void {
    this.#stopLoop();
    if (this.#transitionRafId !== null) {
      cancelAnimationFrame(this.#transitionRafId);
      this.#transitionRafId = null;
    }
    this.#transitionTimer.stop();
    this.#transitionStartCenter = null;
    this.#transitionTargetCenter = null;
  }

  /**
   * Purpose: Locate the preset whose projected position currently sits
   *          under the centre cross — used as the anchor for arrow stepping.
   * How: Iterate the ordered list, return the first preset whose projection
   *      coincides with the centre within a tight tolerance. Returns -1
   *      when the centre is between presets so callers fall back to a
   *      starting end of the list.
   */
  #findIndexUnderCentre(): number {
    if (!this.#projection || !this.#centerProjection) return -1;
    // Hash-based fast path : when the cross was placed on a specific
    // preset (click, recall, arrow, loop), trust that explicit binding
    // even if the cluster spread later moves the disc out from under
    // the cross's old position.
    if (this.#activePresetHash) {
      const idx = this.#orderedPresets.findIndex(
        (p) => p.configHash === this.#activePresetHash,
      );
      if (idx >= 0) return idx;
    }
    // Fallback for cases without an explicit binding (legacy or future).
    const tol = 1e-6;
    for (let i = 0; i < this.#orderedPresets.length; i++) {
      const preset = this.#orderedPresets[i]!;
      const xy = this.#presetVisualProjection(preset);
      if (
        Math.abs(xy[0] - this.#centerProjection[0]) < tol
        && Math.abs(xy[1] - this.#centerProjection[1]) < tol
      ) {
        return i;
      }
    }
    return -1;
  }

  // -------------------------------------------------------------------------
  // Selection / preset-save (shift+click)
  // -------------------------------------------------------------------------

  #toggleSelection(configHash: string): void {
    if (this.#selectedConfigHashes.has(configHash)) {
      this.#selectedConfigHashes.delete(configHash);
    } else {
      this.#selectedConfigHashes.add(configHash);
    }
    this.#draw();
    this.#emitState();
  }

  /**
   * Purpose: Save the current audible configuration as a new preset and add
   *          it to the selection so the user immediately sees the result.
   * How: Read the current config straight from the domain model via the
   *      handler — that's whatever the audio is playing right now (last
   *      drag, last arrow step, or initial state). Persist via the same
   *      `promotePreset` path used by the dwell mechanism, so content dedup
   *      is automatic (revisit just bumps lastSeenAt). Works even when the
   *      library was empty — that's how the user creates their first preset.
   */
  async #savePresetAtCentre(): Promise<PresetRecord | null> {
    const config = this.#handler.getCurrentConfig();
    if (Object.keys(config).length === 0) return null;
    // Snapshot the cross position BEFORE awaiting — refresh might recompute
    // the projection basis and invalidate the override.
    const projectionWasFull = this.#projection?.kind === "full";
    const anchor: readonly [number, number] | null =
      projectionWasFull && this.#centerProjection
        ? [this.#centerProjection[0], this.#centerProjection[1]]
        : null;
    let record: PresetRecord | null = null;
    try {
      record = await promotePreset(this.#uiHash, config);
      this.#selectedConfigHashes.add(record.configHash);
    } catch (error) {
      console.warn("[webdaw] preset save failed", error);
      return null;
    }
    // Record the op in the library undo scope only when this is a
    // genuinely new preset — re-promotions of an existing config just
    // bump lastSeenAt without creating an entry, so undoing them would
    // be confusing (nothing visible changed).
    if (record.firstSeenAt === record.lastSeenAt) {
      getLibraryUndoScope(this.#uiHash).record({ kind: "add", record });
    }
    // Set the anchor only when the projection was already full at save
    // time — refresh won't recompute it, so the anchor stays in a valid
    // basis. When the projection was still settling (single / oneD), the
    // about-to-run refresh will recompute the basis ; honouring the
    // anchor under the new basis would be wrong, so we let it fall back
    // to projectConfig.
    if (anchor && projectionWasFull) {
      this.#anchorOverrides.set(record.configHash, anchor);
    }
    presetTrackingSystem.notifyLibraryChange(this.#uiHash);
    await this.refresh();
    return record;
  }

  // -------------------------------------------------------------------------
  // Naming (double-click)
  // -------------------------------------------------------------------------

  /**
   * Purpose: Double-click on a preset disc opens its name editor inline —
   *          a quick alternative to the right-click "Rename…" menu item.
   * How: Hit-test the discs ; on a hit, open the inline editor. Empty
   *      space and the centre cross are now no-ops at this layer (preset
   *      creation lives behind the right-click context menu).
   */
  #handleDoubleClick(e: MouseEvent): void {
    if (!this.#visible || !this.#projection) return;
    if (this.#projection.kind === "empty") return;
    const preset = this.#hitTestPreset(e.offsetX, e.offsetY);
    if (preset) {
      e.preventDefault();
      this.#openNameEditor(preset.configHash);
    }
  }

  // -------------------------------------------------------------------------
  // Context menu (right-click)
  // -------------------------------------------------------------------------

  /**
   * Purpose: Open the right-click context menu with items appropriate to
   *          what was hit — "Add preset" on the centre cross, "Rename…" /
   *          "Delete" on a preset disc, nothing on empty space. Centralises
   *          the three preset operations (create / rename / delete) behind
   *          one platform-standard gesture so they no longer clash with
   *          select / drag / shift+select.
   * How: Hit-test preset first (the centre often sits on top of one when
   *      the user has just selected it), then the centre cross, otherwise
   *      bail without showing a menu. The native browser menu is always
   *      suppressed when the calque is visible so the user gets our menu
   *      instead of the page's "save image / inspect" menu.
   */
  #handleContextMenu(e: MouseEvent): void {
    if (!this.#visible) return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.#projection) return;
    const px = e.offsetX;
    const py = e.offsetY;
    const onPreset = this.#projection.kind !== "empty"
      ? this.#hitTestPreset(px, py)
      : null;
    if (onPreset) {
      this.#showContextMenuOnPreset(px, py, onPreset);
      return;
    }
    if (this.#hitTestCentre(px, py)) {
      this.#showContextMenuOnCross(px, py);
      return;
    }
    // Empty space — no menu.
    if (this.#contextMenuOpen) this.#hideContextMenu();
  }

  #showContextMenuOnCross(px: number, py: number): void {
    this.#contextMenu.replaceChildren();
    this.#contextMenu.appendChild(
      this.#buildMenuItem("Add preset", () => {
        this.#hideContextMenu();
        void this.#savePresetAtCentre();
      }),
    );
    this.#openContextMenuAt(px, py);
  }

  #showContextMenuOnPreset(px: number, py: number, preset: PresetRecord): void {
    this.#contextMenu.replaceChildren();
    this.#contextMenu.appendChild(
      this.#buildMenuItem("Rename…", () => {
        this.#hideContextMenu();
        this.#openNameEditor(preset.configHash);
      }),
    );
    this.#contextMenu.appendChild(
      this.#buildMenuItem("Delete", () => {
        this.#hideContextMenu();
        void this.#confirmAndDeletePreset(preset);
      }),
    );
    this.#openContextMenuAt(px, py);
  }

  #buildMenuItem(label: string, onClick: () => void): HTMLButtonElement {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "fx-panel-effect-context-menu-item";
    item.textContent = label;
    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return item;
  }

  /**
   * Purpose: Position the menu next to the click and reveal it.
   * How: Convert canvas-pixel coords to coordinates relative to the
   *      `.fx-panel-effect-orbit` container (the menu's offsetParent), then
   *      show the element. The pointerdown-elsewhere listener installed in
   *      the constructor closes the menu when the user clicks away.
   */
  #openContextMenuAt(canvasX: number, canvasY: number): void {
    const canvasRect = this.#canvas.getBoundingClientRect();
    const containerRect = this.#outerContainer.getBoundingClientRect();
    const left = canvasRect.left - containerRect.left + canvasX;
    const top = canvasRect.top - containerRect.top + canvasY;
    this.#contextMenu.style.left = `${Math.round(left)}px`;
    this.#contextMenu.style.top = `${Math.round(top)}px`;
    this.#contextMenu.style.display = "";
    this.#contextMenuOpen = true;
  }

  #hideContextMenu(): void {
    if (!this.#contextMenuOpen) return;
    this.#contextMenuOpen = false;
    this.#contextMenu.style.display = "none";
    this.#contextMenu.replaceChildren();
  }

  /**
   * Purpose: Single-preset deletion path with a confirm step for named
   *          presets (their loss is harder to undo than an auto-promoted
   *          one). Distinct from `deleteSelected` which is the trash-button
   *          batch path.
   * How: Confirm only when the preset has a user-supplied name, then
   *      delete via the storage gateway, prune the selection, notify
   *      other badges, refresh.
   */
  async #confirmAndDeletePreset(preset: PresetRecord): Promise<void> {
    if (preset.name && preset.name.length > 0) {
      const ok = window.confirm(`Delete preset “${preset.name}”?`);
      if (!ok) return;
    }
    try {
      await deletePreset(this.#uiHash, preset.configHash);
    } catch (error) {
      console.warn("[webdaw] preset deletion failed", error);
      return;
    }
    getLibraryUndoScope(this.#uiHash).record({
      kind: "delete",
      record: preset,
    });
    this.#selectedConfigHashes.delete(preset.configHash);
    presetTrackingSystem.notifyLibraryChange(this.#uiHash);
    await this.refresh();
  }

  /**
   * Purpose: Surface the inline name editor over the disc of `configHash`.
   * How: Compute the disc's visual position, place the input element near
   *      it, pre-fill with the current name, focus + select-all so the
   *      user can replace it immediately by typing.
   */
  #openNameEditor(configHash: string): void {
    const preset = this.#presets.find((p) => p.configHash === configHash);
    if (!preset) return;
    this.#nameEditingHash = configHash;
    this.#nameInput.value = preset.name ?? "";
    this.#nameInput.style.display = "";
    this.#positionNameEditor(configHash);
    // Wait a tick so the input is laid out before focusing.
    requestAnimationFrame(() => {
      this.#nameInput.focus();
      this.#nameInput.select();
    });
  }

  /**
   * Purpose: Anchor the name editor's DOM position over the target disc.
   * How: Read the visual position via `#computeVisualPositions`, convert
   *      to coordinates relative to the editor's offsetParent (the
   *      `.fx-panel-effect-orbit` container). The input sits just below
   *      the disc so it doesn't hide the visual.
   */
  #positionNameEditor(configHash: string): void {
    const rect = this.#canvas.getBoundingClientRect();
    const placement = this.#buildCurrentPlacement(rect.width, rect.height);
    if (!placement) return;
    const visualPositions = this.#computeVisualPositions(placement);
    const pos = visualPositions.get(configHash);
    if (!pos) return;
    const containerRect = this.#outerContainer.getBoundingClientRect();
    const left = rect.left - containerRect.left + pos[0] - 60;
    const top = rect.top - containerRect.top + pos[1] + DISK_RADIUS_PX + 4;
    this.#nameInput.style.left = `${Math.round(left)}px`;
    this.#nameInput.style.top = `${Math.round(top)}px`;
  }

  /**
   * Purpose: Persist (or discard) the editor's value and close it.
   * How: When `commit` is true, write the trimmed value via
   *      `setPresetName` (empty string strips the name back to the
   *      auto-promoted state). Refresh after the round-trip so the disc
   *      colour and label update immediately.
   */
  #commitNameEdit(commit: boolean): void {
    const editingHash = this.#nameEditingHash;
    if (editingHash === null) return;
    const value = this.#nameInput.value;
    this.#nameEditingHash = null;
    this.#nameInput.style.display = "none";
    this.#nameInput.value = "";
    this.#canvas.focus();
    if (!commit) return;
    void (async () => {
      // Capture the previous name BEFORE writing the new one so the undo
      // path can restore it. `loadPresetName` returns undefined for an
      // unnamed (auto-promoted) preset.
      const prevName = await loadPresetName(this.#uiHash, editingHash);
      const trimmed = value.trim();
      const nextName = trimmed.length > 0 ? trimmed : undefined;
      // No-op rename — same effective name before and after — skips the
      // op record so the undo stack doesn't fill up with phantom entries.
      const changed = (prevName ?? "") !== (nextName ?? "");
      try {
        await setPresetName(this.#uiHash, editingHash, value);
        presetTrackingSystem.notifyLibraryChange(this.#uiHash);
      } catch (error) {
        console.warn("[webdaw] preset rename failed", error);
        return;
      }
      if (changed) {
        getLibraryUndoScope(this.#uiHash).record({
          kind: "rename",
          uiHash: this.#uiHash,
          configHash: editingHash,
          prevName,
          nextName,
        });
      }
      await this.refresh();
    })();
  }

  /**
   * Purpose: Build a placement that reflects the calque's current viewport
   *          (pan + zoom) and the canvas's current size. Used everywhere a
   *          projection-coord ↔ canvas-pixel mapping is needed.
   * How: Read the canvas's bounding rect ; if it has area, build the
   *      placement around the cached `#viewportCenterProj` and `#zoom`.
   *      Returns null when the calque is not yet ready (no bounds /
   *      viewport / size).
   */
  #buildCurrentPlacement(width: number, height: number): Placement | null {
    if (!this.#bounds || !this.#viewportCenterProj) return null;
    if (width <= 0 || height <= 0) return null;
    return buildPlacement(this.#bounds, this.#viewportCenterProj, this.#zoom, width, height);
  }

  /**
   * Purpose: Return the 2D projection-space position to use for a preset
   *          everywhere a position is needed (drawing, hit-test, Shepard
   *          distances, navigation targets).
   * How: A user-anchored preset (created via "Add preset") returns its
   *      override; otherwise we fall back to the linear PCA projection of
   *      the configuration. Anchors live only while the current projection
   *      basis is in force — `refresh()` clears them on a basis recompute.
   */
  #presetPosition(preset: PresetRecord): readonly [number, number] {
    const override = this.#anchorOverrides.get(preset.configHash);
    if (override) return override;
    if (!this.#projection) return [0, 0];
    return projectConfig(preset.configuration, this.#projection);
  }

  /**
   * Purpose: Resolve the **visual** position of a preset's disc — i.e.
   *          its `#presetPosition` *plus* any cluster-spread offset
   *          applied at draw time. Expressed in projection coords so it
   *          can be assigned to `#centerProjection`. Used everywhere a
   *          target « on the disc » is needed (click-to-snap, arrow nav,
   *          loop arming, recall) so the cross visually lands where the
   *          user expects regardless of cluster spread.
   * How: Build the current placement, run `#computeVisualPositions` to
   *      get pixel-space positions including spread, look up the disc
   *      and convert back to projection coords. Falls back to the base
   *      position when the placement isn't ready (e.g. zero-sized canvas).
   */
  #presetVisualProjection(preset: PresetRecord): readonly [number, number] {
    const rect = this.#canvas.getBoundingClientRect();
    const placement = this.#buildCurrentPlacement(rect.width, rect.height);
    if (placement) {
      const visualPositions = this.#computeVisualPositions(placement);
      const visualPos = visualPositions.get(preset.configHash);
      if (visualPos) {
        return [
          placement.fromCanvasX(visualPos[0]),
          placement.fromCanvasY(visualPos[1]),
        ];
      }
    }
    return this.#presetPosition(preset);
  }

  // -------------------------------------------------------------------------
  // Orbit-ui header interception (Center / Random / Zoom)
  // -------------------------------------------------------------------------

  #interceptHeaderClick(e: Event): void {
    if (!this.#visible) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // The buttons now contain a Material icon span ; the click target is
    // typically that inner span. closest() resolves it back to the
    // outer button so the action still triggers when the calque is on.
    if (target.closest(".orbit-center-btn")) {
      e.preventDefault();
      e.stopPropagation();
      this.#actionCenter();
    } else if (target.closest(".orbit-random-btn")) {
      e.preventDefault();
      e.stopPropagation();
      this.#actionRandom();
    }
  }

  #interceptHeaderChange(e: Event): void {
    if (!this.#visible) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.classList.contains("orbit-zoom")) {
      e.stopPropagation();
      this.#actionZoom();
    }
  }

  /**
   * Purpose: Pan the calque viewport so the manipulable centre cross sits
   *          at the canvas centre. Audio is unchanged ; this is a pure view
   *          translation.
   */
  #actionCenter(): void {
    if (!this.#centerProjection) return;
    this.#viewportCenterProj = [this.#centerProjection[0], this.#centerProjection[1]];
    this.#draw();
  }

  /**
   * Purpose: Move the centre cross to a random point inside the data
   *          bounds, blended with its current position by the mix factor
   *          read from the orbit-ui Random select. ψ at the new position
   *          is applied to the audio so the user immediately hears the new
   *          configuration.
   * How: `new = current + mix · (random − current)` — mix=0 stays put,
   *      mix=1 jumps fully to the random pick.
   */
  #actionRandom(): void {
    if (!this.#projection || this.#projection.kind === "empty") return;
    if (!this.#bounds || !this.#centerProjection) return;
    const mixSelect = this.#orbitWrap?.querySelector<HTMLSelectElement>(".orbit-random-mix");
    const mixRaw = mixSelect ? Number(mixSelect.value) : 0.5;
    const mix = isFinite(mixRaw) ? Math.max(0, Math.min(1, mixRaw)) : 0.5;
    const randX = this.#bounds.xMin + Math.random() * (this.#bounds.xMax - this.#bounds.xMin);
    const randY = this.#bounds.yMin + Math.random() * (this.#bounds.yMax - this.#bounds.yMin);
    const cur = this.#centerProjection;
    this.#centerProjection = [
      cur[0] + mix * (randX - cur[0]),
      cur[1] + mix * (randY - cur[1]),
    ];
    const rect = this.#canvas.getBoundingClientRect();
    const placement = this.#buildCurrentPlacement(rect.width, rect.height);
    if (placement) {
      const config = this.#computeShepardConfig(placement);
      this.#handler.apply(config);
    }
    this.#draw();
  }

  /**
   * Purpose: Apply the zoom factor selected in the orbit-ui Zoom dropdown.
   * How: The select holds a percent (75/100/125/150/200) ; we convert to a
   *      multiplicative factor for the placement scale. Pan stays put so
   *      the same projection point remains at the canvas centre.
   */
  #actionZoom(): void {
    const zoomSelect = this.#orbitWrap?.querySelector<HTMLSelectElement>(".orbit-zoom");
    if (!zoomSelect) return;
    const percent = Number(zoomSelect.value);
    if (!isFinite(percent) || percent <= 0) return;
    this.#zoom = percent / 100;
    this.#draw();
  }

  // -------------------------------------------------------------------------
  // Hit-tests
  // -------------------------------------------------------------------------

  #hitTestCentre(px: number, py: number): boolean {
    if (!this.#projection || !this.#centerProjection) return false;
    const rect = this.#canvas.getBoundingClientRect();
    const placement = this.#buildCurrentPlacement(rect.width, rect.height);
    if (!placement) return false;
    const cx = placement.toCanvasX(this.#centerProjection[0]);
    const cy = placement.toCanvasY(this.#centerProjection[1]);
    return Math.hypot(px - cx, py - cy) <= CENTER_HIT_RADIUS_PX;
  }

  #hitTestPreset(px: number, py: number): PresetRecord | null {
    if (!this.#projection) return null;
    const rect = this.#canvas.getBoundingClientRect();
    const placement = this.#buildCurrentPlacement(rect.width, rect.height);
    if (!placement) return null;
    const visualPositions = this.#computeVisualPositions(placement);
    let best: PresetRecord | null = null;
    let bestDist = POINT_HIT_RADIUS_PX;
    for (const preset of this.#presets) {
      const pos = visualPositions.get(preset.configHash);
      if (!pos) continue;
      const d = Math.hypot(px - pos[0], py - pos[1]);
      if (d <= bestDist) {
        bestDist = d;
        best = preset;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Shepard
  // -------------------------------------------------------------------------

  #updateCenterFromPointer(e: PointerEvent): void {
    if (!this.#projection) return;
    const rect = this.#canvas.getBoundingClientRect();
    const placement = this.#buildCurrentPlacement(rect.width, rect.height);
    if (!placement) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    this.#centerProjection = [placement.fromCanvasX(px), placement.fromCanvasY(py)];
    // Free drag → no specific preset is « active » anymore.
    this.#activePresetHash = null;
    const config = this.#computeShepardConfig(placement);
    this.#handler.apply(config);
    this.#draw();
  }

  #computeShepardConfig(placement: Placement): Record<string, number> {
    if (!this.#projection || !this.#centerProjection) {
      return this.#defaultConfig();
    }
    const centerPx: [number, number] = [
      placement.toCanvasX(this.#centerProjection[0]),
      placement.toCanvasY(this.#centerProjection[1]),
    ];
    // Use the VISUAL (cluster-spread) positions so distances and the
    // `d = 0` snap match what's drawn — clicking a clustered disc puts
    // the cross at its visual position, and Shepard sees that exact
    // disc as d = 0 instead of returning a centroid mix.
    const visualPositions = this.#computeVisualPositions(placement);
    const presetPositions: Array<readonly [number, number]> = this.#presets.map((preset) => {
      const visual = visualPositions.get(preset.configHash);
      if (visual) return visual;
      const xy = this.#presetPosition(preset);
      return [placement.toCanvasX(xy[0]), placement.toCanvasY(xy[1])];
    });
    return shepardInterpolate(
      centerPx,
      this.#presets,
      presetPositions,
      this.#paramSpecs,
    );
  }

  #defaultConfig(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const spec of this.#paramSpecs) result[spec.address] = spec.default;
    return result;
  }

  /**
   * Purpose: Compute each preset's Shepard contribution to ψ(centre) so the
   *          calque can visualise the influence map as proportional white
   *          arcs around each preset point.
   * How: Mirror unbounded `shepardInterpolate` : every preset's weight is
   *      `1/d^p` (p=2), normalised so the contributions sum to 1. The only
   *      special case is exact zero distance — that preset takes the whole
   *      share (avoids Infinity/Infinity = NaN). Continuous everywhere.
   */
  /**
   * Purpose: Resolve final canvas-pixel positions for every preset, applying
   *          a small radial spread to presets whose PCA projection collides
   *          with others (otherwise discs end up stacked and the user can
   *          neither see nor click the hidden ones).
   * How: Detect clusters and compute spread offsets in **projection space**
   *      (not canvas pixels) so the relative arrangement is stable across
   *      zoom — the cluster as a whole expands/contracts coherently with
   *      the placement scale, but members never re-cluster or re-arrange
   *      when the user changes zoom. Threshold + spread radius are a
   *      fraction of the bounds extent. Members are ordered by their
   *      position in `#orderedPresets` so the angular arrangement is
   *      stable across re-draws. Used for drawing AND hit-testing AND
   *      Shepard math (so `d = 0` snap aligns with what's drawn).
   */
  #computeVisualPositions(placement: Placement): Map<string, readonly [number, number]> {
    const result = new Map<string, readonly [number, number]>();
    if (!this.#projection || !this.#bounds || this.#presets.length === 0) return result;
    const n = this.#presets.length;

    // Base projection-space positions for clustering and spread math.
    const projXs: number[] = new Array(n);
    const projYs: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const xy = this.#presetPosition(this.#presets[i]!);
      projXs[i] = xy[0];
      projYs[i] = xy[1];
    }

    // Cluster threshold + spread radius expressed as a fraction of the
    // bounds' extent. With these in projection space, the cluster
    // arrangement (which presets cluster, which angle each gets) is the
    // same at every zoom level — only the visual size of the cluster
    // changes with the placement scale.
    const xRange = this.#bounds.xMax - this.#bounds.xMin;
    const yRange = this.#bounds.yMax - this.#bounds.yMin;
    const extent = Math.max(xRange, yRange) || 1;
    const threshold = 0.04 * extent;
    const baseRadius = 0.025 * extent;

    // Union-find on projection-space distance.
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => {
      let r = i;
      while (parent[r] !== r) r = parent[r]!;
      while (parent[i] !== r) {
        const next = parent[i]!;
        parent[i] = r;
        i = next;
      }
      return r;
    };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = projXs[i]! - projXs[j]!;
        const dy = projYs[i]! - projYs[j]!;
        if (Math.hypot(dx, dy) < threshold) {
          const ri = find(i);
          const rj = find(j);
          if (ri !== rj) parent[ri] = rj;
        }
      }
    }

    const clusters = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let bucket = clusters.get(r);
      if (!bucket) {
        bucket = [];
        clusters.set(r, bucket);
      }
      bucket.push(i);
    }

    const orderedRank = new Map<string, number>();
    this.#orderedPresets.forEach((p, idx) => orderedRank.set(p.configHash, idx));

    for (const members of clusters.values()) {
      if (members.length === 1) {
        const i = members[0]!;
        result.set(this.#presets[i]!.configHash, [
          placement.toCanvasX(projXs[i]!),
          placement.toCanvasY(projYs[i]!),
        ]);
        continue;
      }
      // Centroid in projection space.
      let cx = 0;
      let cy = 0;
      for (const i of members) {
        cx += projXs[i]!;
        cy += projYs[i]!;
      }
      cx /= members.length;
      cy /= members.length;

      const sortedMembers = [...members].sort((a, b) => {
        const ra = orderedRank.get(this.#presets[a]!.configHash) ?? a;
        const rb = orderedRank.get(this.#presets[b]!.configHash) ?? b;
        return ra - rb;
      });

      // Radius scales with member count (more members → wider circle so
      // discs don't overlap themselves), still in projection space so it
      // expands cohesively with zoom.
      const radius = Math.max(baseRadius, baseRadius * 0.4 * members.length);
      for (let k = 0; k < sortedMembers.length; k++) {
        const angle = (k / sortedMembers.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        result.set(this.#presets[sortedMembers[k]!]!.configHash, [
          placement.toCanvasX(x),
          placement.toCanvasY(y),
        ]);
      }
    }
    return result;
  }

  #computeContributionWeights(placement: Placement): number[] {
    const n = this.#presets.length;
    if (n === 0 || !this.#projection || !this.#centerProjection) {
      return new Array(n).fill(0);
    }
    if (this.#projection.kind === "empty") return new Array(n).fill(0);
    const centerPx: [number, number] = [
      placement.toCanvasX(this.#centerProjection[0]),
      placement.toCanvasY(this.#centerProjection[1]),
    ];
    // Same visual-position alignment as `#computeShepardConfig` — the
    // contribution arcs reflect what Shepard actually does, including
    // the cluster-spread snap.
    const visualPositions = this.#computeVisualPositions(placement);
    const distances = this.#presets.map((preset) => {
      const visual = visualPositions.get(preset.configHash);
      const xy = visual
        ? visual
        : (() => {
            const proj = this.#presetPosition(preset);
            return [placement.toCanvasX(proj[0]), placement.toCanvasY(proj[1])] as const;
          })();
      return Math.hypot(centerPx[0] - xy[0], centerPx[1] - xy[1]);
    });
    for (let i = 0; i < n; i++) {
      if (distances[i] === 0) {
        const w = new Array(n).fill(0);
        w[i] = 1;
        return w;
      }
    }
    const raw = distances.map((d) => {
      const dist = d ?? Infinity;
      return isFinite(dist) ? Math.pow(dist, -2) : 0;
    });
    const sum = raw.reduce((a, b) => a + b, 0);
    if (sum > 0) return raw.map((r) => r / sum);
    return new Array(n).fill(0);
  }

  // -------------------------------------------------------------------------
  // Selection helpers
  // -------------------------------------------------------------------------

  #emitState(): void {
    const selectedCount = this.#selectedConfigHashes.size;
    this.#loopButton.disabled = !this.#visible || selectedCount === 0;
    if (selectedCount === 0 && this.#loopActive) this.#stopLoop();
    this.#onStateChange({
      count: this.#orderedPresets.length,
      selectedCount,
      visible: this.#visible,
    });
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  #draw(): void {
    if (!this.#visible || !this.#projection) return;
    const rect = this.#anchor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.#canvas.width = Math.round(rect.width * dpr);
    this.#canvas.height = Math.round(rect.height * dpr);
    this.#canvas.style.width = `${rect.width}px`;
    this.#canvas.style.height = `${rect.height}px`;
    const ctx = this.#ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const placement = this.#buildCurrentPlacement(rect.width, rect.height);
    if (!placement) return;

    // Preset points drawn in the same style as orbit-ui parameters : a thin
    // background ring topped by a bright white arc whose length encodes the
    // preset's Shepard contribution to ψ(centre), so the user can see at a
    // glance how the centre is being interpolated. All disks share the same
    // pink fill (recency is not encoded in the colour for this iteration).
    // A small dark digit overlays each disk with its position in the
    // lastSeenAt-ascending order — the same order arrow keys cycle through.
    const weights = this.#computeContributionWeights(placement);
    const visualPositions = this.#computeVisualPositions(placement);
    const orderedIndexByHash = new Map<string, number>();
    this.#orderedPresets.forEach((p, idx) => orderedIndexByHash.set(p.configHash, idx));
    for (let i = 0; i < this.#presets.length; i++) {
      const preset = this.#presets[i]!;
      const pos = visualPositions.get(preset.configHash);
      if (!pos) continue;
      const cx = pos[0];
      const cy = pos[1];
      const w = weights[i] ?? 0;

      // Background ring (faint white).
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.beginPath();
      ctx.arc(cx, cy, RING_RADIUS_PX, 0, Math.PI * 2);
      ctx.stroke();

      // Contribution arc (bright white) — same convention as orbit-ui :
      // starts at -π/2 (12 o'clock) and grows clockwise.
      if (w > 0.001) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
        ctx.beginPath();
        ctx.arc(cx, cy, RING_RADIUS_PX, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * w);
        ctx.stroke();
      }
      ctx.lineCap = "butt";

      // Filled disk — uniform pink for auto-promoted presets ; named
      // (user-labeled) presets get a cream / gold fill so they stand out
      // from the auto-grown crowd.
      const isNamed = preset.name !== undefined && preset.name.length > 0;
      ctx.fillStyle = isNamed ? "rgb(232, 201, 122)" : "rgb(232, 110, 158)";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, DISK_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Number — preset's 1-based index in the lastSeenAt cycle.
      const orderedIndex = orderedIndexByHash.get(preset.configHash);
      if (orderedIndex !== undefined) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.font = "600 9px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(orderedIndex + 1), cx, cy + 0.5);
      }
    }

    // Selection rings — ambre highlight around every selected preset.
    if (this.#selectedConfigHashes.size > 0) {
      ctx.strokeStyle = "rgba(255, 200, 80, 0.95)";
      ctx.lineWidth = 2;
      for (const preset of this.#presets) {
        if (!this.#selectedConfigHashes.has(preset.configHash)) continue;
        const pos = visualPositions.get(preset.configHash);
        if (!pos) continue;
        ctx.beginPath();
        ctx.arc(pos[0], pos[1], SELECTION_RADIUS_PX, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Manipulable centre cross — bare crosshair, no surrounding ring so the
    // user reads the snap / influence radii from the presets' arcs alone.
    if (this.#centerProjection) {
      const ccx = placement.toCanvasX(this.#centerProjection[0]);
      const ccy = placement.toCanvasY(this.#centerProjection[1]);
      const arm = CENTER_RADIUS_PX;
      ctx.strokeStyle = "rgba(240, 240, 240, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ccx - arm, ccy);
      ctx.lineTo(ccx + arm, ccy);
      ctx.moveTo(ccx, ccy - arm);
      ctx.lineTo(ccx, ccy + arm);
      ctx.stroke();
    }

    // Active preset name label — when the centre coincides with a preset
    // and that preset has a user-supplied name, surface the name beneath
    // the disc. Otherwise no label, keeping the calque uncluttered.
    const activeIndex = this.#findIndexUnderCentre();
    let activeHash: string | null = null;
    if (activeIndex >= 0) {
      const activePreset = this.#orderedPresets[activeIndex];
      if (activePreset && activePreset.name && activePreset.name.length > 0) {
        activeHash = activePreset.configHash;
        const pos = visualPositions.get(activePreset.configHash);
        if (pos) {
          ctx.fillStyle = "rgba(232, 201, 122, 0.95)";
          ctx.font = "600 11px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(activePreset.name, pos[0], pos[1] + RING_RADIUS_PX + 4);
        }
      }
    }

    // Hover tooltip — surface the name of the disc currently under the
    // pointer (skip if it's already the active disc, no point drawing
    // twice). Uses a slightly dimmer colour so the active label remains
    // the most salient.
    if (this.#hoveredPresetHash && this.#hoveredPresetHash !== activeHash) {
      const hovered = this.#presets.find((p) => p.configHash === this.#hoveredPresetHash);
      if (hovered && hovered.name && hovered.name.length > 0) {
        const pos = visualPositions.get(hovered.configHash);
        if (pos) {
          ctx.fillStyle = "rgba(232, 201, 122, 0.7)";
          ctx.font = "500 11px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(hovered.name, pos[0], pos[1] + RING_RADIUS_PX + 4);
        }
      }
    }

    // Selection rectangle (shift+drag) — translucent fill + ambre outline.
    if (this.#selectionRect) {
      const r = this.#selectionRect;
      const rx = Math.min(r.startX, r.endX);
      const ry = Math.min(r.startY, r.endY);
      const rw = Math.abs(r.endX - r.startX);
      const rh = Math.abs(r.endY - r.startY);
      ctx.fillStyle = "rgba(255, 200, 80, 0.15)";
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = "rgba(255, 200, 80, 0.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(rx, ry, rw, rh);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Bounds = {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
};

type Placement = {
  readonly toCanvasX: (x: number) => number;
  readonly toCanvasY: (y: number) => number;
  readonly fromCanvasX: (cx: number) => number;
  readonly fromCanvasY: (cy: number) => number;
};

function computeBounds(xys: ReadonlyArray<readonly [number, number]>): Bounds {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const [x, y] of xys) {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  if (xMin === Infinity) return { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  return { xMin, xMax, yMin, yMax };
}

/**
 * Purpose: Map projection coordinates to canvas pixels, with a viewport
 *          centre and a zoom factor so the user can pan / zoom the calque
 *          via the orbit-ui header.
 * How: The viewport centre (in projection coords) is anchored at the canvas
 *      centre. A `baseScale` fits the frozen bounds inside the canvas with
 *      the same equal-axis policy as before ; the effective scale is
 *      `baseScale × zoom`. Inverse (`fromCanvas*`) recovers projection
 *      coordinates so pointer events keep working at any zoom / pan.
 */
/**
 * Purpose: Map a slider integer position [0, SLIDER_RES] onto a target
 *          quantity (ms for the portamento, BPM for the loop tempo) via a
 *          geometric curve `v = min · (max/min)^(s / SLIDER_RES)`.
 * How: Endpoints map exactly to `min` and `max`; the midpoint maps to the
 *      geometric mean. Result is rounded to the nearest integer in the
 *      target unit. Unit-agnostic so the same helper drives both sliders.
 */
function logSliderToValue(s: number, min: number, max: number): number {
  const clamped = Math.max(0, Math.min(SLIDER_RES, s));
  const ratio = max / min;
  return Math.round(min * Math.pow(ratio, clamped / SLIDER_RES));
}

/**
 * Purpose: Inverse of `logSliderToValue` — recover the slider position from
 *          a quantity in the target unit. Used to initialise the slider
 *          from the stored Tp (ms) or loop tempo (BPM).
 */
function valueToLogSlider(v: number, min: number, max: number): number {
  const clamped = Math.max(min, Math.min(max, v));
  const ratio = max / min;
  return Math.round((SLIDER_RES * Math.log(clamped / min)) / Math.log(ratio));
}

/**
 * Purpose: BPM ↔ cycle-duration converters for the loop tempo. The cycle is
 *          taken to be one bar at 4/4, so `cycleMs = 60_000 · BAR_BEATS / BPM`.
 *          Used both at slider read-time (BPM → ms storage) and
 *          slider/label-init time (ms storage → BPM display).
 */
function bpmToCycleMs(bpm: number): number {
  return Math.round((60000 * LOOP_BAR_BEATS) / bpm);
}

function cycleMsToBpm(cycleMs: number): number {
  return Math.round((60000 * LOOP_BAR_BEATS) / cycleMs);
}

/**
 * Purpose: Render a duration in milliseconds in the most readable unit for
 *          the value : `Xms` below 1 s, `X.Xs` between 1 s and 10 s, `Ns`
 *          above 10 s. Keeps the slider value-label tidy across the full
 *          log range without collapsing precision near the extremes.
 */
function formatMs(t: number): string {
  if (t < 1000) return `${Math.round(t)} ms`;
  const s = t / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}

function buildPlacement(
  bounds: Bounds,
  viewportCenter: readonly [number, number],
  zoom: number,
  width: number,
  height: number,
): Placement {
  const rangeX = bounds.xMax - bounds.xMin;
  const rangeY = bounds.yMax - bounds.yMin;
  const boxW = Math.max(0, width - 2 * MARGIN_PX);
  const boxH = Math.max(0, height - 2 * MARGIN_PX);
  let baseScale: number;
  if (rangeX === 0 && rangeY === 0) {
    baseScale = 1;
  } else {
    const scaleX = rangeX > 0 ? boxW / rangeX : Infinity;
    const scaleY = rangeY > 0 ? boxH / rangeY : Infinity;
    baseScale = Math.min(scaleX, scaleY);
    if (!isFinite(baseScale)) baseScale = 1;
  }
  const scale = baseScale * zoom;
  const cx = width / 2;
  const cy = height / 2;
  return {
    toCanvasX: (x) => cx + (x - viewportCenter[0]) * scale,
    toCanvasY: (y) => cy + (y - viewportCenter[1]) * scale,
    fromCanvasX: (px) => scale > 0 ? (px - cx) / scale + viewportCenter[0] : viewportCenter[0],
    fromCanvasY: (py) => scale > 0 ? (py - cy) / scale + viewportCenter[1] : viewportCenter[1],
  };
}
