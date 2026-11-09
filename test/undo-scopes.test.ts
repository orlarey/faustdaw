/****************************** undo-scopes.test.ts ****************************
 *
 * Purpose: Check that a project-level (level 0) undo/redo restores the project
 *          slice only and keeps the chain content (levels 1–2) as it is now
 *          (UNDOREDOSPEC-WEBDAW: scopes are independent).
 * How: Build session documents with the real createSessionDocument, merge them
 *      with withChainContentOf, and apply them with applySessionDocument.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { importAudioResource } from "../src/domain/audio-resource.js";
import { placeClip } from "../src/domain/clip.js";
import { initProject, type Project } from "../src/domain/project.js";
import { addEffect, importFxResource } from "../src/fx-chain.js";
import type { FxEffect } from "../src/domain/fx-chain.js";
import { applySessionDocument, createSessionDocument, withChainContentOf } from "../demo/session-document.js";

const resource = { id: "tone", sampleRate: 48_000, channels: 1, length: 96_000 };
const gainCode = { id: "fxr-1", name: "gain-000001", code: "process = *(0.5);" };
const effect: FxEffect = { id: "fx-1", fxResourceId: gainCode.id, parameters: [], bypassed: false };
const transformEffect: FxEffect = { id: "fx-2", fxResourceId: gainCode.id, parameters: [], bypassed: true };

const documentOf = (project: Project, transformChain: readonly FxEffect[] = []) =>
  createSessionDocument(project, new Map(), 1, new Map(), transformChain);

test("withChainContentOf takes the project slice of the target and the chain content of the current state", () => {
  // D0: clip at 1 s, no effect. Then the clip moves to 3 s (project entry),
  // then an effect is added on track-1 and in the Transform Chain (chain scopes).
  const base = importAudioResource(initProject("s"), resource);
  const d0Project = placeClip(base, "c1", resource, 48_000, "track-1");
  const d0 = documentOf(d0Project);
  const moved = placeClip(base, "c1", resource, 3 * 48_000, "track-1");
  const current = documentOf(addEffect(importFxResource(moved, gainCode), "track-1", effect), [transformEffect]);

  const restored = withChainContentOf(d0, current);
  assert.deepEqual(restored.tracks.map((t) => t.clips), d0.tracks.map((t) => t.clips));
  assert.deepEqual(restored.tracks.map((t) => t.effects), current.tracks.map((t) => t.effects));
  assert.deepEqual(restored.transformChain, current.transformChain);
  assert.deepEqual(restored.fxResources, current.fxResources);
});

test("a project undo applied through withChainContentOf moves the clip back and keeps the effect added since", () => {
  const base = importAudioResource(initProject("s"), resource);
  const d0 = documentOf(placeClip(base, "c1", resource, 48_000, "track-1"));
  const now = addEffect(importFxResource(placeClip(base, "c1", resource, 3 * 48_000, "track-1"), gainCode), "track-1", effect);

  const undone = applySessionDocument(now, withChainContentOf(d0, documentOf(now)));
  assert.equal(undone.timeline.tracks[0]!.clips[0]!.start, 48_000);
  assert.deepEqual(undone.chains.get("track-1")?.effects.map((e) => e.id), ["fx-1"]);
  assert.equal(undone.fxResources.get(gainCode.id)?.code, gainCode.code);

  // Without the merge (the previous behaviour), the effect added since D0 was dropped.
  const legacy = applySessionDocument(now, d0);
  assert.deepEqual(legacy.chains.get("track-1")?.effects ?? [], []);
});

test("a target without Transform Chain does not erase the current one, and track settings come from the target", () => {
  const base = importAudioResource(initProject("s"), resource);
  const target = { ...documentOf(base), tracks: documentOf(base).tracks.map((t) => ({ ...t, gain: 0.25, mute: true })) };
  const current = documentOf(base, [transformEffect]);
  const restored = withChainContentOf(target, current);
  assert.deepEqual(restored.transformChain, current.transformChain);
  assert.ok(restored.tracks.every((t) => t.gain === 0.25 && t.mute));
  // And a current state without Transform Chain clears the target's.
  assert.equal(withChainContentOf(documentOf(base, [transformEffect]), documentOf(base)).transformChain, undefined);
});
