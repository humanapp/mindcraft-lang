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
  createWendooEnvironment,
  Dict,
  type HydratedTileMetadataSnapshot,
  runtime,
  type WendooBrain,
  type WendooCatalog,
  type WendooEnvironment,
  type WendooModule,
  type WendooModuleApi,
} from "@wendoo/core";
import { CoreHostActions } from "@wendoo/core/runtime";

type RootContracts = [
  ActionBundleUpdate,
  BrainInvalidationEvent,
  CompiledActionArtifact,
  CompiledActionBundle,
  CreateBrainOptions,
  HydratedTileMetadataSnapshot,
  WendooBrain,
  WendooCatalog,
  WendooEnvironment,
  WendooModule,
  WendooModuleApi,
];

type ModuleApiMembers = [WendooModuleApi["registerFunction"], WendooModuleApi["registerOperator"]];

void (0 as unknown as RootContracts);
void (0 as unknown as ModuleApiMembers);

test("exports wendoo public contracts from the root package", () => {
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
    vmEvents: {
      onFiberFault: () => {},
    },
  } satisfies CreateBrainOptions;

  void hydrated;
  void bundle;
  void options;
  assert.ok(brain.compiler);
  assert.ok(runtime);
  assert.ok(brain.tiles);
  assert.equal(typeof createWendooEnvironment, "function");
  assert.equal(typeof coreModule, "function");
});

test("coreModule installs through WendooModuleApi with brainServices", () => {
  const services = brain.createBrainServices(brain.createAppServices());

  const fail = (): never => {
    throw new Error("coreModule() should use api.brainServices directly");
  };

  const api: WendooModuleApi = {
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
  assert.ok(services.runtime.functions.get(CoreHostActions.CurrentPage.key));
  assert.ok(services.runtime.actions.getByKey(CoreHostActions.CurrentPage.key));
  assert.ok(services.edit.tiles.get(brain.mkSensorTileId(CoreHostActions.CurrentPage.key)));
  assert.ok(services.runtime.operatorTable.get(runtime.CoreOpId.Add));
});
