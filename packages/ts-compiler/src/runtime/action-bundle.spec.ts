import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { coreModule, createMindcraftEnvironment, type HydratedTileMetadataSnapshot } from "@mindcraft-lang/core";
import {
  CoreTypeIds,
  mkActuatorTileId,
  mkParameterTileId,
  mkSensorTileId,
  registerCoreBrainComponents,
} from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { UserTileProject } from "../compiler/compile.js";
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

function compileProject(files: ReadonlyMap<string, string>) {
  const project = new UserTileProject();
  project.setFiles(files);
  return project.compileAll();
}

describe("buildCompiledActionBundle", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("builds a full-snapshot bundle with deduped shared parameter tiles", () => {
    const result = compileProject(
      new Map([
        [
          "scan.ts",
          `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "scan",
  output: "number",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`,
        ],
        [
          "move.ts",
          `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "move",
  params: {
    target: { type: "number", anonymous: true },
  },
  onExecute(ctx: Context, params: { target: number }): void {
  },
});
`,
        ],
        [
          "turn.ts",
          `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "turn",
  params: {
    angle: { type: "number", anonymous: true },
    label: { type: "string" },
  },
  onExecute(ctx: Context, params: { angle: number; label: string }): void {
  },
});
`,
        ],
      ])
    );

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId });

    assert.ok(bundle);
    assert.deepEqual(bundle.actions.keys().toArray(), ["user.actuator.move", "user.actuator.turn", "user.sensor.scan"]);
    assert.ok(bundle.tiles.some((tile) => tile.tileId === mkSensorTileId("user.sensor.scan")));
    assert.ok(bundle.tiles.some((tile) => tile.tileId === mkActuatorTileId("user.actuator.move")));
    assert.ok(bundle.tiles.some((tile) => tile.tileId === mkActuatorTileId("user.actuator.turn")));
    assert.equal(bundle.tiles.filter((tile) => tile.tileId === mkParameterTileId("anon.number")).length, 1);
    assert.ok(bundle.tiles.some((tile) => tile.tileId === mkParameterTileId("user.turn.label")));
  });

  test("returns no bundle when the compile output still has diagnostics", () => {
    const result = compileProject(
      new Map([
        [
          "broken.ts",
          `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "broken",
  output: "number",
  onExecute(ctx: Context): number {
    const value: string = 1;
    return value;
  },
});
`,
        ],
      ])
    );

    assert.equal(buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId }), undefined);
  });

  test("returns no bundle when a program parameter type cannot be resolved at bundle time", () => {
    const result = compileProject(
      new Map([
        [
          "move.ts",
          `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "move",
  params: {
    target: { type: "number" },
  },
  onExecute(ctx: Context, params: { target: number }): void {
  },
});
`,
        ],
      ])
    );

    const entry = result.results.get("move.ts");
    assert.ok(entry?.program);

    entry.program.params[0]!.type = "vector2";

    assert.equal(buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId }), undefined);
  });

  test("bundle tiles can hydrate deserialization before executable actions are installed", () => {
    const result = compileProject(
      new Map([
        [
          "probe.ts",
          `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "probe",
  output: "number",
  onExecute(ctx: Context): number {
    return 2;
  },
});
`,
        ],
      ])
    );

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId });
    assert.ok(bundle);

    const sensorTile = bundle.tiles.find((tile) => tile.tileId === mkSensorTileId("user.sensor.probe"));
    assert.ok(sensorTile);

    const brainDef = BrainDef.emptyBrainDef("Probe Brain");
    brainDef.pages().get(0)!.children().get(0)!.when().appendTile(sensorTile!);

    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const json = brainDef.toJson();

    assert.throws(() => environment.deserializeBrainJson(json), /user\.sensor\.probe/);

    const hydrationSnapshot: HydratedTileMetadataSnapshot = {
      revision: bundle.revision,
      tiles: bundle.tiles,
    };

    environment.hydrateTileMetadata(hydrationSnapshot);

    const restored = environment.deserializeBrainJson(json);
    assert.equal(restored.pages().get(0)!.children().get(0)!.when().tiles().get(0)!.tileId, sensorTile!.tileId);

    assert.throws(() => environment.createBrain(restored), /user\.sensor\.probe/);

    environment.replaceActionBundle(bundle);

    const brain = environment.createBrain(restored);
    assert.equal(brain.status, "active");
  });
});
