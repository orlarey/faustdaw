/****************************** bind-elements.ts *******************************
 *
 * Purpose: Resolve and type-check all DOM elements the demo harness relies on.
 * How: Query each element by id at startup, assert its concrete HTML type, and
 *      return a strongly typed collection so downstream code never casts.
 *
 ******************************************************************************/

/**
 * Purpose: Describe the complete set of DOM handles used across the demo.
 * How: Map each logical UI control to its concrete HTML element type.
 */
export type Elements = {
  sessionDragHandle: HTMLButtonElement;
  sessionCombo: HTMLElement;
  sessionNameInput: HTMLInputElement;
  sessionMenuButton: HTMLButtonElement;
  sessionMenu: HTMLElement;
  deleteSessionButton: HTMLButtonElement;
  transportReturnButton: HTMLButtonElement;
  loadSessionButton: HTMLButtonElement;
  loadSessionInput: HTMLInputElement;
  saveSessionButton: HTMLButtonElement;
  exportMixdownButton: HTMLButtonElement;
  shortcutsButton: HTMLButtonElement;
  shortcutsPanel: HTMLElement;
  tutorialOverlay: HTMLElement;
  tutorialOverlayBackdrop: HTMLElement;
  tutorialOverlayClose: HTMLButtonElement;
  overlayTutorialLeft: HTMLVideoElement;
  overlayTutorialRight: HTMLVideoElement;
  cursorForm: HTMLFormElement;
  cursorTime: HTMLInputElement;
  playButton: HTMLButtonElement;
  timelineSharedGrid: HTMLCanvasElement;
  timelineRulerNegativeOverlay: HTMLElement;
  timelineGridNegativeOverlay: HTMLElement;
  markerLayer: HTMLElement;
  timelineRuler: HTMLElement;
  timelineRulerLabels: HTMLElement;
  timelineGrid: HTMLElement;
  dragOverlayLayer: HTMLElement;
  selectionRectangle: HTMLElement;
  clipContextMenu: HTMLElement;
  clipContextRename: HTMLButtonElement;
  clipContextSplit: HTMLButtonElement;
  clipContextMerge: HTMLButtonElement;
  clipContextCrossfade: HTMLButtonElement;
  clipContextReverse: HTMLButtonElement;
  clipContextPlay: HTMLButtonElement;
  clipContextDelete: HTMLButtonElement;
  clipContextSourceSeparator: HTMLElement;
  clipContextOpenSource: HTMLButtonElement;
  clipContextUpdateSource: HTMLButtonElement;
  clipOnsetPanel: HTMLElement;
  clipOnsetTitle: HTMLElement;
  clipOnsetStatus: HTMLElement;
  clipOnsetSensitivity: HTMLInputElement;
  clipOnsetSensitivityValue: HTMLOutputElement;
  clipOnsetSpacing: HTMLInputElement;
  clipOnsetSpacingValue: HTMLOutputElement;
  clipOnsetRefine: HTMLInputElement;
  clipOnsetApply: HTMLButtonElement;
  clipOnsetExplode: HTMLButtonElement;
  clipOnsetCancel: HTMLButtonElement;
  trackStrips: HTMLElement[];
  masterStrip: HTMLElement;
  masterVolumeSlider: HTMLInputElement;
  masterVolumeValue: HTMLOutputElement;
  timelineFooterVersion: HTMLElement;
  timelineFooterMessage: HTMLElement;
  timelineFooterZoom: HTMLElement;
  timelineFooterSampleRate: HTMLElement;
  trackFxButtons: HTMLButtonElement[];
  fxPanel: HTMLElement;
  fxPanelTrackLabel: HTMLElement;
  fxPanelList: HTMLElement;
  fxPanelNew: HTMLButtonElement;
  fxPanelClose: HTMLButtonElement;
  clipContextFaustTransform: HTMLButtonElement;
  transformPanel: HTMLElement;
  transformPanelStatus: HTMLElement;
  transformPanelList: HTMLElement;
  transformPanelApply: HTMLButtonElement;
  transformPanelCancel: HTMLButtonElement;
  transformPanelNew: HTMLButtonElement;
  transformPanelClose: HTMLButtonElement;
  faustEditor: HTMLElement;
  faustEditorTitle: HTMLElement;
  faustEditorChannels: HTMLElement;
  faustEditorClose: HTMLButtonElement;
  faustEditorCodeMirror: HTMLElement;
  faustEditorError: HTMLElement;
  faustEditorAutoCompile: HTMLInputElement;
  faustEditorCompile: HTMLButtonElement;
  faustEditorRevert: HTMLButtonElement;
  faustEditorCloseBtn: HTMLButtonElement;
  trackMuteButtons: HTMLButtonElement[];
  trackSoloButtons: HTMLButtonElement[];
  trackVolumeSliders: HTMLInputElement[];
  trackVolumeValues: HTMLOutputElement[];
  trackPanSliders: HTMLInputElement[];
  trackPanValues: HTMLOutputElement[];
  zoomIndicator: HTMLElement;
};

/**
 * Purpose: Fetch a DOM node with a runtime type check so the harness can rely on strongly typed elements.
 * How: Resolve the element by id, verify it is an instance of the expected constructor, and throw otherwise.
 */
function getById<T extends typeof Element>(
  id: string,
  expectedType: T,
): InstanceType<T> {
  const element = document.getElementById(id);
  if (!element || !(element instanceof expectedType)) {
    throw new Error(`Missing or invalid element: ${id}`);
  }

  return element as InstanceType<T>;
}

/**
 * Purpose: Read required DOM elements once and fail early if the harness markup is broken.
 * How: Query each known element by id and assert its concrete DOM type before returning the typed collection.
 */
export function bindElements(): Elements {
  return {
    sessionDragHandle: getById("session-drag-handle", HTMLButtonElement),
    sessionCombo: getById("session-combo", HTMLElement),
    sessionNameInput: getById("session-name-input", HTMLInputElement),
    sessionMenuButton: getById("session-menu-button", HTMLButtonElement),
    sessionMenu: getById("session-menu", HTMLElement),
    deleteSessionButton: getById("delete-session", HTMLButtonElement),
    transportReturnButton: getById("transport-return", HTMLButtonElement),
    loadSessionButton: getById("load-session", HTMLButtonElement),
    loadSessionInput: getById("load-session-input", HTMLInputElement),
    saveSessionButton: getById("save-session", HTMLButtonElement),
    exportMixdownButton: getById("export-mixdown", HTMLButtonElement),
    shortcutsButton: getById("shortcuts-button", HTMLButtonElement),
    shortcutsPanel: getById("shortcuts-panel", HTMLElement),
    tutorialOverlay: getById("tutorial-overlay", HTMLElement),
    tutorialOverlayBackdrop: getById("tutorial-overlay-backdrop", HTMLElement),
    tutorialOverlayClose: getById("tutorial-overlay-close", HTMLButtonElement),
    overlayTutorialLeft: getById("overlay-tutorial-left", HTMLVideoElement),
    overlayTutorialRight: getById("overlay-tutorial-right", HTMLVideoElement),
    cursorForm: getById("cursor-form", HTMLFormElement),
    cursorTime: getById("cursor-time", HTMLInputElement),
    playButton: getById("play", HTMLButtonElement),
    timelineSharedGrid: getById("timeline-shared-grid", HTMLCanvasElement),
    timelineRulerNegativeOverlay: getById("timeline-ruler-negative-overlay", HTMLElement),
    timelineGridNegativeOverlay: getById("timeline-grid-negative-overlay", HTMLElement),
    markerLayer: getById("marker-layer", HTMLElement),
    timelineRuler: getById("timeline-ruler", HTMLElement),
    timelineRulerLabels: getById("timeline-ruler-labels", HTMLElement),
    timelineGrid: getById("timeline-grid", HTMLElement),
    dragOverlayLayer: getById("drag-overlay-layer", HTMLElement),
    selectionRectangle: getById("selection-rectangle", HTMLElement),
    clipContextMenu: getById("clip-context-menu", HTMLElement),
    clipContextRename: getById("clip-context-rename", HTMLButtonElement),
    clipContextSplit: getById("clip-context-split", HTMLButtonElement),
    clipContextMerge: getById("clip-context-merge", HTMLButtonElement),
    clipContextCrossfade: getById("clip-context-crossfade", HTMLButtonElement),
    clipContextReverse: getById("clip-context-reverse", HTMLButtonElement),
    clipContextPlay: getById("clip-context-play", HTMLButtonElement),
    clipContextDelete: getById("clip-context-delete", HTMLButtonElement),
    clipContextSourceSeparator: getById("clip-context-source-separator", HTMLElement),
    clipContextOpenSource: getById("clip-context-open-source", HTMLButtonElement),
    clipContextUpdateSource: getById("clip-context-update-source", HTMLButtonElement),
    clipOnsetPanel: getById("clip-onset-panel", HTMLElement),
    clipOnsetTitle: getById("clip-onset-title", HTMLElement),
    clipOnsetStatus: getById("clip-onset-status", HTMLElement),
    clipOnsetSensitivity: getById("clip-onset-sensitivity", HTMLInputElement),
    clipOnsetSensitivityValue: getById("clip-onset-sensitivity-value", HTMLOutputElement),
    clipOnsetSpacing: getById("clip-onset-spacing", HTMLInputElement),
    clipOnsetSpacingValue: getById("clip-onset-spacing-value", HTMLOutputElement),
    clipOnsetRefine: getById("clip-onset-refine", HTMLInputElement),
    clipOnsetApply: getById("clip-onset-apply", HTMLButtonElement),
    clipOnsetExplode: getById("clip-onset-explode", HTMLButtonElement),
    clipOnsetCancel: getById("clip-onset-cancel", HTMLButtonElement),
    trackStrips: Array.from(document.querySelectorAll<HTMLElement>(".track-strip")),
    masterStrip: getById("master-strip", HTMLElement),
    masterVolumeSlider: getById("master-volume-slider", HTMLInputElement),
    masterVolumeValue: getById("master-volume-value", HTMLOutputElement),
    timelineFooterVersion: getById("timeline-footer-version", HTMLElement),
    timelineFooterMessage: getById("timeline-footer-message", HTMLElement),
    timelineFooterZoom: getById("timeline-footer-zoom", HTMLElement),
    timelineFooterSampleRate: getById("timeline-footer-sample-rate", HTMLElement),
    clipContextFaustTransform: getById("clip-context-faust-transform", HTMLButtonElement),
    transformPanel: getById("transform-panel", HTMLElement),
    transformPanelStatus: getById("transform-panel-status", HTMLElement),
    transformPanelList: getById("transform-panel-list", HTMLElement),
    transformPanelApply: getById("transform-panel-apply", HTMLButtonElement),
    transformPanelCancel: getById("transform-panel-cancel", HTMLButtonElement),
    transformPanelNew: getById("transform-panel-new", HTMLButtonElement),
    transformPanelClose: getById("transform-panel-close", HTMLButtonElement),
    faustEditor: getById("faust-editor", HTMLElement),
    faustEditorTitle: getById("faust-editor-title", HTMLElement),
    faustEditorChannels: getById("faust-editor-channels", HTMLElement),
    faustEditorClose: getById("faust-editor-close", HTMLButtonElement),
    faustEditorCodeMirror: getById("faust-editor-codemirror", HTMLElement),
    faustEditorError: getById("faust-editor-error", HTMLElement),
    faustEditorAutoCompile: getById("faust-editor-autocompile", HTMLInputElement),
    faustEditorCompile: getById("faust-editor-compile", HTMLButtonElement),
    faustEditorRevert: getById("faust-editor-revert", HTMLButtonElement),
    faustEditorCloseBtn: getById("faust-editor-close-btn", HTMLButtonElement),
    trackFxButtons: Array.from(document.querySelectorAll<HTMLButtonElement>(".track-fx-button")),
    fxPanel: getById("fx-panel", HTMLElement),
    fxPanelTrackLabel: getById("fx-panel-track-label", HTMLElement),
    fxPanelList: getById("fx-panel-list", HTMLElement),
    fxPanelNew: getById("fx-panel-new", HTMLButtonElement),
    fxPanelClose: getById("fx-panel-close", HTMLButtonElement),
    trackMuteButtons: Array.from(document.querySelectorAll<HTMLButtonElement>(".track-mute-button")),
    trackSoloButtons: Array.from(document.querySelectorAll<HTMLButtonElement>(".track-solo-button")),
    trackVolumeSliders: Array.from(document.querySelectorAll<HTMLInputElement>(".track-volume-slider")),
    trackVolumeValues: Array.from(document.querySelectorAll<HTMLOutputElement>(".track-volume-value")),
    trackPanSliders: Array.from(document.querySelectorAll<HTMLInputElement>(".track-pan-slider")),
    trackPanValues: Array.from(document.querySelectorAll<HTMLOutputElement>(".track-pan-value")),
    zoomIndicator: getById("zoom-indicator", HTMLElement),
  };
}
