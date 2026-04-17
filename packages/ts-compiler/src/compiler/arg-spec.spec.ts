import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type BooleanValue,
  type BrainActionCallArgSpec,
  type BrainActionCallBagSpec,
  type BrainActionCallChoiceSpec,
  type BrainActionCallConditionalSpec,
  type BrainActionCallOptionalSpec,
  type BrainActionCallRepeatSpec,
  type BrainActionCallSeqSpec,
  type BrainServices,
  type ExecutionContext,
  HandleTable,
  type MapValue,
  mkNumberValue,
  mkStringValue,
  NativeType,
  type NumberValue,
  runtime,
  type Scheduler,
  type StringValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildCallDef } from "./call-def-builder.js";
import { compileUserTile } from "./compile.js";
import { DescriptorDiagCode } from "./diag-codes.js";
import type {
  ExtractedChoice,
  ExtractedConditional,
  ExtractedModifier,
  ExtractedOptional,
  ExtractedParam,
  ExtractedRepeated,
  ExtractedSeq,
  UserAuthoredProgram,
} from "./types.js";

let services: BrainServices;

describe("descriptor arg spec extraction", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("modifier is extracted with id, label, and icon", () => {
    const source = `
import { Actuator, type Context, modifier } from "mindcraft";

export default Actuator({
  name: "walk",
  args: [
    modifier("fast", { label: "Fast", icon: "speed" }),
  ],
  onExecute(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.args.length, 1);
    const mod = result.descriptor.args[0] as ExtractedModifier;
    assert.equal(mod.kind, "modifier");
    assert.equal(mod.id, "fast");
    assert.equal(mod.label, "Fast");
    assert.equal(mod.icon, "speed");
  });

  test("modifier without icon omits icon", () => {
    const source = `
import { Actuator, type Context, modifier } from "mindcraft";

export default Actuator({
  name: "walk",
  args: [
    modifier("slow", { label: "Slow" }),
  ],
  onExecute(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const mod = result.descriptor!.args[0] as ExtractedModifier;
    assert.equal(mod.kind, "modifier");
    assert.equal(mod.id, "slow");
    assert.equal(mod.label, "Slow");
    assert.equal(mod.icon, undefined);
  });

  test("param extracts name, type, and anonymous flag", () => {
    const source = `
import { Actuator, type Context, param } from "mindcraft";

export default Actuator({
  name: "chase",
  args: [
    param("speed", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { speed: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const p = result.descriptor!.args[0] as ExtractedParam;
    assert.equal(p.kind, "param");
    assert.equal(p.name, "speed");
    assert.equal(p.type, "number");
    assert.equal(p.anonymous, false);
    assert.equal(p.defaultValue, undefined);
  });

  test("param with default value", () => {
    const source = `
import { Actuator, type Context, param } from "mindcraft";

export default Actuator({
  name: "chase",
  args: [
    param("speed", { type: "number", default: 5 }),
  ],
  onExecute(ctx: Context, args: { speed: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const p = result.descriptor!.args[0] as ExtractedParam;
    assert.equal(p.defaultValue, 5);
  });

  test("param with string default", () => {
    const source = `
import { Actuator, type Context, param } from "mindcraft";

export default Actuator({
  name: "greet",
  args: [
    param("message", { type: "string", default: "hello" }),
  ],
  onExecute(ctx: Context, args: { message: string }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const p = result.descriptor!.args[0] as ExtractedParam;
    assert.equal(p.defaultValue, "hello");
  });

  test("param with boolean default", () => {
    const source = `
import { Actuator, type Context, param } from "mindcraft";

export default Actuator({
  name: "toggle",
  args: [
    param("active", { type: "boolean", default: true }),
  ],
  onExecute(ctx: Context, args: { active: boolean }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const p = result.descriptor!.args[0] as ExtractedParam;
    assert.equal(p.defaultValue, true);
  });

  test("param with null default", () => {
    const source = `
import { Actuator, type Context, param } from "mindcraft";

export default Actuator({
  name: "test",
  args: [
    param("val", { type: "number", default: null }),
  ],
  onExecute(ctx: Context, args: { val: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const p = result.descriptor!.args[0] as ExtractedParam;
    assert.equal(p.defaultValue, null);
  });

  test("anonymous param", () => {
    const source = `
import { Actuator, type Context, param } from "mindcraft";

export default Actuator({
  name: "chase",
  args: [
    param("target", { type: "number", anonymous: true }),
  ],
  onExecute(ctx: Context, args: { target: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const p = result.descriptor!.args[0] as ExtractedParam;
    assert.equal(p.anonymous, true);
  });

  test("choice with named group", () => {
    const source = `
import { Actuator, type Context, choice, param } from "mindcraft";

export default Actuator({
  name: "move",
  args: [
    choice("direction",
      param("left", { type: "number" }),
      param("right", { type: "number" }),
    ),
  ],
  onExecute(ctx: Context, args: { left: number; right: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const c = result.descriptor!.args[0] as ExtractedChoice;
    assert.equal(c.kind, "choice");
    assert.equal(c.name, "direction");
    assert.equal(c.items.length, 2);
    assert.equal((c.items[0] as ExtractedParam).name, "left");
    assert.equal((c.items[1] as ExtractedParam).name, "right");
  });

  test("choice without name", () => {
    const source = `
import { Actuator, type Context, choice, param } from "mindcraft";

export default Actuator({
  name: "move",
  args: [
    choice(
      param("up", { type: "number" }),
      param("down", { type: "number" }),
    ),
  ],
  onExecute(ctx: Context, args: { up: number; down: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const c = result.descriptor!.args[0] as ExtractedChoice;
    assert.equal(c.kind, "choice");
    assert.equal(c.name, undefined);
    assert.equal(c.items.length, 2);
  });

  test("optional wraps inner spec", () => {
    const source = `
import { Actuator, type Context, optional, param } from "mindcraft";

export default Actuator({
  name: "fly",
  args: [
    optional(param("altitude", { type: "number", default: 10 })),
  ],
  onExecute(ctx: Context, args: { altitude: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const opt = result.descriptor!.args[0] as ExtractedOptional;
    assert.equal(opt.kind, "optional");
    const inner = opt.item as ExtractedParam;
    assert.equal(inner.kind, "param");
    assert.equal(inner.name, "altitude");
    assert.equal(inner.defaultValue, 10);
  });

  test("repeated with min and max", () => {
    const source = `
import { Actuator, type Context, repeated, modifier } from "mindcraft";

export default Actuator({
  name: "patrol",
  args: [
    repeated(modifier("waypoint", { label: "Waypoint" }), { min: 1, max: 5 }),
  ],
  onExecute(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const rep = result.descriptor!.args[0] as ExtractedRepeated;
    assert.equal(rep.kind, "repeated");
    assert.equal(rep.min, 1);
    assert.equal(rep.max, 5);
    const inner = rep.item as ExtractedModifier;
    assert.equal(inner.kind, "modifier");
    assert.equal(inner.id, "waypoint");
  });

  test("repeated without bounds", () => {
    const source = `
import { Actuator, type Context, repeated, modifier } from "mindcraft";

export default Actuator({
  name: "patrol",
  args: [
    repeated(modifier("stop", { label: "Stop" })),
  ],
  onExecute(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const rep = result.descriptor!.args[0] as ExtractedRepeated;
    assert.equal(rep.kind, "repeated");
    assert.equal(rep.min, undefined);
    assert.equal(rep.max, undefined);
  });

  test("conditional extracts condition and thenItem", () => {
    const source = `
import { Actuator, type Context, conditional, param } from "mindcraft";

export default Actuator({
  name: "react",
  args: [
    conditional("mode", param("speed", { type: "number" })),
  ],
  onExecute(ctx: Context, args: { speed: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const cond = result.descriptor!.args[0] as ExtractedConditional;
    assert.equal(cond.kind, "conditional");
    assert.equal(cond.condition, "mode");
    const inner = cond.thenItem as ExtractedParam;
    assert.equal(inner.kind, "param");
    assert.equal(inner.name, "speed");
    assert.equal(cond.elseItem, undefined);
  });

  test("conditional extracts else branch when provided", () => {
    const source = `
import { Actuator, type Context, conditional, param } from "mindcraft";

export default Actuator({
  name: "react",
  args: [
    conditional("mode", param("fast-speed", { type: "number" }), param("slow-speed", { type: "number" })),
  ],
  onExecute(ctx: Context, args: Record<string, unknown>): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const cond = result.descriptor!.args[0] as ExtractedConditional;
    assert.equal(cond.kind, "conditional");
    assert.equal(cond.condition, "mode");
    const thenParam = cond.thenItem as ExtractedParam;
    assert.equal(thenParam.name, "fast-speed");
    const elseParam = cond.elseItem as ExtractedParam;
    assert.equal(elseParam.kind, "param");
    assert.equal(elseParam.name, "slow-speed");
  });

  test("seq wraps multiple items in order", () => {
    const source = `
import { Actuator, type Context, seq, param, modifier } from "mindcraft";

export default Actuator({
  name: "combo",
  args: [
    seq(
      modifier("warm-up", { label: "Warm Up" }),
      param("power", { type: "number" }),
    ),
  ],
  onExecute(ctx: Context, args: { power: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const s = result.descriptor!.args[0] as ExtractedSeq;
    assert.equal(s.kind, "seq");
    assert.equal(s.items.length, 2);
    assert.equal(s.items[0].kind, "modifier");
    assert.equal(s.items[1].kind, "param");
  });

  test("nested: choice inside optional", () => {
    const source = `
import { Actuator, type Context, optional, choice, param } from "mindcraft";

export default Actuator({
  name: "steer",
  args: [
    optional(choice("axis",
      param("x", { type: "number" }),
      param("y", { type: "number" }),
    )),
  ],
  onExecute(ctx: Context, args: { x: number; y: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const opt = result.descriptor!.args[0] as ExtractedOptional;
    assert.equal(opt.kind, "optional");
    const c = opt.item as ExtractedChoice;
    assert.equal(c.kind, "choice");
    assert.equal(c.name, "axis");
    assert.equal(c.items.length, 2);
  });

  test("nested: conditional inside seq", () => {
    const source = `
import { Actuator, type Context, seq, conditional, modifier, param } from "mindcraft";

export default Actuator({
  name: "complex",
  args: [
    seq(
      modifier("go", { label: "Go" }),
      conditional("mode", param("boost", { type: "number" })),
    ),
  ],
  onExecute(ctx: Context, args: { boost: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const s = result.descriptor!.args[0] as ExtractedSeq;
    assert.equal(s.kind, "seq");
    assert.equal(s.items.length, 2);
    assert.equal(s.items[0].kind, "modifier");
    const cond = s.items[1] as ExtractedConditional;
    assert.equal(cond.kind, "conditional");
    assert.equal(cond.condition, "mode");
  });

  test("full grammar: all shapes together", () => {
    const source = `
import { Actuator, type Context, modifier, param, choice, optional, repeated, conditional, seq } from "mindcraft";

export default Actuator({
  name: "mega",
  args: [
    modifier("sprint", { label: "Sprint" }),
    param("target", { type: "number" }),
    choice("style",
      param("aggressive", { type: "boolean" }),
      param("cautious", { type: "boolean" }),
    ),
    optional(param("duration", { type: "number", default: 10 })),
    repeated(modifier("checkpoint", { label: "CP" }), { min: 0, max: 3 }),
    conditional("style", param("rage", { type: "number" })),
    seq(
      modifier("begin", { label: "Begin" }),
      param("intensity", { type: "number" }),
    ),
  ],
  onExecute(ctx: Context, args: Record<string, unknown>): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.args.length, 7);
    assert.equal(result.descriptor.args[0].kind, "modifier");
    assert.equal(result.descriptor.args[1].kind, "param");
    assert.equal(result.descriptor.args[2].kind, "choice");
    assert.equal(result.descriptor.args[3].kind, "optional");
    assert.equal(result.descriptor.args[4].kind, "repeated");
    assert.equal(result.descriptor.args[5].kind, "conditional");
    assert.equal(result.descriptor.args[6].kind, "seq");
  });
});

describe("sensor return type extraction", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("type reference return type", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.equal(result.descriptor!.returnType, "boolean");
  });

  test("number keyword return type", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number { return 0; },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.equal(result.descriptor!.returnType, "number");
  });

  test("string keyword return type", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): string { return ""; },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.equal(result.descriptor!.returnType, "string");
  });

  test("async unwraps Promise<T>", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  async onExecute(ctx: Context): Promise<number> { return 0; },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.equal(result.descriptor!.returnType, "number");
  });

  test("nullable union type is not supported as return type", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number | null { return 0; },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.some((d) => d.code === DescriptorDiagCode.SensorReturnTypeRequired));
  });

  test("void return type produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.some((d) => d.code === DescriptorDiagCode.SensorReturnTypeMustNotBeVoid));
  });

  test("missing return type annotation produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context) { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.some((d) => d.code === DescriptorDiagCode.SensorReturnTypeRequired));
  });

  test("actuator does not extract return type", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "test",
  onExecute(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.equal(result.descriptor!.returnType, undefined);
  });
});

describe("descriptor arg spec extraction diagnostics", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("args as non-array expression produces diagnostic", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "test",
  args: "not-an-array" as any,
  onExecute(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.some((d) => d.code === DescriptorDiagCode.ArgsMustBeArrayLiteral));
  });

  test("non-call expression in args array produces diagnostic", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "test",
  args: [
    "not-a-call" as any,
  ],
  onExecute(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.some((d) => d.code === DescriptorDiagCode.ArgSpecMustBeCallExpression));
  });

  test("param missing type property produces diagnostic", () => {
    const source = `
import { Actuator, type Context, param } from "mindcraft";

export default Actuator({
  name: "test",
  args: [
    param("x", {} as any),
  ],
  onExecute(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
  });
});

describe("buildCallDef grammar shapes", () => {
  test("modifier lowers to mod tile id", () => {
    const callDef = buildCallDef("walk", [{ kind: "modifier", id: "fast", label: "Fast" }]);
    assert.equal(callDef.callSpec.type, "bag");
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    assert.equal(bag.items.length, 1);
    assert.equal(bag.items[0].type, "arg");
    assert.equal(bag.items[0].tileId, "tile.modifier->user.walk.fast");
    assert.equal(callDef.argSlots.size(), 1);
    assert.equal(callDef.argSlots.get(0)!.argSpec.tileId, "tile.modifier->user.walk.fast");
  });

  test("param lowers to parameter tile id", () => {
    const callDef = buildCallDef("chase", [{ kind: "param", name: "speed", type: "number", anonymous: false }]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    assert.equal(bag.items[0].type, "arg");
    assert.equal(bag.items[0].tileId, "tile.parameter->user.chase.speed");
    assert.equal(callDef.argSlots.get(0)!.argSpec.tileId, "tile.parameter->user.chase.speed");
  });

  test("anonymous param uses anon tile id", () => {
    const callDef = buildCallDef("chase", [{ kind: "param", name: "target", type: "number", anonymous: true }]);
    assert.equal(callDef.argSlots.get(0)!.argSpec.tileId, "tile.parameter->anon.number");
    assert.equal(callDef.argSlots.get(0)!.argSpec.anonymous, true);
  });

  test("choice lowers to choice spec with options", () => {
    const callDef = buildCallDef("move", [
      {
        kind: "choice",
        name: "direction",
        items: [
          { kind: "param", name: "left", type: "number", anonymous: false },
          { kind: "param", name: "right", type: "number", anonymous: false },
        ],
      },
    ]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    assert.equal(bag.items.length, 1);
    const choiceSpec = bag.items[0] as BrainActionCallChoiceSpec;
    assert.equal(choiceSpec.type, "choice");
    assert.equal(choiceSpec.name, "direction");
    assert.equal(choiceSpec.options.length, 2);
    const opt0 = choiceSpec.options[0] as BrainActionCallArgSpec;
    const opt1 = choiceSpec.options[1] as BrainActionCallArgSpec;
    assert.equal(opt0.tileId, "tile.parameter->user.move.left");
    assert.equal(opt1.tileId, "tile.parameter->user.move.right");

    assert.equal(callDef.argSlots.size(), 2);
    const group0 = callDef.argSlots.get(0)!.choiceGroup;
    const group1 = callDef.argSlots.get(1)!.choiceGroup;
    assert.ok(group0 !== undefined, "choice items should have a choiceGroup");
    assert.equal(group0, group1);
  });

  test("choice without name produces unnamed choice spec", () => {
    const callDef = buildCallDef("test", [
      {
        kind: "choice",
        items: [
          { kind: "param", name: "a", type: "number", anonymous: false },
          { kind: "param", name: "b", type: "number", anonymous: false },
        ],
      },
    ]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    const choiceSpec = bag.items[0] as BrainActionCallChoiceSpec;
    assert.equal(choiceSpec.type, "choice");
    assert.equal(choiceSpec.name, undefined);
  });

  test("optional lowers to optional spec", () => {
    const callDef = buildCallDef("fly", [
      {
        kind: "optional",
        item: { kind: "param", name: "altitude", type: "number", defaultValue: 10, anonymous: false },
      },
    ]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    assert.equal(bag.items.length, 1);
    const optSpec = bag.items[0] as BrainActionCallOptionalSpec;
    assert.equal(optSpec.type, "optional");
    assert.equal(optSpec.item.type, "arg");
    assert.equal(optSpec.item.tileId, "tile.parameter->user.fly.altitude");

    assert.equal(callDef.argSlots.size(), 1);
    assert.equal(callDef.argSlots.get(0)!.argSpec.tileId, "tile.parameter->user.fly.altitude");
  });

  test("repeated lowers to repeat spec with bounds", () => {
    const callDef = buildCallDef("patrol", [
      {
        kind: "repeated",
        item: { kind: "modifier", id: "wp", label: "Waypoint" },
        min: 1,
        max: 5,
      },
    ]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    const repSpec = bag.items[0] as BrainActionCallRepeatSpec;
    assert.equal(repSpec.type, "repeat");
    assert.equal(repSpec.min, 1);
    assert.equal(repSpec.max, 5);
    assert.equal(repSpec.item.type, "arg");
    assert.equal(repSpec.item.tileId, "tile.modifier->user.patrol.wp");
  });

  test("repeated without bounds omits min/max", () => {
    const callDef = buildCallDef("patrol", [
      {
        kind: "repeated",
        item: { kind: "modifier", id: "stop", label: "Stop" },
      },
    ]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    const repSpec = bag.items[0] as BrainActionCallRepeatSpec;
    assert.equal(repSpec.type, "repeat");
    assert.equal(repSpec.min, undefined);
    assert.equal(repSpec.max, undefined);
  });

  test("conditional lowers to conditional spec", () => {
    const callDef = buildCallDef("react", [
      {
        kind: "conditional",
        condition: "mode",
        thenItem: { kind: "param", name: "speed", type: "number", anonymous: false },
      },
    ]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    const condSpec = bag.items[0] as BrainActionCallConditionalSpec;
    assert.equal(condSpec.type, "conditional");
    assert.equal(condSpec.condition, "mode");
    assert.equal(condSpec.then.type, "arg");
    assert.equal((condSpec.then as BrainActionCallArgSpec).tileId, "tile.parameter->user.react.speed");

    assert.equal(callDef.argSlots.size(), 1);
    assert.equal(callDef.argSlots.get(0)!.argSpec.tileId, "tile.parameter->user.react.speed");
  });

  test("conditional with else lowers both branches", () => {
    const callDef = buildCallDef("react", [
      {
        kind: "conditional",
        condition: "mode",
        thenItem: { kind: "param", name: "fast-speed", type: "number", anonymous: false },
        elseItem: { kind: "param", name: "slow-speed", type: "number", anonymous: false },
      },
    ]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    const condSpec = bag.items[0] as BrainActionCallConditionalSpec;
    assert.equal(condSpec.type, "conditional");
    assert.equal(condSpec.condition, "mode");
    assert.equal(condSpec.then.type, "arg");
    assert.equal((condSpec.then as BrainActionCallArgSpec).tileId, "tile.parameter->user.react.fast-speed");
    assert.ok(condSpec.else, "expected else branch");
    assert.equal(condSpec.else!.type, "arg");
    assert.equal((condSpec.else as BrainActionCallArgSpec).tileId, "tile.parameter->user.react.slow-speed");

    assert.equal(callDef.argSlots.size(), 2);
  });

  test("seq lowers to seq spec preserving order", () => {
    const callDef = buildCallDef("combo", [
      {
        kind: "seq",
        items: [
          { kind: "modifier", id: "warm-up", label: "Warm Up" },
          { kind: "param", name: "power", type: "number", anonymous: false },
        ],
      },
    ]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    assert.equal(bag.items.length, 1);
    const seqSpec = bag.items[0] as BrainActionCallSeqSpec;
    assert.equal(seqSpec.type, "seq");
    assert.equal(seqSpec.items.length, 2);
    assert.equal(seqSpec.items[0].type, "arg");
    assert.equal(seqSpec.items[0].tileId, "tile.modifier->user.combo.warm-up");
    assert.equal(seqSpec.items[1].type, "arg");
    assert.equal(seqSpec.items[1].tileId, "tile.parameter->user.combo.power");

    assert.equal(callDef.argSlots.size(), 2);
  });

  test("deeply nested: optional choice of params", () => {
    const callDef = buildCallDef("deep", [
      {
        kind: "optional",
        item: {
          kind: "choice",
          name: "style",
          items: [
            { kind: "param", name: "fast", type: "boolean", anonymous: false },
            { kind: "param", name: "slow", type: "boolean", anonymous: false },
          ],
        },
      },
    ]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    const optSpec = bag.items[0] as BrainActionCallOptionalSpec;
    assert.equal(optSpec.type, "optional");
    const choiceSpec = optSpec.item as BrainActionCallChoiceSpec;
    assert.equal(choiceSpec.type, "choice");
    assert.equal(choiceSpec.name, "style");
    assert.equal(choiceSpec.options.length, 2);

    assert.equal(callDef.argSlots.size(), 2);
    const cg0 = callDef.argSlots.get(0)!.choiceGroup;
    const cg1 = callDef.argSlots.get(1)!.choiceGroup;
    assert.ok(cg0 !== undefined);
    assert.equal(cg0, cg1);
  });

  test("optional(choice(anon_A, anon_B)) has correct argSlots with choiceGroup", () => {
    const callDef = buildCallDef("teleport", [
      {
        kind: "optional",
        item: {
          kind: "choice",
          items: [
            { kind: "param", name: "destPos", type: "Vector2", anonymous: true },
            { kind: "param", name: "destActor", type: "ActorRef", anonymous: true },
          ],
        },
      },
    ]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    assert.equal(bag.items.length, 1);
    const optSpec = bag.items[0] as BrainActionCallOptionalSpec;
    assert.equal(optSpec.type, "optional");
    const choiceSpec = optSpec.item as BrainActionCallChoiceSpec;
    assert.equal(choiceSpec.type, "choice");
    assert.equal(choiceSpec.options.length, 2);
    const opt0 = choiceSpec.options[0] as BrainActionCallArgSpec;
    const opt1 = choiceSpec.options[1] as BrainActionCallArgSpec;
    assert.equal(opt0.tileId, "tile.parameter->anon.Vector2");
    assert.equal(opt0.anonymous, true);
    assert.equal(opt1.tileId, "tile.parameter->anon.ActorRef");
    assert.equal(opt1.anonymous, true);

    assert.equal(callDef.argSlots.size(), 2);
    assert.equal(callDef.argSlots.get(0)!.slotId, 0);
    assert.equal(callDef.argSlots.get(0)!.argSpec.tileId, "tile.parameter->anon.Vector2");
    assert.equal(callDef.argSlots.get(1)!.slotId, 1);
    assert.equal(callDef.argSlots.get(1)!.argSpec.tileId, "tile.parameter->anon.ActorRef");
    const cg0 = callDef.argSlots.get(0)!.choiceGroup;
    const cg1 = callDef.argSlots.get(1)!.choiceGroup;
    assert.ok(cg0 !== undefined, "anonymous choice items should have choiceGroup");
    assert.equal(cg0, cg1);
  });

  test("seq containing repeated modifier and param", () => {
    const callDef = buildCallDef("attack", [
      {
        kind: "seq",
        items: [
          {
            kind: "repeated",
            item: { kind: "modifier", id: "charge", label: "Charge" },
            min: 1,
            max: 3,
          },
          { kind: "param", name: "damage", type: "number", anonymous: false },
        ],
      },
    ]);
    const bag = callDef.callSpec as BrainActionCallBagSpec;
    const seqSpec = bag.items[0] as BrainActionCallSeqSpec;
    assert.equal(seqSpec.type, "seq");
    assert.equal(seqSpec.items.length, 2);
    const repSpec = seqSpec.items[0] as BrainActionCallRepeatSpec;
    assert.equal(repSpec.type, "repeat");
    assert.equal(repSpec.min, 1);
    assert.equal(repSpec.max, 3);
    assert.equal(seqSpec.items[1].type, "arg");

    assert.equal(callDef.argSlots.size(), 2);
  });

  test("all grammar shapes together in one callDef", () => {
    const callDef = buildCallDef("mega", [
      { kind: "modifier", id: "sprint", label: "Sprint" },
      { kind: "param", name: "target", type: "number", anonymous: false },
      {
        kind: "choice",
        name: "style",
        items: [
          { kind: "param", name: "aggressive", type: "boolean", anonymous: false },
          { kind: "param", name: "cautious", type: "boolean", anonymous: false },
        ],
      },
      {
        kind: "optional",
        item: { kind: "param", name: "duration", type: "number", defaultValue: 10, anonymous: false },
      },
      {
        kind: "repeated",
        item: { kind: "modifier", id: "checkpoint", label: "CP" },
        min: 0,
        max: 3,
      },
      {
        kind: "conditional",
        condition: "style",
        thenItem: { kind: "param", name: "rage", type: "number", anonymous: false },
      },
      {
        kind: "seq",
        items: [
          { kind: "modifier", id: "begin", label: "Begin" },
          { kind: "param", name: "intensity", type: "number", anonymous: false },
        ],
      },
    ]);

    const bag = callDef.callSpec as BrainActionCallBagSpec;
    assert.equal(bag.type, "bag");
    assert.equal(bag.items.length, 7);

    assert.equal(bag.items[0].type, "arg");
    assert.equal(bag.items[0].tileId, "tile.modifier->user.mega.sprint");

    assert.equal(bag.items[1].type, "arg");
    assert.equal(bag.items[1].tileId, "tile.parameter->user.mega.target");

    assert.equal((bag.items[2] as BrainActionCallChoiceSpec).type, "choice");
    assert.equal((bag.items[3] as BrainActionCallOptionalSpec).type, "optional");
    assert.equal((bag.items[4] as BrainActionCallRepeatSpec).type, "repeat");
    assert.equal((bag.items[5] as BrainActionCallConditionalSpec).type, "conditional");
    assert.equal((bag.items[6] as BrainActionCallSeqSpec).type, "seq");

    assert.equal(callDef.argSlots.size(), 9);

    const slot0 = callDef.argSlots.get(0)!;
    assert.equal(slot0.argSpec.tileId, "tile.modifier->user.mega.sprint");
    assert.equal(slot0.choiceGroup, undefined);

    const slot1 = callDef.argSlots.get(1)!;
    assert.equal(slot1.argSpec.tileId, "tile.parameter->user.mega.target");
    assert.equal(slot1.choiceGroup, undefined);

    const slot2 = callDef.argSlots.get(2)!;
    assert.equal(slot2.argSpec.tileId, "tile.parameter->user.mega.aggressive");
    assert.ok(slot2.choiceGroup !== undefined);
    const slot3 = callDef.argSlots.get(3)!;
    assert.equal(slot3.argSpec.tileId, "tile.parameter->user.mega.cautious");
    assert.equal(slot2.choiceGroup, slot3.choiceGroup);

    const slot4 = callDef.argSlots.get(4)!;
    assert.equal(slot4.argSpec.tileId, "tile.parameter->user.mega.duration");

    const slot5 = callDef.argSlots.get(5)!;
    assert.equal(slot5.argSpec.tileId, "tile.modifier->user.mega.checkpoint");

    const slot6 = callDef.argSlots.get(6)!;
    assert.equal(slot6.argSpec.tileId, "tile.parameter->user.mega.rage");

    const slot7 = callDef.argSlots.get(7)!;
    assert.equal(slot7.argSpec.tileId, "tile.modifier->user.mega.begin");

    const slot8 = callDef.argSlots.get(8)!;
    assert.equal(slot8.argSpec.tileId, "tile.parameter->user.mega.intensity");
  });
});

describe("end-to-end: extraction through callDef", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("sensor with all grammar shapes compiles and produces valid program", () => {
    const source = `
import { Sensor, type Context, modifier, param, choice, optional, repeated, conditional, seq } from "mindcraft";

export default Sensor({
  name: "complex-sensor",
  args: [
    modifier("fast", { label: "Fast" }),
    param("range", { type: "number" }),
    choice("mode",
      param("walk", { type: "boolean" }),
      param("run", { type: "boolean" }),
    ),
    optional(param("timeout", { type: "number", default: 30 })),
    repeated(modifier("flag", { label: "Flag" }), { min: 0, max: 2 }),
    conditional("mode", param("stamina", { type: "number" })),
    seq(
      modifier("start", { label: "Start" }),
      param("power", { type: "number" }),
    ),
  ],
  onExecute(ctx: Context, args: Record<string, unknown>): boolean {
    return true;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    assert.equal(result.program.kind, "sensor");
    assert.equal(result.program.name, "complex-sensor");
    assert.ok(result.program.outputType, "expected outputType to be set");
    assert.equal(result.program.args.length, 7);

    const callDef = result.program.callDef;
    assert.equal(callDef.callSpec.type, "bag");

    const bag = callDef.callSpec as BrainActionCallBagSpec;
    assert.equal(bag.items.length, 7);
    assert.equal(bag.items[0].type, "arg");
    assert.equal((bag.items[2] as BrainActionCallChoiceSpec).type, "choice");
    assert.equal((bag.items[3] as BrainActionCallOptionalSpec).type, "optional");
    assert.equal((bag.items[4] as BrainActionCallRepeatSpec).type, "repeat");
    assert.equal((bag.items[5] as BrainActionCallConditionalSpec).type, "conditional");
    assert.equal((bag.items[6] as BrainActionCallSeqSpec).type, "seq");

    assert.ok(callDef.argSlots.size() >= 8);
  });

  test("actuator with nested grammar compiles cleanly", () => {
    const source = `
import { Actuator, type Context, choice, optional, param, seq, modifier } from "mindcraft";

export default Actuator({
  name: "patrol",
  args: [
    seq(
      optional(choice("approach",
        param("stealthy", { type: "boolean" }),
        param("direct", { type: "boolean" }),
      )),
      param("destination", { type: "number" }),
    ),
    modifier("urgent", { label: "Urgent" }),
  ],
  async onExecute(ctx: Context, args: Record<string, unknown>): Promise<void> {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);
    assert.equal(result.program.kind, "actuator");
    assert.equal(result.program.isAsync, true);

    const bag = result.program.callDef.callSpec as BrainActionCallBagSpec;
    assert.equal(bag.items.length, 2);
    const seqSpec = bag.items[0] as BrainActionCallSeqSpec;
    assert.equal(seqSpec.type, "seq");
    assert.equal(seqSpec.items.length, 2);
    const optSpec = seqSpec.items[0] as BrainActionCallOptionalSpec;
    assert.equal(optSpec.type, "optional");
    const choiceSpec = optSpec.item as BrainActionCallChoiceSpec;
    assert.equal(choiceSpec.type, "choice");
    assert.equal(choiceSpec.name, "approach");
  });
});

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    brain: undefined as never,
    getVariable: () => undefined,
    setVariable: () => {},
    clearVariable: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
    ...overrides,
  };
}

function mkScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

function mkArgsMap(entries: Record<number, Value>): MapValue {
  const dict = new ValueDict();
  for (const [key, value] of Object.entries(entries)) {
    dict.set(Number(key), value);
  }
  return { t: NativeType.Map, typeId: "map:<args>", v: dict };
}

function execSensor(prog: UserAuthoredProgram, argsMap: MapValue): Value | undefined {
  const handles = new HandleTable(100);
  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, 0, List.from<Value>([argsMap]), mkCtx());
  fiber.instrBudget = 2000;
  const result = vm.runFiber(fiber, mkScheduler());
  assert.equal(result.status, VmStatus.DONE, "sensor fiber did not complete");
  return result.status === VmStatus.DONE ? result.result : undefined;
}

describe("arg spec execution: args passed to onExecute", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("single param receives value in onExecute", () => {
    const source = `
import { Sensor, param, type Context } from "mindcraft";

export default Sensor({
  name: "single-param",
  args: [
    param("distance", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { distance: number }): number {
    return args.distance * 2;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(result.program!, mkArgsMap({ 0: mkNumberValue(7) }));
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 14);
  });

  test("multiple params receive correct values by position", () => {
    const source = `
import { Sensor, param, type Context } from "mindcraft";

export default Sensor({
  name: "multi-param",
  args: [
    param("a", { type: "number" }),
    param("b", { type: "number" }),
    param("c", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { a: number; b: number; c: number }): number {
    return args.a + args.b * args.c;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(
      result.program!,
      mkArgsMap({
        0: mkNumberValue(10),
        1: mkNumberValue(3),
        2: mkNumberValue(5),
      })
    );
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 25);
  });

  test("string param received correctly", () => {
    const source = `
import { Sensor, param, type Context } from "mindcraft";

export default Sensor({
  name: "str-param",
  args: [
    param("label", { type: "string" }),
  ],
  onExecute(ctx: Context, args: { label: string }): string {
    return args.label + "!";
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(result.program!, mkArgsMap({ 0: mkStringValue("hello") }));
    assert.equal(value!.t, NativeType.String);
    assert.equal((value as StringValue).v, "hello!");
  });

  test("optional param receives value when provided", () => {
    const source = `
import { Sensor, optional, param, type Context } from "mindcraft";

export default Sensor({
  name: "opt-param",
  args: [
    optional(param("speed", { type: "number", default: 5 })),
  ],
  onExecute(ctx: Context, args: { speed: number }): number {
    return args.speed + 1;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(result.program!, mkArgsMap({ 0: mkNumberValue(20) }));
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 21);
  });

  test("choice params receive value for selected option", () => {
    const source = `
import { Sensor, choice, param, type Context } from "mindcraft";

export default Sensor({
  name: "choice-param",
  args: [
    choice("mode",
      param("walkSpeed", { type: "number" }),
      param("runSpeed", { type: "number" }),
    ),
  ],
  onExecute(ctx: Context, args: { walkSpeed: number; runSpeed: number }): number {
    return args.walkSpeed + args.runSpeed;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(
      result.program!,
      mkArgsMap({
        0: mkNumberValue(3),
        1: mkNumberValue(10),
      })
    );
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 13);
  });

  test("conditional then-branch param receives value", () => {
    const source = `
import { Sensor, conditional, param, type Context } from "mindcraft";

export default Sensor({
  name: "cond-param",
  args: [
    conditional("mode", param("boost", { type: "number" })),
  ],
  onExecute(ctx: Context, args: { boost: number }): number {
    return args.boost * 3;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(result.program!, mkArgsMap({ 0: mkNumberValue(4) }));
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 12);
  });

  test("seq params receive values in declaration order", () => {
    const source = `
import { Sensor, seq, param, modifier, type Context } from "mindcraft";

export default Sensor({
  name: "seq-params",
  args: [
    seq(
      param("x", { type: "number" }),
      param("y", { type: "number" }),
    ),
  ],
  onExecute(ctx: Context, args: { x: number; y: number }): number {
    return args.x - args.y;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(
      result.program!,
      mkArgsMap({
        0: mkNumberValue(100),
        1: mkNumberValue(37),
      })
    );
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 63);
  });

  test("mixed grammar: params from different nesting levels all receive values", () => {
    const source = `
import { Sensor, param, optional, choice, seq, modifier, type Context } from "mindcraft";

export default Sensor({
  name: "mixed",
  args: [
    param("base", { type: "number" }),
    optional(param("multiplier", { type: "number", default: 1 })),
    choice("direction",
      param("left", { type: "number" }),
      param("right", { type: "number" }),
    ),
    seq(
      param("start", { type: "number" }),
      param("end", { type: "number" }),
    ),
  ],
  onExecute(ctx: Context, args: {
    base: number; multiplier: number;
    left: number; right: number;
    start: number; end: number;
  }): number {
    return args.base + args.multiplier + args.left + args.right + args.start + args.end;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(
      result.program!,
      mkArgsMap({
        0: mkNumberValue(1),
        1: mkNumberValue(2),
        2: mkNumberValue(3),
        3: mkNumberValue(4),
        4: mkNumberValue(5),
        5: mkNumberValue(6),
      })
    );
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 21);
  });

  test("boolean param controls branch in onExecute", () => {
    const source = `
import { Sensor, param, type Context } from "mindcraft";

export default Sensor({
  name: "bool-branch",
  args: [
    param("fast", { type: "boolean" }),
    param("speed", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { fast: boolean; speed: number }): number {
    if (args.fast) {
      return args.speed * 2;
    }
    return args.speed;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);

    const boolTrue: Value = { t: NativeType.Boolean, v: true };
    const boolFalse: Value = { t: NativeType.Boolean, v: false };

    const fast = execSensor(result.program!, mkArgsMap({ 0: boolTrue, 1: mkNumberValue(10) }));
    assert.equal((fast as NumberValue).v, 20);

    const slow = execSensor(result.program!, mkArgsMap({ 0: boolFalse, 1: mkNumberValue(10) }));
    assert.equal((slow as NumberValue).v, 10);
  });

  test("repeated modifier occupies slot before param", () => {
    const source = `
import { Sensor, repeated, modifier, param, type Context } from "mindcraft";

export default Sensor({
  name: "rep-mod",
  args: [
    repeated(modifier("flag", { label: "Flag" }), { min: 0, max: 3 }),
    param("count", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { flag: number; count: number }): number {
    return args.count + 100;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(result.program!, mkArgsMap({ 1: mkNumberValue(42) }));
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 142);
  });

  test("repeated modifier exposes count, zero when absent", () => {
    const source = `
import { Sensor, repeated, modifier, param, type Context } from "mindcraft";

export default Sensor({
  name: "rep-mod-count",
  args: [
    repeated(modifier("boost", { label: "Boost" }), { min: 0, max: 5 }),
    param("base", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { boost: number; base: number }): number {
    return args.base + args.boost * 10;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);

    const with3 = execSensor(result.program!, mkArgsMap({ 0: mkNumberValue(3), 1: mkNumberValue(5) }));
    assert.equal((with3 as NumberValue).v, 35);

    const with0 = execSensor(result.program!, mkArgsMap({ 1: mkNumberValue(5) }));
    assert.equal((with0 as NumberValue).v, 5);
  });

  test("repeated modifier preserves min/max in descriptor", () => {
    const source = `
import { Sensor, repeated, modifier, type Context } from "mindcraft";

export default Sensor({
  name: "rep-bounds",
  args: [
    repeated(modifier("ping", { label: "Ping" }), { min: 2, max: 4 }),
  ],
  onExecute(ctx: Context, args: { ping: number }): number {
    return args.ping;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    const rep = result.descriptor.args[0];
    assert.equal(rep.kind, "repeated");
    if (rep.kind === "repeated") {
      assert.equal(rep.min, 2);
      assert.equal(rep.max, 4);
      assert.equal(rep.item.kind, "modifier");
    }
  });

  test("optional(choice(A, B)) -- only slot 1 filled returns correct value", () => {
    const source = `
import { Sensor, optional, choice, param, type Context } from "mindcraft";

export default Sensor({
  name: "opt-choice-slot1",
  args: [
    optional(choice(
      param("alpha", { type: "number" }),
      param("beta", { type: "number" }),
    )),
  ],
  onExecute(ctx: Context, args: { alpha: number; beta: number }): number {
    return args.beta;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(result.program!, mkArgsMap({ 1: mkNumberValue(42) }));
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 42);
  });

  test("optional(choice(A, B)) -- only slot 0 filled returns correct value", () => {
    const source = `
import { Sensor, optional, choice, param, type Context } from "mindcraft";

export default Sensor({
  name: "opt-choice-slot0",
  args: [
    optional(choice(
      param("alpha", { type: "number" }),
      param("beta", { type: "number" }),
    )),
  ],
  onExecute(ctx: Context, args: { alpha: number; beta: number }): number {
    return args.alpha;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(result.program!, mkArgsMap({ 0: mkNumberValue(99) }));
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 99);
  });

  test("modifier present yields true in args", () => {
    const source = `
import { Sensor, modifier, type Context } from "mindcraft";

export default Sensor({
  name: "mod-present",
  args: [
    modifier("turbo", { label: "Turbo" }),
  ],
  onExecute(ctx: Context, args: { turbo: boolean }): number {
    if (args.turbo) return 1;
    return 0;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(result.program!, mkArgsMap({ 0: mkNumberValue(1) }));
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 1);
  });

  test("modifier absent yields false in args", () => {
    const source = `
import { Sensor, modifier, type Context } from "mindcraft";

export default Sensor({
  name: "mod-absent",
  args: [
    modifier("turbo", { label: "Turbo" }),
  ],
  onExecute(ctx: Context, args: { turbo: boolean }): number {
    if (args.turbo) return 1;
    return 0;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    const value = execSensor(result.program!, mkArgsMap({}));
    assert.equal(value!.t, NativeType.Number);
    assert.equal((value as NumberValue).v, 0);
  });

  test("modifier in choice with param uses correct slots", () => {
    const source = `
import { Sensor, choice, modifier, param, type Context } from "mindcraft";

export default Sensor({
  name: "mod-choice",
  args: [
    choice(
      modifier("quick", { label: "Quick" }),
      param("amount", { type: "number" }),
    ),
  ],
  onExecute(ctx: Context, args: { quick: boolean; amount: number }): number {
    if (args.quick) return 99;
    return args.amount;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);

    const withMod = execSensor(result.program!, mkArgsMap({ 0: mkNumberValue(1) }));
    assert.equal((withMod as NumberValue).v, 99);

    const withParam = execSensor(result.program!, mkArgsMap({ 1: mkNumberValue(55) }));
    assert.equal((withParam as NumberValue).v, 55);
  });

  test("existing modifier ref without opts compiles", () => {
    const source = `
import { Sensor, modifier, type Context } from "mindcraft";

export default Sensor({
  name: "existing-ref",
  args: [
    modifier("modifier.distance.nearby"),
  ],
  onExecute(ctx: Context, args: { nearby: boolean }): number {
    if (args.nearby) return 1;
    return 0;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    const mod = result.descriptor.args[0] as ExtractedModifier;
    assert.equal(mod.id, "modifier.distance.nearby");

    const value = execSensor(result.program!, mkArgsMap({ 0: mkNumberValue(1) }));
    assert.equal((value as NumberValue).v, 1);
  });

  test("multiple modifiers before param use correct slot indices", () => {
    const source = `
import { Sensor, modifier, param, type Context } from "mindcraft";

export default Sensor({
  name: "multi-mod",
  args: [
    modifier("alpha", { label: "Alpha" }),
    modifier("beta", { label: "Beta" }),
    param("val", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { alpha: boolean; beta: boolean; val: number }): number {
    let result = args.val;
    if (args.alpha) result = result + 10;
    if (args.beta) result = result + 20;
    return result;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);

    const neitherMod = execSensor(result.program!, mkArgsMap({ 2: mkNumberValue(5) }));
    assert.equal((neitherMod as NumberValue).v, 5);

    const bothMods = execSensor(
      result.program!,
      mkArgsMap({ 0: mkNumberValue(1), 1: mkNumberValue(1), 2: mkNumberValue(5) })
    );
    assert.equal((bothMods as NumberValue).v, 35);

    const alphaOnly = execSensor(result.program!, mkArgsMap({ 0: mkNumberValue(1), 2: mkNumberValue(5) }));
    assert.equal((alphaOnly as NumberValue).v, 15);
  });
});
