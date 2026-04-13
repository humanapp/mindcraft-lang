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
describe("function references and CALL_INDIRECT", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("passing a named function as argument and calling via indirect call", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function double(n: number): number {
  return n * 2;
}

function apply(fn: (n: number) => number, x: number): number {
  return fn(x);
}

export default Sensor({
  name: "test-fn-ref",
  output: "number",
  params: {
    val: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    return apply(double, params.val);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 10);
    }
  });

  test("function reference stored in local variable and called indirectly", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function triple(n: number): number {
  return n * 3;
}

export default Sensor({
  name: "test-fn-local",
  output: "number",
  params: {
    val: { type: "number", default: 4 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const fn = triple;
    return fn(params.val);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(4) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 12);
    }
  });
});

// ---- Closures ----

describe("closures", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("simple closure: makeAdder pattern", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function makeAdder(n: number): (x: number) => number {
  return (x: number): number => x + n;
}

export default Sensor({
  name: "test-closure-adder",
  output: "number",
  params: {
    val: { type: "number", default: 3 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const add5 = makeAdder(5);
    return add5(params.val);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(3) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 8);
    }
  });

  test("closure over multiple variables", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function makeLinear(a: number, b: number): (x: number) => number {
  return (x: number): number => a * x + b;
}

export default Sensor({
  name: "test-closure-multi",
  output: "number",
  params: {
    val: { type: "number", default: 4 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const linear = makeLinear(3, 7);
    return linear(params.val);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(4) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 19);
    }
  });

  test("arrow function with no captures compiles as plain function ref", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function apply(fn: (n: number) => number, x: number): number {
  return fn(x);
}

export default Sensor({
  name: "test-no-capture",
  output: "number",
  params: {
    val: { type: "number", default: 7 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    return apply((x: number): number => x * 2, params.val);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(7) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 14);
    }
  });

  test("closure captures local variable from enclosing scope", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-capture-local",
  output: "number",
  params: {
    val: { type: "number", default: 10 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const threshold = params.val;
    const fn = (x: number): number => x + threshold;
    return fn(5);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(10) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 15);
    }
  });

  test("concise arrow function body (expression, not block)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function apply(fn: (n: number) => number, x: number): number {
  return fn(x);
}

export default Sensor({
  name: "test-concise-arrow",
  output: "number",
  params: {
    val: { type: "number", default: 6 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const offset = 100;
    return apply((x: number): number => x + offset, params.val);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(6) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 106);
    }
  });
});

describe("function type signatures", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("callback parameter gets typed FunctionTypeDef TypeId", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function apply(fn: (n: number) => number, x: number): number {
  return fn(x);
}

function double(n: number): number {
  return n * 2;
}

export default Sensor({
  name: "test-fn-sig",
  output: "number",
  params: {
    val: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    return apply(double, params.val);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const args = mkArgsMap({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 10);
    }
  });

  test("different callback signatures resolve to different function TypeIds", () => {
    const registry = services.types;
    const id1 = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([CoreTypeIds.Number]),
      returnTypeId: CoreTypeIds.Number,
    });
    const id2 = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([CoreTypeIds.String]),
      returnTypeId: CoreTypeIds.Boolean,
    });
    assert.notEqual(id1, id2);
    const def1 = registry.get(id1)!;
    const def2 = registry.get(id2)!;
    assert.equal(def1.coreType, NativeType.Function);
    assert.equal(def2.coreType, NativeType.Function);
  });

  test("closure with typed callback compiles and runs correctly", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function makeTransformer(factor: number): (x: number) => number {
  return (x: number): number => x * factor;
}

export default Sensor({
  name: "test-closure-sig",
  output: "number",
  params: {
    val: { type: "number", default: 3 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const t = makeTransformer(10);
    return t(params.val);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const args = mkArgsMap({ 0: mkNumberValue(3) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 30);
    }
  });
});
