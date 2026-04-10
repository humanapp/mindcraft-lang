import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BrainServices,
  HandleTable,
  mkNumberValue,
  NativeType,
  type NumberValue,
  runtime,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { compileUserTile } from "./compile.js";

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

function sensorReturningNumber(body: string): string {
  return `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "exp-test",
  output: "number",
  onExecute(ctx: Context): number {
    ${body}
  },
});
`;
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

function compileAndRunNumber(body: string): number {
  const result = compileAndRun(sensorReturningNumber(body));
  assert.equal(result.t, NativeType.Number);
  return (result as NumberValue).v;
}

describe("Exponentiation operator (**)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("2 ** 10 === 1024", () => {
    const v = compileAndRunNumber("return 2 ** 10;");
    assert.equal(v, 1024);
  });

  test("9 ** 0.5 === 3 (square root)", () => {
    const v = compileAndRunNumber("return 9 ** 0.5;");
    assert.equal(v, 3);
  });

  test("right-associativity: 2 ** 2 ** 3 === 256", () => {
    const v = compileAndRunNumber("return 2 ** 2 ** 3;");
    assert.equal(v, 256);
  });

  test("negative exponent: 2 ** -1 === 0.5", () => {
    const v = compileAndRunNumber("return 2 ** -1;");
    assert.equal(v, 0.5);
  });

  test("zero exponent: 5 ** 0 === 1", () => {
    const v = compileAndRunNumber("return 5 ** 0;");
    assert.equal(v, 1);
  });
});

describe("Exponentiation precedence", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("** binds tighter than *: 2 * 3 ** 2 === 18", () => {
    const v = compileAndRunNumber("return 2 * 3 ** 2;");
    assert.equal(v, 18);
  });

  test("** binds tighter than * (reversed): 3 ** 2 * 2 === 18", () => {
    const v = compileAndRunNumber("return 3 ** 2 * 2;");
    assert.equal(v, 18);
  });

  test("** binds tighter than /: 16 / 2 ** 2 === 4", () => {
    const v = compileAndRunNumber("return 16 / 2 ** 2;");
    assert.equal(v, 4);
  });

  test("** binds tighter than +: 1 + 2 ** 3 === 9", () => {
    const v = compileAndRunNumber("return 1 + 2 ** 3;");
    assert.equal(v, 9);
  });

  test("** binds tighter than -: 10 - 2 ** 3 === 2", () => {
    const v = compileAndRunNumber("return 10 - 2 ** 3;");
    assert.equal(v, 2);
  });

  test("** binds tighter than %: 10 % 2 ** 3 === 2", () => {
    const v = compileAndRunNumber("return 10 % 2 ** 3;");
    assert.equal(v, 2);
  });

  test("unary minus applied after **: -(2 ** 3) === -8", () => {
    const v = compileAndRunNumber("return -(2 ** 3);");
    assert.equal(v, -8);
  });

  test("parentheses override right-assoc: (2 ** 2) ** 3 === 64", () => {
    const v = compileAndRunNumber("return (2 ** 2) ** 3;");
    assert.equal(v, 64);
  });

  test("triple right-assoc: 2 ** 3 ** 1 ** 4 === 8", () => {
    const v = compileAndRunNumber("return 2 ** 3 ** 1 ** 4;");
    assert.equal(v, 8);
  });

  test("mixed arithmetic: 1 + 2 ** 3 * 4 === 33", () => {
    const v = compileAndRunNumber("return 1 + 2 ** 3 * 4;");
    assert.equal(v, 33);
  });

  test("comparison after **: 2 ** 3 > 7 is true (returns 1)", () => {
    const v = compileAndRunNumber("return 2 ** 3 > 7 ? 1 : 0;");
    assert.equal(v, 1);
  });

  test("** with variable operands", () => {
    const v = compileAndRunNumber("const a = 3; const b = 4; return a ** b;");
    assert.equal(v, 81);
  });

  test("** in subexpression: (1 + 1) ** (1 + 2) === 8", () => {
    const v = compileAndRunNumber("return (1 + 1) ** (1 + 2);");
    assert.equal(v, 8);
  });
});

describe("Compound exponentiation assignment (**=)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("x **= 10 (x = 2 -> 1024)", () => {
    const v = compileAndRunNumber("let x = 2; x **= 10; return x;");
    assert.equal(v, 1024);
  });

  test("x **= 0.5 (square root via compound)", () => {
    const v = compileAndRunNumber("let x = 9; x **= 0.5; return x;");
    assert.equal(v, 3);
  });
});
