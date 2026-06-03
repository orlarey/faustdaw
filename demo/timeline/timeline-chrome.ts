/******************************** timeline/timeline-chrome.ts ********************************
 *
 * Purpose: Own the small DOM-facing chrome state rendered above the timeline surfaces.
 * How: Build one immutable chrome state from timeline interaction flags,
 *      then apply it to overlays and ruler labels.
 *
 ******************************************************************************/
import type { Elements } from "../bind-elements.js";
import type { Timebase } from "../../src/domain/timebase.js";
import { formatCurrentAbsoluteTimeLabel } from "../format.js";

export type TimelineChromeState = {
  negativeOverlayWidthPx: number;
  cursorDragFeedbackText: string | null;
  rulerDragging: boolean;
  rulerLabelsHidden: boolean;
  rulerLabelsWidthPx: number;
};

// Purpose: Represent the timeline chrome as one public ADT instead of scattered DOM mutations.
// How: Build one immutable state object, then render that state into the corresponding DOM nodes.
export class TimelineChrome {
  // Purpose: Build the current chrome state from timeline interaction flags.
  // How: Format the cursor label once and normalize the DOM booleans that the renderer needs to apply.
  static buildState(input: {
    negativeOverlayWidthPx: number;
    cursorCoord: number;
    timebase: Timebase;
    pixelsPerSample: number;
    cursorDragActive: boolean;
    rulerDragging: boolean;
    rulerLabelsHidden: boolean;
    rulerLabelsWidthPx: number;
  }): TimelineChromeState {
    return {
      negativeOverlayWidthPx: input.negativeOverlayWidthPx,
      cursorDragFeedbackText: input.cursorDragActive
        ? formatCurrentAbsoluteTimeLabel(input.cursorCoord, input.timebase, input.pixelsPerSample)
        : null,
      rulerDragging: input.rulerDragging,
      rulerLabelsHidden: input.rulerLabelsHidden,
      rulerLabelsWidthPx: input.rulerLabelsWidthPx,
    };
  }

  // Purpose: Apply one chrome state to the timeline DOM.
  // How: Update the overlay widths and ruler labels owned by the timeline chrome.
  static render(elements: Elements, state: TimelineChromeState): void {
    elements.timelineGridNegativeOverlay.style.width = `${state.negativeOverlayWidthPx.toFixed(4)}px`;
    elements.timelineRulerNegativeOverlay.style.width = `${state.negativeOverlayWidthPx.toFixed(4)}px`;
    elements.timelineRuler.classList.toggle("dragging", state.rulerDragging);
    elements.timelineRulerLabels.hidden = state.rulerLabelsHidden;
    elements.timelineRulerLabels.style.width = `${state.rulerLabelsWidthPx.toFixed(4)}px`;
  }
}
