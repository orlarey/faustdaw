/*********************** fx-resource-code-store.test.ts ***********************
 *
 * Purpose: Check that an FX resource dropped by an undo keeps its code for the
 *          redo, in memory and across a working-session save.
 * How: Drive the real createSessionDocument / applySessionDocument through
 *      the undo/redo sequence of a Faust code edit, then query the store's
 *      history payloads and the id generator.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { initProject } from "../src/domain/project.js";
import { importFxResource } from "../src/fx-chain.js";
import { applySessionDocument, createSessionDocument } from "../demo/session-document.js";
import {
  collectHistoryFxResourcePayloads,
  getFxResourceCodeStore,
  rememberFxResources,
  resetFxResourceCodeStore,
} from "../demo/fx-resource-code-store.js";
import { importDspFileAsEffect } from "../demo/fx-chain/faust-resource.js";
import { demoState } from "../demo/state.js";

const OLD = { id: "fxr-old", name: "gain-aaaaaa", code: "process = _;" };
const NEW = { id: "fxr-new", name: "gain-bbbbbb", code: "process = *(0.5);" };

/** D0: before the code edit; D1: after it (the edit adds an immutable resource). */
function editHistory() {
  const before = importFxResource(initProject("s"), OLD);
  const after = importFxResource(before, NEW);
  const document = (project: typeof before) => createSessionDocument(project, new Map(), 1, new Map());
  return { after, d0: document(before), d1: document(after) };
}

test("without the store, redo after undo restores an empty code (the defect)", () => {
  const { after, d0, d1 } = editHistory();
  const undone = applySessionDocument(after, d0);
  assert.equal(undone.fxResources.has(NEW.id), false);
  assert.equal(applySessionDocument(undone, d1).fxResources.get(NEW.id)?.code, "");
});

test("with the store, redo after undo restores the code of the dropped resource", (t) => {
  t.after(() => resetFxResourceCodeStore());
  resetFxResourceCodeStore();
  const { after, d0, d1 } = editHistory();
  // Undo, as restoreSessionDocument does it: remember, then apply with the store.
  rememberFxResources(after.fxResources.values());
  const undone = applySessionDocument(after, d0, getFxResourceCodeStore());
  // Redo.
  rememberFxResources(undone.fxResources.values());
  const redone = applySessionDocument(undone, d1, getFxResourceCodeStore());
  assert.equal(redone.fxResources.get(NEW.id)?.code, NEW.code);
  assert.equal(redone.fxResources.get(OLD.id)?.code, OLD.code);
});

test("the working-session save carries the code the redo stack needs, once, and only that", (t) => {
  t.after(() => resetFxResourceCodeStore());
  resetFxResourceCodeStore([OLD, NEW]);
  const { after, d0, d1 } = editHistory();
  const undone = applySessionDocument(after, d0, getFxResourceCodeStore());
  // historyPast = [], historyFuture = [d1, d1]: fxr-new is needed, fxr-old is in the project.
  assert.deepEqual(collectHistoryFxResourcePayloads(undone, [d1, d1]), [
    { fxResourceId: NEW.id, fileName: `${NEW.name}.dsp`, code: NEW.code },
  ]);
  assert.deepEqual(collectHistoryFxResourcePayloads(after, [d0, d1]), []);
});

test("an empty code never overwrites a known one; a reset forgets the previous session", () => {
  resetFxResourceCodeStore([NEW]);
  rememberFxResources([{ id: NEW.id, code: "" }]);
  assert.equal(getFxResourceCodeStore().get(NEW.id), NEW.code);
  resetFxResourceCodeStore([{ id: "fxr-1", code: "process = 0;" }]);
  assert.equal(getFxResourceCodeStore().has(NEW.id), false);
  resetFxResourceCodeStore();
});

test("a new FX resource never reuses an id known only to the history", (t) => {
  const savedProject = demoState.project;
  t.after(() => {
    demoState.project = savedProject;
    resetFxResourceCodeStore();
  });
  demoState.project = initProject("s");
  // fxr-1 is absent from the project (dropped by an undo) but referenced by the redo stack.
  resetFxResourceCodeStore([{ id: "fxr-1", code: "process = _ * 0.25;" }]);
  const { effect } = importDspFileAsEffect(new File(["process = _ * 4;"], "loud.dsp"), "process = _ * 4;");
  assert.notEqual(effect.fxResourceId, "fxr-1");
  assert.equal(demoState.project.fxResources.get(effect.fxResourceId)?.code, "process = _ * 4;");
});
