import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { CORE_LIB_COORDINATE, resolveProjectExtensions } from "@mindcraft-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@mindcraft-lang/bridge-app/node";
import {
  BrainDef,
  coreModule,
  createMindcraftEnvironment,
  type MindcraftBrain,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { createWorkspaceCompiler, type Mount, type WorkspaceSnapshot } from "@mindcraft-lang/ts-compiler";
import { createEcosimModule } from "../brain";
import type { Archetype } from "../brain/actor";
import { Engine } from "../brain/engine";
import type { Playground } from "../game/scenes/Playground";
import type { EcosimEnvironmentStore } from "../services/ecosim-environment-store";
import {
  ECOSIM_DETECT_EXT_COORDINATE,
  ECOSIM_LIB_COORDINATE,
  ECOSIM_LIB_REFERENCE,
  ECOSIM_TELEPORT_EXT_COORDINATE,
} from "../services/ecosim-extension-coordinates";

/** Stable ids baked into the Teleport and Detect extension source defs. */
const TELEPORT_ID = "4vllyby14afcZtYY";
const DETECT_ID = "qqCSFiDwg0oiEVAw";
const TELEPORT_KEY = `${ECOSIM_TELEPORT_EXT_COORDINATE}:user.actuator.${TELEPORT_ID}`;

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

function embedRecord() {
  return [
    buildEmbeddedExtensionFromDir(extensionDir("../../lib"), ECOSIM_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../../../packages/core/lib"), CORE_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/lib-ecosim-teleport"), ECOSIM_TELEPORT_EXT_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/lib-ecosim-detect"), ECOSIM_DETECT_EXT_COORDINATE),
  ];
}

const HOST_PROGRAM = `import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "host probe",
  onExecute(ctx: Context): boolean {
    return ctx.self.rotation > 0;
  },
});
`;

/** True when the brain's linked program binds the given bytecode action key. */
function brainBindsAction(brain: MindcraftBrain, key: string): boolean {
  const program = brain.getProgram();
  const actions = program?.actions;
  if (!actions) return false;
  for (let i = 0; i < actions.size(); i++) {
    if (actions.get(i).descriptor.key === key) return true;
  }
  return false;
}

function findTile(tiles: readonly IBrainTileDef[], tileId: string): IBrainTileDef {
  for (const tile of tiles) {
    if (tile.tileId === tileId) return tile;
  }
  throw new Error(`tile ${tileId} not found in bundle`);
}

/**
 * A driver over the real sim compiler + environment that mirrors what an
 * extension install/uninstall does: re-resolve the project's dependency set,
 * recompile, and republish the compiled action bundle into the environment.
 */
function createCompileHarness(env: MindcraftEnvironment) {
  const mounts: readonly Mount[] = [];
  function resolve(coordinates: readonly string[]) {
    const extensions: Record<string, string> = { [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE };
    for (const c of coordinates) extensions[c] = `embedded:${c}`;
    return resolveProjectExtensions(extensions, { embedded: embedRecord() });
  }

  const initial = resolve([ECOSIM_TELEPORT_EXT_COORDINATE, ECOSIM_DETECT_EXT_COORDINATE]);
  const compiler = createWorkspaceCompiler({
    projectNamespace: "sim-recompile",
    mounts,
    environment: env,
    dependencies: initial.dependencies,
    dependencyMounts: initial.dependencyMounts,
  });
  const snapshot: WorkspaceSnapshot = new Map([
    ["main.ts", { kind: "file", content: HOST_PROGRAM, etag: "e0", isReadonly: false }],
  ]);
  compiler.replaceWorkspace(snapshot);

  /** Recompile against `coordinates` installed and republish the bundle. Returns the bundle tiles. */
  function recompileWith(coordinates: readonly string[]): readonly IBrainTileDef[] {
    const resolved = resolve(coordinates);
    compiler.setDependencies(resolved.dependencies, resolved.dependencyMounts);
    const result = compiler.compile();
    if (!result.bundle) throw new Error("compile produced no bundle");
    env.replaceActionBundle(result.bundle);
    return result.bundle.tiles;
  }

  return { recompileWith };
}

/**
 * Build a carnivore-shaped brain def: a rule whose WHEN uses the Detect sensor
 * and whose DO uses the Teleport actuator. The tiles are taken from a bundle in
 * which both are installed.
 */
function buildTeleportBrainDef(env: MindcraftEnvironment, tiles: readonly IBrainTileDef[]): BrainDef {
  const teleportTile = findTile(tiles, mkActuatorTileId(TELEPORT_KEY));
  const detectTile = findTile(tiles, mkSensorTileId(`${ECOSIM_DETECT_EXT_COORDINATE}:user.sensor.${DETECT_ID}`));
  const def = BrainDef.emptyBrainDef(env.brainServices, "carnivore");
  const rule = def.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(detectTile);
  rule.do().appendTile(teleportTile);
  return def;
}

/**
 * A minimal Playground stand-in: the engine only reaches the scene to mint a
 * sprite on spawn, which the brain-lifecycle path under test never reads.
 */
function fakeScene(): Playground {
  return {
    spawn: () => ({}) as unknown,
  } as unknown as Playground;
}

/** A store stand-in exposing the real environment and a per-archetype brain def source. */
function fakeStore(env: MindcraftEnvironment, defs: Record<Archetype, BrainDef>): EcosimEnvironmentStore {
  return {
    env,
    getDesiredCounts: () => ({ carnivore: 0, herbivore: 0, plant: 0 }),
    loadBrainFromProject: async (archetype: Archetype) => defs[archetype],
    saveBrainForArchetype: async () => {},
  } as unknown as EcosimEnvironmentStore;
}

describe("engine re-instantiates living actor brains on recompile", () => {
  test("an actor spawned while a tile is uninstalled recovers when the tile is re-added", async () => {
    const env = createMindcraftEnvironment({ modules: [coreModule(), createEcosimModule()] });
    const harness = createCompileHarness(env);

    // Teleport installed: build the archetype brain def against the live bundle.
    const withTiles = harness.recompileWith([ECOSIM_TELEPORT_EXT_COORDINATE, ECOSIM_DETECT_EXT_COORDINATE]);
    const teleportDef = buildTeleportBrainDef(env, withTiles);
    const emptyHerbivore = BrainDef.emptyBrainDef(env.brainServices, "herbivore");
    const emptyPlant = BrainDef.emptyBrainDef(env.brainServices, "plant");

    const store = fakeStore(env, { carnivore: teleportDef, herbivore: emptyHerbivore, plant: emptyPlant });
    const engine = new Engine(fakeScene(), [], store);
    await engine.loadBrains();

    // A carnivore alive while Teleport is installed binds the Teleport action.
    const preExisting = engine.spawn("carnivore");
    assert.ok(preExisting, "spawn yields an actor once brains are loaded");
    assert.equal(brainBindsAction(preExisting.brain, TELEPORT_KEY), true, "pre-existing actor binds teleport");

    // Uninstall Teleport and let the runtime rebuild invalidated brains, as the
    // per-tick flush does. The living actor's brain is invalidated (stopped).
    harness.recompileWith([ECOSIM_DETECT_EXT_COORDINATE]);
    env.rebuildInvalidatedBrains();
    assert.equal(preExisting.brain.status, "invalidated", "removing the tile stops the living actor's brain");

    // An actor that spawns during the uninstalled window cannot build its
    // teleport brain, so its brain is born invalidated (no teleport action) and
    // tracked for retry, just as a brain whose later rebuild fails is.
    const spawnedWhileMissing = engine.spawn("carnivore");
    assert.ok(spawnedWhileMissing, "spawn yields an actor once brains are loaded");
    assert.equal(
      brainBindsAction(spawnedWhileMissing.brain, TELEPORT_KEY),
      false,
      "an actor spawned while the tile is missing has no teleport"
    );

    // Re-add Teleport. The per-tick flush rebuilds the still-tracked invalidated
    // brains, which includes both the broke-later actor and the actor spawned
    // while the tile was missing (born broke, tracked and invalidated at spawn).
    harness.recompileWith([ECOSIM_TELEPORT_EXT_COORDINATE, ECOSIM_DETECT_EXT_COORDINATE]);
    env.rebuildInvalidatedBrains();

    // A fresh spawn after the re-add works (the behavior that already held).
    const spawnedAfterReadd = engine.spawn("carnivore");
    assert.ok(spawnedAfterReadd, "spawn yields an actor once brains are loaded");
    assert.equal(brainBindsAction(spawnedAfterReadd.brain, TELEPORT_KEY), true, "a new spawn after re-add works");

    // Both pre-existing live actors end up on the same working brain.
    assert.equal(preExisting.brain.status, "active", "the pre-existing actor is active again after re-add");
    assert.equal(
      brainBindsAction(preExisting.brain, TELEPORT_KEY),
      true,
      "the pre-existing actor recovers the working brain after re-add"
    );
    assert.equal(
      brainBindsAction(spawnedWhileMissing.brain, TELEPORT_KEY),
      true,
      "the actor spawned while the tile was missing recovers after re-add"
    );
  });

  test("a normal brain edit still re-instantiates living actor brains", async () => {
    const env = createMindcraftEnvironment({ modules: [coreModule(), createEcosimModule()] });
    const harness = createCompileHarness(env);
    const withTiles = harness.recompileWith([ECOSIM_TELEPORT_EXT_COORDINATE, ECOSIM_DETECT_EXT_COORDINATE]);
    const teleportDef = buildTeleportBrainDef(env, withTiles);

    const store = fakeStore(env, {
      carnivore: teleportDef,
      herbivore: BrainDef.emptyBrainDef(env.brainServices, "herbivore"),
      plant: BrainDef.emptyBrainDef(env.brainServices, "plant"),
    });
    const engine = new Engine(fakeScene(), [], store);
    await engine.loadBrains();

    const actor = engine.spawn("carnivore");
    assert.ok(actor, "spawn yields an actor once brains are loaded");
    assert.equal(brainBindsAction(actor.brain, TELEPORT_KEY), true, "actor starts on the teleport brain");

    // Editing the archetype brain to an empty def pushes to the living actor.
    const emptyDef = BrainDef.emptyBrainDef(env.brainServices, "carnivore");
    engine.updateBrainDef("carnivore", emptyDef);
    assert.equal(
      brainBindsAction(actor.brain, TELEPORT_KEY),
      false,
      "the living actor picks up the edited (empty) brain"
    );
  });
});
