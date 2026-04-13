import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type BooleanValue,
  type BrainServices,
  ContextTypeIds,
  CoreTypeIds,
  type EnumValue,
  type ExecutionContext,
  HandleTable,
  isEnumValue,
  isListValue,
  isMapValue,
  isStructValue,
  type ListValue,
  type MapValue,
  mkNativeStructValue,
  mkNumberValue,
  mkStringValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  Op,
  runtime,
  type Scheduler,
  type StringValue,
  type StructTypeDef,
  type StructValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, LoweringDiagCode, ValidatorDiagCode } from "./diag-codes.js";
import type { UserAuthoredProgram } from "./types.js";

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

function mkArgsMap(entries: Record<number, Value>): MapValue {
  const dict = new ValueDict();
  for (const [key, value] of Object.entries(entries)) {
    dict.set(Number(key), value);
  }
  return { t: NativeType.Map, typeId: "map:<args>", v: dict };
}

function runActivation(prog: UserAuthoredProgram, handles: HandleTable, callsiteVars?: List<Value>): void {
  if (prog.activationFuncId === undefined) {
    return;
  }

  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, prog.activationFuncId, List.empty<Value>(), mkCtx());
  if (callsiteVars) {
    fiber.callsiteVars = callsiteVars;
  }
  fiber.instrBudget = 1000;

  const result = vm.runFiber(fiber, mkScheduler());
  assert.equal(result.status, VmStatus.DONE);
}
describe("array/list literal compilation", () => {
  before(async () => {
    services = __test__createBrainServices();

    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");

    const numListName = "NumberList";
    const numListTypeId = mkTypeId(NativeType.List, numListName);
    if (!types.get(numListTypeId)) {
      types.addListType(numListName, { elementTypeId: numTypeId });
    }

    const strListName = "StringList";
    const strListTypeId = mkTypeId(NativeType.List, strListName);
    if (!types.get(strListTypeId)) {
      types.addListType(strListName, { elementTypeId: strTypeId });
    }

    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
      });
    }

    const vec2ListName = "Vector2List";
    const vec2ListTypeId = mkTypeId(NativeType.List, vec2ListName);
    if (!types.get(vec2ListTypeId)) {
      types.addListType(vec2ListName, { elementTypeId: vec2TypeId });
    }
  });

  test("array literal with 3 elements compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "make-list",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [1, 2, 3];
    return nums;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isListValue(runResult.result!), "expected list value");
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 1);
      assert.equal((list.v.get(1) as NumberValue).v, 2);
      assert.equal((list.v.get(2) as NumberValue).v, 3);
    }
  });

  test("empty array compiles to empty list", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "empty-list",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [];
    return nums;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isListValue(runResult.result!), "expected list value");
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 0);
    }
  });

  test("array as return value (contextual type from return annotation)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "return-list",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    return [10, 20];
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 2);
      assert.equal((list.v.get(0) as NumberValue).v, 10);
      assert.equal((list.v.get(1) as NumberValue).v, 20);
    }
  });

  test("nested arrays compile to nested list construction", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type Vector2, type Vector2List } from "mindcraft";

export default Sensor({
  name: "nested-list",
  output: "Vector2List",
  onExecute(ctx: Context): Vector2List {
    const points: Vector2List = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    return points;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 2);
      const first = list.v.get(0) as StructValue;
      assert.ok(isStructValue(first));
      assert.equal((first.v?.get("x") as NumberValue).v, 1);
      assert.equal((first.v?.get("y") as NumberValue).v, 2);
      const second = list.v.get(1) as StructValue;
      assert.ok(isStructValue(second));
      assert.equal((second.v?.get("x") as NumberValue).v, 3);
      assert.equal((second.v?.get("y") as NumberValue).v, 4);
    }
  });
});

describe("mixed-type list compilation (AnyList)", () => {
  before(async () => {
    services = __test__createBrainServices();

    const types = services.types;
    const anyTypeId = mkTypeId(NativeType.Any, "any");
    if (!types.get(anyTypeId)) {
      types.addAnyType("any");
    }

    const anyListTypeId = mkTypeId(NativeType.List, "AnyList");
    if (!types.get(anyListTypeId)) {
      types.addListType("AnyList", { elementTypeId: anyTypeId });
    }

    const numListTypeId = mkTypeId(NativeType.List, "NumberList");
    if (!types.get(numListTypeId)) {
      const numTypeId = mkTypeId(NativeType.Number, "number");
      types.addListType("NumberList", { elementTypeId: numTypeId });
    }
  });

  test("mixed-type array literal compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type AnyList } from "mindcraft";

export default Sensor({
  name: "mixed-list",
  output: "AnyList",
  onExecute(ctx: Context): AnyList {
    const arr: AnyList = [1, "hello", true];
    return arr;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isListValue(runResult.result!), "expected list value");
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 1);
      assert.equal((list.v.get(1) as StringValue).v, "hello");
      assert.equal((list.v.get(2) as BooleanValue).v, true);
    }
  });

  test("homogeneous array still resolves to NumberList, not AnyList", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "num-list",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [1, 2, 3];
    return nums;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal(list.typeId, mkTypeId(NativeType.List, "NumberList"));
    }
  });

  test("empty array with AnyList annotation compiles correctly", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type AnyList } from "mindcraft";

export default Sensor({
  name: "empty-any",
  output: "AnyList",
  onExecute(ctx: Context): AnyList {
    const arr: AnyList = [];
    return arr;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isListValue(runResult.result!), "expected list value");
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 0);
    }
  });

  test("buildAmbientDeclarations includes AnyList type alias", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    assert.ok(
      ambientSource.includes("export type AnyList = Array<number | string | boolean | null>;"),
      "AnyList type alias should be in ambient declarations"
    );
  });
});

describe("list element access and methods", () => {
  before(async () => {
    services = __test__createBrainServices();

    const types = services.types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");

    const numListName = "NumberList";
    if (!types.get(mkTypeId(NativeType.List, numListName))) {
      types.addListType(numListName, { elementTypeId: numTypeId });
    }

    const strListName = "StringList";
    if (!types.get(mkTypeId(NativeType.List, strListName))) {
      types.addListType(strListName, { elementTypeId: strTypeId });
    }
  });

  test("element access reads from list by index", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-elem-access",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [10, 20, 30];
    return nums[1];
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
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 20);
    }
  });

  test("element access with variable index", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-elem-var-idx",
  output: "number",
  params: {
    idx: { type: "number", default: 2 },
  },
  onExecute(ctx: Context, params: { idx: number }): number {
    const nums: NumberList = [100, 200, 300];
    return nums[params.idx];
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const args = mkArgsMap({ 0: mkNumberValue(2) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 300);
    }
  });

  test("element access on list supports stringified indexes", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-elem-string-idx",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [10, 20, 30];
    return nums["1"];
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
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 20);
    }
  });

  test('element access on list supports "length" like JS', () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-elem-length",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [10, 20, 30];
    return nums["length"];
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
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 3);
    }
  });

  test("element access on string supports stringified indexes", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-str-elem-string-idx",
  output: "string",
  onExecute(ctx: Context): string {
    const word = "hello";
    return word["1"];
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
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as StringValue).v, "e");
    }
  });

  test('element access on string supports "length" like JS', () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-str-elem-length",
  output: "number",
  onExecute(ctx: Context): number {
    const word = "hello";
    return word["length"];
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
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 5);
    }
  });

  test("element assignment sets value at index", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-elem-assign",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [1, 2, 3];
    nums[1] = 99;
    return nums;
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
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 1);
      assert.equal((list.v.get(1) as NumberValue).v, 99);
      assert.equal((list.v.get(2) as NumberValue).v, 3);
    }
  });

  test(".push() appends element to list", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-push",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [1, 2];
    nums.push(3);
    return nums;
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
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(2) as NumberValue).v, 3);
    }
  });

  test(".indexOf() returns index of matching element", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-indexof",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [10, 20, 30];
    return nums.indexOf(20);
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
      assert.equal((runResult.result as NumberValue).v, 1);
    }
  });

  test(".indexOf() returns -1 when element not found", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-indexof-miss",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [10, 20, 30];
    return nums.indexOf(99);
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
      assert.equal((runResult.result as NumberValue).v, -1);
    }
  });

  test(".filter() creates new list with matching elements", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-filter",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [1, 2, 3, 4, 5];
    return nums.filter((x: number): boolean => x > 3);
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 2);
      assert.equal((list.v.get(0) as NumberValue).v, 4);
      assert.equal((list.v.get(1) as NumberValue).v, 5);
    }
  });

  test(".filter() with closure capturing threshold variable", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-filter-closure",
  output: "NumberList",
  params: {
    threshold: { type: "number", default: 3 },
  },
  onExecute(ctx: Context, params: { threshold: number }): NumberList {
    const threshold = params.threshold;
    const nums: NumberList = [1, 2, 3, 4, 5];
    return nums.filter((x: number): boolean => x > threshold);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const args = mkArgsMap({ 0: mkNumberValue(3) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 2);
      assert.equal((list.v.get(0) as NumberValue).v, 4);
      assert.equal((list.v.get(1) as NumberValue).v, 5);
    }
  });

  test(".map() transforms each element", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-map",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [1, 2, 3];
    return nums.map((x: number): number => x * 2);
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 2);
      assert.equal((list.v.get(1) as NumberValue).v, 4);
      assert.equal((list.v.get(2) as NumberValue).v, 6);
    }
  });

  test(".map() with closure capturing multiplier", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-map-closure",
  output: "NumberList",
  params: {
    factor: { type: "number", default: 10 },
  },
  onExecute(ctx: Context, params: { factor: number }): NumberList {
    const factor = params.factor;
    const nums: NumberList = [1, 2, 3];
    return nums.map((x: number): number => x * factor);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const args = mkArgsMap({ 0: mkNumberValue(10) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 10);
      assert.equal((list.v.get(1) as NumberValue).v, 20);
      assert.equal((list.v.get(2) as NumberValue).v, 30);
    }
  });

  test(".forEach() iterates over all elements", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-foreach",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [1, 2, 3, 4];
    const result: NumberList = [];
    nums.forEach((x: number): void => {
      result.push(x);
    });
    return result.length;
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 4);
    }
  });

  test("for...of iterates over list elements", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-for-of",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [1, 2, 3];
    let sum = 0;
    for (const x of nums) {
      sum = sum + x;
    }
    return sum;
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
    fiber.instrBudget = 10000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as NumberValue).v, 6);
    }
  });

  test("for...in iterates over list keys", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-for-in-list",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [1, 2, 3];
    let sum = 0;
    for (const key in nums) {
      sum = sum + nums[key];
    }
    return sum;
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
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 6);
    }
  });

  test("for...of with break exits early", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-for-of-break",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [10, 20, 30, 40, 50];
    let sum = 0;
    for (const x of nums) {
      if (x === 30) {
        break;
      }
      sum = sum + x;
    }
    return sum;
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
    fiber.instrBudget = 10000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as NumberValue).v, 30);
    }
  });

  test("for...of with continue skips iteration", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-for-of-continue",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [1, 2, 3, 4, 5];
    let sum = 0;
    for (const x of nums) {
      if (x === 3) {
        continue;
      }
      sum = sum + x;
    }
    return sum;
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
    fiber.instrBudget = 10000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      // 1 + 2 + 4 + 5 = 12
      assert.equal((runResult2.result as NumberValue).v, 12);
    }
  });

  test("for...of over empty list executes no body", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-for-of-empty",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [];
    let sum = 99;
    for (const x of nums) {
      sum = sum + x;
    }
    return sum;
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
    fiber.instrBudget = 10000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as NumberValue).v, 99);
    }
  });

  test(".includes() returns true when element found", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-includes-true",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const nums: NumberList = [10, 20, 30];
    return nums.includes(20);
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test(".includes() returns false when element not found", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-includes-false",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const nums: NumberList = [10, 20, 30];
    return nums.includes(99);
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test(".some() returns true when any element matches", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-some-true",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const nums: NumberList = [1, 2, 3, 4, 5];
    return nums.some((x: number): boolean => x > 3);
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test(".some() returns false when no element matches", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-some-false",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const nums: NumberList = [1, 2, 3];
    return nums.some((x: number): boolean => x > 10);
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test(".every() returns true when all elements match", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-every-true",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const nums: NumberList = [2, 4, 6];
    return nums.every((x: number): boolean => x > 1);
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test(".every() returns false when any element fails", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-every-false",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const nums: NumberList = [2, 4, 1, 6];
    return nums.every((x: number): boolean => x > 1);
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test(".find() returns matching element", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-find-match",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [10, 20, 30];
    const found = nums.find((x: number): boolean => x > 15);
    if (found !== undefined) {
      return found;
    }
    return -1;
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 20);
    }
  });

  test(".find() returns undefined when no match", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-find-nomatch",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [1, 2, 3];
    const found = nums.find((x: number): boolean => x > 10);
    if (found !== undefined) {
      return found;
    }
    return -1;
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, -1);
    }
  });

  test(".concat() merges two lists", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-concat",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const a: NumberList = [1, 2];
    const b: NumberList = [3, 4];
    return a.concat(b);
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 4);
      assert.equal((list.v.get(0) as NumberValue).v, 1);
      assert.equal((list.v.get(1) as NumberValue).v, 2);
      assert.equal((list.v.get(2) as NumberValue).v, 3);
      assert.equal((list.v.get(3) as NumberValue).v, 4);
    }
  });

  test(".reverse() creates reversed list", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-reverse",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [1, 2, 3];
    return nums.reverse();
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 3);
      assert.equal((list.v.get(1) as NumberValue).v, 2);
      assert.equal((list.v.get(2) as NumberValue).v, 1);
    }
  });

  test(".slice() extracts sub-array", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-slice",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [10, 20, 30, 40, 50];
    return nums.slice(1, 4);
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 20);
      assert.equal((list.v.get(1) as NumberValue).v, 30);
      assert.equal((list.v.get(2) as NumberValue).v, 40);
    }
  });

  test(".slice() with no args copies entire list", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-slice-copy",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [1, 2, 3];
    return nums.slice();
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 3);
      assert.equal((list.v.get(0) as NumberValue).v, 1);
      assert.equal((list.v.get(1) as NumberValue).v, 2);
      assert.equal((list.v.get(2) as NumberValue).v, 3);
    }
  });

  test(".join() concatenates elements with separator", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-join",
  output: "string",
  onExecute(ctx: Context): string {
    const nums: NumberList = [1, 2, 3];
    return nums.join("-");
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
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as StringValue).v, "1-2-3");
    }
  });

  test("unsupported array method produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [3, 1, 2];
    return nums.sort();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "Expected at least one diagnostic for .sort()");
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.SortRequiresComparatorFn),
      "Expected diagnostic to mention 'sort'"
    );
  });
});

// ---- Function type signatures ----
