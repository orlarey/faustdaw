/****************************** tab-identity.test.ts ***************************
 *
 * Purpose: Check when a page reuses its tab's id (a reload) and when it must
 *          not (a duplicated tab whose source page is still alive).
 * How: Drive resolveTabId / markTabIdReleased / clearTabIdReleased over an
 *      in-memory Storage, the way sessionStorage behaves across those cases.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import {
  clearTabIdReleased,
  markTabIdReleased,
  resolveTabId,
  type TabIdentityStorage,
} from "../demo/tab-identity.js";

function memoryStorage(): TabIdentityStorage & { snapshot(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    snapshot: () => new Map(map),
  };
}

function idFactory() {
  let n = 0;
  return () => `tab-${++n}`;
}

test("a reload reuses the tab id (its pagehide marked it released)", () => {
  const storage = memoryStorage(); const createId = idFactory();
  const first = resolveTabId(storage, createId);
  markTabIdReleased(storage, first); // pagehide of the first page
  assert.equal(resolveTabId(storage, createId), first);
});

test("the release mark is consumed: a second page without pagehide gets a new id", () => {
  const storage = memoryStorage(); const createId = idFactory();
  const first = resolveTabId(storage, createId);
  markTabIdReleased(storage, first);
  assert.equal(resolveTabId(storage, createId), first);
  // No pagehide in between (the page is still alive): never the same id twice.
  assert.notEqual(resolveTabId(storage, createId), first);
});

test("a duplicated tab (storage copied while the source page is alive) gets a new id", () => {
  const source = memoryStorage(); const createId = idFactory();
  const sourceId = resolveTabId(source, createId);
  const copy = memoryStorage();
  for (const [key, value] of source.snapshot()) copy.setItem(key, value);
  assert.notEqual(resolveTabId(copy, createId), sourceId);
});

test("a page restored from the back-forward cache clears the mark, so a later duplicate gets a new id", () => {
  const storage = memoryStorage(); const createId = idFactory();
  const id = resolveTabId(storage, createId);
  markTabIdReleased(storage, id);   // pagehide (persisted)
  clearTabIdReleased(storage);      // pageshow (persisted): the same page is alive again
  const copy = memoryStorage();
  for (const [key, value] of storage.snapshot()) copy.setItem(key, value);
  assert.notEqual(resolveTabId(copy, createId), id);
});

test("without storage, or when it throws, every page gets a fresh id", () => {
  const createId = idFactory();
  assert.equal(resolveTabId(null, createId), "tab-1");
  const throwing: TabIdentityStorage = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
    removeItem: () => { throw new Error("denied"); },
  };
  assert.equal(resolveTabId(throwing, createId), "tab-2");
  assert.doesNotThrow(() => markTabIdReleased(throwing, "tab-2"));
});
