/****************************** preset-recall.ts ******************************
 *
 * Purpose: Niveau-0 dropdown that surfaces user-named presets directly
 *          from the FX panel header — a one-click recall path that does
 *          not require opening the niveau-1 calque. Auto-promoted
 *          (un-named) presets are intentionally NOT surfaced here ; they
 *          live behind the calque, where the projection plane gives them
 *          spatial context. The header menu is the « pinned » subset.
 * How: Transient menu attached to `document.body` with `position: fixed`,
 *      anchored under the count span at open-time. Outside click, Escape
 *      and scroll all dismiss it. Recall reuses the overlay's gesture
 *      handler (begin / apply / end) so the audio + project update path
 *      is identical to a click inside the calque ; the dwell tracker
 *      handles `lastSeenAt` promotion if the user lingers, same as for
 *      a direct click on the disc.
 *
 ******************************************************************************/

import {
  computeConfigHash,
  listPresetsByUIHash,
  type PresetRecord,
} from "./preset-storage.js";
import type { PresetOverlay } from "./preset-overlay.js";

const MENU_CLASS = "fx-panel-effect-recall-menu";

/**
 * Shared registry of live PresetOverlay instances, keyed by effectId. Both
 * the FX chain panel and the Faust Transform panel populate it when they
 * build an overlay so a single window-level click handler can resolve any
 * count-span back to its overlay regardless of which panel rendered it.
 * Without this, each panel's `activeOrbitInstances` map is private and the
 * click handler can't see transform-panel overlays (or vice-versa).
 */
const overlayRegistry = new Map<string, PresetOverlay>();

export function registerPresetOverlay(effectId: string, overlay: PresetOverlay): void {
  overlayRegistry.set(effectId, overlay);
}

export function unregisterPresetOverlay(effectId: string): void {
  overlayRegistry.delete(effectId);
}

/**
 * Purpose: Install the global recall-menu trigger. Call once at app startup.
 * How: Window-level capture-phase pointerdown handler — captures the click
 *      before the parent header's drag-and-drop arms (otherwise the click
 *      gets swallowed by the drag tracker on `draggable="true"` headers).
 *      Looks up the overlay from the shared registry, opens the menu.
 */
export function wirePresetRecallMenu(): void {
  window.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const span = target.closest<HTMLElement>(".fx-panel-effect-presets");
      if (!span) return;
      event.preventDefault();
      event.stopPropagation();
      const effectId = span.dataset.effectId;
      const uiHash = span.dataset.uiHash;
      if (!effectId || !uiHash) return;
      const overlay = overlayRegistry.get(effectId);
      if (!overlay) return;
      openPresetRecallMenu({
        anchor: span,
        uiHash,
        recall: (cfg, hash) => overlay.recall(cfg, hash),
        getCurrentConfig: () => overlay.getCurrentConfig(),
      });
    },
    { capture: true },
  );
}

/**
 * Purpose: Open the niveau-0 named-preset recall dropdown anchored under
 *          the given header span.
 * How: Tear down any existing menu (only one at a time across the app),
 *      build the DOM, fetch the named subset asynchronously, render either
 *      a list of items or an empty-state message. Each item recalls its
 *      preset on click. Outside click, scroll, and Escape close the menu.
 */
function openPresetRecallMenu(options: {
  readonly anchor: HTMLElement;
  readonly uiHash: string;
  readonly recall: (
    configuration: Readonly<Record<string, number>>,
    configHash: string,
  ) => void;
  readonly getCurrentConfig: () => Readonly<Record<string, number>>;
}): void {
  document.querySelectorAll(`.${MENU_CLASS}`).forEach((el) => el.remove());

  const menu = document.createElement("div");
  menu.className = MENU_CLASS;
  positionMenuUnder(menu, options.anchor);

  const loading = document.createElement("div");
  loading.className = "fx-panel-effect-recall-menu-empty";
  loading.textContent = "Loading…";
  menu.appendChild(loading);

  document.body.appendChild(menu);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onDocumentPointerDown, { capture: true });
    document.removeEventListener("keydown", onKeyDown, { capture: true });
    window.removeEventListener("scroll", onScroll, { capture: true });
    menu.remove();
  };
  const onDocumentPointerDown = (e: PointerEvent): void => {
    if (menu.contains(e.target as Node)) return;
    if (options.anchor.contains(e.target as Node)) return;
    close();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const onScroll = (): void => close();
  document.addEventListener("pointerdown", onDocumentPointerDown, { capture: true });
  document.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("scroll", onScroll, { capture: true });

  void (async () => {
    let named: PresetRecord[] = [];
    let activeHash: string | null = null;
    try {
      const [all, currentHash] = await Promise.all([
        listPresetsByUIHash(options.uiHash),
        computeConfigHash(options.getCurrentConfig()),
      ]);
      named = all
        .filter((p) => p.name !== undefined && p.name.length > 0)
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }));
      activeHash = currentHash;
    } catch (error) {
      console.warn("[webdaw] preset recall fetch failed", error);
    }
    if (closed) return;
    menu.replaceChildren();
    if (named.length === 0) {
      const empty = document.createElement("div");
      empty.className = "fx-panel-effect-recall-menu-empty";
      empty.textContent = "No named presets";
      menu.appendChild(empty);
      return;
    }
    for (const preset of named) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "fx-panel-effect-recall-menu-item";
      if (preset.configHash === activeHash) {
        item.classList.add("fx-panel-effect-recall-menu-item--active");
      }
      item.textContent = preset.name ?? "";
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
        recallPreset(options.uiHash, preset, options.recall);
      });
      menu.appendChild(item);
    }
  })();
}

/**
 * Purpose: Apply a preset's configuration to the audio + domain model.
 * How: Delegate to the host-supplied `recall`, which itself wraps the
 *      change in `handler.begin / end` — same gesture machinery as a
 *      direct click on the disc (autosave commit, dwell tracker armed).
 *      We deliberately do NOT bump `lastSeenAt` here : doing so would
 *      reorder the niveau-1 cluster (changing disc numbers and spread
 *      angles), making a menu-driven recall visually different from a
 *      direct click on the same preset. The dwell tracker handles
 *      « recall + linger = promote » naturally if the user stays.
 */
function recallPreset(
  _uiHash: string,
  preset: PresetRecord,
  recall: (
    configuration: Readonly<Record<string, number>>,
    configHash: string,
  ) => void,
): void {
  recall(preset.configuration, preset.configHash);
}

function positionMenuUnder(menu: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.top = `${Math.round(r.bottom + 4)}px`;
}
