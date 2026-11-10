/*********************** effect-node-retirement.test.ts *************************
 *
 * Purpose: Check when the node of a removed or replaced effect is disconnected.
 * How: Register runtimes with fake nodes that count their disconnections, wire
 *      or note track paths through them, then destroy, replace or release
 *      them. A node still on a wired path must keep its connections until the
 *      path is rewired without it: disconnecting it first cut the sound and
 *      left the track output without input, so its fade never ran.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import {
  destroyEffectRuntime,
  getEffectRuntime,
  noteWiredEffectNodes,
  registerEffectRuntime,
  retainEffectRuntimes,
} from "../demo/fx-chain/fx-chain-runtime.js";
import { wireTrackEffectChain } from "../demo/fx-chain/fx-chain-audio.js";
import { initProject } from "../src/domain/project.js";
import { demoState } from "../demo/state.js";

type FakeNode = { context: object; disconnects: number; disconnect(): void; connect(target: unknown): void };

const live = { state: "running" };

function fakeNode(): FakeNode {
  return {
    context: live,
    disconnects: 0,
    disconnect() { this.disconnects += 1; },
    connect() {},
  };
}

function register(effectId: string, node: FakeNode): void {
  registerEffectRuntime(effectId, {
    effectId, node: node as unknown as AudioWorkletNode, generator: null, ui: null, code: "process = _;",
  });
}

const asNode = (node: FakeNode) => node as unknown as AudioNode;

test("a removed effect node off every wired path is disconnected at once", (t) => {
  t.after(() => noteWiredEffectNodes("path-a", []));
  const node = fakeNode();
  register("fx-r1", node);
  noteWiredEffectNodes("path-a", []);
  destroyEffectRuntime("fx-r1");
  assert.equal(node.disconnects, 1);
  assert.equal(getEffectRuntime("fx-r1"), undefined);
});

test("a removed effect node on a wired path is disconnected only when the path is rewired without it", (t) => {
  t.after(() => noteWiredEffectNodes("path-a", []));
  const node = fakeNode();
  register("fx-r2", node);
  noteWiredEffectNodes("path-a", [asNode(node)]);
  destroyEffectRuntime("fx-r2");
  assert.equal(node.disconnects, 0, "still sounding until the rewire");
  assert.equal(getEffectRuntime("fx-r2"), undefined, "but no longer an effect runtime");
  noteWiredEffectNodes("path-b", []);
  assert.equal(node.disconnects, 0, "another path's rewire does not release it");
  noteWiredEffectNodes("path-a", []);
  assert.equal(node.disconnects, 1);
  noteWiredEffectNodes("path-a", []);
  assert.equal(node.disconnects, 1, "released once");
});

test("a recompiled effect keeps its old node wired until the rewire, not the new one", (t) => {
  t.after(() => {
    noteWiredEffectNodes("path-a", []);
    destroyEffectRuntime("fx-r3");
  });
  const oldNode = fakeNode();
  const newNode = fakeNode();
  register("fx-r3", oldNode);
  noteWiredEffectNodes("path-a", [asNode(oldNode)]);
  register("fx-r3", newNode);
  assert.equal(getEffectRuntime("fx-r3")?.node, newNode as unknown as AudioWorkletNode);
  assert.equal(oldNode.disconnects, 0);
  noteWiredEffectNodes("path-a", [asNode(newNode)]);
  assert.equal(oldNode.disconnects, 1);
  assert.equal(newNode.disconnects, 0);
});

test("loading another session releases the previous effects at once, wired or not", (t) => {
  t.after(() => noteWiredEffectNodes("path-a", []));
  const node = fakeNode();
  const retired = fakeNode();
  register("fx-r4", node);
  register("fx-r4b", retired);
  noteWiredEffectNodes("path-a", [asNode(node), asNode(retired)]);
  destroyEffectRuntime("fx-r4b");
  assert.equal(retired.disconnects, 0);
  retainEffectRuntimes(new Set());
  assert.equal(node.disconnects, 1);
  assert.equal(retired.disconnects, 1, "a node in retirement too");
  assert.equal(getEffectRuntime("fx-r4"), undefined);
  noteWiredEffectNodes("path-a", []);
  assert.equal(node.disconnects, 1, "not released a second time");
  assert.equal(retired.disconnects, 1, "not released a second time");
});

test("a node registered again leaves retirement", (t) => {
  t.after(() => {
    noteWiredEffectNodes("path-a", []);
    destroyEffectRuntime("fx-r6");
  });
  const node = fakeNode();
  register("fx-r6", node);
  noteWiredEffectNodes("path-a", [asNode(node)]);
  destroyEffectRuntime("fx-r6");
  register("fx-r6", node); // the same runtime restored
  noteWiredEffectNodes("path-a", []);
  assert.equal(node.disconnects, 0, "a live effect's node is not released by a rewire");
});

test("rewiring a track releases the node of the effect removed from its chain", (t) => {
  const node = fakeNode();
  register("fx-r5", node);
  const savedProject = demoState.project;
  const project = initProject("p");
  const track = project.timeline.tracks[0]!;
  const setEffects = (ids: string[]): void => {
    const chains = new Map(project.chains);
    chains.set(track.chainId, {
      id: track.chainId,
      effects: ids.map((id) => ({ id, fxResourceId: "r", parameters: [], bypassed: false })),
    });
    demoState.project = { ...project, chains };
  };
  t.after(() => {
    demoState.project = savedProject;
    noteWiredEffectNodes(track.id, []);
  });
  const input = fakeNode();
  const output = fakeNode();
  const wire = () => wireTrackEffectChain(track.id, input as unknown as GainNode, output as unknown as GainNode);

  setEffects(["fx-r5"]);
  wire();
  const disconnectsWhenWired = node.disconnects; // the wiring clears the node's old edges first
  setEffects([]);
  destroyEffectRuntime("fx-r5");
  assert.equal(node.disconnects, disconnectsWhenWired, "kept until the track is rewired");
  wire();
  assert.equal(node.disconnects, disconnectsWhenWired + 1);
});
