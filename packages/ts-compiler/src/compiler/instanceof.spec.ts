import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BooleanValue,
  type BrainServices,
  HandleTable,
  NativeType,
  type NumberValue,
  runtime,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { compileUserTile } from "./compile.js";
import { LoweringDiagCode } from "./diag-codes.js";

let services: BrainServices;

function mkCtx(): ExecutionContext {
  return {
    brain: undefined as never,
    getVariable: () => undefined,
    setVariable: () => {},
    clearVariable: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  };
}

function mkScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

function compileAndRun(source: string): Value {
  const result = compileUserTile(source, { services });
  assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program, "expected program");

  const prog = result.program!;
  const handles = new HandleTable(100);
  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
  fiber.instrBudget = 1000;

  const runResult = vm.runFiber(fiber, mkScheduler());
  assert.equal(runResult.status, VmStatus.DONE);
  assert.ok(runResult.result, "expected a return value");
  return runResult.result!;
}

function compileAndRunBool(source: string): boolean {
  const result = compileAndRun(source);
  assert.equal(result.t, NativeType.Boolean);
  return (result as BooleanValue).v;
}

function compileAndRunNumber(source: string): number {
  const result = compileAndRun(source);
  assert.equal(result.t, NativeType.Number);
  return (result as NumberValue).v;
}

function boolSensor(body: string): string {
  return `
import { Sensor, type Context } from "mindcraft";

class Foo {
  x: number;
  constructor(x: number) { this.x = x; }
}

class Bar {
  y: string;
  constructor(y: string) { this.y = y; }
}

export default Sensor({
  name: "instanceof-test",
  onExecute(ctx: Context): boolean {
    ${body}
  },
});
`;
}

function numberSensor(body: string): string {
  return `
import { Sensor, type Context } from "mindcraft";

class Foo {
  x: number;
  constructor(x: number) { this.x = x; }
}

class Bar {
  y: string;
  constructor(y: string) { this.y = y; }
}

export default Sensor({
  name: "instanceof-test",
  onExecute(ctx: Context): number {
    ${body}
  },
});
`;
}

describe("instanceof operator", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("instance of its own class returns true", () => {
    assert.equal(compileAndRunBool(boolSensor("const f = new Foo(1); return f instanceof Foo;")), true);
  });

  test("instance of a different class returns false", () => {
    assert.equal(compileAndRunBool(boolSensor("const f = new Foo(1); return f instanceof Bar;")), false);
  });

  test("number instanceof Foo returns false", () => {
    assert.equal(compileAndRunBool(boolSensor("const n = 5; return (n as any) instanceof Foo;")), false);
  });

  test("instanceof in conditional", () => {
    assert.equal(
      compileAndRunNumber(numberSensor("const f = new Foo(42); if (f instanceof Foo) { return f.x; } return 0;")),
      42
    );
  });

  test("instanceof with different instances of same class", () => {
    assert.equal(
      compileAndRunBool(boolSensor("const a = new Foo(1); const b = new Foo(2); return a instanceof Foo;")),
      true
    );
  });

  test("Bar instance is not instanceof Foo", () => {
    assert.equal(compileAndRunBool(boolSensor('const b = new Bar("hello"); return b instanceof Foo;')), false);
  });
});

describe("instanceof diagnostics", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("instanceof with non-class RHS produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "instanceof-diag-test",
  onExecute(ctx: Context): boolean {
    const x = 5;
    return (x as any) instanceof String;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.InstanceofRhsNotClass),
      `Expected InstanceofRhsNotClass diagnostic, got: ${JSON.stringify(result.diagnostics)}`
    );
  });
});
