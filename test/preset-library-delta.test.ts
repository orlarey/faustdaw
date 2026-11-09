/*************************** preset-library-delta.test.ts **********************
 *
 * Purpose: Check that an OrbitUI library change is written as its own delta,
 *          so a tab never deletes or reverts presets it did not touch.
 * How: Drive indexLibrary / computeLibraryDelta over add, rename, recency
 *      bump, delete, undo, foreign uiHash, and the two-tab sequence where
 *      each tab only knows its own preset.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { computeLibraryDelta, indexLibrary, type LibraryPreset } from "../demo/preset-library-delta.js";

const UI = "ui-1";

function preset(configHash: string, lastSeenAt: number, name?: string, uiHash = UI): LibraryPreset {
  return { uiHash, configHash, configuration: { "/g/gain": lastSeenAt }, lastSeenAt, ...(name !== undefined ? { name } : {}) };
}

function delta(previous: LibraryPreset[], next: LibraryPreset[]) {
  const d = computeLibraryDelta(indexLibrary(previous, UI), indexLibrary(next, UI));
  return { upserts: d.upserts.map((r) => r.configHash), deletes: [...d.deletes] };
}

test("no change gives an empty delta", () => {
  const a = preset("a", 1, "A");
  assert.deepEqual(delta([a], [a]), { upserts: [], deletes: [] });
});

test("an added preset is upserted, nothing deleted", () => {
  assert.deepEqual(delta([preset("a", 1)], [preset("a", 1), preset("b", 2)]), { upserts: ["b"], deletes: [] });
});

test("a rename or a recency bump is upserted", () => {
  assert.deepEqual(delta([preset("a", 1)], [preset("a", 1, "Named")]), { upserts: ["a"], deletes: [] });
  assert.deepEqual(delta([preset("a", 1)], [preset("a", 5)]), { upserts: ["a"], deletes: [] });
});

test("a removed preset is deleted", () => {
  assert.deepEqual(delta([preset("a", 1), preset("b", 2)], [preset("a", 1)]), { upserts: [], deletes: ["b"] });
});

test("records of another uiHash are ignored", () => {
  assert.deepEqual(delta([], [preset("x", 1, undefined, "ui-2")]), { upserts: [], deletes: [] });
});

test("two tabs that each add a preset never delete the other's", () => {
  // Store: {}. Tab A and tab B both loaded the empty library.
  const store = new Map<string, LibraryPreset>();
  const apply = (previous: LibraryPreset[], next: LibraryPreset[]) => {
    const d = computeLibraryDelta(indexLibrary(previous, UI), indexLibrary(next, UI));
    for (const r of d.upserts) store.set(r.configHash, r);
    for (const h of d.deletes) store.delete(h);
  };
  const pa = preset("pa", 1, "PA");
  const pb = preset("pb", 2, "PB");
  const pa2 = preset("pa2", 3, "PA2");
  apply([], [pa]); // tab A saves PA
  apply([], [pb]); // tab B, unaware of PA, saves PB
  apply([pa], [pa, pa2]); // tab A, unaware of PB, saves PA2
  assert.deepEqual([...store.keys()].sort(), ["pa", "pa2", "pb"]);
  apply([pa, pa2], [pa]); // tab A undoes PA2
  assert.deepEqual([...store.keys()].sort(), ["pa", "pb"]);
});

test("a tab never reverts another tab's rename it did not touch", () => {
  // Tab B loaded {a: "Old"}; tab A renamed a to "New" in the store since.
  // Tab B now adds b: only b is written, a keeps "New".
  assert.deepEqual(delta([preset("a", 1, "Old")], [preset("a", 1, "Old"), preset("b", 2)]), { upserts: ["b"], deletes: [] });
});
