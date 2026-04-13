import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type BooleanValue,
  type BrainServices,
  ContextTypeIds,
  CoreTypeIds,
  type EnumValue,
  type ExecutionContext,
  HandleTable,
  isEnumValue,
  isListValue,
  isMapValue,
  isStructValue,
  type ListValue,
  type MapValue,
  mkNativeStructValue,
  mkNumberValue,
  mkStringValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  Op,
  runtime,
  type Scheduler,
  type StringValue,
  type StructTypeDef,
  type StructValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, LoweringDiagCode, ValidatorDiagCode } from "./diag-codes.js";
import type { UserAuthoredProgram } from "./types.js";

let services: BrainServices;

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

function runActivation(prog: UserAuthoredProgram, handles: HandleTable, callsiteVars?: List<Value>): void {
  if (prog.activationFuncId === undefined) {
    return;
  }

  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, prog.activationFuncId, List.empty<Value>(), mkCtx());
  if (callsiteVars) {
    fiber.callsiteVars = callsiteVars;
  }
  fiber.instrBudget = 1000;

  const result = vm.runFiber(fiber, mkScheduler());
  assert.equal(result.status, VmStatus.DONE);
}
describe("user-authored enum declarations", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("local enum member lowers to EnumValue and resolves a qualified output type", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

enum Direction {
  Up = "north",
  Down = "south",
}

export default Sensor({
  name: "local-user-enum",
  output: "Direction",
  onExecute(ctx: Context): Direction {
    return Direction.Up;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const typeId = mkTypeId(NativeType.Enum, "/user-code.ts::Direction");
    assert.equal(prog.outputType, typeId);

    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isEnumValue(runResult.result!), "expected EnumValue");
      const ev = runResult.result as EnumValue;
      assert.equal(ev.typeId, typeId);
      assert.equal(ev.v, "Up");
    }
  });

  test("local string enum supports equality and string conversion sites", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

enum Direction {
  Up = "north",
  Down = "south",
}

function label(text: string): string {
  return text + "!";
}

export default Sensor({
  name: "local-string-enum-conversion",
  output: "string",
  onExecute(ctx: Context): string {
    const same = Direction.Up === Direction.Up;
    if (!same) {
      return "bad";
    }
    // @ts-ignore testing runtime implicit string enum conversion
    return label(Direction.Down);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.String);
      assert.equal((runResult.result as StringValue).v, "south!");
    }
  });

  test("local numeric enum works in numeric conversion sites", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

enum Throttle {
  Idle = 0,
  Fast = 2,
}

export default Sensor({
  name: "local-numeric-enum",
  output: "number",
  onExecute(ctx: Context): number {
    const speed = Throttle.Fast;
    // @ts-ignore testing runtime implicit numeric enum conversion
    const first: number = speed;
    // @ts-ignore testing runtime implicit numeric enum conversion
    const second: number = speed;
    return first + second;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 4);
    }
  });

  test("empty enum can be referenced as a type", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

enum Empty {}

export default Sensor({
  name: "empty-enum-type",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    let value: Empty | null = null;
    return value === null;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });
});

describe("enum value literals", () => {
  before(async () => {
    services = __test__createBrainServices();
    const types = services.types;
    const dirTypeId = mkTypeId(NativeType.Enum, "Direction");
    if (!types.get(dirTypeId)) {
      types.addEnumType("Direction", {
        symbols: List.from([
          { key: "north", label: "North", value: "north" },
          { key: "south", label: "South", value: "south" },
          { key: "east", label: "East", value: "east" },
          { key: "west", label: "West", value: "west" },
        ]),
        defaultKey: "north",
      });
    }
  });

  test("string literal with enum type annotation produces EnumValue", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

export default Sensor({
  name: "enum-literal",
  output: "Direction",
  onExecute(ctx: Context): Direction {
    const d: Direction = "north";
    return d;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isEnumValue(runResult.result!), "expected EnumValue");
      const ev = runResult.result as EnumValue;
      assert.equal(ev.typeId, mkTypeId(NativeType.Enum, "Direction"));
      assert.equal(ev.v, "north");
    }
  });

  test("enum value as function argument", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

function identity(d: Direction): Direction {
  return d;
}

export default Sensor({
  name: "enum-arg",
  output: "Direction",
  onExecute(ctx: Context): Direction {
    return identity("south");
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isEnumValue(runResult.result!), "expected EnumValue");
      const ev = runResult.result as EnumValue;
      assert.equal(ev.typeId, mkTypeId(NativeType.Enum, "Direction"));
      assert.equal(ev.v, "south");
    }
  });

  test("enum value as return value", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

export default Sensor({
  name: "enum-return",
  output: "Direction",
  onExecute(ctx: Context): Direction {
    return "east";
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isEnumValue(runResult.result!), "expected EnumValue");
      const ev = runResult.result as EnumValue;
      assert.equal(ev.typeId, mkTypeId(NativeType.Enum, "Direction"));
      assert.equal(ev.v, "east");
    }
  });

  test("plain string literal without enum context produces StringValue", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "plain-string",
  output: "string",
  onExecute(ctx: Context): string {
    return "hello";
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.String);
      assert.equal((runResult.result as StringValue).v, "hello");
    }
  });

  test("enum equality (===) returns true for matching values", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

export default Sensor({
  name: "enum-eq-true",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const a: Direction = "north";
    const b: Direction = "north";
    return a === b;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("enum equality (===) returns false for different values", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

function checkEqual(a: Direction, b: Direction): boolean {
  return a === b;
}

export default Sensor({
  name: "enum-eq-false",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return checkEqual("north", "south");
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test("enum inequality (!==) returns true for different values", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

function checkNotEqual(a: Direction, b: Direction): boolean {
  return a !== b;
}

export default Sensor({
  name: "enum-neq",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return checkNotEqual("north", "east");
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });
});
