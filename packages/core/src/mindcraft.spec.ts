import assert from "node:assert/strict";
import test from "node:test";
import {
  type ActionBundleUpdate,
  type BrainInvalidationEvent,
  brain,
  type CompiledActionArtifact,
  type CompiledActionBundle,
  type CreateBrainOptions,
  Dict,
  type HydratedTileMetadataSnapshot,
  type MindcraftBrain,
  type MindcraftCatalog,
  type MindcraftEnvironment,
  type MindcraftModule,
  type MindcraftModuleApi,
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
  assert.ok(brain.runtime);
  assert.ok(brain.tiles);
});
