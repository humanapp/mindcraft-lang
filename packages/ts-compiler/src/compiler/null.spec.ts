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
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
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
describe("null literal support", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("null assigned to a variable compiles to NIL_VALUE", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "null-var",
  onExecute(ctx: Context): number {
    let x: number | null = null;
    if (x === null) {
      x = 42;
    }
    return x;
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
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("helper function returning null produces NIL_VALUE", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function maybeNull(): number | null {
  return null;
}

export default Sensor({
  name: "null-return",
  onExecute(ctx: Context): number {
    const val = maybeNull();
    if (val === null) {
      return 99;
    }
    return val;
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
      assert.equal((runResult.result as NumberValue).v, 99);
    }
  });

  test("null in callsite-persistent variable with comparison", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let cached: number | null = null;

export default Sensor({
  name: "null-callsite",
  onExecute(ctx: Context): number {
    if (cached === null) {
      cached = 7;
    }
    return cached;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    {
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;

      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 7);
      }
    }
  });

  test("number !== null returns true", () => {
    const source = `
import { Sensor, param, type Context } from "mindcraft";

export default Sensor({
  name: "not-null",
  args: [
    param("x", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { x: number }): boolean {
    const val: number | null = args.x;
    return val !== null;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const args = mkArgsList({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, args, mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("null === null returns true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nil-eq",
  onExecute(ctx: Context): boolean {
    const a: number | null = null;
    const b: number | null = null;
    return a === b;
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
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("undefined compiles to NIL_VALUE", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "undef-var",
  onExecute(ctx: Context): number {
    let x: number | undefined = undefined;
    if (x === undefined) {
      x = 42;
    }
    return x;
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

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as NumberValue).v, 42);
    }
  });

  test("undefined === null returns true (both are nil)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "undef-null-eq",
  onExecute(ctx: Context): boolean {
    const a: number | undefined = undefined;
    const b: number | null = null;
    return a === b;
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

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as BooleanValue).v, true);
    }
  });

  test("number !== undefined returns true", () => {
    const source = `
import { Sensor, param, type Context } from "mindcraft";

export default Sensor({
  name: "not-undef",
  args: [
    param("x", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { x: number }): boolean {
    const val: number | undefined = args.x;
    return val !== undefined;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const args = mkArgsList({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, args, mkCtx());
    fiber.instrBudget = 1000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as BooleanValue).v, true);
    }
  });

  test("true && false -> false", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "and-test",
  onExecute(ctx: Context): boolean {
    return true && false;
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
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test("false && sideEffect() -> false (short-circuit, side effect not called)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let called = false;

function sideEffect(): boolean {
  called = true;
  return true;
}

export default Sensor({
  name: "and-short",
  onExecute(ctx: Context): boolean {
    const result = false && sideEffect();
    return called;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test("false || true -> true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "or-test",
  onExecute(ctx: Context): boolean {
    return false || true;
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

  test("true || sideEffect() -> true (short-circuit, side effect not called)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let called = false;

function sideEffect(): boolean {
  called = true;
  return false;
}

export default Sensor({
  name: "or-short",
  onExecute(ctx: Context): boolean {
    const result = true || sideEffect();
    return called;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test("!true -> false, !false -> true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "not-test",
  onExecute(ctx: Context): boolean {
    return !true;
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
      assert.equal((runResult.result as BooleanValue).v, false);
    }

    const source2 = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "not-test2",
  onExecute(ctx: Context): boolean {
    return !false;
  },
});
`;
    const result2 = compileUserTile(source2, { services });
    assert.deepStrictEqual(result2.diagnostics, []);
    assert.ok(result2.program);

    const prog2 = result2.program!;
    const vm2 = new runtime.VM(services, prog2, new HandleTable(100));
    const fiber2 = vm2.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber2.instrBudget = 1000;

    const runResult2 = vm2.runFiber(fiber2, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal(runResult2.result!.t, NativeType.Boolean);
      assert.equal((runResult2.result as BooleanValue).v, true);
    }
  });

  test("0 && 42 -> 0 (JS value-preserving semantics)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "and-val",
  onExecute(ctx: Context): number {
    return 0 && 42;
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
      assert.equal((runResult.result as NumberValue).v, 0);
    }
  });

  test('"a" + "b" -> "ab" (string concatenation)', () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "str-concat",
  onExecute(ctx: Context): string {
    return "a" + "b";
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
      assert.equal((runResult.result as StringValue).v, "ab");
    }
  });

  test("template literal with number interpolation -> 'count: 42'", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "template-num",
  onExecute(ctx: Context): string {
    const n: number = 42;
    return \`count: \${n}\`;
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
      assert.equal((runResult.result as StringValue).v, "count: 42");
    }
  });

  test("template literal with multiple spans -> correct concatenation", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "template-multi",
  onExecute(ctx: Context): string {
    const a: string = "hello";
    const b: string = "world";
    return \`\${a}-\${b}\`;
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
      assert.equal((runResult.result as StringValue).v, "hello-world");
    }
  });

  test('empty template literal `` -> "" (no substitution template)', () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "empty-template",
  onExecute(ctx: Context): string {
    return \`\`;
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
      assert.equal((runResult.result as StringValue).v, "");
    }
  });

  test("template literal with undetermined type produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "template-any",
  onExecute(ctx: Context): string {
    const x: any = 42;
    return \`val: \${x}\`;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.CannotConvertToString),
      `Expected diagnostic about type determination but got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("template literal with null interpolation produces no-conversion diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "template-null",
  onExecute(ctx: Context): string {
    return \`val: \${null}\`;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.NoConversionToString),
      `Expected no-conversion diagnostic but got: ${JSON.stringify(result.diagnostics)}`
    );
  });
});

describe("nullable types", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("tsTypeToTypeId returns nullable TypeId for number | null parameter", () => {
    const source = `
import { Sensor, optional, param, type Context } from "mindcraft";

export default Sensor({
  name: "nullable-num",
  args: [
    optional(param("value", { type: "number?", default: null })),
  ],
  onExecute(ctx: Context, args: { value: number | null }): number {
    return 0;
  },
});
`;
    const types = services.types;
    const nullableNumberId = types.addNullableType(mkTypeId(NativeType.Number, "number"));
    const nullableDef = types.get(nullableNumberId);
    assert.ok(nullableDef);
    assert.equal(nullableDef.nullable, true);
    assert.equal(nullableNumberId, "number:<number?>");
  });

  test("tsTypeToTypeId returns nullable TypeId for string | undefined", () => {
    const types = services.types;
    const nullableStringId = types.addNullableType(mkTypeId(NativeType.String, "string"));
    assert.equal(nullableStringId, "string:<string?>");
    const def = types.get(nullableStringId);
    assert.ok(def);
    assert.equal(def.nullable, true);
  });

  test("multi-member non-null union resolves to Any (not nullable)", () => {
    const types = services.types;
    const anyId = types.get(mkTypeId(NativeType.Any, "any"));
    assert.ok(anyId);
    assert.equal(anyId.nullable, undefined);
  });

  test("ambient output includes | null for nullable types", () => {
    const types = services.types;
    types.addNullableType(mkTypeId(NativeType.Number, "number"));
    const ambientSource = buildAmbientDeclarations(services.types);
    assert.ok(
      ambientSource.includes("number?") && ambientSource.includes("number | null"),
      "ambient declarations should include nullable type with | null"
    );
  });
});

describe("nullable struct nil comparison", () => {
  before(() => {
    services = __test__createBrainServices();
    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
      });
    }
    types.addNullableType(vec2TypeId);
  });

  test("nullable struct === null compiles and returns true when nil", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "struct-nil-eq",
  onExecute(ctx: Context): boolean {
    const v: Vector2 | null = null;
    return v === null;
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
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("nullable struct !== null compiles and returns true when non-nil", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "struct-nil-neq",
  onExecute(ctx: Context): boolean {
    const v: Vector2 | null = { x: 1, y: 2 };
    return v !== null;
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
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("null === nullable struct compiles (nil on left side)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "nil-lhs-eq",
  onExecute(ctx: Context): boolean {
    const v: Vector2 | null = null;
    return null === v;
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
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("nullable struct !== null returns false when nil", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "struct-nil-neq-false",
  onExecute(ctx: Context): boolean {
    const v: Vector2 | null = null;
    return v !== null;
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
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });
});

describe("auto-instantiated list types", () => {
  before(async () => {
    services = __test__createBrainServices();

    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");

    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
      });
    }
  });

  test("Vector2[] compiles via auto-instantiation without pre-registered Vector2List", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "vec-list",
  onExecute(ctx: Context): number {
    const vecs: ReadonlyArray<Vector2> = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    return vecs.length;
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

  test("ambient generation skips auto-instantiated types", () => {
    const types = services.types;
    types.instantiate("List", List.from([CoreTypeIds.Number]));
    const ambientSource = buildAmbientDeclarations(services.types);
    assert.ok(
      !ambientSource.includes("List<number:<number>>"),
      "auto-instantiated type name should not appear in ambient"
    );
  });
});
