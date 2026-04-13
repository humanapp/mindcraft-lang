import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
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
  name: "assign-test",
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

describe("Modulo compound assignment (%=)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("x %= 3 (x = 10 -> 1)", () => {
    assert.equal(compileAndRunNumber("let x = 10; x %= 3; return x;"), 1);
  });

  test("x %= 4 (x = 17 -> 1)", () => {
    assert.equal(compileAndRunNumber("let x = 17; x %= 4; return x;"), 1);
  });
});

describe("Nullish assignment (??=)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("assigns when null", () => {
    assert.equal(compileAndRunNumber("let x: number | null = null; x ??= 5; return x as number;"), 5);
  });

  test("keeps value when non-null", () => {
    assert.equal(compileAndRunNumber("let x: number | null = 10; x ??= 5; return x as number;"), 10);
  });

  test("assigns when undefined (nil)", () => {
    assert.equal(compileAndRunNumber("let x: number | undefined = undefined; x ??= 42; return x as number;"), 42);
  });

  test("does not assign for zero (not nullish)", () => {
    assert.equal(compileAndRunNumber("let x: number | null = 0; x ??= 99; return x as number;"), 0);
  });
});

describe("Logical OR assignment (||=)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("assigns when falsy (0)", () => {
    assert.equal(compileAndRunNumber("let x = 0; x ||= 5; return x;"), 5);
  });

  test("keeps value when truthy", () => {
    assert.equal(compileAndRunNumber("let x = 10; x ||= 5; return x;"), 10);
  });

  test("assigns when falsy (false -> number)", () => {
    assert.equal(
      compileAndRunNumber("let x: number | boolean = false as number | boolean; x ||= 7; return x as number;"),
      7
    );
  });
});

describe("Logical AND assignment (&&=)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("assigns when truthy", () => {
    assert.equal(compileAndRunNumber("let x = 1; x &&= 5; return x;"), 5);
  });

  test("keeps value when falsy (0)", () => {
    assert.equal(compileAndRunNumber("let x = 0; x &&= 5; return x;"), 0);
  });

  test("assigns when truthy (42 -> 99)", () => {
    assert.equal(compileAndRunNumber("let x = 42; x &&= 99; return x;"), 99);
  });
});
