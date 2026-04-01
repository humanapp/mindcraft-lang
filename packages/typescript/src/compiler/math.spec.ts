import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  HandleTable,
  mkNumberValue,
  NativeType,
  type NumberValue,
  registerCoreBrainComponents,
  runtime,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, LoweringDiagCode } from "./diag-codes.js";

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
  name: "math-test",
  output: "number",
  onExecute(ctx: Context): number {
    ${body}
  },
});
`;
}

function compileAndRun(source: string): Value {
  const result = compileUserTile(source);
  assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program, "expected program");

  const prog = result.program!;
  const handles = new HandleTable(100);
  const vm = new runtime.VM(prog, handles);
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

describe("Math constants", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("Math.PI", () => {
    const v = compileAndRunNumber("return Math.PI;");
    assert.equal(v, Math.PI);
  });

  test("Math.E", () => {
    const v = compileAndRunNumber("return Math.E;");
    assert.equal(v, Math.E);
  });

  test("Math.LN2", () => {
    const v = compileAndRunNumber("return Math.LN2;");
    assert.equal(v, Math.LN2);
  });

  test("Math.LN10", () => {
    const v = compileAndRunNumber("return Math.LN10;");
    assert.equal(v, Math.LN10);
  });

  test("Math.LOG2E", () => {
    const v = compileAndRunNumber("return Math.LOG2E;");
    assert.equal(v, Math.LOG2E);
  });

  test("Math.LOG10E", () => {
    const v = compileAndRunNumber("return Math.LOG10E;");
    assert.equal(v, Math.LOG10E);
  });

  test("Math.SQRT2", () => {
    const v = compileAndRunNumber("return Math.SQRT2;");
    assert.equal(v, Math.SQRT2);
  });

  test("Math.SQRT1_2", () => {
    const v = compileAndRunNumber("return Math.SQRT1_2;");
    assert.equal(v, Math.SQRT1_2);
  });
});

describe("Math unary methods", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("Math.abs(-5) -> 5", () => {
    const v = compileAndRunNumber("return Math.abs(-5);");
    assert.equal(v, 5);
  });

  test("Math.abs(3) -> 3", () => {
    const v = compileAndRunNumber("return Math.abs(3);");
    assert.equal(v, 3);
  });

  test("Math.ceil(4.3) -> 5", () => {
    const v = compileAndRunNumber("return Math.ceil(4.3);");
    assert.equal(v, 5);
  });

  test("Math.floor(4.7) -> 4", () => {
    const v = compileAndRunNumber("return Math.floor(4.7);");
    assert.equal(v, 4);
  });

  test("Math.round(4.5) -> 5", () => {
    const v = compileAndRunNumber("return Math.round(4.5);");
    assert.equal(v, 5);
  });

  test("Math.round(4.4) -> 4", () => {
    const v = compileAndRunNumber("return Math.round(4.4);");
    assert.equal(v, 4);
  });

  test("Math.sqrt(9) -> 3", () => {
    const v = compileAndRunNumber("return Math.sqrt(9);");
    assert.equal(v, 3);
  });

  test("Math.sqrt(2) -> Math.SQRT2", () => {
    const v = compileAndRunNumber("return Math.sqrt(2);");
    assert.equal(v, Math.sqrt(2));
  });

  test("Math.sin(0) -> 0", () => {
    const v = compileAndRunNumber("return Math.sin(0);");
    assert.equal(v, 0);
  });

  test("Math.cos(0) -> 1", () => {
    const v = compileAndRunNumber("return Math.cos(0);");
    assert.equal(v, 1);
  });

  test("Math.tan(0) -> 0", () => {
    const v = compileAndRunNumber("return Math.tan(0);");
    assert.equal(v, 0);
  });

  test("Math.asin(1) -> PI/2", () => {
    const v = compileAndRunNumber("return Math.asin(1);");
    assert.equal(v, Math.asin(1));
  });

  test("Math.acos(1) -> 0", () => {
    const v = compileAndRunNumber("return Math.acos(1);");
    assert.equal(v, 0);
  });

  test("Math.atan(1) -> PI/4", () => {
    const v = compileAndRunNumber("return Math.atan(1);");
    assert.equal(v, Math.atan(1));
  });

  test("Math.exp(0) -> 1", () => {
    const v = compileAndRunNumber("return Math.exp(0);");
    assert.equal(v, 1);
  });

  test("Math.exp(1) -> E", () => {
    const v = compileAndRunNumber("return Math.exp(1);");
    assert.equal(v, Math.exp(1));
  });

  test("Math.log(1) -> 0", () => {
    const v = compileAndRunNumber("return Math.log(1);");
    assert.equal(v, 0);
  });

  test("Math.log(Math.E) -> 1", () => {
    const v = compileAndRunNumber("return Math.log(Math.E);");
    assert.ok(Math.abs(v - 1) < 1e-10, `expected ~1, got ${v}`);
  });
});

describe("Math binary methods", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("Math.max(3, 7) -> 7", () => {
    const v = compileAndRunNumber("return Math.max(3, 7);");
    assert.equal(v, 7);
  });

  test("Math.max(-1, -5) -> -1", () => {
    const v = compileAndRunNumber("return Math.max(-1, -5);");
    assert.equal(v, -1);
  });

  test("Math.min(3, 7) -> 3", () => {
    const v = compileAndRunNumber("return Math.min(3, 7);");
    assert.equal(v, 3);
  });

  test("Math.min(-1, -5) -> -5", () => {
    const v = compileAndRunNumber("return Math.min(-1, -5);");
    assert.equal(v, -5);
  });

  test("Math.pow(2, 10) -> 1024", () => {
    const v = compileAndRunNumber("return Math.pow(2, 10);");
    assert.equal(v, 1024);
  });

  test("Math.pow(9, 0.5) -> 3", () => {
    const v = compileAndRunNumber("return Math.pow(9, 0.5);");
    assert.equal(v, 3);
  });

  test("Math.atan2(1, 1) -> PI/4", () => {
    const v = compileAndRunNumber("return Math.atan2(1, 1);");
    assert.equal(v, Math.atan2(1, 1));
  });

  test("Math.atan2(0, -1) -> PI", () => {
    const v = compileAndRunNumber("return Math.atan2(0, -1);");
    assert.equal(v, Math.atan2(0, -1));
  });
});

describe("Math.random", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("Math.random() returns a number", () => {
    const v = compileAndRunNumber("return Math.random();");
    assert.ok(typeof v === "number");
    assert.ok(v >= 0 && v < 1, `expected [0,1), got ${v}`);
  });
});

describe("Math expressions", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("Math methods compose with arithmetic", () => {
    const v = compileAndRunNumber("return Math.floor(Math.PI * 100);");
    assert.equal(v, 314);
  });

  test("Math in a variable", () => {
    const v = compileAndRunNumber(`
      const x = Math.sqrt(16);
      return x + 1;
    `);
    assert.equal(v, 5);
  });

  test("nested Math calls", () => {
    const v = compileAndRunNumber("return Math.abs(Math.floor(-3.7));");
    assert.equal(v, 4);
  });

  test("Math in a loop", () => {
    const v = compileAndRunNumber(`
      let sum = 0;
      for (let i = 0; i < 5; i++) {
        sum = sum + Math.pow(2, i);
      }
      return sum;
    `);
    assert.equal(v, 31);
  });
});

describe("Math diagnostics", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("Math.abs() with no args produces TS error", () => {
    const source = sensorReturningNumber("return Math.abs();");
    const result = compileUserTile(source);
    assert.ok(result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError));
  });

  test("Math.abs(1, 2) with too many args produces TS error", () => {
    const source = sensorReturningNumber("return Math.abs(1, 2);");
    const result = compileUserTile(source);
    assert.ok(result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError));
  });

  test("Math.max(1) with too few args produces lowering diagnostic", () => {
    const source = sensorReturningNumber("return Math.max(1);");
    const result = compileUserTile(source);
    assert.ok(result.diagnostics.some((d) => d.code === LoweringDiagCode.MathMinMaxRequiresTwoArgs));
  });

  test("Math.pow(1, 2, 3) with too many args produces TS error", () => {
    const source = sensorReturningNumber("return Math.pow(1, 2, 3);");
    const result = compileUserTile(source);
    assert.ok(result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError));
  });

  test("Math.nonexistent() produces TS error", () => {
    const source = sensorReturningNumber("return Math.nonexistent();");
    const result = compileUserTile(source);
    assert.ok(result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError));
  });
});
