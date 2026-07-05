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
import { CoreOpId, CoreTypeIds, mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/runtime";
import { UserTileProject } from "../compiler/compile.js";
import { CompileDiagCode, DescriptorDiagCode } from "../compiler/diag-codes.js";
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

describe("SensorConfig / ActuatorConfig `consumesWhenResult`", () => {
  test("consumesWhenResult on a sensor forwards the resolved type to the tile def", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snwhen",
  name: "when reader",
  consumesWhenResult: "number",
  onExecute(ctx: Context): number {
    const result = ctx.getWhenResult();
    return typeof result === "number" ? result : 0;
  },
});
`;
    const { services, result } = compileOne("when-sensor.ts", source);
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("when-sensor.ts");
    assert.ok(entry?.program);
    assert.equal(entry.program.consumesWhenResult, CoreTypeIds.Number, "program carries the resolved WHEN-result type");

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const sensorTile = bundle.tiles.find((tile) => tile.tileId === mkSensorTileId("user.sensor.snwhen"));
    assert.ok(sensorTile);
    assert.equal(sensorTile.consumesWhenResult(), CoreTypeIds.Number, "the sensor tile declares consumesWhenResult");
  });

  test("consumesWhenResult on an actuator forwards the resolved type to the tile def", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  id: "acwhen",
  name: "when actuator",
  consumesWhenResult: "number",
  onExecute(ctx: Context): void {
    ctx.getWhenResult();
  },
});
`;
    const { services, result } = compileOne("when-actuator.ts", source);
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("when-actuator.ts");
    assert.ok(entry?.program);
    assert.equal(entry.program.consumesWhenResult, CoreTypeIds.Number);

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const actuatorTile = bundle.tiles.find((tile) => tile.tileId === mkActuatorTileId("user.actuator.acwhen"));
    assert.ok(actuatorTile);
    assert.equal(actuatorTile.consumesWhenResult(), CoreTypeIds.Number);
  });

  test("consumesWhenResult named by a TypeRef token resolves and forwards", () => {
    const source = `
import { NumberType, Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snwhenref",
  name: "when ref reader",
  consumesWhenResult: NumberType,
  onExecute(ctx: Context): number {
    const result = ctx.getWhenResult();
    return typeof result === "number" ? result : 0;
  },
});
`;
    const { services, result } = compileOne("when-ref.ts", source);
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("when-ref.ts");
    assert.ok(entry?.program);
    assert.equal(entry.program.consumesWhenResult, CoreTypeIds.Number, "the TypeRef token resolves to its TypeId");

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const sensorTile = bundle.tiles.find((tile) => tile.tileId === mkSensorTileId("user.sensor.snwhenref"));
    assert.ok(sensorTile);
    assert.equal(sensorTile.consumesWhenResult(), CoreTypeIds.Number);
  });

  test("a tile without consumesWhenResult reports no declared consumption", () => {
    const { services, result } = compileOne("plain.ts", PLAIN_NUMBER_SENSOR);
    assert.equal(result.tsErrors.size, 0);
    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const sensorTile = bundle.tiles.find((tile) => tile.tileId === mkSensorTileId("user.sensor.snplain"));
    assert.ok(sensorTile);
    assert.equal(sensorTile.consumesWhenResult(), undefined);
  });

  test("a sensor whose consumesWhenResult resolves to the top type is rejected", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snwhenany",
  name: "when any reader",
  consumesWhenResult: "any",
  onExecute(ctx: Context): number {
    const result = ctx.getWhenResult();
    return typeof result === "number" ? result : 0;
  },
});
`;
    const { result } = compileOne("when-any-sensor.ts", source);
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("when-any-sensor.ts");
    assert.ok(entry, "expected a compile entry");
    const error = entry.diagnostics.find((d) => d.code === CompileDiagCode.ConsumesWhenResultIsAny);
    assert.ok(error, "expected the ConsumesWhenResultIsAny error");
    assert.equal(error.severity, "error");
    assert.equal(entry.program, undefined, "an unofferrable tile is a compile failure, not a forwarded declaration");
  });

  test("an actuator whose consumesWhenResult resolves to the top type is rejected", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  id: "acwhenany",
  name: "when any actuator",
  consumesWhenResult: "any",
  onExecute(ctx: Context): void {
    ctx.getWhenResult();
  },
});
`;
    const { result } = compileOne("when-any-actuator.ts", source);
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("when-any-actuator.ts");
    assert.ok(entry, "expected a compile entry");
    const error = entry.diagnostics.find((d) => d.code === CompileDiagCode.ConsumesWhenResultIsAny);
    assert.ok(error, "the actuator path rejects the top type too");
    assert.equal(error.severity, "error");
    assert.equal(entry.program, undefined, "an unofferrable tile is a compile failure, not a forwarded declaration");
  });

  test("a concrete consumesWhenResult TypeRef token resolves and is not mistaken for the top type", () => {
    const source = `
import { BufferType, Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snwhenbuf",
  name: "when buffer reader",
  consumesWhenResult: BufferType,
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const { result } = compileOne("when-buffer-sensor.ts", source);
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("when-buffer-sensor.ts");
    assert.ok(entry?.program, "a concrete type compiles clean");
    assert.equal(entry.program.consumesWhenResult, CoreTypeIds.Buffer, "the concrete type is forwarded");
    assert.ok(
      !entry.diagnostics.some((d) => d.code === CompileDiagCode.ConsumesWhenResultIsAny),
      "a concrete type must not trip the top-type check"
    );
  });

  test("a concrete required type with no producer in scope still compiles clean", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snwhennp",
  name: "when no producer reader",
  consumesWhenResult: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const { result } = compileOne("when-no-producer.ts", source);
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("when-no-producer.ts");
    assert.ok(
      entry?.program,
      "a concrete no-producer-yet consumer must compile -- the producer gate is not a compile error"
    );
    assert.equal(entry.program.consumesWhenResult, CoreTypeIds.Number);
    assert.ok(
      !entry.diagnostics.some((d) => d.code === CompileDiagCode.ConsumesWhenResultIsAny),
      "no producer in scope is not the top-type category error"
    );
  });
});
