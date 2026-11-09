/************************ fx-runtime-validity.test.ts *************************
 *
 * Purpose: Check when a compiled FX runtime may be reused.
 * How: Register runtimes with fake nodes and contexts, then query
 *      hasCurrentEffectRuntime and retainEffectRuntimes. An effect id alone
 *      does not identify a DSP: ids repeat across sessions, an undone code edit
 *      keeps its id, and a sample-rate change replaces the AudioContext. The
 *      track wiring must skip a node of a replaced context rather than throw.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import {
  destroyEffectRuntime,
  getEffectRuntime,
  hasCurrentEffectRuntime,
  registerEffectRuntime,
  retainEffectRuntimes,
} from "../demo/fx-chain/fx-chain-runtime.js";
import { wireTrackEffectChain } from "../demo/fx-chain/fx-chain-audio.js";
import { initProject } from "../src/domain/project.js";
import { demoState } from "../demo/state.js";

type FakeContext = { state: "running" | "suspended" | "closed" };

/** Register a runtime for `effectId` whose fake node belongs to `context` and was built from `code`. */
function registerFake(effectId: string, code: string | undefined, context: FakeContext): void {
  const node = { context, disconnect: () => {} } as unknown as AudioWorkletNode;
  registerEffectRuntime(effectId, {
    effectId,
    node,
    generator: null,
    ui: null,
    ...(code !== undefined ? { code } : {}),
  });
}

test("a runtime is current only for its own code in its own live context", (t) => {
  t.after(() => destroyEffectRuntime("fx-1"));
  const live: FakeContext = { state: "running" };
  registerFake("fx-1", "process = _ * 0.25;", live);
  const asContext = (context: FakeContext) => context as unknown as BaseAudioContext;

  assert.equal(hasCurrentEffectRuntime("fx-1", "process = _ * 0.25;", asContext(live)), true);
  // Same id, other code: another session's "fx-1", or an undone code edit.
  assert.equal(hasCurrentEffectRuntime("fx-1", "process = _ * 4;", asContext(live)), false);
  // Same code, other context: the context was replaced after a sample-rate change.
  assert.equal(hasCurrentEffectRuntime("fx-1", "process = _ * 0.25;", asContext({ state: "running" })), false);
  // Same code, same context, but closed.
  live.state = "closed";
  assert.equal(hasCurrentEffectRuntime("fx-1", "process = _ * 0.25;", asContext(live)), false);
  // A suspended context (after Stop) is still the live one.
  live.state = "suspended";
  assert.equal(hasCurrentEffectRuntime("fx-1", "process = _ * 0.25;", asContext(live)), true);
});

test("a runtime of unknown code is never current, a missing one neither", (t) => {
  t.after(() => destroyEffectRuntime("fx-2"));
  const live = { state: "running" } as unknown as BaseAudioContext;
  registerFake("fx-2", undefined, live as unknown as FakeContext);
  assert.equal(hasCurrentEffectRuntime("fx-2", "process = _;", live), false);
  assert.equal(hasCurrentEffectRuntime("fx-absent", "process = _;", live), false);
});

test("retainEffectRuntimes releases the runtimes of effects that no longer exist", (t) => {
  t.after(() => ["fx-1", "fx-2", "fx-3"].forEach((id) => destroyEffectRuntime(id)));
  const live: FakeContext = { state: "running" };
  const disconnected: string[] = [];
  for (const id of ["fx-1", "fx-2", "fx-3"]) {
    registerEffectRuntime(id, {
      effectId: id,
      node: { context: live, disconnect: () => disconnected.push(id) } as unknown as AudioWorkletNode,
      generator: null,
      ui: null,
      code: "process = _;",
    });
  }
  retainEffectRuntimes(new Set(["fx-2"]));
  assert.deepEqual(disconnected.sort(), ["fx-1", "fx-3"]);
  assert.equal(getEffectRuntime("fx-1"), undefined);
  assert.ok(getEffectRuntime("fx-2"));
  assert.equal(getEffectRuntime("fx-3"), undefined);
});

test("wiring a track skips an effect node of another audio context instead of throwing", (t) => {
  const liveContext = { state: "running" };
  const closedContext = { state: "closed" };
  const edges: string[] = [];
  const fakeNode = (name: string, context: object) => ({
    context,
    connect(target: { name: string }) {
      if ((target as unknown as { context: object }).context !== context) {
        throw new Error("InvalidAccessError: cannot connect to an AudioNode belonging to a different audio context");
      }
      edges.push(`${name}->${target.name}`);
    },
    disconnect() {},
    name,
  });
  const input = fakeNode("input", liveContext);
  const output = fakeNode("output", liveContext);
  registerEffectRuntime("fx-old", {
    effectId: "fx-old", node: fakeNode("fx-old", closedContext) as unknown as AudioWorkletNode, generator: null, ui: null, code: "process = _;",
  });
  registerEffectRuntime("fx-live", {
    effectId: "fx-live", node: fakeNode("fx-live", liveContext) as unknown as AudioWorkletNode, generator: null, ui: null, code: "process = _;",
  });
  const savedProject = demoState.project;
  const project = initProject("p");
  const track = project.timeline.tracks[0]!;
  const chains = new Map(project.chains);
  chains.set(track.chainId, {
    id: track.chainId,
    effects: [
      { id: "fx-old", fxResourceId: "r", parameters: [], bypassed: false },
      { id: "fx-live", fxResourceId: "r", parameters: [], bypassed: false },
    ],
  });
  demoState.project = { ...project, chains };
  t.after(() => {
    demoState.project = savedProject;
    destroyEffectRuntime("fx-old");
    destroyEffectRuntime("fx-live");
  });

  wireTrackEffectChain(track.id, input as unknown as GainNode, output as unknown as GainNode);
  assert.deepEqual(edges, ["input->fx-live", "fx-live->output"]);
});
