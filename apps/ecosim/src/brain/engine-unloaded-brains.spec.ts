import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BrainDef } from "@mindcraft-lang/core/app";
import type { Playground } from "../game/scenes/Playground";
import type { EcosimEnvironmentStore } from "../services/ecosim-environment-store";
import { Engine } from "./engine";

/** A scene stand-in; an engine that never loads brains never reaches it. */
function fakeScene(): Playground {
  return {} as unknown as Playground;
}

/** A store stand-in supplying only what the `Engine` constructor reads. */
function fakeStore(): EcosimEnvironmentStore {
  return {
    getDesiredCounts: () => ({ carnivore: 0, herbivore: 0, plant: 0 }),
  } as unknown as EcosimEnvironmentStore;
}

/** A store stand-in whose project brain lookup always rejects. */
function failingStore(): EcosimEnvironmentStore {
  return {
    getDesiredCounts: () => ({ carnivore: 0, herbivore: 0, plant: 0 }),
    loadBrainFromProject: async () => {
      throw new Error("brain load failed");
    },
  } as unknown as EcosimEnvironmentStore;
}

describe("engine with brains not yet loaded", () => {
  test("hasLoadedBrains reports no brains are available", () => {
    const engine = new Engine(fakeScene(), [], fakeStore());

    assert.equal(engine.hasLoadedBrains, false);
  });

  test("hasLoadedBrains stays false when the load rejects", async () => {
    const engine = new Engine(fakeScene(), [], failingStore());

    await assert.rejects(() => engine.loadBrains());

    assert.equal(engine.hasLoadedBrains, false);
    assert.equal(engine.getBrainDef("carnivore"), undefined);
  });

  test("getBrainDef reports no brain instead of throwing", () => {
    const engine = new Engine(fakeScene(), [], fakeStore());

    assert.equal(engine.getBrainDef("carnivore"), undefined);
    assert.equal(engine.getBrainDef("herbivore"), undefined);
    assert.equal(engine.getBrainDef("plant"), undefined);
  });

  test("spawn yields no actor instead of throwing", () => {
    const engine = new Engine(fakeScene(), [], fakeStore());

    assert.equal(engine.spawn("carnivore"), undefined);
  });

  test("updateBrainDef leaves the archetype without a brain", () => {
    const engine = new Engine(fakeScene(), [], fakeStore());

    engine.updateBrainDef("carnivore", {} as BrainDef);

    assert.equal(engine.getBrainDef("carnivore"), undefined);
  });
});
