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
  name: "bitwise-test",
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

describe("Bitwise AND (&)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("5 & 3 === 1", () => {
    assert.equal(compileAndRunNumber("return 5 & 3;"), 1);
  });

  test("0xFF & 0x0F === 0x0F", () => {
    assert.equal(compileAndRunNumber("return 0xFF & 0x0F;"), 0x0f);
  });

  test("compound &=", () => {
    assert.equal(compileAndRunNumber("let x = 0xFF; x &= 0x0F; return x;"), 0x0f);
  });
});

describe("Bitwise OR (|)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("5 | 3 === 7", () => {
    assert.equal(compileAndRunNumber("return 5 | 3;"), 7);
  });

  test("0xF0 | 0x0F === 0xFF", () => {
    assert.equal(compileAndRunNumber("return 0xF0 | 0x0F;"), 0xff);
  });

  test("compound |=", () => {
    assert.equal(compileAndRunNumber("let x = 0xF0; x |= 0x0F; return x;"), 0xff);
  });
});

describe("Bitwise XOR (^)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("5 ^ 3 === 6", () => {
    assert.equal(compileAndRunNumber("return 5 ^ 3;"), 6);
  });

  test("self-xor is zero: 42 ^ 42 === 0", () => {
    assert.equal(compileAndRunNumber("return 42 ^ 42;"), 0);
  });

  test("compound ^=", () => {
    assert.equal(compileAndRunNumber("let x = 5; x ^= 3; return x;"), 6);
  });
});

describe("Bitwise NOT (~)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("~5 === -6", () => {
    assert.equal(compileAndRunNumber("return ~5;"), -6);
  });

  test("~0 === -1", () => {
    assert.equal(compileAndRunNumber("return ~0;"), -1);
  });

  test("~~x === x (double complement)", () => {
    assert.equal(compileAndRunNumber("return ~~42;"), 42);
  });
});

describe("Left shift (<<)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("1 << 3 === 8", () => {
    assert.equal(compileAndRunNumber("return 1 << 3;"), 8);
  });

  test("5 << 0 === 5", () => {
    assert.equal(compileAndRunNumber("return 5 << 0;"), 5);
  });

  test("compound <<=", () => {
    assert.equal(compileAndRunNumber("let x = 1; x <<= 4; return x;"), 16);
  });
});

describe("Right shift (>>)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("8 >> 2 === 2", () => {
    assert.equal(compileAndRunNumber("return 8 >> 2;"), 2);
  });

  test("-8 >> 1 === -4 (sign-extending)", () => {
    assert.equal(compileAndRunNumber("return -8 >> 1;"), -4);
  });

  test("compound >>=", () => {
    assert.equal(compileAndRunNumber("let x = 32; x >>= 3; return x;"), 4);
  });
});

describe("Bitwise operator precedence", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("<< binds tighter than &: 1 << 2 & 7 === 4", () => {
    assert.equal(compileAndRunNumber("return 1 << 2 & 7;"), 4);
  });

  test("& binds tighter than ^: 7 & 3 ^ 1 === 2", () => {
    assert.equal(compileAndRunNumber("return 7 & 3 ^ 1;"), 2);
  });

  test("^ binds tighter than |: 3 ^ 1 | 4 === 6", () => {
    assert.equal(compileAndRunNumber("return 3 ^ 1 | 4;"), 6);
  });

  test("+ binds tighter than <<: 1 + 1 << 2 === 8", () => {
    assert.equal(compileAndRunNumber("return 1 + 1 << 2;"), 8);
  });

  test("** binds tighter than &: 2 ** 3 & 5 === 0", () => {
    assert.equal(compileAndRunNumber("return 2 ** 3 & 5;"), 0);
  });

  test("~ has highest precedence: ~3 & 5 === 4", () => {
    assert.equal(compileAndRunNumber("return ~3 & 5;"), 4);
  });

  test("bitwise with variable operands", () => {
    assert.equal(compileAndRunNumber("const a = 12; const b = 10; return a & b;"), 8);
  });
});
