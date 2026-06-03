/******************************** daw-render/daw-render-surface.ts ********************************
 *
 * Purpose: Represent the DOM-backed surface owned by the global DAW renderer above the timeline scene.
 * How: Wrap the bound demo elements and expose only DAW-level shell operations such as transport-field
 *      sync, footer updates, zoom-indicator visibility, viewport sync, and access to the timeline scene surface.
 *
 ******************************************************************************/
import type { Elements } from "../bind-elements.js";
import { View } from "../view/view.js";
import { TimelineSceneSurface } from "../timeline/timeline-scene-surface.js";

export class DAWRenderSurface {
  readonly #elements: Elements;
  readonly #timelineSceneSurface: TimelineSceneSurface;

  private constructor(elements: Elements) {
    this.#elements = elements;
    this.#timelineSceneSurface = TimelineSceneSurface.fromElements(elements);
  }

  static fromElements(elements: Elements): DAWRenderSurface {
    return new DAWRenderSurface(elements);
  }

  timelineSceneSurface(): TimelineSceneSurface {
    return this.#timelineSceneSurface;
  }

  syncTransportFields(input: {
    timecode: string;
    isPlaying: boolean;
    activeElement?: Element | null;
  }): void {
    const activeElement = input.activeElement ?? (typeof document === "undefined" ? null : document.activeElement);
    if (activeElement !== this.#elements.cursorTime) {
      this.#elements.cursorTime.value = input.timecode;
    }
    this.#elements.playButton.textContent = input.isPlaying ? "Playing" : "Play";
    this.#elements.playButton.setAttribute("aria-pressed", String(input.isPlaying));
  }

  hideZoomIndicator(): void {
    this.#elements.zoomIndicator.hidden = true;
  }

  syncExactTimelineViewport(): void {
    View.syncExactTimelineViewport(this.#elements);
  }
}
