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
  type StringValue,
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
  name: "nested-fn-test",
  output: "number",
  onExecute(ctx: Context): number {
    ${body}
  },
});
`;
}

function sensorReturningString(body: string): string {
  return `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nested-fn-test",
  output: "string",
  onExecute(ctx: Context): string {
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
  fiber.instrBudget = 2000;

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

function compileAndRunString(body: string): string {
  const result = compileAndRun(sensorReturningString(body));
  assert.equal(result.t, NativeType.String);
  return (result as StringValue).v;
}

describe("nested function declarations", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("basic nested function returning a constant", () => {
    const val = compileAndRunNumber(`
      function inner(): number {
        return 42;
      }
      return inner();
    `);
    assert.equal(val, 42);
  });

  test("nested function with parameters", () => {
    const val = compileAndRunNumber(`
      function add(a: number, b: number): number {
        return a + b;
      }
      return add(3, 7);
    `);
    assert.equal(val, 10);
  });

  test("nested function called before its textual position (hoisting)", () => {
    const val = compileAndRunNumber(`
      const x = double(5);
      function double(n: number): number {
        return n * 2;
      }
      return x;
    `);
    assert.equal(val, 10);
  });

  test("multiple nested functions", () => {
    const val = compileAndRunNumber(`
      function square(n: number): number {
        return n * n;
      }
      function addOne(n: number): number {
        return n + 1;
      }
      return addOne(square(3));
    `);
    assert.equal(val, 10);
  });

  test("nested function calling another nested function", () => {
    const val = compileAndRunNumber(`
      function inc(n: number): number {
        return n + 1;
      }
      function incTwice(n: number): number {
        return inc(inc(n));
      }
      return incTwice(5);
    `);
    assert.equal(val, 7);
  });

  test("nested function capturing outer variable", () => {
    const val = compileAndRunNumber(`
      const factor = 3;
      function multiply(n: number): number {
        return n * factor;
      }
      return multiply(4);
    `);
    assert.equal(val, 12);
  });

  test("nested function capturing outer parameter", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nested-fn-capture-param",
  output: "number",
  params: {
    base: { type: "number" },
  },
  onExecute(ctx: Context, params: { base: number }): number {
    const b = params.base;
    function addToBase(n: number): number {
      return b + n;
    }
    return addToBase(5);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("nested function used as a value (passed to another function)", () => {
    const val = compileAndRunNumber(`
      function apply(fn: (n: number) => number, x: number): number {
        return fn(x);
      }
      function triple(n: number): number {
        return n * 3;
      }
      return apply(triple, 4);
    `);
    assert.equal(val, 12);
  });

  test("nested function with string return type", () => {
    const val = compileAndRunString(`
      function greet(name: string): string {
        return "hello " + name;
      }
      return greet("world");
    `);
    assert.equal(val, "hello world");
  });

  test("deeply nested functions (function inside a function)", () => {
    const val = compileAndRunNumber(`
      function outer(n: number): number {
        function inner(m: number): number {
          return m + 1;
        }
        return inner(n) * 2;
      }
      return outer(4);
    `);
    assert.equal(val, 10);
  });

  test("nested function inside if block", () => {
    const val = compileAndRunNumber(`
      const x = 5;
      if (x > 0) {
        function pos(): number { return 1; }
        return pos();
      }
      return 0;
    `);
    assert.equal(val, 1);
  });

  test("hoisted nested functions can call each other regardless of order", () => {
    const val = compileAndRunNumber(`
      function isEven(n: number): number {
        if (n === 0) return 1;
        return isOdd(n - 1);
      }
      function isOdd(n: number): number {
        if (n === 0) return 0;
        return isEven(n - 1);
      }
      return isEven(4);
    `);
    assert.equal(val, 1);
  });

  test("nested function with no captures produces PushFunctionRef (no closure overhead)", () => {
    const source = sensorReturningNumber(`
      function pure(n: number): number {
        return n + 1;
      }
      return pure(9);
    `);
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);
  });

  test("nested function with captures produces MakeClosure", () => {
    const source = sensorReturningNumber(`
      const offset = 10;
      function shifted(n: number): number {
        return n + offset;
      }
      return shifted(5);
    `);
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);
    const val = compileAndRunNumber(`
      const offset = 10;
      function shifted(n: number): number {
        return n + offset;
      }
      return shifted(5);
    `);
    assert.equal(val, 15);
  });

  test("nested function shadows a top-level helper with the same name", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function double(n: number): number {
  return n * 2;
}

export default Sensor({
  name: "shadow-test",
  output: "number",
  onExecute(ctx: Context): number {
    function double(n: number): number {
      return n * 3;
    }
    return double(4);
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
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    assert.ok(runResult.result);
    assert.equal(runResult.result!.t, NativeType.Number);
    assert.equal((runResult.result as NumberValue).v, 12);
  });

  test("two top-level helpers each with a same-named local function don't stomp each other", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function helperA(n: number): number {
  function compute(x: number): number {
    return x + 10;
  }
  return compute(n);
}

function helperB(n: number): number {
  function compute(x: number): number {
    return x * 10;
  }
  return compute(n);
}

export default Sensor({
  name: "no-stomp-test",
  output: "number",
  onExecute(ctx: Context): number {
    return helperA(3) + helperB(3);
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
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    assert.ok(runResult.result);
    assert.equal(runResult.result!.t, NativeType.Number);
    assert.equal((runResult.result as NumberValue).v, 43);
  });
});
