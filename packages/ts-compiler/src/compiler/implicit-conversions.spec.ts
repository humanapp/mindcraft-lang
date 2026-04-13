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
describe("binary operator implicit conversions", () => {
  before(() => {
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

  test("existing direct overloads still compile and execute", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function joinParts(left: string, right: string): string {
  return left + right;
}

export default Sensor({
  name: "direct-string-add",
  onExecute(ctx: Context): string {
    return joinParts("1", "2");
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
      assert.equal((runResult.result as StringValue).v, "12");
    }
  });

  test("binary lowering can convert the right operand to match an overload", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function addFlag(count: number, flag: boolean): number {
  // @ts-ignore testing runtime implicit conversion behavior
  return count + flag;
}

export default Sensor({
  name: "right-conversion",
  onExecute(ctx: Context): number {
    return addFlag(5, true);
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
      assert.equal((runResult.result as NumberValue).v, 6);
    }
  });

  test("binary lowering reports a no-overload diagnostic when no implicit conversion exists", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function stringify(values: number[]): string {
  return values + "!";
}

export default Sensor({
  name: "missing-overload",
  onExecute(ctx: Context): string {
    return stringify([1, 2]);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0, "expected a lowering diagnostic");
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.NoOperatorOverload),
      `Expected no-overload diagnostic but got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("binary lowering reports ambiguous implicit conversions", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function compare(left: string, right: boolean): boolean {
  // @ts-ignore testing runtime implicit conversion ambiguity
  return left === right;
}

export default Sensor({
  name: "ambiguous-binary-conversion",
  onExecute(ctx: Context): boolean {
    return compare("1", false);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0, "expected an ambiguity diagnostic");
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.AmbiguousImplicitBinaryConversion),
      `Expected ambiguity diagnostic but got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("enum values concatenate with strings through enum-to-string conversion", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

function label(direction: Direction): string {
  return direction + "!";
}

export default Sensor({
  name: "enum-string-concat",
  onExecute(ctx: Context): string {
    return label("south");
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
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
});

describe("target-typed implicit conversions", () => {
  before(() => {
    services = __test__createBrainServices();

    const types = services.types;
    const signalTypeId = mkTypeId(NativeType.Enum, "Signal");
    if (!types.get(signalTypeId)) {
      types.addEnumType("Signal", {
        symbols: List.from([
          { key: "go", label: "Go", value: "green" },
          { key: "stop", label: "Stop", value: "red" },
        ]),
        defaultKey: "go",
      });
    }

    const throttleTypeId = mkTypeId(NativeType.Enum, "Throttle");
    if (!types.get(throttleTypeId)) {
      types.addEnumType("Throttle", {
        symbols: List.from([
          { key: "idle", label: "Idle", value: 0 },
          { key: "fast", label: "Fast", value: 2 },
        ]),
        defaultKey: "idle",
      });
    }
  });

  test("return statement converts a pre-registered enum value to string", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Signal } from "mindcraft";

export default Sensor({
  name: "enum-return-string",
  onExecute(ctx: Context): string {
    const signal: Signal = "go";
    return signal;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
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
      assert.equal((runResult.result as StringValue).v, "green");
    }
  });

  test("function-call arguments convert enum values to the declared parameter type", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Signal } from "mindcraft";

function label(text: string): string {
  return text + "-label";
}

export default Sensor({
  name: "enum-arg-string",
  onExecute(ctx: Context): string {
    const signal: Signal = "go";
    return label(signal);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
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
      assert.equal((runResult.result as StringValue).v, "green-label");
    }
  });

  test("variable initializers and simple assignments convert numeric enum values to number", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Throttle } from "mindcraft";

export default Sensor({
  name: "numeric-enum-targets",
  onExecute(ctx: Context): number {
    const throttle: Throttle = "fast";
    // @ts-ignore testing runtime implicit numeric enum conversion
    const initial: number = throttle;
    let total: number = 0;
    // @ts-ignore testing runtime implicit numeric enum conversion
    total = throttle;
    return initial + total;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
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

  test("missing target-type conversion produces a clear lowering diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function expectText(text: string): string {
  return text;
}

export default Sensor({
  name: "missing-target-conversion",
  onExecute(ctx: Context): string {
    // @ts-ignore testing runtime missing target-type conversion
    return expectText([1, 2]);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0, "expected a lowering diagnostic");
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.NoConversionToTargetType),
      `Expected target-type conversion diagnostic but got: ${JSON.stringify(result.diagnostics)}`
    );
  });
});
