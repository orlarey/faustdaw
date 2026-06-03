/******************************** footer-view.ts ******************************
 *
 * Purpose: Own the timeline footer as a single concept. The footer displays
 *          four zones — app version, status message (with tone), current zoom
 *          level, and current sample rate. Some zones come from stored state
 *          (message + tone), others are derived from the viewport and the
 *          project timebase, and the version is a build constant. This module
 *          groups all of it so new affichages (clip count, CPU, memory, …)
 *          can be added in one place.
 * How: The two stored fields (message + tone) live as private instance
 *      fields on the FooterView class. `setStatus` mutates them; `sync`
 *      writes all four zones to the DOM in one pass; `syncZoomOnly` is the
 *      fast path used by frame-level render passes (transport / drag) where
 *      only the zoom changes.
 *
 ******************************************************************************/
import type { Elements } from "./bind-elements.js";
import { demoState } from "./state.js";
import { focusedCalqueUIHash } from "./preset-library-undo.js";
import { focusedChainScopeKey, TRANSFORM_CHAIN_ID } from "./chain-undo.js";
import { focusedFaustFxScopeKey } from "./faust-fx-undo.js";

const APP_VERSION_LABEL = "WebDAW v0.2.0";

/**
 * Purpose: Compute the label of the undo scope that would currently be
 *          affected by Cmd+Z, based on the focus position. Used by the
 *          footer to display the active scope at all times — mirrors
 *          the four-tier routing : library (3b) > faust-fx (2) >
 *          chain (1) > project (0).
 */
function currentUndoScopeLabel(): string {
  const calqueHash = focusedCalqueUIHash();
  if (calqueHash) return `Library (${calqueHash.slice(0, 8)})`;
  const faustFxKey = focusedFaustFxScopeKey();
  if (faustFxKey) return `Faust FX (${faustFxKey.effectId})`;
  const chainKey = focusedChainScopeKey();
  if (chainKey) {
    return chainKey.chainId === TRANSFORM_CHAIN_ID
      ? "Transform Chain"
      : `Chain (${chainKey.chainId})`;
  }
  return "Project";
}

export class FooterView {
  #message: string | null = null;
  #tone: "neutral" | "error" = "neutral";

  // -------------------------------------------------------------------------
  // Read access
  // -------------------------------------------------------------------------

  get message(): string | null {
    return this.#message;
  }

  get tone(): "neutral" | "error" {
    return this.#tone;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Purpose: Write a status message + tone into the footer state. A null message
   *          clears the zone; the next sync will fall back to the latest error
   *          logged (so unrecovered errors stay visible until a new message is set).
   */
  setStatus(message: string | null, tone: "neutral" | "error" = "neutral"): void {
    this.#message = message;
    this.#tone = tone;
  }

  /**
   * Purpose: Render all four footer zones from the current state + derived values.
   * How: Read private fields + demoState.viewport + demoState.project and write
   *      the four DOM nodes. Uses the error-log fallback when no explicit message
   *      is set, so unrecovered errors remain visible.
   */
  sync(elements: Elements): void {
    elements.timelineFooterVersion.textContent = APP_VERSION_LABEL;
    this.#writeMessage(elements);
    this.#writeZoom(elements);
    elements.timelineFooterSampleRate.textContent = formatSampleRateLabel(demoState.project.timebase.sampleRate);
  }

  /**
   * Purpose: Fast path for frame-level render passes (transport ticking, clip
   *          drag) that only need the zoom zone refreshed.
   */
  syncZoomOnly(elements: Elements): void {
    this.#writeZoom(elements);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  #writeMessage(elements: Elements): void {
    // Center zone : an explicit setStatus message wins ; failing that,
    // we fall back to the latest unrecovered error ; failing that, we
    // show the current undo scope so the user always knows where Cmd+Z
    // would land. Explicit messages and errors keep their tone ; the
    // scope label is rendered as neutral ambient information.
    const explicit = this.#message;
    const fallbackError = getLatestFooterErrorMessage();
    let message: string;
    let tone: "neutral" | "error" | "scope";
    if (explicit !== null) {
      message = explicit;
      tone = this.#tone;
    } else if (fallbackError !== null) {
      message = fallbackError;
      tone = "error";
    } else {
      message = `Undo scope : ${currentUndoScopeLabel()}`;
      tone = "scope";
    }
    elements.timelineFooterMessage.textContent = message;
    elements.timelineFooterMessage.hidden = false;
    elements.timelineFooterMessage.dataset.state = tone;
  }

  #writeZoom(elements: Elements): void {
    elements.timelineFooterZoom.textContent = demoState.viewport.timeScale.formatZoomLevel();
  }
}

function formatSampleRateLabel(sampleRate: number): string {
  const kiloHertz = sampleRate / 1000;
  const formatted = Number.isInteger(kiloHertz) ? kiloHertz.toFixed(0) : kiloHertz.toFixed(1);
  return `${formatted} kHz`;
}

function getLatestFooterErrorMessage(): string | null {
  const latestEntry = demoState.logEntries[0] ?? "";
  const errorMarker = "ERROR:";
  const errorIndex = latestEntry.indexOf(errorMarker);
  if (errorIndex < 0) {
    return null;
  }
  return latestEntry.slice(errorIndex).trim();
}
