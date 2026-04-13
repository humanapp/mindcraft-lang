import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BrainServices,
  CoreTypeIds,
  HandleTable,
  NativeType,
  type NumberValue,
  runtime,
  type StructTypeDef,
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

describe("interface method signatures as function-typed fields", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("interface with method signature registers function-typed field", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Greeter {
  greet(name: string): string;
}

export default Sensor({
  name: "method-sig-reg",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = services.types;
    const typeId = registry.resolveByName("/user-code.ts::Greeter");
    assert.ok(typeId, "Greeter struct type should be registered");
    const structDef = registry.get(typeId!) as StructTypeDef;
    assert.equal(structDef.coreType, NativeType.Struct);

    let greetTypeId: string | undefined;
    structDef.fields.forEach((f) => {
      if (f.name === "greet") greetTypeId = f.typeId;
    });
    assert.ok(greetTypeId, "greet field should exist");
    const greetDef = registry.get(greetTypeId!);
    assert.ok(greetDef, "greet type def should exist");
    assert.equal(greetDef!.coreType, NativeType.Function, "greet should be a function type");
  });

  test("interface with mixed data and method fields", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Calculator {
  value: number;
  add(n: number): number;
}

export default Sensor({
  name: "method-sig-mixed",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = services.types;
    const typeId = registry.resolveByName("/user-code.ts::Calculator");
    assert.ok(typeId, "Calculator struct type should be registered");
    const structDef = registry.get(typeId!) as StructTypeDef;

    let valueTypeId: string | undefined;
    let addTypeId: string | undefined;
    structDef.fields.forEach((f) => {
      if (f.name === "value") valueTypeId = f.typeId;
      if (f.name === "add") addTypeId = f.typeId;
    });
    assert.equal(valueTypeId, CoreTypeIds.Number, "value should be number");
    assert.ok(addTypeId, "add field should exist");
    const addDef = registry.get(addTypeId!);
    assert.equal(addDef!.coreType, NativeType.Function, "add should be a function type");
  });

  test("object literal with arrow function conforming to interface method", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Doubler {
  compute(n: number): number;
}

export default Sensor({
  name: "method-arrow",
  output: "number",
  onExecute(ctx: Context): number {
    const d: Doubler = { compute: (n: number): number => n * 2 };
    return d.compute(7);
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
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 14);
    }
  });

  test("object literal with method shorthand conforming to interface", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Adder {
  add(a: number, b: number): number;
}

export default Sensor({
  name: "method-shorthand",
  output: "number",
  onExecute(ctx: Context): number {
    const a: Adder = {
      add(a: number, b: number): number {
        return a + b;
      }
    };
    return a.add(3, 5);
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
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 8);
    }
  });

  test("interface method accessing struct data field via closure capture", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Counter {
  count: number;
  increment: () => number;
}

export default Sensor({
  name: "method-capture",
  output: "number",
  onExecute(ctx: Context): number {
    const base = 10;
    const c: Counter = {
      count: base,
      increment: (): number => base + 1,
    };
    return c.increment();
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
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 11);
    }
  });

  test("type alias with method-style field compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

type Multiplier = {
  factor: number;
  multiply(n: number): number;
};

export default Sensor({
  name: "type-alias-method",
  output: "number",
  onExecute(ctx: Context): number {
    const m: Multiplier = {
      factor: 3,
      multiply(n: number): number {
        return n * 3;
      }
    };
    return m.multiply(4);
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
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 12);
    }
  });
});
