import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, runtime } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import type { ExecutionContext } from "@wendoo/core/runtime";
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
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { expectDiagnostic } from "../testsupport/diag-coverage.js";
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
describe("union types", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("tsTypeToTypeId returns a union TypeId for number | string (not Any)", () => {
    const types = services.runtime.types;
    const unionId = types.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    assert.ok(unionId);
    assert.notEqual(unionId, CoreTypeIds.Any);
    const def = types.get(unionId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.Union);
  });

  test("[1, 'hello'] compiles to a list with a union element type, not AnyList", () => {
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "union-list",
  onExecute(ctx: Context): number {
    const arr: (number | string)[] = [1, "hello"];
    return arr.length;
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
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
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 2);
    }
  });

  test("ambient output for a union type emits member1 | member2", () => {
    const types = services.runtime.types;
    types.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    assert.ok(!ambientSource.includes("union:<"), "union type internal name should not appear in ambient output");
  });

  test("operator resolution works through union expansion: (number | string) + number", () => {
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "union-op",
  onExecute(ctx: Context): number {
    const x: number | null = 5;
    return x + 1;
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
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
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, optional, param, type Context } from "wendoo";

export default Sensor({
  name: "typeof-number",
  args: [
    optional(param("val", { type: "number", default: 42 })),
  ],
  onExecute(ctx: Context, args: { val: number }): boolean {
    return typeof args.val === "number";
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
    const ctx = mkCtx();

    const args = mkArgsList({ 0: mkNumberValue(42) });
    const fiber = vm.spawnFiber(1, 0, args, ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("typeof x !== 'string' produces negated result", () => {
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, optional, param, type Context } from "wendoo";

export default Sensor({
  name: "typeof-not-string",
  args: [
    optional(param("val", { type: "number", default: 42 })),
  ],
  onExecute(ctx: Context, args: { val: number }): boolean {
    return typeof args.val !== "string";
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
    const ctx = mkCtx();

    const args = mkArgsList({ 0: mkNumberValue(42) });
    const fiber = vm.spawnFiber(1, 0, args, ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("reversed form: 'boolean' === typeof x", () => {
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, optional, param, type Context } from "wendoo";

export default Sensor({
  name: "typeof-reversed",
  args: [
    optional(param("val", { type: "boolean", default: true })),
  ],
  onExecute(ctx: Context, args: { val: boolean }): boolean {
    return "boolean" === typeof args.val;
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
    const ctx = mkCtx();

    const args = mkArgsList({ 0: { t: NativeType.Boolean, v: true } });
    const fiber = vm.spawnFiber(1, 0, args, ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("typeof x === 'undefined' for nil value", () => {
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "typeof-undefined",
  onExecute(ctx: Context): boolean {
    const x: number | null = null;
    return typeof x === "undefined";
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
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
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("typeof x === 'object' produces a diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "typeof-object",
  onExecute(ctx: Context): boolean {
    const x = 5;
    return typeof x === "object";
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.ok(result.diagnostics.length > 0, "expected a diagnostic for unsupported typeof comparison");
    expectDiagnostic(result.diagnostics, LoweringDiagCode.UnsupportedTypeofComparison);
  });

  test("typeof in if-statement for runtime narrowing", () => {
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, optional, param, type Context } from "wendoo";

export default Sensor({
  name: "typeof-narrowing",
  args: [
    optional(param("val", { type: "number", default: 10 })),
  ],
  onExecute(ctx: Context, args: { val: number }): number {
    if (typeof args.val === "number") {
      return args.val + 1;
    }
    return 0;
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
    const ctx = mkCtx();

    const args = mkArgsList({ 0: mkNumberValue(10) });
    const fiber = vm.spawnFiber(1, 0, args, ctx);
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
