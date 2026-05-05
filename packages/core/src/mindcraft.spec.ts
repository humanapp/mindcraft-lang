import assert from "node:assert/strict";
import test from "node:test";
import {
  type ActionBundleUpdate,
  type BrainInvalidationEvent,
  brain,
  type CompiledActionArtifact,
  type CompiledActionBundle,
  type CreateBrainOptions,
  coreModule,
  createMindcraftEnvironment,
  Dict,
  type HydratedTileMetadataSnapshot,
  type MindcraftBrain,
  type MindcraftCatalog,
  type MindcraftEnvironment,
  type MindcraftModule,
  type MindcraftModuleApi,
  runtime,
} from "@mindcraft-lang/core";

type RootContracts = [
  ActionBundleUpdate,
  BrainInvalidationEvent,
  CompiledActionArtifact,
  CompiledActionBundle,
  CreateBrainOptions,
  HydratedTileMetadataSnapshot,
  MindcraftBrain,
  MindcraftCatalog,
  MindcraftEnvironment,
  MindcraftModule,
  MindcraftModuleApi,
];

type ModuleApiMembers = [MindcraftModuleApi["registerFunction"], MindcraftModuleApi["registerOperator"]];

void (0 as unknown as RootContracts);
void (0 as unknown as ModuleApiMembers);

test("exports mindcraft public contracts from the root package", () => {
  const hydrated = {
    revision: "rev-1",
    tiles: [],
  } satisfies HydratedTileMetadataSnapshot;

  const bundle = {
    revision: "rev-2",
    tiles: [],
    actions: new Dict<string, CompiledActionArtifact>(),
  } satisfies CompiledActionBundle;

  const options = {
    context: { actorId: "actor-1" },
    catalogs: [],
  } satisfies CreateBrainOptions;

  void hydrated;
  void bundle;
  void options;
  assert.ok(brain.compiler);
  assert.ok(runtime);
  assert.ok(brain.tiles);
  assert.equal(typeof createMindcraftEnvironment, "function");
  assert.equal(typeof coreModule, "function");
});

test("coreModule installs through MindcraftModuleApi with brainServices", () => {
  const services = brain.createBrainServices(brain.createAppServices());

  const fail = (): never => {
    throw new Error("coreModule() should use api.brainServices directly");
  };

  const api: MindcraftModuleApi = {
    brainServices: services,
    defineType: fail,
    registerHostSensor: fail,
    registerHostActuator: fail,
    registerFunction: fail,
    registerTile: fail,
    registerOperator: fail,
    registerConversion: fail,
    registerModifiers: fail,
    registerParameters: fail,
  };

  coreModule().install(api);

  assert.ok(services.runtime.types.resolveByName("number"));
  assert.ok(services.runtime.functions.get(brain.CoreSensorId.CurrentPage));
  assert.ok(services.runtime.actions.getByKey(brain.CoreSensorId.CurrentPage));
  assert.ok(services.edit.tiles.get(brain.mkSensorTileId(brain.CoreSensorId.CurrentPage)));
  assert.ok(services.runtime.operatorTable.get(runtime.CoreOpId.Add));
});
