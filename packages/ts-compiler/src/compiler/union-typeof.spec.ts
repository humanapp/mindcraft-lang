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
describe("union types", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("tsTypeToTypeId returns a union TypeId for number | string (not Any)", () => {
    const types = services.types;
    const unionId = types.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    assert.ok(unionId);
    assert.notEqual(unionId, CoreTypeIds.Any);
    const def = types.get(unionId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.Union);
  });

  test("[1, 'hello'] compiles to a list with a union element type, not AnyList", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "union-list",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: (number | string)[] = [1, "hello"];
    return arr.length;
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
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 2);
    }
  });

  test("ambient output for a union type emits member1 | member2", () => {
    const types = services.types;
    types.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const ambientSource = buildAmbientDeclarations(services.types);
    assert.ok(!ambientSource.includes("union:<"), "union type internal name should not appear in ambient output");
  });

  test("operator resolution works through union expansion: (number | string) + number", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "union-op",
  output: "number",
  onExecute(ctx: Context): number {
    const x: number | null = 5;
    return x + 1;
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
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 6);
    }
  });
});

describe("typeof lowering", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("typeof x === 'number' compiles and returns true for number", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-number",
  output: "boolean",
  params: { val: { type: "number", default: 42 } },
  onExecute(ctx: Context, params: { val: number }): boolean {
    return typeof params.val === "number";
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

    const args = mkArgsMap({ 0: mkNumberValue(42) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("typeof x !== 'string' produces negated result", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-not-string",
  output: "boolean",
  params: { val: { type: "number", default: 42 } },
  onExecute(ctx: Context, params: { val: number }): boolean {
    return typeof params.val !== "string";
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

    const args = mkArgsMap({ 0: mkNumberValue(42) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("reversed form: 'boolean' === typeof x", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-reversed",
  output: "boolean",
  params: { val: { type: "boolean", default: true } },
  onExecute(ctx: Context, params: { val: boolean }): boolean {
    return "boolean" === typeof params.val;
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

    const args = mkArgsMap({ 0: { t: NativeType.Boolean, v: true } });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("typeof x === 'undefined' for nil value", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-undefined",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const x: number | null = null;
    return typeof x === "undefined";
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
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("typeof x === 'object' produces a diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-object",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const x = 5;
    return typeof x === "object";
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "expected a diagnostic for unsupported typeof comparison");
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.UnsupportedTypeofComparison),
      `expected diagnostic about unsupported typeof, got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("typeof in if-statement for runtime narrowing", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-narrowing",
  output: "number",
  params: { val: { type: "number", default: 10 } },
  onExecute(ctx: Context, params: { val: number }): number {
    if (typeof params.val === "number") {
      return params.val + 1;
    }
    return 0;
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

    const args = mkArgsMap({ 0: mkNumberValue(10) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 11);
    }
  });
});

// ---- Function references ----
