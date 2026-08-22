import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, runtime } from "@wendoo-lang/core";
import type { BrainServices } from "@wendoo-lang/core/brain";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import type { ExecutionContext, Scheduler } from "@wendoo-lang/core/runtime";
import {
  type BooleanValue,
  HandleTable,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type Value,
  VmStatus,
} from "@wendoo-lang/core/runtime";
import { __test__createPlatformServices } from "@wendoo-lang/core/runtime/__test__";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { compileUserTile } from "./compile.js";

let services: BrainServices;

function toVmServices(b: BrainServices) {
  return __test__createPlatformServices({ runtime: { functions: b.runtime.functions, types: b.runtime.types } })
    .runtime;
}

function mkCtx(): ExecutionContext {
  return {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
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
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "buffer-test",
  onExecute(ctx: Context): number {
    ${body}
  },
});
`;
}

function compileAndRun(source: string): Value {
  const result = compileUserTile(source, { projectNamespace: TEST_PROJECT_NAMESPACE, services });
  assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program, "expected program");

  const prog = result.program!;
  const handles = new HandleTable(100);
  const vm = new runtime.VM(prog, toVmServices(services), { handles });
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

function sensorReturningBoolean(body: string): string {
  return `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "buffer-test",
  onExecute(ctx: Context): boolean {
    ${body}
  },
});
`;
}

function compileAndRunBoolean(body: string): boolean {
  const result = compileAndRun(sensorReturningBoolean(body));
  assert.equal(result.t, NativeType.Boolean);
  return (result as BooleanValue).v;
}

describe("Buffer constructors and accessors", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("Buffer.from([10, 20, 30]).length()", () => {
    assert.equal(compileAndRunNumber("return Buffer.from([10, 20, 30]).length();"), 3);
  });

  test("Buffer.from(...).get(i) reads the byte at i", () => {
    assert.equal(compileAndRunNumber("return Buffer.from([10, 20, 30]).get(1);"), 20);
  });

  test("Buffer.from masks each element to a byte (0-255)", () => {
    assert.equal(compileAndRunNumber("return Buffer.from([256, 511]).get(0);"), 0);
    assert.equal(compileAndRunNumber("return Buffer.from([256, 511]).get(1);"), 255);
  });

  test("Buffer.fromHex parses two hex digits per byte", () => {
    assert.equal(compileAndRunNumber('return Buffer.fromHex("00ff7f").length();'), 3);
    assert.equal(compileAndRunNumber('return Buffer.fromHex("00ff7f").get(1);'), 255);
  });

  test("Buffer.fromString uses latin1 char codes", () => {
    assert.equal(compileAndRunNumber('return Buffer.fromString("ABC").length();'), 3);
    assert.equal(compileAndRunNumber('return Buffer.fromString("ABC").get(0);'), 65);
  });

  test("Buffer.from([]).length() is 0", () => {
    assert.equal(compileAndRunNumber("return Buffer.from([]).length();"), 0);
  });
});

describe("Buffer.isBuffer", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("Buffer.isBuffer(Buffer.from(...)) -> true", () => {
    assert.equal(compileAndRunBoolean("return Buffer.isBuffer(Buffer.from([1, 2, 3]));"), true);
  });

  test("Buffer.isBuffer(5) -> false", () => {
    assert.equal(compileAndRunBoolean("return Buffer.isBuffer(5);"), false);
  });

  test('Buffer.isBuffer("hello") -> false', () => {
    assert.equal(compileAndRunBoolean('return Buffer.isBuffer("hello");'), false);
  });

  test("Buffer.isBuffer of nil -> false", () => {
    assert.equal(
      compileAndRunBoolean(`
        const x: number | null = null;
        return Buffer.isBuffer(x);
      `),
      false
    );
  });

  test("narrows a union to Buffer inside an if (true branch)", () => {
    assert.equal(
      compileAndRunNumber(`
        const x: Buffer | number = Buffer.from([10, 20, 30]);
        if (Buffer.isBuffer(x)) {
          return x.get(0);
        }
        return -1;
      `),
      10
    );
  });

  test("false branch keeps the non-buffer member of the union", () => {
    assert.equal(
      compileAndRunNumber(`
        const x: Buffer | number = 42;
        if (Buffer.isBuffer(x)) {
          return x.get(0);
        }
        return x;
      `),
      42
    );
  });

  test("narrows in a ternary condition", () => {
    assert.equal(
      compileAndRunNumber(`
        const x: Buffer | number = Buffer.from([5, 6]);
        return Buffer.isBuffer(x) ? x.get(1) : -1;
      `),
      6
    );
  });

  test("narrows across && for a follow-on buffer read", () => {
    assert.equal(
      compileAndRunNumber(`
        const x: Buffer | number = Buffer.from([9]);
        if (Buffer.isBuffer(x) && x.get(0) === 9) {
          return 1;
        }
        return 0;
      `),
      1
    );
  });

  test("|| narrows its right operand to the non-buffer member", () => {
    assert.equal(
      compileAndRunNumber(`
        const x: Buffer | number = 5;
        if (Buffer.isBuffer(x) || x === 5) {
          return 1;
        }
        return 0;
      `),
      1
    );
  });

  test("narrows a nullable Buffer | undefined spelling", () => {
    assert.equal(
      compileAndRunNumber(`
        const x: Buffer | undefined = Buffer.from([3, 4]);
        if (Buffer.isBuffer(x)) {
          return x.get(0);
        }
        return -1;
      `),
      3
    );
  });

  test('typeof x === "number" excludes a buffer', () => {
    assert.equal(
      compileAndRunNumber(`
        const x: Buffer | number = Buffer.from([1]);
        return typeof x === "number" ? 1 : 0;
      `),
      0
    );
  });

  test('typeof x === "number" still matches an actual number in the union', () => {
    assert.equal(
      compileAndRunNumber(`
        const x: Buffer | number = 7;
        return typeof x === "number" ? 1 : 0;
      `),
      1
    );
  });

  test("a WendooValue list (AnyList) can hold a buffer and narrow it back", () => {
    const result = compileAndRun(`
import { Sensor, type Context, type AnyList } from "wendoo";

export default Sensor({
  name: "buffer-test",
  onExecute(ctx: Context): number {
    const items: AnyList = [Buffer.from([1, 2]), 3];
    const first = items[0];
    return Buffer.isBuffer(first) ? first.get(1) : -1;
  },
});
`);
    assert.equal(result.t, NativeType.Number);
    assert.equal((result as NumberValue).v, 2);
  });

  test("a Buffer is assignable to a ctx.rule variable slot (WendooValue)", () => {
    assert.equal(
      compileAndRunNumber(`
        ctx.rule.setVariable("payload", Buffer.from([1, 2, 3]));
        return 1;
      `),
      1
    );
  });
});
