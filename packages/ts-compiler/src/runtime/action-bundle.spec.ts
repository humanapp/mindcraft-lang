import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { coreModule, createWendooEnvironment, type HydratedTileMetadataSnapshot } from "@wendoo/core";
import { type BrainServices, CoreCapabilityBits } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { BrainDef } from "@wendoo/core/brain/model";
import { CoreTypeIds, mkActuatorTileId, mkParameterTileId, mkSensorTileId, Op } from "@wendoo/core/runtime";
import { UserTileProject } from "../compiler/compile.js";
import type { ExtractedParam } from "../compiler/types.js";
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

function compileProject(files: ReadonlyMap<string, string>) {
  const project = new UserTileProject({ projectNamespace: TEST_PROJECT_NAMESPACE, services });
  project.setFiles(files);
  return project.compileAll();
}

let services: BrainServices;

describe("buildCompiledActionBundle", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("builds a full-snapshot bundle with deduped shared parameter tiles", () => {
    const result = compileProject(
      new Map([
        [
          "scan.ts",
          `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  id: "snscan",
  name: "scan",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`,
        ],
        [
          "move.ts",
          `
import { Actuator, param, type Context } from "wendoo";

export default Actuator({
  id: "acmove",
  name: "move",
  args: [
    param("target", { type: "number", anonymous: true }),
  ],
  onExecute(ctx: Context, args: { target: number }): void {
  },
});
`,
        ],
        [
          "turn.ts",
          `
import { Actuator, param, type Context } from "wendoo";

export default Actuator({
  id: "acturn",
  name: "turn",
  args: [
    param("angle", { type: "number", anonymous: true }),
    param("label", { type: "string" }),
  ],
  onExecute(ctx: Context, args: { angle: number; label: string }): void {
  },
});
`,
        ],
      ])
    );

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });

    assert.ok(bundle);
    assert.deepEqual(bundle.actions.keys().toArray(), [
      `${TEST_PROJECT_NAMESPACE}:user.actuator.acmove`,
      `${TEST_PROJECT_NAMESPACE}:user.actuator.acturn`,
      `${TEST_PROJECT_NAMESPACE}:user.sensor.snscan`,
    ]);
    assert.ok(
      bundle.tiles.some((tile) => tile.tileId === mkSensorTileId(`${TEST_PROJECT_NAMESPACE}:user.sensor.snscan`))
    );
    assert.ok(
      bundle.tiles.some((tile) => tile.tileId === mkActuatorTileId(`${TEST_PROJECT_NAMESPACE}:user.actuator.acmove`))
    );
    assert.ok(
      bundle.tiles.some((tile) => tile.tileId === mkActuatorTileId(`${TEST_PROJECT_NAMESPACE}:user.actuator.acturn`))
    );
    assert.equal(bundle.tiles.filter((tile) => tile.tileId === mkParameterTileId("anon.number")).length, 1);
    assert.ok(
      bundle.tiles.some((tile) => tile.tileId === mkParameterTileId(`${TEST_PROJECT_NAMESPACE}:user.acturn.label`))
    );
  });

  test("a user sensor declaring presenceGated: true carries the bit and emits WHEN_END_PRESENT", () => {
    const result = compileProject(
      new Map([
        [
          "rx.ts",
          `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  id: "snrx",
  name: "rx",
  presenceGated: true,
  onExecute(ctx: Context): number {
    return 0;
  },
});
`,
        ],
      ])
    );

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);

    const sensorTile = bundle.tiles.find(
      (tile) => tile.tileId === mkSensorTileId(`${TEST_PROJECT_NAMESPACE}:user.sensor.snrx`)
    );
    assert.ok(sensorTile);
    assert.equal(
      sensorTile.capabilities().get(CoreCapabilityBits.PresenceGated),
      1,
      "the declared capability must land on the generated tile def"
    );

    // The brain compiler reads that bit from the user tile and emits
    // WHEN_END_PRESENT for a bare WHEN, identically to a built-in sensor.
    const environment = createWendooEnvironment({ modules: [coreModule()] });
    environment.hydrateTileMetadata({ revision: bundle.revision, tiles: bundle.tiles });
    environment.replaceActionBundle(bundle);

    const brainDef = BrainDef.emptyBrainDef(services, "Presence Brain");
    brainDef.pages().get(0)!.children().get(0)!.when().appendTile(sensorTile);
    const brain = environment.createBrain(environment.deserializeBrainJson(brainDef.toJson()));
    assert.equal(brain.status, "active");

    const program = brain.getProgram();
    assert.ok(program);
    const page = brain.getPages().get(0)!;
    const rootFunc = program.functions.get(page.rootRuleFuncIds.get(0)!)!;
    assert.notEqual(
      rootFunc.code.findIndex((ins) => ins.op === Op.WHEN_END_PRESENT),
      -1,
      "a bare user presence-gated sensor must emit WHEN_END_PRESENT"
    );
  });

  test("returns no bundle when every tile file is present but blocked from contributing", () => {
    const result = compileProject(
      new Map([
        [
          "steer.ts",
          `import { Actuator, param, type Context } from "wendoo";
import { Position } from "@lib/acme/pos";

export default Actuator({
  id: "acsteer000000001",
  name: "steer",
  args: [param("position", { type: Position, anonymous: true })],
  onExecute(ctx: Context, args: { position: Position }): void {
  },
});
`,
        ],
      ])
    );

    assert.equal(buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services }), undefined);
  });

  test("returns an empty bundle when the tile files are gone and only a non-tile file fails", () => {
    const result = compileProject(new Map([["helper.ts", 'export const value: number = "not a number";\n']]));

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle, "a failing non-tile file must not withhold the bundle");
    assert.deepEqual(bundle.tiles, [], "no tile survives a project that declares none");
    assert.deepEqual(bundle.actions.keys().toArray(), []);
  });

  // Re-anchored for definition presence: a bundle-time surface failure
  // withholds that tile and its action; it never withholds the bundle.
  test("a program whose parameter type cannot be resolved at bundle time is withheld from the bundle", () => {
    const result = compileProject(
      new Map([
        [
          "move.ts",
          `
import { Actuator, param, type Context } from "wendoo";

export default Actuator({
  name: "move",
  args: [
    param("target", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { target: number }): void {
  },
});
`,
        ],
      ])
    );

    const entry = result.results.get("move.ts");
    assert.ok(entry?.program);
    const actionKey = entry.program.key;

    (entry.program.args[0] as ExtractedParam).type = "vector2";

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle, "the bundle still builds");
    assert.equal(bundle.actions.get(actionKey), undefined, "the unresolvable tile's action is withheld");
    assert.equal(
      bundle.tiles.some((tile) => tile.tileId === mkActuatorTileId(actionKey)),
      false,
      "the unresolvable tile is withheld"
    );
  });

  test("bundle tiles can hydrate deserialization before executable actions are installed", () => {
    const result = compileProject(
      new Map([
        [
          "probe.ts",
          `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  id: "snprobe",
  name: "probe",
  onExecute(ctx: Context): number {
    return 2;
  },
});
`,
        ],
      ])
    );

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);

    const sensorTile = bundle.tiles.find(
      (tile) => tile.tileId === mkSensorTileId(`${TEST_PROJECT_NAMESPACE}:user.sensor.snprobe`)
    );
    assert.ok(sensorTile);

    const brainDef = BrainDef.emptyBrainDef(services, "Probe Brain");
    brainDef.pages().get(0)!.children().get(0)!.when().appendTile(sensorTile!);

    const environment = createWendooEnvironment({ modules: [coreModule()] });
    const json = brainDef.toJson();

    const preHydrate = environment.deserializeBrainJson(json);
    assert.equal(preHydrate.pages().get(0)!.children().get(0)!.when().tiles().get(0)!.kind, "missing");
    assert.equal(preHydrate.pages().get(0)!.children().get(0)!.when().tiles().get(0)!.tileId, sensorTile!.tileId);

    const hydrationSnapshot: HydratedTileMetadataSnapshot = {
      revision: bundle.revision,
      tiles: bundle.tiles,
    };

    environment.hydrateTileMetadata(hydrationSnapshot);

    const restored = environment.deserializeBrainJson(json);
    assert.equal(restored.pages().get(0)!.children().get(0)!.when().tiles().get(0)!.tileId, sensorTile!.tileId);

    // Before the executable actions are installed, linking the restored brain
    // reports the missing action by its key.
    const linkResult = environment.linkBrain(restored);
    assert.equal(linkResult.program, undefined);
    assert.ok(
      linkResult.diagnostics
        .toArray()
        .some((diag) => diag.message.includes(`${TEST_PROJECT_NAMESPACE}:user.sensor.snprobe`))
    );

    // With the action still missing, createBrain yields a tracked, invalidated
    // brain that has no executable program.
    const bornInvalidated = environment.createBrain(restored);
    assert.equal(bornInvalidated.status, "invalidated");
    assert.equal(bornInvalidated.getProgram(), undefined);

    // Installing the executable actions revives the born-invalidated brain
    // through the per-tick rebuild retry path.
    environment.replaceActionBundle(bundle);
    environment.rebuildInvalidatedBrains();
    assert.equal(bornInvalidated.status, "active");
    assert.ok(bornInvalidated.getProgram());

    const brain = environment.createBrain(restored);
    assert.equal(brain.status, "active");
  });
});
