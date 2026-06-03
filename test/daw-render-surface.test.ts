/****************************** daw-render-surface.test.ts ******************************
 *
 * Purpose: Verify the DOM-shell surface owned by the DAW-level renderer.
 * How: Drive it with fake bound elements so the shell updates can be validated
 *      without exercising the full timeline runtime.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { DAWRenderSurface } from "../demo/daw-render/daw-render-surface.js";

function buildElements() {
  return {
    cursorTime: { value: "" },
    playButton: {
      textContent: "",
      attributes: {} as Record<string, string>,
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      },
    },
    zoomIndicator: { hidden: false },
  };
}

test("DAWRenderSurface syncs transport fields and hides the zoom indicator", () => {
  const elements = buildElements();
  const surface = DAWRenderSurface.fromElements(elements as never);

  surface.syncTransportFields({
    timecode: "00:00:01.000",
    isPlaying: true,
    activeElement: null,
  });
  surface.hideZoomIndicator();

  assert.equal(elements.cursorTime.value, "00:00:01.000");
  assert.equal(elements.playButton.textContent, "Playing");
  assert.equal(elements.playButton.attributes["aria-pressed"], "true");
  assert.equal(elements.zoomIndicator.hidden, true);
});

test("DAWRenderSurface leaves the cursor input untouched while it is active", () => {
  const elements = buildElements();
  elements.cursorTime.value = "keep-me";
  const surface = DAWRenderSurface.fromElements(elements as never);

  surface.syncTransportFields({
    timecode: "ignored",
    isPlaying: false,
    activeElement: elements.cursorTime as never,
  });

  assert.equal(elements.cursorTime.value, "keep-me");
  assert.equal(elements.playButton.textContent, "Play");
  assert.equal(elements.playButton.attributes["aria-pressed"], "false");
});
