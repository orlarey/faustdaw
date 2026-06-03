/**************************** preset-storage.test.ts ***************************
 *
 * Purpose: Verify the pure helpers exposed by preset-storage.ts. Focus on
 *          `computeConfigHash`, which must produce a stable hash invariant
 *          to key-insertion order and sensitive to any value change.
 * How: Node `test` runner with `assert/strict`. Uses the global Web Crypto
 *      subtle API available since Node 19.
 *
 *   IDB-backed functions (loadTrajectory, saveTrajectory, …) are not covered
 *   here because Node has no IndexedDB. They are exercised manually in the
 *   browser or through a future integration suite backed by fake-indexeddb.
 *
 ******************************************************************************/
import test from "node:test";
import assert from "node:assert/strict";

import { computeCodeHash, computeConfigHash } from "../demo/preset-storage.js";

test("computeConfigHash is stable across re-computation", async () => {
  const config = { "/a": 0.25, "/b": 0.75 };
  const first = await computeConfigHash(config);
  const second = await computeConfigHash(config);
  assert.equal(first, second);
});

test("computeConfigHash is independent of key-insertion order", async () => {
  const a = { "/x": 1, "/y": 2, "/z": 3 };
  const b = { "/z": 3, "/x": 1, "/y": 2 };
  const hashA = await computeConfigHash(a);
  const hashB = await computeConfigHash(b);
  assert.equal(hashA, hashB);
});

test("computeConfigHash changes when any value changes", async () => {
  const base = { "/a": 0.5, "/b": 0.5 };
  const tweaked = { "/a": 0.5, "/b": 0.5001 };
  const hashBase = await computeConfigHash(base);
  const hashTweaked = await computeConfigHash(tweaked);
  assert.notEqual(hashBase, hashTweaked);
});

test("computeConfigHash changes when a key is added or removed", async () => {
  const small = { "/a": 1 };
  const large = { "/a": 1, "/b": 0 };
  const hashSmall = await computeConfigHash(small);
  const hashLarge = await computeConfigHash(large);
  assert.notEqual(hashSmall, hashLarge);
});

test("computeConfigHash handles the empty configuration", async () => {
  const empty = {};
  const hash = await computeConfigHash(empty);
  assert.equal(typeof hash, "string");
  assert.equal(hash.length, 64, "SHA-256 hex digest should be 64 characters");
});

test("computeConfigHash digest is a 64-character hex string", async () => {
  const config = { "/ratio": 0.5 };
  const hash = await computeConfigHash(config);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("computeCodeHash is stable across re-computation", async () => {
  const code = "process = +;";
  const first = await computeCodeHash(code);
  const second = await computeCodeHash(code);
  assert.equal(first, second);
});

test("computeCodeHash is byte-exact (comments matter)", async () => {
  const a = "process = +;";
  const b = "process = +;\n// noop";
  const hashA = await computeCodeHash(a);
  const hashB = await computeCodeHash(b);
  assert.notEqual(hashA, hashB);
});

test("computeCodeHash digest is a 64-character hex string", async () => {
  const hash = await computeCodeHash("process = _;");
  assert.match(hash, /^[0-9a-f]{64}$/);
});
