import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BrainDef, coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { Playground } from "../game/scenes/Playground";
import type { EcosimEnvironmentStore } from "../services/ecosim-environment-store";
import type { Actor, Archetype } from "./actor";
import { Engine } from "./engine";
import { createEcosimModule } from "./index";

/** A graphics stand-in that records whether it was destroyed. */
interface StubGraphics {
  destroyed: boolean;
  setDepth(depth: number): StubGraphics;
  clear(): StubGraphics;
  destroy(): void;
}

function stubGraphics(): StubGraphics {
  const gfx: StubGraphics = {
    destroyed: false,
    setDepth: () => gfx,
    clear: () => gfx,
    destroy: () => {
      gfx.destroyed = true;
    },
  };
  return gfx;
}

/** A sprite stand-in that records whether it was destroyed. */
function stubSprite() {
  const sprite = {
    x: 0,
    y: 0,
    destroyed: false,
    destroy: () => {
      sprite.destroyed = true;
    },
    setVisible: () => sprite,
    setActive: () => sprite,
    setVelocity: () => sprite,
    setPosition: () => sprite,
    body: null,
  };
  return sprite;
}

/**
 * A Matter world stand-in recording every `on`/`off` pair, so a test can tell
 * which world instance a listener was attached to and detached from.
 */
function stubMatterWorld() {
  const attached = new Set<unknown>();
  return {
    attached,
    on(_event: string, fn: unknown) {
      attached.add(fn);
      return this;
    },
    off(_event: string, fn: unknown) {
      attached.delete(fn);
      return this;
    },
  };
}

/**
 * A Playground stand-in exposing exactly the scene surface the engine touches
 * while starting, spawning and shutting down. `matter.world` is writable so a
 * test can reproduce the scene releasing it before the engine tears down.
 */
function stubScene() {
  const graphics: StubGraphics[] = [];
  const scene = {
    scale: { width: 800, height: 600 },
    matter: { world: stubMatterWorld() as unknown as Phaser.Physics.Matter.World | null },
    add: {
      graphics: () => {
        const gfx = stubGraphics();
        graphics.push(gfx);
        return gfx;
      },
    },
    graphics,
    spawn: (actor: Actor) => {
      actor.debugGraphics = scene.add.graphics() as unknown as Phaser.GameObjects.Graphics;
      actor.healthBarGfx = scene.add.graphics() as unknown as Phaser.GameObjects.Graphics;
      return stubSprite() as unknown as Phaser.Physics.Matter.Sprite;
    },
    activateBlip: (blip: { sprite: unknown }) => {
      blip.sprite = stubSprite();
    },
  };
  return scene;
}

/** A store stand-in exposing the live environment and an empty brain per archetype. */
function stubStore(env: MindcraftEnvironment): EcosimEnvironmentStore {
  return {
    env,
    getDesiredCounts: () => ({ carnivore: 0, herbivore: 0, plant: 0 }),
    loadBrainFromProject: async (archetype: Archetype) => BrainDef.emptyBrainDef(env.brainServices, archetype),
    saveBrainForArchetype: async () => {},
  } as unknown as EcosimEnvironmentStore;
}

/** A started engine holding one live carnivore and one in-flight blip. */
async function startedEngine() {
  const env = createMindcraftEnvironment({ modules: [coreModule(), createEcosimModule()] });
  const scene = stubScene();
  const engine = new Engine(scene as unknown as Playground, [], stubStore(env));
  engine.start();
  await engine.loadBrains();

  const actor = engine.spawn("carnivore");
  assert.ok(actor, "spawn yields an actor once brains are loaded");
  const blip = engine.spawnBlip(actor.actorId, 0, 0, 1, 0);
  assert.ok(blip, "the blip pool yields a blip");

  return {
    engine,
    scene,
    actor,
    blip,
    startWorld: scene.matter.world as unknown as ReturnType<typeof stubMatterWorld>,
  };
}

describe("engine shutdown", () => {
  test("detaches the physics listener from the world it subscribed to", async () => {
    const { engine, startWorld } = await startedEngine();
    assert.equal(startWorld.attached.size, 1, "start attaches one physics-step listener");

    engine.shutdown();

    assert.equal(startWorld.attached.size, 0);
  });

  test("completes teardown after the scene has released its matter world", async () => {
    const { engine, scene, actor, blip, startWorld } = await startedEngine();

    // The scene's matter plugin tears down before the engine does, leaving
    // `scene.matter.world` null by the time the engine's shutdown runs.
    scene.matter.world = null;

    engine.shutdown();

    assert.equal(startWorld.attached.size, 0, "the physics-step listener is detached");
    assert.equal(engine.getActorsByArchetype("carnivore").length, 0, "the ECS world is emptied");
    assert.equal(actor.brain.status, "disposed", "each actor's brain is disposed");
    assert.equal(actor.debugGraphics, undefined, "each actor's debug graphics are released");
    assert.equal(actor.healthBarGfx, undefined, "each actor's health bar graphics are released");
    assert.equal(
      scene.graphics.filter((gfx) => !gfx.destroyed).length,
      0,
      "every graphics object the engine created is destroyed"
    );
    assert.equal(blip.alive, false, "in-flight blips are released");
    assert.equal(blip.sprite, null, "blip sprites are destroyed");
  });

  test("releases the loaded brains", async () => {
    const { engine } = await startedEngine();
    assert.equal(engine.hasLoadedBrains, true, "a resolved load leaves a brain per archetype");

    engine.shutdown();

    assert.equal(engine.hasLoadedBrains, false);
    assert.equal(engine.getBrainDef("carnivore"), undefined, "no brain survives to be edited");
  });

  test("is idempotent", async () => {
    const { engine, scene } = await startedEngine();

    engine.shutdown();
    scene.matter.world = null;

    assert.doesNotThrow(() => engine.shutdown());
  });
});
