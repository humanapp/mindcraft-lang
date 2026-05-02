import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type BrainServices,
  type ExecutionContext,
  HandleTable,
  isStructValue,
  mkNativeStructValue,
  mkNumberValue,
  mkStringValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  runtime,
  type Scheduler,
  type StringValue,
  type StructValue,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile } from "./compile.js";

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

function runSensor(source: string, args?: List<Value>): { result: Value | undefined } {
  const ambientSource = buildAmbientDeclarations(services.types);
  const result = compileUserTile(source, { ambientSource, services });
  assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program);

  const prog = result.program!;
  const handles = new HandleTable(100);
  const vm = new runtime.VM(services, prog, handles);
  const ctx = mkCtx();
  const fiberArgs = args ? args : List.empty<Value>();
  const fiber = vm.spawnFiber(1, 0, fiberArgs, ctx);
  fiber.instrBudget = 1000;

  const runResult = vm.runFiber(fiber, mkScheduler());
  assert.equal(runResult.status, VmStatus.DONE);
  if (runResult.status === VmStatus.DONE) {
    return { result: runResult.result };
  }
  return { result: undefined };
}

describe("optional chaining", () => {
  before(() => {
    services = __test__createBrainServices();

    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");

    const innerTypeId = mkTypeId(NativeType.Struct, "Inner");
    if (!types.get(innerTypeId)) {
      types.addStructType("Inner", {
        fields: List.from([
          { name: "value", typeId: numTypeId },
          { name: "label", typeId: strTypeId },
        ]),
      });
    }

    const outerTypeId = mkTypeId(NativeType.Struct, "Outer");
    if (!types.get(outerTypeId)) {
      types.addStructType("Outer", {
        fields: List.from([{ name: "inner", typeId: innerTypeId }]),
      });
    }
  });

  test("obj?.field returns field value when obj is non-null", () => {
    const source = `
import { Sensor, type Context, type Inner } from "mindcraft";

export default Sensor({
  name: "opt-field-nonnull",
  onExecute(ctx: Context): number {
    const obj: Inner | undefined = { value: 42, label: "hi" };
    return obj?.value ?? 0;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, 42);
  });

  test("obj?.field returns undefined when obj is null", () => {
    const source = `
import { Sensor, type Context, type Inner } from "mindcraft";

export default Sensor({
  name: "opt-field-null",
  onExecute(ctx: Context): number {
    const obj = null as Inner | null;
    return obj?.value ?? -1;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, -1);
  });

  test("obj?.field returns undefined when obj is undefined", () => {
    const source = `
import { Sensor, type Context, type Inner } from "mindcraft";

export default Sensor({
  name: "opt-field-undef",
  onExecute(ctx: Context): number {
    const obj = undefined as Inner | undefined;
    return obj?.value ?? -1;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, -1);
  });

  test("arr?.[0] returns element when arr is non-null", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "opt-elem-nonnull",
  onExecute(ctx: Context): number {
    const arr: number[] | undefined = [10, 20, 30];
    return arr?.[1] ?? -1;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, 20);
  });

  test("arr?.[0] returns undefined when arr is null", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "opt-elem-null",
  onExecute(ctx: Context): number {
    const arr = null as number[] | null;
    return arr?.[0] ?? -1;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, -1);
  });

  test("str?.length returns length when str is non-null", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "opt-strlen-nonnull",
  onExecute(ctx: Context): number {
    const s: string | undefined = "hello";
    return s?.length ?? -1;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, 5);
  });

  test("str?.length returns undefined when str is null", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "opt-strlen-null",
  onExecute(ctx: Context): number {
    const s = null as string | null;
    return s?.length ?? -1;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, -1);
  });

  test("fn?.() returns result when fn is non-null", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "opt-call-nonnull",
  onExecute(ctx: Context): number {
    const fn: (() => number) | undefined = () => 99;
    return fn?.() ?? -1;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, 99);
  });

  test("fn?.() returns undefined when fn is null", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "opt-call-null",
  onExecute(ctx: Context): number {
    const fn = null as ((() => number) | null);
    return fn?.() ?? -1;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, -1);
  });

  test("chained optional: obj?.inner.value with null obj", () => {
    const source = `
import { Sensor, type Context, type Outer } from "mindcraft";

export default Sensor({
  name: "opt-chain-null",
  onExecute(ctx: Context): number {
    const obj = null as Outer | null;
    return obj?.inner.value ?? -1;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, -1);
  });

  test("arr?.length returns length when arr is non-null", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "opt-arrlen-nonnull",
  onExecute(ctx: Context): number {
    const arr: number[] | undefined = [1, 2, 3];
    return arr?.length ?? -1;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, 3);
  });

  test("arr?.length returns undefined when arr is null", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "opt-arrlen-null",
  onExecute(ctx: Context): number {
    const arr = null as number[] | null;
    return arr?.length ?? -1;
  },
});
`;
    const { result } = runSensor(source);
    assert.ok(result);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, -1);
  });
});
