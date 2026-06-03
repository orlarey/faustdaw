/**
 * Purpose: Provide a visual Marker component for the timeline.
 * How: Each Marker instance owns its DOM elements and manages its visual state.
 *      The containing structure (marker-manager) handles all interactions:
 *      hit-test, drag, auto-scroll, and position projection (coord→pixel).
 *      Icons use Material Symbols Outlined for visual consistency across the DAW.
 */
import type { TimeCoord } from "../../src/domain/timebase.js";

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * Purpose: Identify one marker instance across the application.
 */
export type MarkerId = string;

let markerIdCounter = 0;

/**
 * Purpose: Generate a unique MarkerId.
 */
function nextMarkerId(): MarkerId {
  return `marker-${++markerIdCounter}`;
}

// ---------------------------------------------------------------------------
// Appearance types
// ---------------------------------------------------------------------------

/**
 * Purpose: Name a Material Symbols icon to render inside the marker handle.
 * How: Any valid Material Symbols icon name (e.g. "diamond", "flag", "bookmark",
 *      "play_arrow"). See https://fonts.google.com/icons for the full catalog.
 */
export type MarkerIcon = string;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Purpose: Describe the full set of properties that define a Marker at creation.
 */
export type MarkerConfig = {
  position: TimeCoord;
  label: string | null;
  active: boolean;
  visible: boolean;
  draggable: boolean;
  deletable: boolean;
  editable: boolean;
  snappable: boolean;
  icon: MarkerIcon;
  iconSize: number;
  color: string;
  height: "full" | "ruler";
  zOrder: number;
  cssClass?: string;
}

// ---------------------------------------------------------------------------
// Marker class
// ---------------------------------------------------------------------------

/**
 * Purpose: Visual timeline marker component.
 * How: Creates its own DOM elements, manages visual state (active, visible,
 *      drag feedback). Does NOT handle pointer events or coordinate conversion.
 *      The container (marker-manager) handles all interactions.
 */
export class Marker {
  readonly id: MarkerId;

  private _position: TimeCoord;
  private _label: string | null;
  private _active: boolean;
  private _visible: boolean;

  readonly draggable: boolean;
  readonly deletable: boolean;
  readonly editable: boolean;
  readonly snappable: boolean;
  readonly icon: MarkerIcon;
  readonly color: string;
  readonly height: "full" | "ruler";
  readonly zOrder: number;

  // DOM — exposed to the container for hit-test and insertion
  private readonly _root: HTMLDivElement;
  private readonly _iconEl: HTMLSpanElement;
  private readonly lineEl: HTMLDivElement;
  private readonly labelEl: HTMLDivElement | null;
  private readonly feedbackEl: HTMLDivElement | null;

  constructor(config: MarkerConfig) {
    this.id = nextMarkerId();
    this._position = config.position;
    this._label = config.label;
    this._active = config.active;
    this._visible = config.visible;
    this.draggable = config.draggable;
    this.deletable = config.deletable;
    this.editable = config.editable;
    this.snappable = config.snappable;
    this.icon = config.icon;
    this.color = config.color;
    this.height = config.height;
    this.zOrder = config.zOrder;

    // --- Build DOM ---
    this._root = document.createElement("div");
    this._root.classList.add("marker");
    if (config.cssClass) this._root.classList.add(config.cssClass);
    this._root.style.position = "absolute";
    this._root.style.top = "0";
    this._root.style.bottom = "0";
    this._root.style.zIndex = String(this.zOrder);
    this._root.style.pointerEvents = "none";

    // Vertical line
    this.lineEl = document.createElement("div");
    this.lineEl.classList.add("marker-line");
    this.lineEl.style.position = "absolute";
    this.lineEl.style.width = "1px";
    this.lineEl.style.backgroundColor = this.color;
    if (this.height === "full") {
      // Line spans from below the ruler (68px) to the bottom of the board.
      this.lineEl.style.top = "68px";
      this.lineEl.style.bottom = "0";
    } else {
      // Line spans within the ruler only.
      this.lineEl.style.top = "0";
      this.lineEl.style.height = "68px";
    }
    this._root.appendChild(this.lineEl);

    // Icon (Material Symbols handle)
    this._iconEl = document.createElement("span");
    this._iconEl.classList.add("material-symbols-outlined", "marker-icon");
    this._iconEl.textContent = this.icon;
    this._iconEl.style.position = "absolute";
    this._iconEl.style.pointerEvents = "auto";
    this._iconEl.style.cursor = !this._active ? "default" : this.draggable ? "ew-resize" : "pointer";
    this._iconEl.style.color = this.color;
    this._iconEl.style.fontSize = `${config.iconSize}px`;
    this._iconEl.style.lineHeight = "1";
    this._iconEl.style.transform = "translateX(-50%)";
    this._iconEl.style.userSelect = "none";
    // Position the icon handle inside the ruler area.
    this._iconEl.style.top = this.height === "full" ? "28px" : "10px";
    this._root.appendChild(this._iconEl);

    // Label (only if the marker has one)
    if (this._label !== null) {
      this.labelEl = document.createElement("div");
      this.labelEl.classList.add("marker-label");
      this.labelEl.textContent = this._label;
      this.labelEl.style.position = "absolute";
      this.labelEl.style.whiteSpace = "nowrap";
      this.labelEl.style.fontSize = "10px";
      this.labelEl.style.color = this.color;
      this.labelEl.style.transform = "translateX(-50%)";
      this.labelEl.style.top = `${config.iconSize + 2}px`;
      this._root.appendChild(this.labelEl);
    } else {
      this.labelEl = null;
    }

    // Drag feedback (only for draggable markers)
    if (this.draggable) {
      this.feedbackEl = document.createElement("div");
      this.feedbackEl.classList.add("marker-feedback");
      this.feedbackEl.style.position = "absolute";
      this.feedbackEl.style.whiteSpace = "nowrap";
      this.feedbackEl.style.fontSize = "0.72rem";
      this.feedbackEl.style.fontFamily = "var(--mono, monospace)";
      this.feedbackEl.style.padding = "4px 8px";
      this.feedbackEl.style.borderRadius = "999px";
      this.feedbackEl.style.background = "rgba(8, 13, 22, 0.92)";
      this.feedbackEl.style.color = "var(--ink, #e0e8f0)";
      this.feedbackEl.style.top = "8px";
      this.feedbackEl.style.left = "14px";
      this.feedbackEl.style.display = "none";
      this.feedbackEl.style.pointerEvents = "none";
      this._root.appendChild(this.feedbackEl);
    } else {
      this.feedbackEl = null;
    }

    // --- Apply initial state ---
    this.applyVisibility();
    this.applyActive();
  }

  // --- Public accessors ---

  get position(): TimeCoord {
    return this._position;
  }

  get label(): string | null {
    return this._label;
  }

  get active(): boolean {
    return this._active;
  }

  get visible(): boolean {
    return this._visible;
  }

  /** The root DOM element for insertion into the container. */
  get rootElement(): HTMLDivElement {
    return this._root;
  }

  /** The icon DOM element for hit-testing and pointer capture by the container. */
  get iconElement(): HTMLSpanElement {
    return this._iconEl;
  }

  // --- Public methods (called by the container) ---

  /**
   * Purpose: Set the marker's position and pixel offset.
   * How: The container computes the pixel from the coord and passes both.
   */
  update(position: TimeCoord, leftPx: number): void {
    this._position = position;
    this._root.style.transform = `translateX(${leftPx}px)`;
  }

  /**
   * Purpose: Activate or deactivate the marker.
   */
  setActive(active: boolean): void {
    this._active = active;
    this.applyActive();
    this._iconEl.style.cursor = !active ? "default" : this.draggable ? "ew-resize" : "pointer";
  }

  /**
   * Purpose: Show or hide the marker.
   */
  setVisible(visible: boolean): void {
    this._visible = visible;
    this.applyVisibility();
  }

  /**
   * Purpose: Change the marker's label.
   */
  setLabel(label: string): void {
    if (!this.editable) return;
    this._label = label;
    if (this.labelEl) {
      this.labelEl.textContent = label;
    }
  }

  /**
   * Purpose: Show or hide drag feedback text (e.g. formatted time during drag).
   * How: When text is provided, the feedback element is shown; when null, it is hidden.
   */
  setDragFeedback(text: string | null): void {
    if (!this.feedbackEl) return;
    if (text === null) {
      this.feedbackEl.style.display = "none";
    } else {
      this.feedbackEl.textContent = text;
      this.feedbackEl.style.display = "";
    }
  }

  /**
   * Purpose: Remove the marker's DOM elements from the document.
   */
  destroy(): void {
    this._root.remove();
  }

  // --- Private: DOM state ---

  private applyVisibility(): void {
    this._root.hidden = !this._visible;
  }

  private applyActive(): void {
    this._root.classList.toggle("marker--inactive", !this._active);
    this._iconEl.style.pointerEvents = this._active ? "auto" : "none";
  }
}

// ---------------------------------------------------------------------------
// Specialized constructors
// ---------------------------------------------------------------------------

/**
 * Purpose: Create the cursor marker (always visible, draggable, not deletable).
 * How: Uses the "diamond" Material Symbol as the playhead handle icon.
 */
export function makeCursorMarker(): Marker {
  return new Marker({
    position: 0 as TimeCoord,
    label: null,
    active: true,
    visible: true,
    draggable: true,
    deletable: false,
    editable: false,
    snappable: true,
    icon: "diamond",
    iconSize: 18,
    color: "#ffffff",
    height: "full",
    zOrder: 100,
    cssClass: "marker--cursor",
  });
}

/**
 * Purpose: Create the last-play-start marker (visible, not draggable, not deletable).
 * How: Uses "arrow_menu_open" as the icon (rightward arrow indicating play start).
 */
export function makeLastPlayMarker(position: TimeCoord): Marker {
  return new Marker({
    position,
    label: null,
    active: false,
    visible: true,
    draggable: false,
    deletable: false,
    editable: false,
    snappable: false,
    icon: "arrow_menu_open",
    iconSize: 18,
    color: "#ffffff",
    height: "full",
    zOrder: 10,
  });
}

/**
 * Purpose: Create the loop-end marker shown during play-selection looping.
 * How: Uses "arrow_menu_close" as the icon (leftward arrow indicating loop-back point).
 */
export function makeLoopEndMarker(position: TimeCoord): Marker {
  return new Marker({
    position,
    label: null,
    active: false,
    visible: true,
    draggable: false,
    deletable: false,
    editable: false,
    snappable: false,
    icon: "arrow_menu_close",
    iconSize: 18,
    color: "#ffffff",
    height: "full",
    zOrder: 10,
  });
}

/**
 * Purpose: Create a cut marker for splitting clips at a given position.
 * How: Uses "content_cut" Material Symbol, orange color, full height.
 */
export function makeCutMarker(): Marker {
  return new Marker({
    position: 0 as TimeCoord,
    label: null,
    active: true,
    visible: true,
    draggable: true,
    deletable: false,
    editable: false,
    snappable: true,
    icon: "content_cut",
    iconSize: 18,
    color: "#f97316",
    height: "full",
    zOrder: 90,
    cssClass: "marker--cut",
  });
}

/**
 * Purpose: Create a user cue-point marker (draggable, deletable, editable label).
 * How: Uses "flag" as the icon.
 */
export function makeCueMarker(position: TimeCoord, label: string): Marker {
  return new Marker({
    position,
    label,
    active: true,
    visible: true,
    draggable: true,
    deletable: true,
    editable: true,
    snappable: true,
    icon: "flag",
    iconSize: 16,
    color: "#f59e0b",
    height: "ruler",
    zOrder: 50,
  });
}
