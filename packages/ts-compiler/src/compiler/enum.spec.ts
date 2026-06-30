import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, runtime } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { ExecutionContext } from "@mindcraft-lang/core/runtime";
import {
  type BooleanValue,
  ContextTypeIds,
  CoreTypeIds,
  type EnumValue,
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
  type Scheduler,
  type StringValue,
  type StructTypeDef,
  type StructValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, LoweringDiagCode, ValidatorDiagCode } from "./diag-codes.js";
import type { UserAuthoredProgram } from "./types.js";

let services: BrainServices;

function toVmServices(b: BrainServices) {
  return __test__createPlatformServices({ runtime: { functions: b.runtime.functions, types: b.runtime.types } })
    .runtime;
}

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
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

function mkArgsList(entries: Record<number, Value>): List<Value> {
  const args = List.empty<Value>();
  for (const [key, value] of Object.entries(entries)) {
    const idx = Number(key);
    while (args.size() <= idx) {
      args.push(NIL_VALUE);
    }
    args.set(idx, value);
  }
  return args;
}

function runActivation(prog: UserAuthoredProgram, handles: HandleTable, callsiteVars?: List<Value>): void {
  const runFn = (funcId: number): void => {
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
    const fiber = vm.spawnFiber(1, funcId, List.empty<Value>(), mkCtx());
    if (callsiteVars) {
      fiber.callsiteVars = callsiteVars;
    }
    fiber.instrBudget = 1000;
    const result = vm.runFiber(fiber, mkScheduler());
    assert.equal(result.status, VmStatus.DONE);
  };
  if (prog.initializerFuncId !== undefined) {
    runFn(prog.initializerFuncId);
  }
  if (prog.activationFuncId !== undefined) {
    runFn(prog.activationFuncId);
  }
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
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
    const types = services.runtime.types;
    const dirTypeId = mkTypeId(NativeType.Enum, "Direction");
    if (!types.get(dirTypeId)) {
      types.addEnumType("Direction", {
        atomId: 1024,
        symbols: List.from([
          { key: "north", label: "North", value: "north" },
          { key: "south", label: "South", value: "south" },
          { key: "east", label: "East", value: "east" },
          { key: "west", label: "West", value: "west" },
        ]),
        defaultKey: "north",
        functionIds: { toString: 30104, toNumber: 30105, equalTo: 30106, notEqualTo: 30107 },
      });
    }
  });

  test("string literal with enum type annotation produces EnumValue", () => {
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

export default Sensor({
  name: "enum-literal",
  onExecute(ctx: Context): Direction {
    const d: Direction = "north";
    return d;
  },
});
`;
    const result = compileUserTile(source, {
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

function identity(d: Direction): Direction {
  return d;
}

export default Sensor({
  name: "enum-arg",
  onExecute(ctx: Context): Direction {
    return identity("south");
  },
});
`;
    const result = compileUserTile(source, {
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

export default Sensor({
  name: "enum-return",
  onExecute(ctx: Context): Direction {
    return "east";
  },
});
`;
    const result = compileUserTile(source, {
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "plain-string",
  onExecute(ctx: Context): string {
    return "hello";
  },
});
`;
    const result = compileUserTile(source, {
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

export default Sensor({
  name: "enum-eq-true",
  onExecute(ctx: Context): boolean {
    const a: Direction = "north";
    const b: Direction = "north";
    return a === b;
  },
});
`;
    const result = compileUserTile(source, {
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

function checkEqual(a: Direction, b: Direction): boolean {
  return a === b;
}

export default Sensor({
  name: "enum-eq-false",
  onExecute(ctx: Context): boolean {
    return checkEqual("north", "south");
  },
});
`;
    const result = compileUserTile(source, {
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

function checkNotEqual(a: Direction, b: Direction): boolean {
  return a !== b;
}

export default Sensor({
  name: "enum-neq",
  onExecute(ctx: Context): boolean {
    return checkNotEqual("north", "east");
  },
});
`;
    const result = compileUserTile(source, {
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
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
