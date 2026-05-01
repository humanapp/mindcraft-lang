import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BrainServices,
  HandleTable,
  isListValue,
  mkNumberValue,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  runtime,
  type StringValue,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, LoweringDiagCode } from "./diag-codes.js";

let services: BrainServices;

function mkCtx(): ExecutionContext {
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
  };
}

function mkScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

function sensorReturningString(body: string): string {
  return `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "str-test",
  onExecute(ctx: Context): string {
    ${body}
  },
});
`;
}

function sensorReturningNumber(body: string): string {
  return `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "str-test",
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

function compileAndRunString(body: string): string {
  const result = compileAndRun(sensorReturningString(body));
  assert.equal(result.t, NativeType.String);
  return (result as StringValue).v;
}

function compileAndRunNumber(body: string): number {
  const result = compileAndRun(sensorReturningNumber(body));
  assert.equal(result.t, NativeType.Number);
  return (result as NumberValue).v;
}

describe("String.length", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"hello".length -> 5', () => {
    const v = compileAndRunNumber('return "hello".length;');
    assert.equal(v, 5);
  });

  test('"".length -> 0', () => {
    const v = compileAndRunNumber('return "".length;');
    assert.equal(v, 0);
  });

  test("length on variable", () => {
    const v = compileAndRunNumber(`
      const s = "test";
      return s.length;
    `);
    assert.equal(v, 4);
  });
});

describe("String.charAt", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"abc".charAt(0) -> "a"', () => {
    const v = compileAndRunString('return "abc".charAt(0);');
    assert.equal(v, "a");
  });

  test('"abc".charAt(2) -> "c"', () => {
    const v = compileAndRunString('return "abc".charAt(2);');
    assert.equal(v, "c");
  });
});

describe("String.charCodeAt", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"A".charCodeAt(0) -> 65', () => {
    const v = compileAndRunNumber('return "A".charCodeAt(0);');
    assert.equal(v, 65);
  });

  test('"abc".charCodeAt(1) -> 98', () => {
    const v = compileAndRunNumber('return "abc".charCodeAt(1);');
    assert.equal(v, 98);
  });
});

describe("String.indexOf", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"hello world".indexOf("world") -> 6', () => {
    const v = compileAndRunNumber('return "hello world".indexOf("world");');
    assert.equal(v, 6);
  });

  test('"hello".indexOf("xyz") -> -1', () => {
    const v = compileAndRunNumber('return "hello".indexOf("xyz");');
    assert.equal(v, -1);
  });

  test("indexOf with position argument", () => {
    const v = compileAndRunNumber('return "abcabc".indexOf("abc", 1);');
    assert.equal(v, 3);
  });
});

describe("String.lastIndexOf", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"abcabc".lastIndexOf("abc") -> 3', () => {
    const v = compileAndRunNumber('return "abcabc".lastIndexOf("abc");');
    assert.equal(v, 3);
  });

  test('"hello".lastIndexOf("xyz") -> -1', () => {
    const v = compileAndRunNumber('return "hello".lastIndexOf("xyz");');
    assert.equal(v, -1);
  });

  test("lastIndexOf with position argument", () => {
    const v = compileAndRunNumber('return "abcabc".lastIndexOf("abc", 2);');
    assert.equal(v, 0);
  });
});

describe("String.slice", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"hello".slice(1) -> "ello"', () => {
    const v = compileAndRunString('return "hello".slice(1);');
    assert.equal(v, "ello");
  });

  test('"hello".slice(1, 3) -> "el"', () => {
    const v = compileAndRunString('return "hello".slice(1, 3);');
    assert.equal(v, "el");
  });

  test("slice with negative index", () => {
    const v = compileAndRunString('return "hello".slice(-3);');
    assert.equal(v, "llo");
  });
});

describe("String.substring", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"hello".substring(1) -> "ello"', () => {
    const v = compileAndRunString('return "hello".substring(1);');
    assert.equal(v, "ello");
  });

  test('"hello".substring(1, 3) -> "el"', () => {
    const v = compileAndRunString('return "hello".substring(1, 3);');
    assert.equal(v, "el");
  });
});

describe("String.toLowerCase / toUpperCase", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"Hello".toLowerCase() -> "hello"', () => {
    const v = compileAndRunString('return "Hello".toLowerCase();');
    assert.equal(v, "hello");
  });

  test('"Hello".toUpperCase() -> "HELLO"', () => {
    const v = compileAndRunString('return "Hello".toUpperCase();');
    assert.equal(v, "HELLO");
  });

  test("chained case conversion", () => {
    const v = compileAndRunString('return "Hello World".toLowerCase().toUpperCase();');
    assert.equal(v, "HELLO WORLD");
  });
});

describe("String.trim", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"  hello  ".trim() -> "hello"', () => {
    const v = compileAndRunString('return "  hello  ".trim();');
    assert.equal(v, "hello");
  });

  test('no-op trim on "abc"', () => {
    const v = compileAndRunString('return "abc".trim();');
    assert.equal(v, "abc");
  });
});

describe("String.split", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"a,b,c".split(",") -> ["a","b","c"]', () => {
    const result = compileAndRun(sensorReturningString('return "a,b,c".split(",").join("-");'));
    assert.equal(result.t, NativeType.String);
    assert.equal((result as StringValue).v, "a-b-c");
  });

  test("split returns correct number of parts", () => {
    const v = compileAndRunNumber('return "a,b,c".split(",").length;');
    assert.equal(v, 3);
  });

  test("split with limit", () => {
    const v = compileAndRunNumber('return "a,b,c,d".split(",", 2).length;');
    assert.equal(v, 2);
  });
});

describe("String.concat", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"hello".concat(" world") -> "hello world"', () => {
    const v = compileAndRunString('return "hello".concat(" world");');
    assert.equal(v, "hello world");
  });

  test("concat with multiple args", () => {
    const v = compileAndRunString('return "a".concat("b", "c");');
    assert.equal(v, "abc");
  });

  test("concat with no args returns same string", () => {
    const v = compileAndRunString('return "hello".concat();');
    assert.equal(v, "hello");
  });
});

describe("String.toString / valueOf", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"hello".toString() -> "hello"', () => {
    const v = compileAndRunString('return "hello".toString();');
    assert.equal(v, "hello");
  });

  test('"hello".valueOf() -> "hello"', () => {
    const v = compileAndRunString('return "hello".valueOf();');
    assert.equal(v, "hello");
  });
});

describe("String bracket access", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test('"abc"[0] -> "a"', () => {
    const v = compileAndRunString(`
      const s = "abc";
      return s[0];
    `);
    assert.equal(v, "a");
  });

  test('"abc"[2] -> "c"', () => {
    const v = compileAndRunString(`
      const s = "abc";
      return s[2];
    `);
    assert.equal(v, "c");
  });
});

describe("String expressions", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("string methods compose", () => {
    const v = compileAndRunString('return "  Hello World  ".trim().toLowerCase();');
    assert.equal(v, "hello world");
  });

  test("string in a variable", () => {
    const v = compileAndRunString(`
      const s = "Hello";
      return s.slice(0, 3);
    `);
    assert.equal(v, "Hel");
  });

  test("string method in a loop", () => {
    const v = compileAndRunString(`
      let result = "";
      const parts = "a,b,c".split(",");
      for (const p of parts) {
        result = result + p.toUpperCase();
      }
      return result;
    `);
    assert.equal(v, "ABC");
  });

  test("indexOf in a conditional", () => {
    const v = compileAndRunString(`
      const s = "hello world";
      if (s.indexOf("world") >= 0) {
        return "found";
      }
      return "not found";
    `);
    assert.equal(v, "found");
  });
});

describe("String diagnostics", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("unsupported string method produces diagnostic", () => {
    const source = sensorReturningString('return "hello".padStart(10);');
    const result = compileUserTile(source, { services });
    assert.ok(
      result.diagnostics.some(
        (d) => d.code === LoweringDiagCode.UnsupportedStringMethod || d.code === CompileDiagCode.TypeScriptError
      )
    );
  });
});
