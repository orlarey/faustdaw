/********************** track-effect-chain-key.test.ts **************************
 *
 * Purpose: Check the identity of a track's effect path, which decides whether
 *          a rewire during playback must fade (the path changes) or may
 *          reconnect at once (the same path, as on every plan activation).
 * How: Register runtimes with fake nodes, set the project chain, and compare
 *      trackEffectChainKey before and after each kind of edit.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { destroyEffectRuntime, registerEffectRuntime } from "../demo/fx-chain/fx-chain-runtime.js";
import { trackEffectChainKey } from "../demo/fx-chain/fx-chain-audio.js";
import { initProject } from "../src/domain/project.js";
import { demoState } from "../demo/state.js";

type Effect = { id: string; fxResourceId: string; parameters: never[]; bypassed: boolean };

test("the effect-path key changes exactly when the wired path changes", (t) => {
  const live = { state: "running" };
  const other = { state: "closed" };
  const register = (id: string, context: object) => registerEffectRuntime(id, {
    effectId: id, node: { context, disconnect() {} } as unknown as AudioWorkletNode, generator: null, ui: null, code: "process = _;",
  });
  register("fx-a", live);
  register("fx-b", live);
  register("fx-c", other);

  const savedProject = demoState.project;
  const project = initProject("p");
  const track = project.timeline.tracks[0]!;
  const setEffects = (effects: Effect[]): void => {
    const chains = new Map(project.chains);
    chains.set(track.chainId, { id: track.chainId, effects });
    demoState.project = { ...project, chains };
  };
  t.after(() => {
    demoState.project = savedProject;
    ["fx-a", "fx-b", "fx-c"].forEach((id) => destroyEffectRuntime(id));
  });
  const fx = (id: string, bypassed = false): Effect => ({ id, fxResourceId: "r", parameters: [], bypassed });
  const context = live as unknown as BaseAudioContext;
  const key = (): string => trackEffectChainKey(track.id, context);

  setEffects([fx("fx-a"), fx("fx-b")]);
  const ab = key();
  assert.equal(key(), ab, "same path, same key: a plan activation reconnects without a fade");

  setEffects([fx("fx-a"), fx("fx-b", true)]);
  const aOnly = key();
  assert.notEqual(aOnly, ab, "bypass changes the path");

  setEffects([fx("fx-a")]);
  assert.equal(key(), aOnly, "removing a bypassed effect leaves the path as it is");

  setEffects([fx("fx-b"), fx("fx-a")]);
  assert.notEqual(key(), ab, "reorder changes the path");

  setEffects([fx("fx-a"), fx("fx-b"), fx("fx-c")]);
  assert.equal(key(), ab, "a node of another context is not wired, so not part of the path");

  setEffects([fx("fx-a"), fx("fx-b")]);
  register("fx-b", live); // recompiled: a new node under the same effect id
  assert.notEqual(key(), ab, "a recompiled node changes the path");

  setEffects([]);
  assert.equal(key(), "track:", "no effect: the direct path");
});
