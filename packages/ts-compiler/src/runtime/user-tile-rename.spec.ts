import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { coreModule, createWendooEnvironment } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { BrainDef } from "@wendoo/core/brain/model";
import { CoreTypeIds } from "@wendoo/core/runtime";
import { UserTileProject } from "../compiler/compile.js";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { buildCompiledActionBundle } from "./action-bundle.js";

function resolveCoreTypeId(typeName: string): string | undefined {
  switch (typeName) {
    case "boolean":
      return CoreTypeIds.Boolean;
    case "number":
      return CoreTypeIds.Number;
    case "string":
      return CoreTypeIds.String;
    default:
      return undefined;
  }
}

const TILE_PATH = "scan.ts";

function sensorSource(name: string): string {
  return `import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "${name}",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
}

function compile(source: string, services: BrainServices) {
  const project = new UserTileProject({ projectNamespace: TEST_PROJECT_NAMESPACE, services });
  project.setFiles(new Map([[TILE_PATH, source]]));
  return project.compileAll();
}

/** The minted-id source the host persists back after a compile, falling back to the original when no id was minted. */
function persistedSource(result: ReturnType<UserTileProject["compileAll"]>, original: string): string {
  const rewrites = (result as { sourceRewrites?: ReadonlyMap<string, string> }).sourceRewrites;
  return rewrites?.get(TILE_PATH) ?? original;
}

let services: BrainServices;

describe("renaming a user action does not orphan brains that reference it", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("a brain keeps resolving the tile and shows the new name after a rename", () => {
    const original = sensorSource("scan");
    const firstCompile = compile(original, services);
    const bundle1 = buildCompiledActionBundle(firstCompile, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle1);

    const sensor1 = bundle1.tiles.find((tile) => tile.kind === "sensor");
    assert.ok(sensor1);
    const storedTileId = sensor1.tileId;

    const environment = createWendooEnvironment({ modules: [coreModule()] });
    environment.hydrateTileMetadata({ revision: bundle1.revision, tiles: bundle1.tiles });
    environment.replaceActionBundle(bundle1);

    const brainDef = BrainDef.emptyBrainDef(services, "Rename Brain");
    brainDef.pages().get(0)!.children().get(0)!.when().appendTile(sensor1);
    const savedBrainJson = brainDef.toJson();

    const renamedSource = persistedSource(firstCompile, original).replace('name: "scan"', 'name: "radar"');
    assert.notEqual(renamedSource, persistedSource(firstCompile, original), "the rename should change the source");

    const secondCompile = compile(renamedSource, services);
    const bundle2 = buildCompiledActionBundle(secondCompile, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle2);

    const sensor2 = bundle2.tiles.find((tile) => tile.kind === "sensor");
    assert.ok(sensor2);

    assert.equal(sensor2.tileId, storedTileId, "the tile key must be stable across a name change");
    assert.equal((sensor2.metadata as { label?: string }).label, "radar", "the tile should display the new name");

    environment.hydrateTileMetadata({ revision: bundle2.revision, tiles: bundle2.tiles });
    environment.replaceActionBundle(bundle2);

    const restored = environment.deserializeBrainJson(savedBrainJson);
    const restoredTile = restored.pages().get(0)!.children().get(0)!.when().tiles().get(0)!;
    assert.notEqual(restoredTile.kind, "missing", "the renamed action must not orphan the brain");
    assert.equal(restoredTile.tileId, storedTileId);

    const brain = environment.createBrain(restored);
    assert.equal(brain.status, "active");
  });
});
