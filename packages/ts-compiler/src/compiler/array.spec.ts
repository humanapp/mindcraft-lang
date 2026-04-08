import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BooleanValue,
  type BrainServices,
  HandleTable,
  isListValue,
  type ListValue,
  mkNumberValue,
  mkTypeId,
  NativeType,
  type NumberValue,
  runtime,
  type StringValue,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile } from "./compile.js";
import { LoweringDiagCode } from "./diag-codes.js";

let ambientSource: string;
let services: BrainServices;

function ensureSetup(): void {
  if (!ambientSource) {
    services = __test__createBrainServices();

    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const numListName = "NumberList";
    const numListTypeId = mkTypeId(NativeType.List, numListName);
    if (!types.get(numListTypeId)) {
      types.addListType(numListName, { elementTypeId: numTypeId });
    }

    ambientSource = buildAmbientDeclarations(services.types);
  }
}

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
  name: "arr-test",
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
  name: "arr-test",
  output: "string",
  onExecute(ctx: Context): string {
    ${body}
  },
});
`;
}

function sensorReturningBoolean(body: string): string {
  return `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "arr-test",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    ${body}
  },
});
`;
}

function sensorReturningNumberList(body: string): string {
  return `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "arr-test",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    ${body}
  },
});
`;
}

function compileAndRun(source: string): Value {
  const result = compileUserTile(source, { ambientSource, services });
  assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program, "expected program");

  const prog = result.program!;
  const handles = new HandleTable(100);
  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
  fiber.instrBudget = 10_000;

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

function compileAndRunBoolean(body: string): boolean {
  const result = compileAndRun(sensorReturningBoolean(body));
  assert.equal(result.t, NativeType.Boolean);
  return (result as BooleanValue).v;
}

function compileAndRunNumberList(body: string): number[] {
  const result = compileAndRun(sensorReturningNumberList(body));
  assert.ok(isListValue(result), "expected list value");
  const list = result as ListValue;
  const nums: number[] = [];
  for (let i = 0; i < list.v.size(); i++) {
    assert.equal(list.v.get(i)!.t, NativeType.Number);
    nums.push((list.v.get(i) as NumberValue).v);
  }
  return nums;
}

describe("Array.length", () => {
  before(() => {
    ensureSetup();
  });

  test("[1, 2, 3].length -> 3", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3];
      return arr.length;
    `);
    assert.equal(v, 3);
  });

  test("empty array length -> 0", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [];
      return arr.length;
    `);
    assert.equal(v, 0);
  });
});

describe("Array.push", () => {
  before(() => {
    ensureSetup();
  });

  test("push adds element to array", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 2];
      arr.push(3);
      return arr;
    `);
    assert.deepStrictEqual(v, [1, 2, 3]);
  });
});

describe("Array.pop", () => {
  before(() => {
    ensureSetup();
  });

  test("pop removes last element", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 2, 3];
      arr.pop();
      return arr;
    `);
    assert.deepStrictEqual(v, [1, 2]);
  });
});

describe("Array.shift", () => {
  before(() => {
    ensureSetup();
  });

  test("shift removes first element", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 2, 3];
      arr.shift();
      return arr;
    `);
    assert.deepStrictEqual(v, [2, 3]);
  });
});

describe("Array.unshift", () => {
  before(() => {
    ensureSetup();
  });

  test("unshift adds element to front", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [2, 3];
      arr.unshift(1);
      return arr;
    `);
    assert.deepStrictEqual(v, [1, 2, 3]);
  });
});

describe("Array.indexOf", () => {
  before(() => {
    ensureSetup();
  });

  test("[1, 2, 3].indexOf(2) -> 1", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3];
      return arr.indexOf(2);
    `);
    assert.equal(v, 1);
  });

  test("indexOf returns -1 when not found", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3];
      return arr.indexOf(5);
    `);
    assert.equal(v, -1);
  });

  test("indexOf finds first occurrence", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3, 2, 1];
      return arr.indexOf(2);
    `);
    assert.equal(v, 1);
  });
});

describe("Array.lastIndexOf", () => {
  before(() => {
    ensureSetup();
  });

  test("[1, 2, 3, 2, 1].lastIndexOf(2) -> 3", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3, 2, 1];
      return arr.lastIndexOf(2);
    `);
    assert.equal(v, 3);
  });

  test("lastIndexOf returns -1 when not found", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3];
      return arr.lastIndexOf(5);
    `);
    assert.equal(v, -1);
  });

  test("lastIndexOf on empty array -> -1", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [];
      return arr.lastIndexOf(1);
    `);
    assert.equal(v, -1);
  });

  test("lastIndexOf finds last occurrence", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 1, 1];
      return arr.lastIndexOf(1);
    `);
    assert.equal(v, 2);
  });
});

describe("Array.includes", () => {
  before(() => {
    ensureSetup();
  });

  test("[1, 2, 3].includes(2) -> true", () => {
    const v = compileAndRunBoolean(`
      const arr: number[] = [1, 2, 3];
      return arr.includes(2);
    `);
    assert.equal(v, true);
  });

  test("[1, 2, 3].includes(5) -> false", () => {
    const v = compileAndRunBoolean(`
      const arr: number[] = [1, 2, 3];
      return arr.includes(5);
    `);
    assert.equal(v, false);
  });
});

describe("Array.find", () => {
  before(() => {
    ensureSetup();
  });

  test("find returns matching element", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3, 4];
      const found = arr.find((x) => x > 2);
      return found ?? -1;
    `);
    assert.equal(v, 3);
  });

  test("find returns undefined when no match", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3];
      const found = arr.find((x) => x > 10);
      return found ?? -1;
    `);
    assert.equal(v, -1);
  });
});

describe("Array.findIndex", () => {
  before(() => {
    ensureSetup();
  });

  test("findIndex returns index of matching element", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [10, 20, 30, 40];
      return arr.findIndex((x) => x > 25);
    `);
    assert.equal(v, 2);
  });

  test("findIndex returns -1 when no match", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3];
      return arr.findIndex((x) => x > 10);
    `);
    assert.equal(v, -1);
  });

  test("findIndex on empty array -> -1", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [];
      return arr.findIndex((x) => x > 0);
    `);
    assert.equal(v, -1);
  });

  test("findIndex finds first match", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3, 2, 1];
      return arr.findIndex((x) => x === 2);
    `);
    assert.equal(v, 1);
  });
});

describe("Array.some", () => {
  before(() => {
    ensureSetup();
  });

  test("some returns true when predicate matches", () => {
    const v = compileAndRunBoolean(`
      const arr: number[] = [1, 2, 3];
      return arr.some((x) => x > 2);
    `);
    assert.equal(v, true);
  });

  test("some returns false when no match", () => {
    const v = compileAndRunBoolean(`
      const arr: number[] = [1, 2, 3];
      return arr.some((x) => x > 10);
    `);
    assert.equal(v, false);
  });

  test("some on empty array -> false", () => {
    const v = compileAndRunBoolean(`
      const arr: number[] = [];
      return arr.some((x) => x > 0);
    `);
    assert.equal(v, false);
  });
});

describe("Array.every", () => {
  before(() => {
    ensureSetup();
  });

  test("every returns true when all match", () => {
    const v = compileAndRunBoolean(`
      const arr: number[] = [2, 4, 6];
      return arr.every((x) => x > 0);
    `);
    assert.equal(v, true);
  });

  test("every returns false when one fails", () => {
    const v = compileAndRunBoolean(`
      const arr: number[] = [2, 4, -1];
      return arr.every((x) => x > 0);
    `);
    assert.equal(v, false);
  });

  test("every on empty array -> true", () => {
    const v = compileAndRunBoolean(`
      const arr: number[] = [];
      return arr.every((x) => x > 0);
    `);
    assert.equal(v, true);
  });
});

describe("Array.forEach", () => {
  before(() => {
    ensureSetup();
  });

  test("forEach iterates over all elements", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3, 4];
      const result: number[] = [];
      arr.forEach((x: number): void => {
        result.push(x);
      });
      return result.length;
    `);
    assert.equal(v, 4);
  });
});

describe("Array.map", () => {
  before(() => {
    ensureSetup();
  });

  test("map transforms elements", () => {
    const v = compileAndRunNumberList(`
      const arr: number[] = [1, 2, 3];
      const result: NumberList = arr.map((x) => x * 2);
      return result;
    `);
    assert.deepStrictEqual(v, [2, 4, 6]);
  });

  test("map on empty array -> empty array", () => {
    const v = compileAndRunNumberList(`
      const arr: number[] = [];
      const result: NumberList = arr.map((x) => x * 2);
      return result;
    `);
    assert.deepStrictEqual(v, []);
  });
});

describe("Array.filter", () => {
  before(() => {
    ensureSetup();
  });

  test("filter keeps matching elements", () => {
    const v = compileAndRunNumberList(`
      const arr: number[] = [1, 2, 3, 4, 5];
      const result: NumberList = arr.filter((x) => x > 2);
      return result;
    `);
    assert.deepStrictEqual(v, [3, 4, 5]);
  });

  test("filter with no matches -> empty", () => {
    const v = compileAndRunNumberList(`
      const arr: number[] = [1, 2, 3];
      const result: NumberList = arr.filter((x) => x > 10);
      return result;
    `);
    assert.deepStrictEqual(v, []);
  });
});

describe("Array.reduce", () => {
  before(() => {
    ensureSetup();
  });

  test("reduce with initial value sums elements", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3, 4];
      return arr.reduce((acc, x) => acc + x, 0);
    `);
    assert.equal(v, 10);
  });

  test("reduce without initial value sums elements", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3, 4];
      return arr.reduce((acc, x) => acc + x);
    `);
    assert.equal(v, 10);
  });

  test("reduce with initial value and single element", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [5];
      return arr.reduce((acc, x) => acc + x, 10);
    `);
    assert.equal(v, 15);
  });

  test("reduce without initial value and single element", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [42];
      return arr.reduce((acc, x) => acc + x);
    `);
    assert.equal(v, 42);
  });

  test("reduce computes product", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [1, 2, 3, 4];
      return arr.reduce((acc, x) => acc * x, 1);
    `);
    assert.equal(v, 24);
  });
});

describe("Array.concat", () => {
  before(() => {
    ensureSetup();
  });

  test("concat two arrays", () => {
    const v = compileAndRunNumberList(`
      const a: NumberList = [1, 2];
      const b: number[] = [3, 4];
      return a.concat(b);
    `);
    assert.deepStrictEqual(v, [1, 2, 3, 4]);
  });

  test("concat with empty array", () => {
    const v = compileAndRunNumberList(`
      const a: NumberList = [1, 2];
      const b: number[] = [];
      return a.concat(b);
    `);
    assert.deepStrictEqual(v, [1, 2]);
  });
});

describe("Array.join", () => {
  before(() => {
    ensureSetup();
  });

  test("join with default separator", () => {
    const v = compileAndRunString(`
      const arr: number[] = [1, 2, 3];
      return arr.join();
    `);
    assert.equal(v, "1,2,3");
  });

  test("join with custom separator", () => {
    const v = compileAndRunString(`
      const arr: number[] = [1, 2, 3];
      return arr.join("-");
    `);
    assert.equal(v, "1-2-3");
  });

  test("join empty array", () => {
    const v = compileAndRunString(`
      const arr: number[] = [];
      return arr.join(",");
    `);
    assert.equal(v, "");
  });
});

describe("Array.reverse", () => {
  before(() => {
    ensureSetup();
  });

  test("reverse reverses the array", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 2, 3];
      return arr.reverse();
    `);
    assert.deepStrictEqual(v, [3, 2, 1]);
  });

  test("reverse empty array", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [];
      return arr.reverse();
    `);
    assert.deepStrictEqual(v, []);
  });
});

describe("Array.slice", () => {
  before(() => {
    ensureSetup();
  });

  test("slice with start", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 2, 3, 4, 5];
      return arr.slice(2);
    `);
    assert.deepStrictEqual(v, [3, 4, 5]);
  });

  test("slice with start and end", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 2, 3, 4, 5];
      return arr.slice(1, 3);
    `);
    assert.deepStrictEqual(v, [2, 3]);
  });

  test("slice with no args copies array", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 2, 3];
      return arr.slice();
    `);
    assert.deepStrictEqual(v, [1, 2, 3]);
  });
});

describe("Array.splice", () => {
  before(() => {
    ensureSetup();
  });

  test("splice removes elements", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 2, 3, 4, 5];
      arr.splice(1, 2);
      return arr;
    `);
    assert.deepStrictEqual(v, [1, 4, 5]);
  });

  test("splice inserts elements", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 4, 5];
      arr.splice(1, 0, 2, 3);
      return arr;
    `);
    assert.deepStrictEqual(v, [1, 2, 3, 4, 5]);
  });
});

describe("Array.sort", () => {
  before(() => {
    ensureSetup();
  });

  test("sort with comparator", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [3, 1, 4, 1, 5];
      return arr.sort((a, b) => a - b);
    `);
    assert.deepStrictEqual(v, [1, 1, 3, 4, 5]);
  });

  test("sort descending", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [3, 1, 4, 1, 5];
      return arr.sort((a, b) => b - a);
    `);
    assert.deepStrictEqual(v, [5, 4, 3, 1, 1]);
  });
});

describe("Array.toString", () => {
  before(() => {
    ensureSetup();
  });

  test("[1, 2, 3].toString() -> '1,2,3'", () => {
    const v = compileAndRunString(`
      const arr: number[] = [1, 2, 3];
      return arr.toString();
    `);
    assert.equal(v, "1,2,3");
  });

  test("empty array toString -> ''", () => {
    const v = compileAndRunString(`
      const arr: number[] = [];
      return arr.toString();
    `);
    assert.equal(v, "");
  });
});

describe("Array bracket access", () => {
  before(() => {
    ensureSetup();
  });

  test("[10, 20, 30][1] -> 20", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [10, 20, 30];
      return arr[1];
    `);
    assert.equal(v, 20);
  });

  test("bracket assignment modifies element", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 2, 3];
      arr[1] = 99;
      return arr;
    `);
    assert.deepStrictEqual(v, [1, 99, 3]);
  });
});

describe("Array method diagnostics", () => {
  before(() => {
    ensureSetup();
  });

  test("unknown method produces unsupported diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "arr-test",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: number[] = [1, 2, 3];
    return (arr as any).unknownMethod();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0);
  });
});

describe("Array.from", () => {
  before(() => {
    ensureSetup();
  });

  test("Array.from copies a list", () => {
    const v = compileAndRunNumberList(`
      const src: NumberList = [1, 2, 3];
      const copy: NumberList = Array.from(src);
      return copy;
    `);
    assert.deepStrictEqual(v, [1, 2, 3]);
  });

  test("Array.from with mapping function", () => {
    const v = compileAndRunNumberList(`
      const src: NumberList = [1, 2, 3];
      const doubled: NumberList = Array.from(src, (x: number) => x * 2);
      return doubled;
    `);
    assert.deepStrictEqual(v, [2, 4, 6]);
  });

  test("Array.from produces independent copy", () => {
    const v = compileAndRunNumberList(`
      const src: NumberList = [10, 20, 30];
      const copy: NumberList = Array.from(src);
      copy.push(40);
      return src;
    `);
    assert.deepStrictEqual(v, [10, 20, 30]);
  });

  test("Array.from empty list", () => {
    const v = compileAndRunNumberList(`
      const src: NumberList = [];
      const copy: NumberList = Array.from(src);
      return copy;
    `);
    assert.deepStrictEqual(v, []);
  });

  test("Array.from with index in mapping function", () => {
    const v = compileAndRunNumberList(`
      const src: NumberList = [10, 20, 30];
      const indices: NumberList = Array.from(src, (_val: number, idx: number) => idx);
      return indices;
    `);
    assert.deepStrictEqual(v, [0, 1, 2]);
  });
});

describe("callback index parameter", () => {
  before(() => {
    ensureSetup();
  });

  test("filter with index parameter", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [10, 20, 30, 40];
      return arr.filter((_val: number, idx: number) => idx >= 2);
    `);
    assert.deepStrictEqual(v, [30, 40]);
  });

  test("map with index parameter", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [10, 20, 30];
      return arr.map((_val: number, idx: number) => idx);
    `);
    assert.deepStrictEqual(v, [0, 1, 2]);
  });

  test("forEach with index parameter", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [10, 20, 30];
      const result: NumberList = [];
      arr.forEach((_val: number, idx: number) => { result.push(idx); });
      return result;
    `);
    assert.deepStrictEqual(v, [0, 1, 2]);
  });

  test("some with index parameter", () => {
    const v = compileAndRunBoolean(`
      const arr: number[] = [10, 20, 30];
      return arr.some((_val: number, idx: number) => idx === 2);
    `);
    assert.equal(v, true);
  });

  test("every with index parameter", () => {
    const v = compileAndRunBoolean(`
      const arr: number[] = [10, 20, 30];
      return arr.every((_val: number, idx: number) => idx < 3);
    `);
    assert.equal(v, true);
  });

  test("find with index parameter", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [10, 20, 30];
      const found = arr.find((_val: number, idx: number) => idx === 1);
      return found ?? 0;
    `);
    assert.equal(v, 20);
  });

  test("findIndex with index parameter", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [10, 20, 30];
      return arr.findIndex((_val: number, idx: number) => idx === 2);
    `);
    assert.equal(v, 2);
  });

  test("reduce with index parameter", () => {
    const v = compileAndRunNumber(`
      const arr: number[] = [10, 20, 30];
      return arr.reduce((acc: number, _val: number, idx: number) => acc + idx, 0);
    `);
    assert.equal(v, 3);
  });

  test("filter with value-only callback still works", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 2, 3, 4, 5];
      return arr.filter((val: number) => val > 3);
    `);
    assert.deepStrictEqual(v, [4, 5]);
  });

  test("map with value-only callback still works", () => {
    const v = compileAndRunNumberList(`
      const arr: NumberList = [1, 2, 3];
      return arr.map((val: number) => val * 10);
    `);
    assert.deepStrictEqual(v, [10, 20, 30]);
  });
});

describe("nested array literal types", () => {
  before(() => {
    ensureSetup();
  });

  test("number[][] compiles and executes", () => {
    const v = compileAndRunNumber(`
      const nested: number[][] = [[1, 2], [3, 4]];
      return nested[0][0] + nested[1][1];
    `);
    assert.equal(v, 5);
  });

  test("destructuring a number[][] directly", () => {
    const v = compileAndRunNumber(`
      const nested: number[][] = [[10, 20], [30, 40]];
      const [first, second] = nested;
      return first[0] + second[1];
    `);
    assert.equal(v, 50);
  });

  test("nested array as function return type", () => {
    const v = compileAndRunNumber(`
      const a: number[] = [1, 2];
      const b: number[] = [3, 4];
      const nested: number[][] = [a, b];
      return nested[0][1] + nested[1][0];
    `);
    assert.equal(v, 5);
  });

  test("triple-nested number[][][] compiles", () => {
    const v = compileAndRunNumber(`
      const deep: number[][][] = [[[1, 2]], [[3, 4]]];
      return deep[0][0][0] + deep[1][0][1];
    `);
    assert.equal(v, 5);
  });
});

describe("Generic function body - list operations", () => {
  before(() => {
    ensureSetup();
  });

  test("generic identity returns list unchanged", () => {
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

function identity<T>(items: T[]): T[] {
  return items;
}

export default Sensor({
  name: "arr-test",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const arr: NumberList = [1, 2, 3];
    return identity(arr);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  });

  test("generic element access via index", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function first<T>(items: T[]): T {
  return items[0];
}

export default Sensor({
  name: "arr-test",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: number[] = [42, 99];
    return first(arr);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  });

  test("generic list length", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function count<T>(items: T[]): number {
  return items.length;
}

export default Sensor({
  name: "arr-test",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: number[] = [1, 2, 3, 4];
    return count(arr);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  });

  test("generic for-of iteration", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function countItems<T>(items: T[]): number {
  let n = 0;
  for (const _item of items) {
    n = n + 1;
  }
  return n;
}

export default Sensor({
  name: "arr-test",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: number[] = [10, 20, 30];
    return countItems(arr);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  });

  test("generic push appends element", () => {
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

function appendValue<T>(items: T[], value: T): T[] {
  items.push(value);
  return items;
}

export default Sensor({
  name: "arr-test",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const arr: NumberList = [1, 2];
    return appendValue(arr, 3);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  });
});

describe("Generic function body - coercion and runtime", () => {
  before(() => {
    ensureSetup();
  });

  test("generic identity executes correctly at runtime", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function identity<T>(value: T): T {
  return value;
}

export default Sensor({
  name: "arr-test",
  output: "number",
  onExecute(ctx: Context): number {
    return identity(42);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program");

    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, result.program!, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10_000;
    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    assert.equal(runResult.result?.t, NativeType.Number);
    assert.equal((runResult.result as NumberValue).v, 42);
  });

  test("generic first-element executes correctly at runtime", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function first<T>(items: T[]): T {
  return items[0];
}

export default Sensor({
  name: "arr-test",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: number[] = [99, 1, 2];
    return first(arr);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program");

    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, result.program!, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10_000;
    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    assert.equal(runResult.result?.t, NativeType.Number);
    assert.equal((runResult.result as NumberValue).v, 99);
  });

  test("generic local variable assignment compiles without coercion errors", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function swapFirst<T>(items: T[], replacement: T): T {
  const original: T = items[0];
  items[0] = replacement;
  return original;
}

export default Sensor({
  name: "arr-test",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: number[] = [10, 20, 30];
    return swapFirst(arr, 99);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  });
});
