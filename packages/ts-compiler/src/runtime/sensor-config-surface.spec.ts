import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { coreModule, createMindcraftEnvironment, List } from "@mindcraft-lang/core";
import {
  type BrainServices,
  CoreCapabilityBits,
  type IBrainTileDef,
  mkOperatorTileId,
  RuleSide,
  TilePlacement,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { parseTilesForSuggestions, suggestTiles } from "@mindcraft-lang/core/brain/language-service";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreOpId, CoreTypeIds, mkSensorTileId } from "@mindcraft-lang/core/runtime";
import { UserTileProject } from "../compiler/compile.js";
import { DescriptorDiagCode } from "../compiler/diag-codes.js";
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

/** Compile one source module through a fresh set of services and return both. */
function compileOne(
  fileName: string,
  source: string
): {
  services: BrainServices;
  result: ReturnType<UserTileProject["compileAll"]>;
} {
  const services = __test__createBrainServices();
  const project = new UserTileProject({ services });
  project.setFiles(new Map([[fileName, source]]));
  return { services, result: project.compileAll() };
}

const INLINE_NUMBER_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snstick",
  name: "stick",
  inline: true,
  onExecute(ctx: Context): number {
    return 3;
  },
});
`;

const PLAIN_NUMBER_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snplain",
  name: "plain",
  onExecute(ctx: Context): number {
    return 3;
  },
});
`;

describe("SensorConfig `inline`", () => {
  test("inline: true is extracted onto the program and marks the tile def placement-inline", () => {
    const { services, result } = compileOne("stick.ts", INLINE_NUMBER_SENSOR);
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);

    const entry = result.results.get("stick.ts");
    assert.ok(entry?.program, "expected a compiled program");
    assert.equal(entry.program.inline, true, "program.inline must reflect the config");

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const sensorTile = bundle.tiles.find((tile) => tile.tileId === mkSensorTileId("user.sensor.snstick"));
    assert.ok(sensorTile, "expected the sensor tile in the bundle");
    assert.notEqual(sensorTile.placement, undefined);
    assert.ok(
      (sensorTile.placement! & TilePlacement.Inline) !== 0,
      "an inline sensor tile must carry the Inline placement bit"
    );
  });

  test("a sensor without inline is not placement-inline (defaults to WhenSide)", () => {
    const { services, result } = compileOne("plain.ts", PLAIN_NUMBER_SENSOR);
    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("plain.ts");
    assert.ok(entry?.program);
    assert.notEqual(entry.program.inline, true);

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const sensorTile = bundle.tiles.find((tile) => tile.tileId === mkSensorTileId("user.sensor.snplain"));
    assert.ok(sensorTile);
    assert.equal(
      sensorTile.placement === undefined || (sensorTile.placement & TilePlacement.Inline) === 0,
      true,
      "a non-inline sensor must not carry the Inline placement bit"
    );
  });

  test("inline: true together with a non-empty args emits InlineSensorTakesNoArgs", () => {
    const source = `
import { Sensor, param, type Context } from "mindcraft";

export default Sensor({
  name: "bad-inline",
  inline: true,
  args: [param("amount", { type: "number", anonymous: true })],
  onExecute(ctx: Context, args: { amount: number }): number {
    return args.amount;
  },
});
`;
    const { result } = compileOne("bad-inline.ts", source);
    assert.equal(result.tsErrors.size, 0, "the source itself type-checks; the block is a descriptor rule");
    const entry = result.results.get("bad-inline.ts");
    assert.ok(entry, "expected a compile entry");
    assert.ok(
      entry.diagnostics.some((d) => d.code === DescriptorDiagCode.InlineSensorTakesNoArgs),
      "expected InlineSensorTakesNoArgs"
    );
    assert.equal(entry.program, undefined, "a diagnostic blocks program assembly");
  });

  test("a non-boolean-literal inline value emits InlineMustBeBoolean", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
const dynamic: boolean = 1 > 0;
export default Sensor({
  name: "dyn-inline",
  inline: dynamic,
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const { result } = compileOne("dyn-inline.ts", source);
    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("dyn-inline.ts");
    assert.ok(entry);
    assert.ok(
      entry.diagnostics.some((d) => d.code === DescriptorDiagCode.InlineMustBeBoolean),
      "expected InlineMustBeBoolean"
    );
  });
});

describe("SensorConfig `presenceGated`", () => {
  test("presenceGated: true is extracted and sets the tile def's PresenceGated capability bit", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "sngate",
  name: "gate",
  presenceGated: true,
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const { services, result } = compileOne("gate.ts", source);
    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("gate.ts");
    assert.ok(entry?.program);
    assert.equal(entry.program.presenceGated, true);

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const sensorTile = bundle.tiles.find((tile) => tile.tileId === mkSensorTileId("user.sensor.sngate"));
    assert.ok(sensorTile);
    assert.equal(sensorTile.capabilities().get(CoreCapabilityBits.PresenceGated), 1);
  });

  test("a sensor without presenceGated does not carry the PresenceGated bit", () => {
    const { services, result } = compileOne("plain.ts", PLAIN_NUMBER_SENSOR);
    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("plain.ts");
    assert.ok(entry?.program);
    assert.notEqual(entry.program.presenceGated, true);

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const sensorTile = bundle.tiles.find((tile) => tile.tileId === mkSensorTileId("user.sensor.snplain"));
    assert.ok(sensorTile);
    assert.equal(sensorTile.capabilities().get(CoreCapabilityBits.PresenceGated), 0);
  });

  test("presenceGated: false is not presence-gated", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snoff",
  name: "off",
  presenceGated: false,
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const { services, result } = compileOne("off.ts", source);
    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("off.ts");
    assert.ok(entry?.program);
    assert.notEqual(entry.program.presenceGated, true);

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const sensorTile = bundle.tiles.find((tile) => tile.tileId === mkSensorTileId("user.sensor.snoff"));
    assert.ok(sensorTile);
    assert.equal(sensorTile.capabilities().get(CoreCapabilityBits.PresenceGated), 0);
  });

  test("a non-boolean-literal presenceGated value emits PresenceGatedMustBeBoolean", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
const dynamic: boolean = 1 > 0;
export default Sensor({
  name: "dyn-gate",
  presenceGated: dynamic,
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const { result } = compileOne("dyn-gate.ts", source);
    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("dyn-gate.ts");
    assert.ok(entry);
    assert.ok(
      entry.diagnostics.some((d) => d.code === DescriptorDiagCode.PresenceGatedMustBeBoolean),
      "expected PresenceGatedMustBeBoolean"
    );
  });
});

describe("inline sensor picker offering", () => {
  test("an inline sensor is offered in a value slot while a non-inline sensor is not", () => {
    const services = __test__createBrainServices();
    const project = new UserTileProject({ services });
    project.setFiles(
      new Map([
        ["stick.ts", INLINE_NUMBER_SENSOR],
        ["plain.ts", PLAIN_NUMBER_SENSOR],
      ])
    );
    const result = project.compileAll();
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    for (const tile of bundle.tiles) {
      services.edit.tiles.registerTileDef(tile);
    }

    // Build `[1] [+] _`: the RHS is a mid-rule value slot. Non-inline sensors are
    // excluded there; inline sensors participate like a literal.
    const oneLit = new BrainTileLiteralDef(CoreTypeIds.Number, 1, {}, services);
    const addOp = services.edit.tiles.get(mkOperatorTileId(CoreOpId.Add))!;
    const expr = parseTilesForSuggestions(List.from<IBrainTileDef>([oneLit, addOp]));

    const suggestions = suggestTiles({ ruleSide: RuleSide.When, expr }, List.from([services.edit.tiles]), services);

    const inlineTileId = mkSensorTileId("user.sensor.snstick");
    const plainTileId = mkSensorTileId("user.sensor.snplain");
    const offered = (id: string) =>
      suggestions.exact.toArray().some((s) => s.tileDef.tileId === id) ||
      suggestions.withConversion.toArray().some((s) => s.tileDef.tileId === id);

    assert.equal(offered(inlineTileId), true, "the inline sensor must be offered in a value slot");
    assert.equal(offered(plainTileId), false, "a non-inline sensor must not be offered in a value slot");
  });

  test("an inline sensor placed in a value slot compiles into an active brain", () => {
    const { services, result } = compileOne("stick.ts", INLINE_NUMBER_SENSOR);
    assert.equal(result.tsErrors.size, 0);
    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const inlineTile = bundle.tiles.find((tile) => tile.tileId === mkSensorTileId("user.sensor.snstick"));
    assert.ok(inlineTile);

    const brainDef = BrainDef.emptyBrainDef(services, "Inline Placement Brain");
    const when = brainDef.pages().get(0)!.children().get(0)!.when();
    when.appendTile(new BrainTileLiteralDef(CoreTypeIds.Number, 1, {}, services));
    when.appendTile(services.edit.tiles.get(mkOperatorTileId(CoreOpId.Add))!);
    when.appendTile(inlineTile);

    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    environment.hydrateTileMetadata({ revision: bundle.revision, tiles: bundle.tiles });
    environment.replaceActionBundle(bundle);

    const brain = environment.createBrain(environment.deserializeBrainJson(brainDef.toJson()));
    assert.equal(brain.status, "active", "a brain reading the inline sensor in a value slot must build");
  });
});

describe("removed capabilities surface", () => {
  test("capabilities: [PresenceGated] no longer type-checks", () => {
    const source = `
import { Sensor, PresenceGated, type Context } from "mindcraft";

export default Sensor({
  name: "old-surface",
  capabilities: [PresenceGated],
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const { result } = compileOne("old-surface.ts", source);
    assert.ok(result.tsErrors.size > 0, "the old capabilities/PresenceGated surface must be a TS error");
  });
});

describe("actuators are unaffected by the sensor-only fields", () => {
  test("inline on an actuator is a TS error", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "act-inline",
  inline: true,
  onExecute(ctx: Context): void {},
});
`;
    const { result } = compileOne("act-inline.ts", source);
    assert.ok(result.tsErrors.size > 0, "inline is not a member of ActuatorConfig");
  });

  test("presenceGated on an actuator is a TS error", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "act-gate",
  presenceGated: true,
  onExecute(ctx: Context): void {},
});
`;
    const { result } = compileOne("act-gate.ts", source);
    assert.ok(result.tsErrors.size > 0, "presenceGated is not a member of ActuatorConfig");
  });
});
