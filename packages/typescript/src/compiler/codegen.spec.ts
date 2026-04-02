import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type BooleanValue,
  ContextTypeIds,
  CoreTypeIds,
  type EnumValue,
  type ExecutionContext,
  getBrainServices,
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
  registerCoreBrainComponents,
  runtime,
  type Scheduler,
  type StringValue,
  type StructTypeDef,
  type StructValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { buildAmbientDeclarations } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, LoweringDiagCode, ValidatorDiagCode } from "./diag-codes.js";

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

describe("lowering + emission", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("sync sensor with comparison compiles and executes correctly (true case)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  output: "boolean",
  params: {
    distance: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { distance: number }): boolean {
    return params.distance < 10;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(3) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result, "expected a return value");
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("sync sensor with comparison compiles and executes correctly (false case)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  output: "boolean",
  params: {
    distance: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { distance: number }): boolean {
    return params.distance < 10;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(15) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test("sensor returning number literal", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "constant",
  output: "number",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("sensor returning boolean literal true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "always-true",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("sensor returning string literal", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "greeting",
  output: "string",
  onExecute(ctx: Context): string {
    return "hello";
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as StringValue).v, "hello");
    }
  });

  test("sensor with arithmetic expression", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "compute",
  output: "number",
  params: {
    x: { type: "number" },
  },
  onExecute(ctx: Context, params: { x: number }): number {
    return params.x + 10;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const args = mkArgsMap({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 15);
    }
  });

  test("program metadata is correct", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  output: "boolean",
  params: {
    distance: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { distance: number }): boolean {
    return params.distance < 10;
  },
});
`;
    const result = compileUserTile(source);
    assert.ok(result.program);

    const prog = result.program!;
    assert.equal(prog.kind, "sensor");
    assert.equal(prog.name, "is-close");
    assert.equal(prog.entryFuncId, 0);
    assert.equal(prog.numCallsiteVars, 0);
    assert.ok(prog.outputType);
    assert.ok(prog.programRevisionId);
    assert.equal(prog.functions.size(), 2);
    assert.ok(prog.constants.size() > 0);
  });

  test("invalid output type produces diagnostic for unregistered type", () => {
    const appAmbient = buildAmbientDeclarations().replace(
      "string: string;",
      "string: string;\n    unknownType: unknown;"
    );
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "bad-type",
  output: "unknownType",
  onExecute(ctx: Context): unknown {
    return 1;
  },
});
`;
    const result = compileUserTile(source, {
      ambientSource: appAmbient,
    });
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, CompileDiagCode.UnknownOutputType);
  });

  test("app-defined output type resolves via registry", () => {
    const types = getBrainServices().types;
    const actorRefTypeId = mkTypeId(NativeType.Struct, "actorRef");
    if (!types.get(actorRefTypeId)) {
      types.addStructType("actorRef", {
        fields: List.from([{ name: "id", typeId: mkTypeId(NativeType.Number, "number") }]),
        nominal: true,
      });
    }
    const appAmbient = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nearest",
  output: "actorRef",
  onExecute(ctx: Context): unknown {
    return 0;
  },
});
`;
    const result = compileUserTile(source, {
      ambientSource: appAmbient,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
    assert.equal(result.program!.outputType, "struct:<actorRef>");
  });

  test("app-defined output type resolves without explicit ambientSource", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nearest",
  output: "actorRef",
  onExecute(ctx: Context): unknown {
    return null;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
    assert.equal(result.program!.outputType, "struct:<actorRef>");
  });
});

describe("buildCallDef", () => {
  before(() => {
    if (!getBrainServices) return;
    try {
      getBrainServices();
    } catch {
      registerCoreBrainComponents();
    }
  });

  test("empty params produces empty bag", () => {
    const callDef = buildCallDef("test-tile", []);
    assert.equal(callDef.callSpec.type, "bag");
    assert.equal(callDef.argSlots.size(), 0);
  });

  test("one required param produces correct callDef", () => {
    const callDef = buildCallDef("my-sensor", [{ name: "range", type: "number", required: true, anonymous: false }]);
    assert.equal(callDef.callSpec.type, "bag");
    assert.equal(callDef.argSlots.size(), 1);
    const slot = callDef.argSlots.get(0)!;
    assert.equal(slot.slotId, 0);
    assert.equal(slot.argSpec.tileId, "tile.parameter->user.my-sensor.range");
  });

  test("one optional param is wrapped in optional", () => {
    const callDef = buildCallDef("my-sensor", [
      { name: "range", type: "number", defaultValue: 5, required: false, anonymous: false },
    ]);
    assert.equal(callDef.callSpec.type, "bag");
    assert.equal(callDef.argSlots.size(), 1);
    const slot = callDef.argSlots.get(0)!;
    assert.equal(slot.slotId, 0);
    assert.equal(slot.argSpec.tileId, "tile.parameter->user.my-sensor.range");
  });

  test("anonymous param uses anon tile id", () => {
    const callDef = buildCallDef("chase", [{ name: "target", type: "actorRef", required: true, anonymous: true }]);
    assert.equal(callDef.argSlots.size(), 1);
    const slot = callDef.argSlots.get(0)!;
    assert.equal(slot.argSpec.tileId, "tile.parameter->anon.actorRef");
    assert.equal(slot.argSpec.anonymous, true);
  });

  test("mixed required, optional, and anonymous params", () => {
    const callDef = buildCallDef("chase", [
      { name: "target", type: "actorRef", required: true, anonymous: true },
      { name: "speed", type: "number", defaultValue: 1, required: false, anonymous: false },
    ]);
    assert.equal(callDef.argSlots.size(), 2);

    const slot0 = callDef.argSlots.get(0)!;
    assert.equal(slot0.slotId, 0);
    assert.equal(slot0.argSpec.tileId, "tile.parameter->anon.actorRef");
    assert.equal(slot0.argSpec.anonymous, true);

    const slot1 = callDef.argSlots.get(1)!;
    assert.equal(slot1.slotId, 1);
    assert.equal(slot1.argSpec.tileId, "tile.parameter->user.chase.speed");
  });
});

describe("control flow + local variables", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("if/else returns correct value for true branch", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-if",
  output: "boolean",
  params: {
    x: { type: "number" },
  },
  onExecute(ctx: Context, params: { x: number }): boolean {
    if (params.x > 5) {
      return true;
    } else {
      return false;
    }
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const args = mkArgsMap({ 0: mkNumberValue(10) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("if/else returns correct value for false branch", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-if",
  output: "boolean",
  params: {
    x: { type: "number" },
  },
  onExecute(ctx: Context, params: { x: number }): boolean {
    if (params.x > 5) {
      return true;
    } else {
      return false;
    }
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const args = mkArgsMap({ 0: mkNumberValue(3) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test("if without else", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-if-no-else",
  output: "number",
  onExecute(ctx: Context): number {
    let x = 10;
    if (x > 5) {
      x = x + 1;
    }
    return x;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 11);
    }
  });

  test("while loop counting to N", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-while",
  output: "number",
  params: {
    n: { type: "number" },
  },
  onExecute(ctx: Context, params: { n: number }): number {
    let count = 0;
    let i = 0;
    while (i < params.n) {
      count = count + 1;
      i = i + 1;
    }
    return count;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const args = mkArgsMap({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 5);
    }
  });

  test("for loop runs correct number of iterations", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-for",
  output: "number",
  params: {
    n: { type: "number" },
  },
  onExecute(ctx: Context, params: { n: number }): number {
    let sum = 0;
    for (let i = 0; i < params.n; i = i + 1) {
      sum = sum + i;
    }
    return sum;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const args = mkArgsMap({ 0: mkNumberValue(4) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      // 0 + 1 + 2 + 3 = 6
      assert.equal((runResult.result as NumberValue).v, 6);
    }
  });

  test("for loop with i++ increment", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-for-pp",
  output: "number",
  onExecute(ctx: Context): number {
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      sum = sum + i;
    }
    return sum;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      // 0 + 1 + 2 = 3
      assert.equal((runResult.result as NumberValue).v, 3);
    }
  });

  test("shadowed variables return correct value", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-shadow",
  output: "number",
  onExecute(ctx: Context): number {
    let x = 1;
    {
      let x = 2;
    }
    return x;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 1);
    }
  });

  test("break exits while loop", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-break",
  output: "number",
  onExecute(ctx: Context): number {
    let i = 0;
    while (true) {
      if (i >= 5) {
        break;
      }
      i = i + 1;
    }
    return i;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 5);
    }
  });

  test("continue skips iteration in for loop", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-continue",
  output: "number",
  onExecute(ctx: Context): number {
    let sum = 0;
    for (let i = 0; i < 10; i = i + 1) {
      if (i === 3) {
        continue;
      }
      sum = sum + i;
    }
    return sum;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 50000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      // 0+1+2+4+5+6+7+8+9 = 42
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("nested blocks produce correct variable indices", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-nested",
  output: "number",
  onExecute(ctx: Context): number {
    let result = 0;
    {
      let a = 10;
      {
        let b = 20;
        result = a + b;
      }
    }
    return result;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 30);
    }
  });

  test("else-if chains execute correctly", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-elseif",
  output: "number",
  params: {
    x: { type: "number" },
  },
  onExecute(ctx: Context, params: { x: number }): number {
    if (params.x > 10) {
      return 3;
    } else if (params.x > 5) {
      return 2;
    } else {
      return 1;
    }
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);

    // x = 15 -> return 3
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, 0, List.from<Value>([mkArgsMap({ 0: mkNumberValue(15) })]), mkCtx());
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 3);
      }
    }

    // x = 7 -> return 2
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, 0, List.from<Value>([mkArgsMap({ 0: mkNumberValue(7) })]), mkCtx());
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 2);
      }
    }

    // x = 2 -> return 1
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, 0, List.from<Value>([mkArgsMap({ 0: mkNumberValue(2) })]), mkCtx());
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 1);
      }
    }
  });
});

describe("helper functions + callsite-persistent state", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("helper function called from onExecute returns correct value", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export default Sensor({
  name: "clamped",
  output: "number",
  params: {
    x: { type: "number" },
  },
  onExecute(ctx: Context, params: { x: number }): number {
    return clamp(params.x, 0, 100);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);

    // x = 50 -> clamped to 50 (within range)
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(
        1,
        prog.entryFuncId,
        List.from<Value>([mkArgsMap({ 0: mkNumberValue(50) })]),
        mkCtx()
      );
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 50);
      }
    }

    // x = -10 -> clamped to 0
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(
        1,
        prog.entryFuncId,
        List.from<Value>([mkArgsMap({ 0: mkNumberValue(-10) })]),
        mkCtx()
      );
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 0);
      }
    }

    // x = 200 -> clamped to 100
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(
        1,
        prog.entryFuncId,
        List.from<Value>([mkArgsMap({ 0: mkNumberValue(200) })]),
        mkCtx()
      );
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 100);
      }
    }
  });

  test("helper function with arithmetic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function double(n: number): number {
  return n + n;
}

export default Sensor({
  name: "doubled",
  output: "number",
  params: {
    val: { type: "number" },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    return double(params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from<Value>([mkArgsMap({ 0: mkNumberValue(7) })]), mkCtx());
    fiber.instrBudget = 1000;

    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 14);
    }
  });

  test("multiple helper functions can call each other", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function addOne(n: number): number {
  return n + 1;
}

function addTwo(n: number): number {
  return addOne(addOne(n));
}

export default Sensor({
  name: "add-two",
  output: "number",
  params: {
    val: { type: "number" },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    return addTwo(params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from<Value>([mkArgsMap({ 0: mkNumberValue(10) })]), mkCtx());
    fiber.instrBudget = 1000;

    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 12);
    }
  });

  test("top-level let persists across invocations via callsite vars", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let count = 0;

export default Sensor({
  name: "counter",
  output: "number",
  onExecute(ctx: Context): number {
    count += 1;
    return count;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.numCallsiteVars > 0, "expected numCallsiteVars > 0");
    assert.ok(prog.initFuncId !== undefined, "expected initFuncId to be set");

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    // Run init function to set count = 0
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
    }

    // First call: count should become 1
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 1);
      }
    }

    // Second call: count should become 2
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 2);
      }
    }
  });

  test("multiple top-level vars have correct slot indices", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let a = 10;
let b = 20;

export default Sensor({
  name: "multi-var",
  output: "number",
  onExecute(ctx: Context): number {
    return a + b;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.equal(prog.numCallsiteVars, 2);
    assert.ok(prog.initFuncId !== undefined);

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    // Run init
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    // a=10, b=20 -> a+b = 30
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 30);
      }
    }
  });

  test("module init function resets state when callsiteVars is freshly allocated", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let count = 0;

export default Sensor({
  name: "resettable",
  output: "number",
  onExecute(ctx: Context): number {
    count += 1;
    return count;
  },
});
`;
    const result = compileUserTile(source);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);

    // First callsite: init + two calls -> 1, 2
    const callsiteVars1 = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars1;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars1;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 1);
    }
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars1;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 2);
    }

    // Fresh callsiteVars2 + init -> resets to 0, next call -> 1
    const callsiteVars2 = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars2;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars2;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 1);
    }
  });

  test("helper function can access top-level callsite var", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let total = 0;

function addToTotal(n: number): number {
  total = total + n;
  return total;
}

export default Sensor({
  name: "accum",
  output: "number",
  params: {
    val: { type: "number" },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    return addToTotal(params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.numCallsiteVars > 0);

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    // Init
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    // Call with val=5 -> total becomes 5
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from<Value>([mkArgsMap({ 0: mkNumberValue(5) })]), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 5);
    }

    // Call with val=3 -> total becomes 8
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from<Value>([mkArgsMap({ 0: mkNumberValue(3) })]), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 8);
    }
  });

  test("no top-level vars produces numCallsiteVars=0 and no initFuncId", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "simple",
  output: "number",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    assert.equal(result.program!.numCallsiteVars, 0);
    assert.equal(result.program!.initFuncId, undefined);
  });

  test("program has correct function count with helpers", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function helper1(): number { return 1; }
function helper2(): number { return 2; }

export default Sensor({
  name: "multi-fn",
  output: "number",
  onExecute(ctx: Context): number {
    return helper1() + helper2();
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    // 4 functions: onExecute + helper1 + helper2 + onPageEntered wrapper
    assert.equal(result.program!.functions.size(), 4);

    const handles = new HandleTable(100);
    const vm = new runtime.VM(result.program!, handles);
    const fiber = vm.spawnFiber(1, result.program!.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 3);
    }
  });

  test("helper with loop and local variables", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function sum(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    total = total + i;
  }
  return total;
}

export default Sensor({
  name: "sum-sensor",
  output: "number",
  params: {
    n: { type: "number" },
  },
  onExecute(ctx: Context, params: { n: number }): number {
    return sum(params.n);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const handles = new HandleTable(100);
    const vm = new runtime.VM(result.program!, handles);
    const fiber = vm.spawnFiber(
      1,
      result.program!.entryFuncId,
      List.from<Value>([mkArgsMap({ 0: mkNumberValue(5) })]),
      mkCtx()
    );
    fiber.instrBudget = 10000;

    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      // 0+1+2+3+4 = 10
      assert.equal((r.result as NumberValue).v, 10);
    }
  });

  test("top-level const with initializer works", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

const THRESHOLD = 10;

export default Sensor({
  name: "threshold",
  output: "boolean",
  params: {
    val: { type: "number" },
  },
  onExecute(ctx: Context, params: { val: number }): boolean {
    return params.val > THRESHOLD;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    // Init
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    // val=15 > THRESHOLD=10 -> true
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(
        1,
        prog.entryFuncId,
        List.from<Value>([mkArgsMap({ 0: mkNumberValue(15) })]),
        mkCtx()
      );
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as BooleanValue).v, true);
    }

    // val=5 > THRESHOLD=10 -> false
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from<Value>([mkArgsMap({ 0: mkNumberValue(5) })]), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as BooleanValue).v, false);
    }
  });
});

describe("onPageEntered + lifecycle wrapper", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("onPageEntered resets a callsite var; next exec call sees the reset value", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let count = 0;

export default Sensor({
  name: "resettable-counter",
  output: "number",
  onExecute(ctx: Context): number {
    count += 1;
    return count;
  },
  onPageEntered(ctx: Context): void {
    count = 0;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.lifecycleFuncIds.onPageEntered !== undefined, "expected onPageEntered wrapper funcId");
    assert.ok(prog.initFuncId !== undefined, "expected initFuncId");

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    // Run init -> count = 0
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    // Call exec twice -> count = 1, then 2
    for (let expected = 1; expected <= 2; expected++) {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, expected);
    }

    // Run onPageEntered wrapper -> resets count via init + user onPageEntered
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.lifecycleFuncIds.onPageEntered!, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
    }

    // Next exec call -> count should be 1 again (reset happened)
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 1);
    }
  });

  test("source without onPageEntered still generates wrapper that runs init", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let count = 0;

export default Sensor({
  name: "no-ope",
  output: "number",
  onExecute(ctx: Context): number {
    count += 1;
    return count;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.lifecycleFuncIds.onPageEntered !== undefined, "wrapper should always be generated");
    assert.ok(prog.initFuncId !== undefined);

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    // Init -> count = 0
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    // Call exec twice -> count = 1, 2
    for (let expected = 1; expected <= 2; expected++) {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, expected);
    }

    // Run onPageEntered wrapper -> no user function, but runs init -> count = 0
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.lifecycleFuncIds.onPageEntered!, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
    }

    // Next exec -> count = 1 (re-initialized)
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 1);
    }
  });

  test("onPageEntered wrapper calls user function after init (user can override init values)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let startValue = 0;

export default Sensor({
  name: "override-init",
  output: "number",
  onExecute(ctx: Context): number {
    startValue += 1;
    return startValue;
  },
  onPageEntered(ctx: Context): void {
    startValue = 100;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.lifecycleFuncIds.onPageEntered !== undefined);

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    // Run onPageEntered wrapper: init sets startValue=0, then user onPageEntered sets startValue=100
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.lifecycleFuncIds.onPageEntered!, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
    }

    // exec -> startValue was 100, now becomes 101
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 101);
    }
  });

  test("wrapper is generated even with no callsite vars and no onPageEntered", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "minimal",
  output: "number",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.lifecycleFuncIds.onPageEntered !== undefined, "wrapper should always exist");
    assert.equal(prog.numCallsiteVars, 0);
    assert.equal(prog.initFuncId, undefined);

    // The wrapper should be callable and return without error
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, prog.lifecycleFuncIds.onPageEntered!, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
  });

  test("onPageEntered with local variables and control flow", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let a = 0;
let b = 0;

export default Sensor({
  name: "multi-reset",
  output: "number",
  onExecute(ctx: Context): number {
    a += 1;
    b += 10;
    return a + b;
  },
  onPageEntered(ctx: Context): void {
    a = 5;
    b = 50;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    // Run wrapper: init sets a=0,b=0 then user onPageEntered sets a=5,b=50
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.lifecycleFuncIds.onPageEntered!, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    // exec: a=5+1=6, b=50+10=60, return 66
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 66);
    }
  });
});

describe("null literal support", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("null assigned to a variable compiles to NIL_VALUE", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "null-var",
  output: "number",
  onExecute(ctx: Context): number {
    let x: number | null = null;
    if (x === null) {
      x = 42;
    }
    return x;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("helper function returning null produces NIL_VALUE", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function maybeNull(): number | null {
  return null;
}

export default Sensor({
  name: "null-return",
  output: "number",
  onExecute(ctx: Context): number {
    const val = maybeNull();
    if (val === null) {
      return 99;
    }
    return val;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 99);
    }
  });

  test("null in callsite-persistent variable with comparison", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let cached: number | null = null;

export default Sensor({
  name: "null-callsite",
  output: "number",
  onExecute(ctx: Context): number {
    if (cached === null) {
      cached = 7;
    }
    return cached;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    {
      const vm = new runtime.VM(prog, handles);
      const initFiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      initFiber.callsiteVars = callsiteVars;
      initFiber.instrBudget = 1000;
      vm.runFiber(initFiber, mkScheduler());
    }

    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;

      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 7);
      }
    }
  });

  test("number !== null returns true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "not-null",
  output: "boolean",
  params: { x: { type: "number" } },
  onExecute(ctx: Context, params: { x: number }): boolean {
    const val: number | null = params.x;
    return val !== null;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const args = mkArgsMap({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("null === null returns true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nil-eq",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const a: number | null = null;
    const b: number | null = null;
    return a === b;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("undefined compiles to NIL_VALUE", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "undef-var",
  output: "number",
  onExecute(ctx: Context): number {
    let x: number | undefined = undefined;
    if (x === undefined) {
      x = 42;
    }
    return x;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as NumberValue).v, 42);
    }
  });

  test("undefined === null returns true (both are nil)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "undef-null-eq",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const a: number | undefined = undefined;
    const b: number | null = null;
    return a === b;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as BooleanValue).v, true);
    }
  });

  test("number !== undefined returns true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "not-undef",
  output: "boolean",
  params: { x: { type: "number" } },
  onExecute(ctx: Context, params: { x: number }): boolean {
    const val: number | undefined = params.x;
    return val !== undefined;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const args = mkArgsMap({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as BooleanValue).v, true);
    }
  });

  test("true && false -> false", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "and-test",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return true && false;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test("false && sideEffect() -> false (short-circuit, side effect not called)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let called = false;

function sideEffect(): boolean {
  called = true;
  return true;
}

export default Sensor({
  name: "and-short",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const result = false && sideEffect();
    return called;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    {
      const initFiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      initFiber.callsiteVars = callsiteVars;
      initFiber.instrBudget = 1000;
      vm.runFiber(initFiber, mkScheduler());
    }

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test("false || true -> true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "or-test",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return false || true;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("true || sideEffect() -> true (short-circuit, side effect not called)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let called = false;

function sideEffect(): boolean {
  called = true;
  return false;
}

export default Sensor({
  name: "or-short",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const result = true || sideEffect();
    return called;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    {
      const initFiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      initFiber.callsiteVars = callsiteVars;
      initFiber.instrBudget = 1000;
      vm.runFiber(initFiber, mkScheduler());
    }

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test("!true -> false, !false -> true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "not-test",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return !true;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, false);
    }

    const source2 = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "not-test2",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return !false;
  },
});
`;
    const result2 = compileUserTile(source2);
    assert.deepStrictEqual(result2.diagnostics, []);
    assert.ok(result2.program);

    const prog2 = result2.program!;
    const vm2 = new runtime.VM(prog2, new HandleTable(100));
    const fiber2 = vm2.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber2.instrBudget = 1000;

    const runResult2 = vm2.runFiber(fiber2, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal(runResult2.result!.t, NativeType.Boolean);
      assert.equal((runResult2.result as BooleanValue).v, true);
    }
  });

  test("0 && 42 -> 0 (JS value-preserving semantics)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "and-val",
  output: "number",
  onExecute(ctx: Context): number {
    return 0 && 42;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 0);
    }
  });

  test('"a" + "b" -> "ab" (string concatenation)', () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "str-concat",
  output: "string",
  onExecute(ctx: Context): string {
    return "a" + "b";
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.String);
      assert.equal((runResult.result as StringValue).v, "ab");
    }
  });

  test("template literal with number interpolation -> 'count: 42'", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "template-num",
  output: "string",
  onExecute(ctx: Context): string {
    const n: number = 42;
    return \`count: \${n}\`;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.String);
      assert.equal((runResult.result as StringValue).v, "count: 42");
    }
  });

  test("template literal with multiple spans -> correct concatenation", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "template-multi",
  output: "string",
  onExecute(ctx: Context): string {
    const a: string = "hello";
    const b: string = "world";
    return \`\${a}-\${b}\`;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.String);
      assert.equal((runResult.result as StringValue).v, "hello-world");
    }
  });

  test('empty template literal `` -> "" (no substitution template)', () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "empty-template",
  output: "string",
  onExecute(ctx: Context): string {
    return \`\`;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.String);
      assert.equal((runResult.result as StringValue).v, "");
    }
  });

  test("template literal with undetermined type produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "template-any",
  output: "string",
  onExecute(ctx: Context): string {
    const x: any = 42;
    return \`val: \${x}\`;
  },
});
`;
    const result = compileUserTile(source);
    assert.ok(result.diagnostics.length > 0);
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.CannotConvertToString),
      `Expected diagnostic about type determination but got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("template literal with null interpolation produces no-conversion diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "template-null",
  output: "string",
  onExecute(ctx: Context): string {
    return \`val: \${null}\`;
  },
});
`;
    const result = compileUserTile(source);
    assert.ok(result.diagnostics.length > 0);
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.NoConversionToString),
      `Expected no-conversion diagnostic but got: ${JSON.stringify(result.diagnostics)}`
    );
  });
});

describe("struct literal compilation", () => {
  before(async () => {
    registerCoreBrainComponents();

    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
        nominal: true,
      });
    }
    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityTypeId)) {
      types.addStructType("Entity", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "position", typeId: vec2TypeId },
        ]),
        nominal: true,
      });
    }
    const nativeTypeId = mkTypeId(NativeType.Struct, "NativeObj");
    if (!types.get(nativeTypeId)) {
      types.addStructType("NativeObj", {
        fields: List.from([{ name: "id", typeId: numTypeId }]),
        fieldGetter: () => undefined,
      });
    }
  });

  test("struct literal with type annotation compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "make-vec",
  output: "Vector2",
  onExecute(ctx: Context): Vector2 {
    const pos: Vector2 = { x: 10, y: 20 };
    return pos;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isStructValue(runResult.result!), "expected struct value");
      const struct = runResult.result as StructValue;
      assert.equal(struct.typeId, mkTypeId(NativeType.Struct, "Vector2"));
      assert.equal((struct.v?.get("x") as NumberValue).v, 10);
      assert.equal((struct.v?.get("y") as NumberValue).v, 20);
    }
  });

  test("struct literal as return value (contextual type from return annotation)", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "make-vec-direct",
  output: "Vector2",
  onExecute(ctx: Context): Vector2 {
    return { x: 3, y: 7 };
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isStructValue(runResult.result!));
      const struct = runResult.result as StructValue;
      assert.equal((struct.v?.get("x") as NumberValue).v, 3);
      assert.equal((struct.v?.get("y") as NumberValue).v, 7);
    }
  });

  test("nested struct literal compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Entity, type Vector2 } from "mindcraft";

export default Sensor({
  name: "make-entity",
  output: "Entity",
  onExecute(ctx: Context): Entity {
    const e: Entity = { name: "hero", position: { x: 5, y: 15 } };
    return e;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isStructValue(runResult.result!));
      const entity = runResult.result as StructValue;
      assert.equal((entity.v?.get("name") as StringValue).v, "hero");
      const pos = entity.v?.get("position") as StructValue;
      assert.ok(isStructValue(pos));
      assert.equal((pos.v?.get("x") as NumberValue).v, 5);
      assert.equal((pos.v?.get("y") as NumberValue).v, 15);
    }
  });

  test("native-backed struct object literal produces compile error", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NativeObj } from "mindcraft";

export default Sensor({
  name: "bad-native",
  output: "number",
  onExecute(ctx: Context): number {
    const obj: NativeObj = { id: 1 };
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for native-backed struct");
  });

  test("untyped object literal produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "untyped-obj",
  output: "number",
  onExecute(ctx: Context): number {
    const obj = { a: 1 };
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "expected diagnostic for untyped object literal");
  });
});

describe("array/list literal compilation", () => {
  before(async () => {
    registerCoreBrainComponents();

    const types = getBrainServices().types;
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
        nominal: true,
      });
    }

    const vec2ListName = "Vector2List";
    const vec2ListTypeId = mkTypeId(NativeType.List, vec2ListName);
    if (!types.get(vec2ListTypeId)) {
      types.addListType(vec2ListName, { elementTypeId: vec2TypeId });
    }
  });

  test("array literal with 3 elements compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    registerCoreBrainComponents();

    const types = getBrainServices().types;
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
    assert.ok(
      ambientSource.includes("export type AnyList = Array<number | string | boolean | null>;"),
      "AnyList type alias should be in ambient declarations"
    );
  });
});

describe("nullable types", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("tsTypeToTypeId returns nullable TypeId for number | null parameter", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nullable-num",
  output: "number",
  params: {
    value: { type: "number?", default: null },
  },
  onExecute(ctx: Context, params: { value: number | null }): number {
    return 0;
  },
});
`;
    const types = getBrainServices().types;
    const nullableNumberId = types.addNullableType(mkTypeId(NativeType.Number, "number"));
    const nullableDef = types.get(nullableNumberId);
    assert.ok(nullableDef);
    assert.equal(nullableDef.nullable, true);
    assert.equal(nullableNumberId, "number:<number?>");
  });

  test("tsTypeToTypeId returns nullable TypeId for string | undefined", () => {
    const types = getBrainServices().types;
    const nullableStringId = types.addNullableType(mkTypeId(NativeType.String, "string"));
    assert.equal(nullableStringId, "string:<string?>");
    const def = types.get(nullableStringId);
    assert.ok(def);
    assert.equal(def.nullable, true);
  });

  test("multi-member non-null union resolves to Any (not nullable)", () => {
    const types = getBrainServices().types;
    const anyId = types.get(mkTypeId(NativeType.Any, "any"));
    assert.ok(anyId);
    assert.equal(anyId.nullable, undefined);
  });

  test("ambient output includes | null for nullable types", () => {
    const types = getBrainServices().types;
    types.addNullableType(mkTypeId(NativeType.Number, "number"));
    const ambientSource = buildAmbientDeclarations();
    assert.ok(
      ambientSource.includes("number?") && ambientSource.includes("number | null"),
      "ambient declarations should include nullable type with | null"
    );
  });
});

describe("auto-instantiated list types", () => {
  before(async () => {
    registerCoreBrainComponents();

    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");

    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
        nominal: true,
      });
    }
  });

  test("Vector2[] compiles via auto-instantiation without pre-registered Vector2List", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "vec-list",
  output: "number",
  onExecute(ctx: Context): number {
    const vecs: ReadonlyArray<Vector2> = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    return vecs.length;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 2);
    }
  });

  test("ambient generation skips auto-instantiated types", () => {
    const types = getBrainServices().types;
    types.instantiate("List", List.from([CoreTypeIds.Number]));
    const ambientSource = buildAmbientDeclarations();
    assert.ok(
      !ambientSource.includes("List<number:<number>>"),
      "auto-instantiated type name should not appear in ambient"
    );
  });
});

describe("union types", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("tsTypeToTypeId returns a union TypeId for number | string (not Any)", () => {
    const types = getBrainServices().types;
    const unionId = types.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    assert.ok(unionId);
    assert.notEqual(unionId, CoreTypeIds.Any);
    const def = types.get(unionId);
    assert.ok(def);
    assert.equal(def.coreType, NativeType.Union);
  });

  test("[1, 'hello'] compiles to a list with a union element type, not AnyList", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "union-list",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: (number | string)[] = [1, "hello"];
    return arr.length;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 2);
    }
  });

  test("ambient output for a union type emits member1 | member2", () => {
    const types = getBrainServices().types;
    types.getOrCreateUnionType(List.from([CoreTypeIds.Number, CoreTypeIds.String]));
    const ambientSource = buildAmbientDeclarations();
    assert.ok(!ambientSource.includes("union:<"), "union type internal name should not appear in ambient output");
  });

  test("operator resolution works through union expansion: (number | string) + number", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "union-op",
  output: "number",
  onExecute(ctx: Context): number {
    const x: number | null = 5;
    return x + 1;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 6);
    }
  });
});

describe("typeof lowering", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("typeof x === 'number' compiles and returns true for number", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-number",
  output: "boolean",
  params: { val: { type: "number", default: 42 } },
  onExecute(ctx: Context, params: { val: number }): boolean {
    return typeof params.val === "number";
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(42) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("typeof x !== 'string' produces negated result", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-not-string",
  output: "boolean",
  params: { val: { type: "number", default: 42 } },
  onExecute(ctx: Context, params: { val: number }): boolean {
    return typeof params.val !== "string";
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(42) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("reversed form: 'boolean' === typeof x", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-reversed",
  output: "boolean",
  params: { val: { type: "boolean", default: true } },
  onExecute(ctx: Context, params: { val: boolean }): boolean {
    return "boolean" === typeof params.val;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: { t: NativeType.Boolean, v: true } });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("typeof x === 'undefined' for nil value", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-undefined",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const x: number | null = null;
    return typeof x === "undefined";
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.deepStrictEqual(runResult.result, { t: NativeType.Boolean, v: true });
    }
  });

  test("typeof x === 'object' produces a diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-object",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const x = 5;
    return typeof x === "object";
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "expected a diagnostic for unsupported typeof comparison");
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.UnsupportedTypeofComparison),
      `expected diagnostic about unsupported typeof, got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("typeof in if-statement for runtime narrowing", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "typeof-narrowing",
  output: "number",
  params: { val: { type: "number", default: 10 } },
  onExecute(ctx: Context, params: { val: number }): number {
    if (typeof params.val === "number") {
      return params.val + 1;
    }
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(10) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 11);
    }
  });
});

// ---- Function references ----

describe("function references and CALL_INDIRECT", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("passing a named function as argument and calling via indirect call", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function double(n: number): number {
  return n * 2;
}

function apply(fn: (n: number) => number, x: number): number {
  return fn(x);
}

export default Sensor({
  name: "test-fn-ref",
  output: "number",
  params: {
    val: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    return apply(double, params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 10);
    }
  });

  test("function reference stored in local variable and called indirectly", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function triple(n: number): number {
  return n * 3;
}

export default Sensor({
  name: "test-fn-local",
  output: "number",
  params: {
    val: { type: "number", default: 4 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const fn = triple;
    return fn(params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(4) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 12);
    }
  });
});

// ---- Closures ----

describe("closures", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("simple closure: makeAdder pattern", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function makeAdder(n: number): (x: number) => number {
  return (x: number): number => x + n;
}

export default Sensor({
  name: "test-closure-adder",
  output: "number",
  params: {
    val: { type: "number", default: 3 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const add5 = makeAdder(5);
    return add5(params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(3) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 8);
    }
  });

  test("closure over multiple variables", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function makeLinear(a: number, b: number): (x: number) => number {
  return (x: number): number => a * x + b;
}

export default Sensor({
  name: "test-closure-multi",
  output: "number",
  params: {
    val: { type: "number", default: 4 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const linear = makeLinear(3, 7);
    return linear(params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(4) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 19);
    }
  });

  test("arrow function with no captures compiles as plain function ref", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function apply(fn: (n: number) => number, x: number): number {
  return fn(x);
}

export default Sensor({
  name: "test-no-capture",
  output: "number",
  params: {
    val: { type: "number", default: 7 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    return apply((x: number): number => x * 2, params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(7) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 14);
    }
  });

  test("closure captures local variable from enclosing scope", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-capture-local",
  output: "number",
  params: {
    val: { type: "number", default: 10 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const threshold = params.val;
    const fn = (x: number): number => x + threshold;
    return fn(5);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(10) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 15);
    }
  });

  test("concise arrow function body (expression, not block)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function apply(fn: (n: number) => number, x: number): number {
  return fn(x);
}

export default Sensor({
  name: "test-concise-arrow",
  output: "number",
  params: {
    val: { type: "number", default: 6 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const offset = 100;
    return apply((x: number): number => x + offset, params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const args = mkArgsMap({ 0: mkNumberValue(6) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 106);
    }
  });
});

describe("list element access and methods", () => {
  before(async () => {
    registerCoreBrainComponents();

    const types = getBrainServices().types;
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 20);
    }
  });

  test("element access with variable index", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const args = mkArgsMap({ 0: mkNumberValue(2) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 300);
    }
  });

  test("element assignment sets value at index", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 1);
    }
  });

  test(".indexOf() returns -1 when element not found", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, -1);
    }
  });

  test(".filter() creates new list with matching elements", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 4);
    }
  });

  test("for...of iterates over list elements", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as NumberValue).v, 6);
    }
  });

  test("for...of with break exits early", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as NumberValue).v, 30);
    }
  });

  test("for...of with continue skips iteration", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.equal((runResult2.result as NumberValue).v, 99);
    }
  });

  test(".includes() returns true when element found", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test(".includes() returns false when element not found", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test(".some() returns true when any element matches", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test(".some() returns false when no element matches", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test(".every() returns true when all elements match", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test(".every() returns false when any element fails", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test(".find() returns matching element", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 20);
    }
  });

  test(".find() returns undefined when no match", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, -1);
    }
  });

  test(".concat() merges two lists", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
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
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 5000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as StringValue).v, "1-2-3");
    }
  });

  test("unsupported array method produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();
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
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "Expected at least one diagnostic for .sort()");
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.SortRequiresComparatorFn),
      "Expected diagnostic to mention 'sort'"
    );
  });
});

// ---- Function type signatures ----

describe("function type signatures", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("callback parameter gets typed FunctionTypeDef TypeId", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function apply(fn: (n: number) => number, x: number): number {
  return fn(x);
}

function double(n: number): number {
  return n * 2;
}

export default Sensor({
  name: "test-fn-sig",
  output: "number",
  params: {
    val: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    return apply(double, params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const args = mkArgsMap({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 10);
    }
  });

  test("different callback signatures resolve to different function TypeIds", () => {
    const registry = getBrainServices().types;
    const id1 = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([CoreTypeIds.Number]),
      returnTypeId: CoreTypeIds.Number,
    });
    const id2 = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([CoreTypeIds.String]),
      returnTypeId: CoreTypeIds.Boolean,
    });
    assert.notEqual(id1, id2);
    const def1 = registry.get(id1)!;
    const def2 = registry.get(id2)!;
    assert.equal(def1.coreType, NativeType.Function);
    assert.equal(def2.coreType, NativeType.Function);
  });

  test("closure with typed callback compiles and runs correctly", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function makeTransformer(factor: number): (x: number) => number {
  return (x: number): number => x * factor;
}

export default Sensor({
  name: "test-closure-sig",
  output: "number",
  params: {
    val: { type: "number", default: 3 },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    const t = makeTransformer(10);
    return t(params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const args = mkArgsMap({ 0: mkNumberValue(3) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 30);
    }
  });
});

describe("map literal compilation", () => {
  before(async () => {
    registerCoreBrainComponents();

    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");

    const numMapName = "NumberMap";
    const numMapTypeId = mkTypeId(NativeType.Map, numMapName);
    if (!types.get(numMapTypeId)) {
      types.addMapType(numMapName, { valueTypeId: numTypeId });
    }

    const strMapName = "StringMap";
    const strMapTypeId = mkTypeId(NativeType.Map, strMapName);
    if (!types.get(strMapTypeId)) {
      types.addMapType(strMapName, { valueTypeId: strTypeId });
    }

    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
        nominal: true,
      });
    }
  });

  test("map literal with 2 entries compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberMap } from "mindcraft";

export default Sensor({
  name: "make-map",
  output: "NumberMap",
  onExecute(ctx: Context): NumberMap {
    const m: NumberMap = { foo: 1, bar: 2 };
    return m;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isMapValue(runResult.result!), "expected map value");
      const map = runResult.result as MapValue;
      assert.equal(map.typeId, mkTypeId(NativeType.Map, "NumberMap"));
      assert.equal((map.v.get("foo") as NumberValue).v, 1);
      assert.equal((map.v.get("bar") as NumberValue).v, 2);
    }
  });

  test("empty map compiles to MAP_NEW only", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberMap } from "mindcraft";

export default Sensor({
  name: "empty-map",
  output: "NumberMap",
  onExecute(ctx: Context): NumberMap {
    const m: NumberMap = {};
    return m;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isMapValue(runResult.result!), "expected map value");
      const map = runResult.result as MapValue;
      assert.equal(map.typeId, mkTypeId(NativeType.Map, "NumberMap"));
      assert.equal(map.v.size(), 0);
    }
  });

  test("map as return value compiles correctly via contextual type", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type StringMap } from "mindcraft";

export default Sensor({
  name: "return-map",
  output: "StringMap",
  onExecute(ctx: Context): StringMap {
    return { greeting: "hello", farewell: "bye" };
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isMapValue(runResult.result!), "expected map value");
      const map = runResult.result as MapValue;
      assert.equal((map.v.get("greeting") as StringValue).v, "hello");
      assert.equal((map.v.get("farewell") as StringValue).v, "bye");
    }
  });

  test("nested struct-in-map compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations();

    const types = getBrainServices().types;
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const vec2MapName = "Vector2Map";
    const vec2MapTypeId = mkTypeId(NativeType.Map, vec2MapName);
    if (!types.get(vec2MapTypeId)) {
      types.addMapType(vec2MapName, { valueTypeId: vec2TypeId });
    }
    const ambientWithVec2Map = buildAmbientDeclarations();

    const source = `
import { Sensor, type Context, type Vector2Map, type Vector2 } from "mindcraft";

export default Sensor({
  name: "vec-map",
  output: "Vector2Map",
  onExecute(ctx: Context): Vector2Map {
    const m: Vector2Map = { origin: { x: 0, y: 0 }, target: { x: 10, y: 20 } };
    return m;
  },
});
`;
    const result = compileUserTile(source, { ambientSource: ambientWithVec2Map });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isMapValue(runResult.result!), "expected map value");
      const map = runResult.result as MapValue;
      const origin = map.v.get("origin") as StructValue;
      assert.ok(isStructValue(origin), "expected struct value for origin");
      assert.equal((origin.v?.get("x") as NumberValue).v, 0);
      assert.equal((origin.v?.get("y") as NumberValue).v, 0);
      const target = map.v.get("target") as StructValue;
      assert.ok(isStructValue(target), "expected struct value for target");
      assert.equal((target.v?.get("x") as NumberValue).v, 10);
      assert.equal((target.v?.get("y") as NumberValue).v, 20);
    }
  });

  test("struct-typed object literal still compiles to STRUCT_NEW (regression)", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "struct-regression",
  output: "Vector2",
  onExecute(ctx: Context): Vector2 {
    const v: Vector2 = { x: 5, y: 10 };
    return v;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isStructValue(runResult.result!), "expected struct value, not map");
      const struct = runResult.result as StructValue;
      assert.equal(struct.typeId, mkTypeId(NativeType.Struct, "Vector2"));
      assert.equal((struct.v?.get("x") as NumberValue).v, 5);
      assert.equal((struct.v?.get("y") as NumberValue).v, 10);
    }
  });

  test("map with array value type: Record<string, number[]>", () => {
    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const numListTypeId = types.instantiate("List", List.from([numTypeId]));
    const numListMapName = "NumberListMap";
    const numListMapTypeId = mkTypeId(NativeType.Map, numListMapName);
    if (!types.get(numListMapTypeId)) {
      types.addMapType(numListMapName, { valueTypeId: numListTypeId });
    }
    const amb = buildAmbientDeclarations();

    const source = `
import { Sensor, type Context, type NumberListMap } from "mindcraft";

export default Sensor({
  name: "map-arr-val",
  output: "NumberListMap",
  onExecute(ctx: Context): NumberListMap {
    const m: NumberListMap = { scores: [10, 20], grades: [90, 95] };
    return m;
  },
});
`;
    const result = compileUserTile(source, { ambientSource: amb });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isMapValue(runResult.result!), "expected map value");
      const map = runResult.result as MapValue;
      const scores = map.v.get("scores") as ListValue;
      assert.ok(isListValue(scores), "expected list value for scores");
      assert.equal(scores.v.size(), 2);
      assert.equal((scores.v.get(0) as NumberValue).v, 10);
      assert.equal((scores.v.get(1) as NumberValue).v, 20);
    }
  });
});

describe("enum value literals", () => {
  before(async () => {
    registerCoreBrainComponents();
    const types = getBrainServices().types;
    const dirTypeId = mkTypeId(NativeType.Enum, "Direction");
    if (!types.get(dirTypeId)) {
      types.addEnumType("Direction", {
        symbols: List.from([
          { key: "north", label: "North" },
          { key: "south", label: "South" },
          { key: "east", label: "East" },
          { key: "west", label: "West" },
        ]),
        defaultKey: "north",
      });
    }
  });

  test("string literal with enum type annotation produces EnumValue", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

export default Sensor({
  name: "enum-literal",
  output: "Direction",
  onExecute(ctx: Context): Direction {
    const d: Direction = "north";
    return d;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isEnumValue(runResult.result!), "expected EnumValue");
      const ev = runResult.result as EnumValue;
      assert.equal(ev.typeId, mkTypeId(NativeType.Enum, "Direction"));
      assert.equal(ev.v, "north");
    }
  });

  test("enum value as function argument", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

function identity(d: Direction): Direction {
  return d;
}

export default Sensor({
  name: "enum-arg",
  output: "Direction",
  onExecute(ctx: Context): Direction {
    return identity("south");
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isEnumValue(runResult.result!), "expected EnumValue");
      const ev = runResult.result as EnumValue;
      assert.equal(ev.typeId, mkTypeId(NativeType.Enum, "Direction"));
      assert.equal(ev.v, "south");
    }
  });

  test("enum value as return value", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

export default Sensor({
  name: "enum-return",
  output: "Direction",
  onExecute(ctx: Context): Direction {
    return "east";
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isEnumValue(runResult.result!), "expected EnumValue");
      const ev = runResult.result as EnumValue;
      assert.equal(ev.typeId, mkTypeId(NativeType.Enum, "Direction"));
      assert.equal(ev.v, "east");
    }
  });

  test("plain string literal without enum context produces StringValue", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "plain-string",
  output: "string",
  onExecute(ctx: Context): string {
    return "hello";
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.String);
      assert.equal((runResult.result as StringValue).v, "hello");
    }
  });

  test("enum equality (===) returns true for matching values", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

export default Sensor({
  name: "enum-eq-true",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const a: Direction = "north";
    const b: Direction = "north";
    return a === b;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });

  test("enum equality (===) returns false for different values", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

function checkEqual(a: Direction, b: Direction): boolean {
  return a === b;
}

export default Sensor({
  name: "enum-eq-false",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return checkEqual("north", "south");
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, false);
    }
  });

  test("enum inequality (!==) returns true for different values", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Direction } from "mindcraft";

function checkNotEqual(a: Direction, b: Direction): boolean {
  return a !== b;
}

export default Sensor({
  name: "enum-neq",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return checkNotEqual("north", "east");
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const ctx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), ctx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Boolean);
      assert.equal((runResult.result as BooleanValue).v, true);
    }
  });
});

describe("property access chains + host calls", () => {
  before(async () => {
    registerCoreBrainComponents();

    const types = getBrainServices().types;
    const fns = getBrainServices().functions;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");

    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
        nominal: true,
      });
    }

    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityTypeId)) {
      types.addStructType("Entity", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "position", typeId: vec2TypeId },
        ]),
        nominal: true,
      });
    }

    const emptyCallDef = {
      callSpec: { type: "bag" as const, items: [] },
      argSlots: List.empty<never>(),
    };

    const engineDef = types.get(ContextTypeIds.EngineContext);
    const engineMethods =
      engineDef && "methods" in engineDef ? (engineDef as { methods?: List<{ name: string }> }).methods : undefined;
    const hasQueryNearby = engineMethods?.some((m) => m.name === "queryNearby") ?? false;
    if (!hasQueryNearby) {
      types.addStructMethods(
        ContextTypeIds.EngineContext,
        List.from([
          {
            name: "queryNearby",
            params: List.from([
              { name: "position", typeId: vec2TypeId },
              { name: "range", typeId: numTypeId },
            ]),
            returnTypeId: CoreTypeIds.Any,
          },
        ])
      );
    }

    if (!fns.get("EngineContext.queryNearby")) {
      fns.register("EngineContext.queryNearby", false, { exec: () => NIL_VALUE }, emptyCallDef);
    }
  });

  test("struct property access compiles to GET_FIELD", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "get-x",
  output: "number",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 42, y: 7 };
    return pos.x;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const execCtx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("chained struct property access (entity.position.x)", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Entity, type Vector2 } from "mindcraft";

export default Sensor({
  name: "get-entity-x",
  output: "number",
  onExecute(ctx: Context): number {
    const e: Entity = { name: "hero", position: { x: 99, y: 50 } };
    return e.position.x;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const execCtx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 99);
    }
  });

  test("ctx.time compiles to GET_FIELD", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "get-time",
  output: "number",
  onExecute(ctx: Context): number {
    return ctx.time;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const execCtx = mkCtx({ time: 12345 });

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 12345);
    }
  });

  test("ctx.dt compiles to GET_FIELD", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "get-dt",
  output: "number",
  onExecute(ctx: Context): number {
    return ctx.dt;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const execCtx = mkCtx({ dt: 16 });

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 16);
    }
  });

  test("ctx.self.getVariable compiles to struct method call", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "get-var",
  output: "number",
  onExecute(ctx: Context): number {
    const val = ctx.self.getVariable("myVar");
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const variables = new Map<string, Value>();
    variables.set("myVar", mkNumberValue(999));
    const execCtx = mkCtx({
      getVariable: <T extends Value>(name: string) => variables.get(name) as T | undefined,
    });

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
  });

  test("ctx.self.setVariable compiles to struct method call", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "set-var",
  output: "number",
  onExecute(ctx: Context): number {
    ctx.self.setVariable("myVar", 42);
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("ctx.engine.queryNearby compiles to struct method call", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "query",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    const pos: Vector2 = { x: 0, y: 0 };
    const result = ctx.engine.queryNearby(pos, 5);
    return true;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("unknown engine method produces compile error", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "bad-method",
  output: "number",
  onExecute(ctx: Context): number {
    ctx.engine.nonExistent();
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "Expected compile error for unknown engine method");
  });

  test("params.speed still resolves to LoadLocal (regression)", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "speed-check",
  output: "number",
  params: {
    speed: { type: "number", default: 10 },
  },
  onExecute(ctx: Context, params: { speed: number }): number {
    return params.speed;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const execCtx = mkCtx();

    const argsMap = mkArgsMap({ 0: mkNumberValue(25) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([argsMap]), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 25);
    }
  });

  test("list.length still resolves to ListLen (regression)", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "list-len",
  output: "number",
  onExecute(ctx: Context): number {
    const items: Array<number> = [1, 2, 3];
    return items.length;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const execCtx = mkCtx();

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 3);
    }
  });

  test("native-backed struct field access uses GET_FIELD (same bytecode)", () => {
    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const nativeActorId = mkTypeId(NativeType.Struct, "NativeActor");
    if (!types.get(nativeActorId)) {
      types.addStructType("NativeActor", {
        fields: List.from([{ name: "health", typeId: numTypeId }]),
        fieldGetter: (source, fieldName) => {
          if (fieldName === "health") return mkNumberValue(100);
          return undefined;
        },
      });
    }

    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NativeActor } from "mindcraft";

export default Sensor({
  name: "actor-health",
  output: "number",
  params: {
    actor: { type: "NativeActor" },
  },
  onExecute(ctx: Context, params: { actor: NativeActor }): number {
    return params.actor.health;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("unknown struct field produces compile error (caught by TS checker)", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "bad-field",
  output: "number",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 1, y: 2 };
    return pos.z;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "Expected compile error for unknown struct field");
    assert.ok(
      result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError),
      `Expected TypeScriptError diagnostic, got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("ctx alias resolves ctx.time correctly", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "ctx-alias",
  output: "number",
  onExecute(ctx: Context): number {
    const c = ctx;
    return c.time;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const execCtx = mkCtx({ time: 777 });

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 777);
    }
  });

  test("ctx alias resolves ctx.self.getVariable correctly", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "ctx-alias-self",
  output: "number",
  onExecute(ctx: Context): number {
    const c = ctx;
    const val = c.self.getVariable("myVar");
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });
});

describe("struct method calls", () => {
  before(async () => {
    registerCoreBrainComponents();

    const types = getBrainServices().types;
    const fns = getBrainServices().functions;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");
    const voidTypeId = mkTypeId(NativeType.Void, "void");

    const widgetTypeId = mkTypeId(NativeType.Struct, "Widget");
    if (!types.get(widgetTypeId)) {
      types.addStructType("Widget", {
        fields: List.from([{ name: "id", typeId: numTypeId }]),
        fieldGetter: (source, fieldName) => {
          if (fieldName === "id") return mkNumberValue((source.native as { id: number }).id);
          return undefined;
        },
        methods: List.from([
          {
            name: "getValue",
            params: List.from([{ name: "key", typeId: strTypeId }]),
            returnTypeId: numTypeId,
          },
          {
            name: "reset",
            params: List.empty<{ name: string; typeId: string }>(),
            returnTypeId: voidTypeId,
          },
          {
            name: "add",
            params: List.from([
              { name: "a", typeId: numTypeId },
              { name: "b", typeId: numTypeId },
            ]),
            returnTypeId: numTypeId,
          },
          {
            name: "fetchData",
            params: List.from([{ name: "url", typeId: strTypeId }]),
            returnTypeId: strTypeId,
            isAsync: true,
          },
        ]),
      });
    }

    const emptyCallDef = {
      callSpec: { type: "bag" as const, items: [] },
      argSlots: List.empty<never>(),
    };

    if (!fns.get("Widget.getValue")) {
      fns.register(
        "Widget.getValue",
        false,
        {
          exec: (_ctx: ExecutionContext, args: MapValue) => {
            const widget = (args.v.get(0) as StructValue).native as { id: number };
            const key = (args.v.get(1) as StringValue).v;
            if (key === "score") return mkNumberValue(widget.id * 10);
            return mkNumberValue(0);
          },
        },
        emptyCallDef
      );
    }

    if (!fns.get("Widget.reset")) {
      fns.register("Widget.reset", false, { exec: () => NIL_VALUE }, emptyCallDef);
    }

    if (!fns.get("Widget.add")) {
      fns.register(
        "Widget.add",
        false,
        {
          exec: (_ctx: ExecutionContext, args: MapValue) => {
            const a = (args.v.get(1) as NumberValue).v;
            const b = (args.v.get(2) as NumberValue).v;
            return mkNumberValue(a + b);
          },
        },
        emptyCallDef
      );
    }

    if (!fns.get("Widget.fetchData")) {
      fns.register(
        "Widget.fetchData",
        true,
        { exec: (_ctx: ExecutionContext, _args: MapValue, _handleId: number) => {} },
        emptyCallDef
      );
    }
  });

  test("struct method with one arg compiles to HostCallArgs with argc 2", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-get",
  output: "number",
  params: {
    w: { type: "Widget" },
  },
  onExecute(ctx: Context, params: { w: Widget }): number {
    return params.w.getValue("score");
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("struct method with no args compiles to HostCallArgs with argc 1", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-reset",
  output: "number",
  params: {
    w: { type: "Widget" },
  },
  onExecute(ctx: Context, params: { w: Widget }): number {
    params.w.reset();
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("struct method with multiple args compiles with correct argc", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-add",
  output: "number",
  params: {
    w: { type: "Widget" },
  },
  onExecute(ctx: Context, params: { w: Widget }): number {
    return params.w.add(3, 4);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("unknown method name on struct produces compile diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-bad",
  output: "number",
  params: {
    w: { type: "Widget" },
  },
  onExecute(ctx: Context, params: { w: Widget }): number {
    return params.w.nonExistent();
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "Expected compile error for unknown struct method");
    assert.ok(
      result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError),
      `Expected TypeScriptError diagnostic, got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("end-to-end: struct method call executes and returns correct value", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-e2e",
  output: "number",
  params: {
    w: { type: "Widget" },
  },
  onExecute(ctx: Context, params: { w: Widget }): number {
    return params.w.getValue("score");
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const execCtx = mkCtx();

    const widgetTypeId = mkTypeId(NativeType.Struct, "Widget");
    const widgetValue = mkNativeStructValue(widgetTypeId, { id: 7 });
    const argsMap = mkArgsMap({ 0: widgetValue });

    const fiber = vm.spawnFiber(1, 0, List.from<Value>([argsMap as Value]), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 70);
    }
  });

  test("end-to-end: struct method with multiple args returns correct value", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-add-e2e",
  output: "number",
  params: {
    w: { type: "Widget" },
  },
  onExecute(ctx: Context, params: { w: Widget }): number {
    return params.w.add(10, 25);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const execCtx = mkCtx();

    const widgetTypeId = mkTypeId(NativeType.Struct, "Widget");
    const widgetValue = mkNativeStructValue(widgetTypeId, { id: 1 });
    const argsMap = mkArgsMap({ 0: widgetValue });

    const fiber = vm.spawnFiber(1, 0, List.from<Value>([argsMap as Value]), execCtx);
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 35);
    }
  });

  test("ambient declarations include method signatures for structs with methods", () => {
    const ambientSource = buildAmbientDeclarations();
    assert.ok(ambientSource.includes("getValue(key: string): number;"), "Expected getValue method signature");
    assert.ok(ambientSource.includes("reset(): void;"), "Expected reset method signature");
    assert.ok(ambientSource.includes("add(a: number, b: number): number;"), "Expected add method signature");
  });

  test("async method declaration generates Promise<T> return type in ambient output", () => {
    const ambientSource = buildAmbientDeclarations();
    assert.ok(
      ambientSource.includes("fetchData(url: string): Promise<string>;"),
      "Expected async method with Promise return type"
    );
  });

  test("calling async host function emits HOST_CALL_ARGS_ASYNC", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-fetch",
  output: "number",
  params: {
    w: { type: "Widget" },
  },
  onExecute(ctx: Context, params: { w: Widget }): number {
    params.w.fetchData("http://example.com");
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const hasAsyncCall = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.HOST_CALL_ARGS_ASYNC));
    assert.ok(hasAsyncCall, "Expected HOST_CALL_ARGS_ASYNC opcode in bytecode");

    const hasSyncCall = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.HOST_CALL_ARGS));
    assert.ok(!hasSyncCall, "Expected no HOST_CALL_ARGS opcode for async method");
  });

  test("calling sync host function emits HOST_CALL_ARGS (not HOST_CALL_ARGS_ASYNC)", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "widget-get-sync",
  output: "number",
  params: {
    w: { type: "Widget" },
  },
  onExecute(ctx: Context, params: { w: Widget }): number {
    return params.w.getValue("score");
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const hasSyncCall = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.HOST_CALL_ARGS));
    assert.ok(hasSyncCall, "Expected HOST_CALL_ARGS opcode for sync method");

    const hasAsyncCall = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.HOST_CALL_ARGS_ASYNC));
    assert.ok(!hasAsyncCall, "Expected no HOST_CALL_ARGS_ASYNC opcode for sync method");
  });

  test(".pop() removes and returns last element", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-pop",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [10, 20, 30];
    const last = nums.pop();
    return last as number;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 30);
    }
  });

  test(".pop() on empty list returns nil", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-pop-empty",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [];
    nums.pop();
    return nums;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      assert.equal((runResult.result as ListValue).v.size(), 0);
    }
  });

  test(".shift() removes and returns first element", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-shift",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: NumberList = [10, 20, 30];
    const first = nums.shift();
    return first as number;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 10);
    }
  });

  test(".unshift() adds element at beginning", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-unshift",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [2, 3];
    nums.unshift(1);
    return nums;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

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

  test(".splice(1, 2) removes 2 elements at index 1", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-splice",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [10, 20, 30, 40, 50];
    const removed = nums.splice(1, 2);
    return removed;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const removed = runResult.result as ListValue;
      assert.equal(removed.v.size(), 2);
      assert.equal((removed.v.get(0) as NumberValue).v, 20);
      assert.equal((removed.v.get(1) as NumberValue).v, 30);
    }
  });

  test(".sort((a, b) => a - b) sorts ascending", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-asc",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [3, 1, 2];
    return nums.sort((a: number, b: number): number => a - b);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

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

  test(".sort((a, b) => b - a) sorts descending", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-desc",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [3, 1, 2];
    return nums.sort((a: number, b: number): number => b - a);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

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

  test(".sort() on already-sorted list is unchanged", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-sorted",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [1, 2, 3];
    return nums.sort((a: number, b: number): number => a - b);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

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

  test(".sort() on single-element list is unchanged", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-single",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [42];
    return nums.sort((a: number, b: number): number => a - b);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 1);
      assert.equal((list.v.get(0) as NumberValue).v, 42);
    }
  });

  test(".sort() on empty list is unchanged", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-empty",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [];
    return nums.sort((a: number, b: number): number => a - b);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(isListValue(runResult.result!));
      const list = runResult.result as ListValue;
      assert.equal(list.v.size(), 0);
    }
  });

  test(".sort() without comparator emits diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-no-cmp",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [3, 1, 2];
    return nums.sort();
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === LoweringDiagCode.SortRequiresComparatorFn));
  });

  test(".sort() mutates the original array", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type NumberList } from "mindcraft";

export default Sensor({
  name: "test-sort-mutates",
  output: "NumberList",
  onExecute(ctx: Context): NumberList {
    const nums: NumberList = [3, 1, 2];
    nums.sort((a: number, b: number): number => a - b);
    return nums;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 10000;

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

  test("true ? 1 : 2 -> 1", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "ternary-true",
  output: "number",
  onExecute(ctx: Context): number {
    return true ? 1 : 2;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 1);
    }
  });

  test("false ? 1 : 2 -> 2", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "ternary-false",
  output: "number",
  onExecute(ctx: Context): number {
    return false ? 1 : 2;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 2);
    }
  });

  test("ternary with variable condition", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "ternary-var",
  output: "number",
  params: {
    flag: { type: "boolean" },
  },
  onExecute(ctx: Context, params: { flag: boolean }): number {
    return params.flag ? 10 : 20;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    {
      const args = mkArgsMap({ 0: { t: NativeType.Boolean, v: true } as BooleanValue });
      const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
      fiber.instrBudget = 1000;
      const runResult = vm.runFiber(fiber, mkScheduler());
      assert.equal(runResult.status, VmStatus.DONE);
      if (runResult.status === VmStatus.DONE) {
        assert.equal((runResult.result as NumberValue).v, 10);
      }
    }
    {
      const args = mkArgsMap({ 0: { t: NativeType.Boolean, v: false } as BooleanValue });
      const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
      fiber.instrBudget = 1000;
      const runResult = vm.runFiber(fiber, mkScheduler());
      assert.equal(runResult.status, VmStatus.DONE);
      if (runResult.status === VmStatus.DONE) {
        assert.equal((runResult.result as NumberValue).v, 20);
      }
    }
  });

  test("nested ternary a ? (b ? 1 : 2) : 3", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "ternary-nested",
  output: "number",
  onExecute(ctx: Context): number {
    const a = true;
    const b = false;
    return a ? (b ? 1 : 2) : 3;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 2);
    }
  });

  test("null ?? 42 -> 42", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nullish-null",
  output: "number",
  onExecute(ctx: Context): number {
    const x: number | null = null;
    return x ?? 42;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("5 ?? 42 -> 5", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nullish-nonnull",
  output: "number",
  onExecute(ctx: Context): number {
    const x: number | null = 5;
    return x ?? 42;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 5);
    }
  });

  test("undefined ?? 42 -> 42", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nullish-undef",
  output: "number",
  onExecute(ctx: Context): number {
    const x: number | undefined = undefined;
    return x ?? 42;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("?? does not trigger on 0 (unlike ||)", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "nullish-zero",
  output: "number",
  onExecute(ctx: Context): number {
    const x: number | null = 0;
    return x ?? 42;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 0);
    }
  });
});

describe("await expression", () => {
  before(async () => {
    registerCoreBrainComponents();

    const types = getBrainServices().types;
    const fns = getBrainServices().functions;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");
    const voidTypeId = mkTypeId(NativeType.Void, "void");

    const emptyCallDef = {
      callSpec: { type: "bag" as const, items: [] },
      argSlots: List.empty<never>(),
    };

    const widgetTypeId = mkTypeId(NativeType.Struct, "Widget");
    if (!types.get(widgetTypeId)) {
      types.addStructType("Widget", {
        fields: List.from([{ name: "id", typeId: numTypeId }]),
        methods: List.from([
          {
            name: "fetchData",
            params: List.from([{ name: "url", typeId: strTypeId }]),
            returnTypeId: numTypeId,
            isAsync: true,
          },
          {
            name: "getValue",
            params: List.from([{ name: "key", typeId: strTypeId }]),
            returnTypeId: numTypeId,
          },
          {
            name: "reset",
            params: List.empty<{ name: string; typeId: string }>(),
            returnTypeId: voidTypeId,
          },
        ]),
        nominal: true,
      });
    }

    if (!fns.get("Widget.fetchData")) {
      fns.register(
        "Widget.fetchData",
        true,
        { exec: (_ctx: ExecutionContext, _args: MapValue, _handleId: number) => {} },
        emptyCallDef
      );
    }

    if (!fns.get("Widget.getValue")) {
      fns.register(
        "Widget.getValue",
        false,
        {
          exec: (_ctx: ExecutionContext, _args: MapValue) => {
            return mkNumberValue(42);
          },
        },
        emptyCallDef
      );
    }

    if (!fns.get("Widget.reset")) {
      fns.register("Widget.reset", false, { exec: () => NIL_VALUE }, emptyCallDef);
    }
  });

  test("single await: fiber suspends, resolves, and returns value", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "fetch-await",
  output: "string",
  params: {
    w: { type: "Widget" },
  },
  async onExecute(ctx: Context, params: { w: Widget }): Promise<string> {
    const result = await params.w.fetchData("test-url");
    return result;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const hasAsyncCall = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.HOST_CALL_ARGS_ASYNC));
    assert.ok(hasAsyncCall, "Expected HOST_CALL_ARGS_ASYNC opcode");

    const hasAwait = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.AWAIT));
    assert.ok(hasAwait, "Expected AWAIT opcode");

    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const args = mkArgsMap({ 0: mkNativeStructValue("Widget", { id: 1 }) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const run1 = vm.runFiber(fiber, mkScheduler());
    assert.equal(run1.status, VmStatus.WAITING, "Fiber should suspend at AWAIT");

    const handleId = run1.handleId!;
    handles.resolve(handleId, mkStringValue("fetched-data"));

    vm.resumeFiberFromHandle(fiber, handleId, mkScheduler());
    fiber.instrBudget = 1000;
    const run2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(run2.status, VmStatus.DONE);
    assert.ok(run2.result);
    assert.equal((run2.result as StringValue).v, "fetched-data");
  });

  test("two consecutive awaits: fiber suspends twice and produces correct result", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "double-await",
  output: "string",
  params: {
    w: { type: "Widget" },
  },
  async onExecute(ctx: Context, params: { w: Widget }): Promise<string> {
    const a = await params.w.fetchData("first");
    const b = await params.w.fetchData("second");
    return a + b;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    let awaitCount = 0;
    prog.functions.forEach((fn) => {
      fn.code.forEach((instr) => {
        if (instr.op === Op.AWAIT) awaitCount++;
      });
    });
    assert.equal(awaitCount, 2, "Expected exactly 2 AWAIT instructions");

    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const args = mkArgsMap({ 0: mkNativeStructValue("Widget", { id: 1 }) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const run1 = vm.runFiber(fiber, mkScheduler());
    assert.equal(run1.status, VmStatus.WAITING, "First AWAIT should suspend");
    const h1 = run1.handleId!;
    handles.resolve(h1, mkStringValue("hello"));
    vm.resumeFiberFromHandle(fiber, h1, mkScheduler());

    fiber.instrBudget = 1000;
    const run2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(run2.status, VmStatus.WAITING, "Second AWAIT should suspend");
    const h2 = run2.handleId!;
    handles.resolve(h2, mkStringValue("world"));
    vm.resumeFiberFromHandle(fiber, h2, mkScheduler());

    fiber.instrBudget = 1000;
    const run3 = vm.runFiber(fiber, mkScheduler());
    assert.equal(run3.status, VmStatus.DONE);
    assert.ok(run3.result);
    assert.equal((run3.result as StringValue).v, "helloworld");
  });

  test("local variable survives across await point", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "local-across-await",
  output: "string",
  params: {
    w: { type: "Widget" },
  },
  async onExecute(ctx: Context, params: { w: Widget }): Promise<string> {
    const before = "prefix-";
    const fetched = await params.w.fetchData("data");
    return before + fetched;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const args = mkArgsMap({ 0: mkNativeStructValue("Widget", { id: 1 }) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 1000;

    const run1 = vm.runFiber(fiber, mkScheduler());
    assert.equal(run1.status, VmStatus.WAITING);
    const handleId = run1.handleId!;
    handles.resolve(handleId, mkStringValue("resolved"));
    vm.resumeFiberFromHandle(fiber, handleId, mkScheduler());

    fiber.instrBudget = 1000;
    const run2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(run2.status, VmStatus.DONE);
    assert.ok(run2.result);
    assert.equal((run2.result as StringValue).v, "prefix-resolved");
  });

  test("await on sync function call produces compile error", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "bad-await",
  output: "number",
  params: {
    w: { type: "Widget" },
  },
  async onExecute(ctx: Context, params: { w: Widget }): Promise<number> {
    const val = await params.w.getValue("score");
    return val;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "Expected compile error for await on sync call");
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.AwaitOnNonAsyncHostCall),
      `Expected AwaitOnNonAsyncHostCall diagnostic, got: ${JSON.stringify(result.diagnostics)}`
    );
  });
});

describe("destructuring", () => {
  before(async () => {
    registerCoreBrainComponents();

    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");

    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
        nominal: true,
      });
    }
  });

  test("object destructuring: const { x, y } = { x: 1, y: 2 }", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "obj-destructure",
  output: "number",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 1, y: 2 };
    const { x, y } = pos;
    return x + y;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 3);
    }
  });

  test("array destructuring: const [a, b] = [10, 20]", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "arr-destructure",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: number[] = [10, 20];
    const [a, b] = arr;
    return a + b;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 30);
    }
  });

  test("nested object destructuring: const { inner: { x, y } } = obj", () => {
    const ambientSource = buildAmbientDeclarations();

    const types = getBrainServices().types;
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityTypeId)) {
      types.addStructType("Entity", {
        fields: List.from([{ name: "pos", typeId: vec2TypeId }]),
        nominal: true,
      });
    }

    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

interface Entity {
  pos: Vector2;
}

export default Sensor({
  name: "nested-obj-destructure",
  output: "number",
  onExecute(ctx: Context): number {
    const entity: Entity = { pos: { x: 10, y: 20 } };
    const { pos: { x, y } } = entity;
    return x + y;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 30);
    }
  });

  test("nested array-in-object destructuring: const { pos: [x, y] } = entity", () => {
    const ambientSource = buildAmbientDeclarations();

    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const numListTypeId = types.instantiate("List", List.from([numTypeId]));
    const coordTypeId = mkTypeId(NativeType.Struct, "Coord");
    if (!types.get(coordTypeId)) {
      types.addStructType("Coord", {
        fields: List.from([{ name: "pos", typeId: numListTypeId }]),
        nominal: true,
      });
    }

    const source = `
import { Sensor, type Context } from "mindcraft";

interface Coord {
  pos: number[];
}

export default Sensor({
  name: "nested-arr-in-obj",
  output: "number",
  onExecute(ctx: Context): number {
    const entity: Coord = { pos: [3, 4] };
    const { pos: [x, y] } = entity;
    return x + y;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 7);
    }
  });

  test("mixed nesting: object containing array", () => {
    const ambientSource = buildAmbientDeclarations();

    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const numListTypeId = types.instantiate("List", List.from([numTypeId]));
    const pairHolderTypeId = mkTypeId(NativeType.Struct, "PairHolder");
    if (!types.get(pairHolderTypeId)) {
      types.addStructType("PairHolder", {
        fields: List.from([{ name: "items", typeId: numListTypeId }]),
        nominal: true,
      });
    }

    const source = `
import { Sensor, type Context } from "mindcraft";

interface PairHolder {
  items: number[];
}

export default Sensor({
  name: "mixed-nesting",
  output: "number",
  onExecute(ctx: Context): number {
    const data: PairHolder = { items: [100, 200] };
    const { items: [first, second] } = data;
    return first + second;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 300);
    }
  });

  test("three levels of nesting: array in object in object", () => {
    const ambientSource = buildAmbientDeclarations();

    const types = getBrainServices().types;
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    const wrapperTypeId = mkTypeId(NativeType.Struct, "Wrapper");
    if (!types.get(wrapperTypeId)) {
      types.addStructType("Wrapper", {
        fields: List.from([{ name: "entity", typeId: entityTypeId }]),
        nominal: true,
      });
    }

    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

interface Entity {
  pos: Vector2;
}
interface Wrapper {
  entity: Entity;
}

export default Sensor({
  name: "deep-nesting",
  output: "number",
  onExecute(ctx: Context): number {
    const w: Wrapper = { entity: { pos: { x: 5, y: 6 } } };
    const { entity: { pos: { x, y } } } = w;
    return x + y;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 11);
    }
  });

  test("array rest pattern: const [first, ...rest] = arr", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "rest-destructure",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: number[] = [1, 2, 3, 4];
    const [first, ...rest] = arr;
    return first + rest[0] + rest[1] + rest[2];
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 10);
    }
  });

  test("array rest pattern: const [a, b, ...tail] = arr", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "rest-tail",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: number[] = [10, 20, 30, 40, 50];
    const [a, b, ...tail] = arr;
    return a + b + tail.length;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 33);
    }
  });

  test("array rest pattern: const [...all] = arr copies the array", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "rest-all",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: number[] = [5, 10, 15];
    const [...all] = arr;
    return all[0] + all[1] + all[2];
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 30);
    }
  });

  test("object rest pattern: const { x, ...rest } = obj extracts x", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "obj-rest",
  output: "number",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 10, y: 20 };
    const { x, ...rest } = obj;
    return x;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 10);
    }
  });

  test("object rest pattern: rest contains remaining fields", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "obj-rest-remaining",
  output: "Vector2",
  onExecute(ctx: Context): Vector2 {
    const obj: Vector2 = { x: 3, y: 7 };
    const { x, ...rest } = obj;
    return rest as unknown as Vector2;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isStructValue(runResult.result), "expected struct value for rest");
      const rest = runResult.result as StructValue;
      assert.equal((rest.v?.get("y") as NumberValue).v, 7, "rest should contain y=7");
      assert.equal(rest.v?.get("x"), undefined, "rest should not contain x");
    }
  });

  test("nested destructuring with rest on inner struct: const { pos: { x, ...posRest } } = entity", () => {
    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityTypeId)) {
      types.addStructType("Entity", {
        fields: List.from([{ name: "pos", typeId: vec2TypeId }]),
        nominal: true,
      });
    }
    const ambientSource = buildAmbientDeclarations();

    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

interface Entity {
  pos: Vector2;
}

export default Sensor({
  name: "nested-rest-inner",
  output: "number",
  onExecute(ctx: Context): number {
    const entity: Entity = { pos: { x: 5, y: 15 } };
    const { pos: { x, ...posRest } } = entity;
    return x;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 5);
    }
  });

  test("rest on outer struct with 3 fields: const { name, ...rest } = player", () => {
    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const playerTypeId = mkTypeId(NativeType.Struct, "Player");
    if (!types.get(playerTypeId)) {
      types.addStructType("Player", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "pos", typeId: vec2TypeId },
          { name: "health", typeId: numTypeId },
        ]),
        nominal: true,
      });
    }
    const ambientSource = buildAmbientDeclarations();

    const source = `
import { Sensor, type Context, type Vector2, type Player } from "mindcraft";

export default Sensor({
  name: "rest-outer-3-fields",
  output: "Player",
  onExecute(ctx: Context): Player {
    const player: Player = { name: "alice", pos: { x: 1, y: 2 }, health: 100 };
    const { name, ...rest } = player;
    return rest as unknown as Player;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.ok(isStructValue(runResult.result), "expected struct for rest");
      const rest = runResult.result as StructValue;
      assert.equal(rest.v?.get("name"), undefined, "rest should not contain name");
      const pos = rest.v?.get("pos");
      assert.ok(pos && isStructValue(pos), "rest should contain pos as struct");
      assert.equal((rest.v?.get("health") as NumberValue).v, 100, "rest should contain health=100");
    }
  });

  test("nested destructure + rest at outer level: const { pos: { x }, ...rest } = player", () => {
    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const playerTypeId = mkTypeId(NativeType.Struct, "Player");
    if (!types.get(playerTypeId)) {
      types.addStructType("Player", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "pos", typeId: vec2TypeId },
          { name: "health", typeId: numTypeId },
        ]),
        nominal: true,
      });
    }
    const ambientSource = buildAmbientDeclarations();

    const source = `
import { Sensor, type Context, type Vector2, type Player } from "mindcraft";

export default Sensor({
  name: "nested-plus-outer-rest",
  output: "number",
  onExecute(ctx: Context): number {
    const player: Player = { name: "bob", pos: { x: 42, y: 99 }, health: 75 };
    const { pos: { x }, ...rest } = player;
    return x;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("property access on object rest variable: rest.y after const { x, ...rest } = obj", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "rest-prop-access",
  output: "number",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 10, y: 20 };
    const { x, ...rest } = obj;
    return rest.y;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 20);
    }
  });

  test("property access on rest variable from 3-field struct: rest.health after const { name, ...rest } = player", () => {
    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");
    const strTypeId = mkTypeId(NativeType.String, "string");
    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    const playerTypeId = mkTypeId(NativeType.Struct, "Player");
    if (!types.get(playerTypeId)) {
      types.addStructType("Player", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "pos", typeId: vec2TypeId },
          { name: "health", typeId: numTypeId },
        ]),
        nominal: true,
      });
    }
    const ambientSource = buildAmbientDeclarations();

    const source = `
import { Sensor, type Context, type Vector2, type Player } from "mindcraft";

export default Sensor({
  name: "rest-prop-access-3-field",
  output: "number",
  onExecute(ctx: Context): number {
    const player: Player = { name: "alice", pos: { x: 1, y: 2 }, health: 100 };
    const { name, ...rest } = player;
    return rest.health;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 100);
    }
  });

  test("computed property name in destructuring: const { ['x']: val } = obj", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "computed-key-literal",
  output: "number",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 42, y: 99 };
    const { ["x"]: val } = obj;
    return val;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("computed property name with variable key: const key = 'y'; const { [key]: val } = obj", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "computed-key-variable",
  output: "number",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 10, y: 55 };
    const key = "y";
    const { [key]: val } = obj;
    return val;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 55);
    }
  });

  test("computed property name combined with rest pattern: const { ['x']: val, ...rest } = obj", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "computed-key-rest",
  output: "number",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 1, y: 2 };
    const { ["x"]: val, ...rest } = obj;
    return val + rest.y;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 3);
    }
  });

  test("object destructuring with default value uses default when field is present", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "default-destructure",
  output: "number",
  onExecute(ctx: Context): number {
    const obj: Vector2 = { x: 3, y: 10 };
    const { x = 5, y = 0 } = obj;
    return x + y;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 13);
    }
  });

  test("object destructuring with rename: const { x: posX } = pos", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

export default Sensor({
  name: "rename-destructure",
  output: "number",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 42, y: 7 };
    const { x: posX, y: posY } = pos;
    return posX + posY;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 49);
    }
  });

  test("array destructuring with omitted elements: const [, b] = arr", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "omitted-destructure",
  output: "number",
  onExecute(ctx: Context): number {
    const arr: number[] = [10, 20, 30];
    const [, b, c] = arr;
    return b + c;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal((runResult.result as NumberValue).v, 50);
    }
  });

  test("helper function with object destructuring in parameter: function f({ x, y }: Point)", () => {
    const ambientSource = buildAmbientDeclarations();

    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

function sum({ x, y }: Vector2): number {
  return x + y;
}

export default Sensor({
  name: "param-obj-destructure",
  output: "number",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 10, y: 20 };
    return sum(pos);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 30);
    }
  });

  test("helper function with array destructuring in parameter: function f([a, b]: number[])", () => {
    const ambientSource = buildAmbientDeclarations();

    const source = `
import { Sensor, type Context } from "mindcraft";

function sum([a, b]: number[]): number {
  return a + b;
}

export default Sensor({
  name: "param-arr-destructure",
  output: "number",
  onExecute(ctx: Context): number {
    const nums: number[] = [3, 7];
    return sum(nums);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 10);
    }
  });

  test("closure with object destructuring in parameter: ({ x }: Point) => x", () => {
    const ambientSource = buildAmbientDeclarations();

    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

function apply(fn: (p: Vector2) => number, p: Vector2): number {
  return fn(p);
}

export default Sensor({
  name: "closure-param-destructure",
  output: "number",
  onExecute(ctx: Context): number {
    const pos: Vector2 = { x: 5, y: 15 };
    return apply(({ x, y }: Vector2): number => x + y, pos);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 20);
    }
  });

  test("closure with destructured param that also captures an outer variable", () => {
    const ambientSource = buildAmbientDeclarations();

    const source = `
import { Sensor, type Context, type Vector2 } from "mindcraft";

function apply(fn: (p: Vector2) => number, p: Vector2): number {
  return fn(p);
}

export default Sensor({
  name: "closure-destructure-capture",
  output: "number",
  onExecute(ctx: Context): number {
    const offset = 100;
    const pos: Vector2 = { x: 3, y: 7 };
    return apply(({ x, y }: Vector2): number => x + y + offset, pos);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;

    const runResult2 = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult2.status, VmStatus.DONE);
    if (runResult2.status === VmStatus.DONE) {
      assert.ok(runResult2.result);
      assert.equal((runResult2.result as NumberValue).v, 110);
    }
  });

  test("destructuring in onExecute parameter position produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();

    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "onexec-destructure",
  output: "number",
  onExecute({ time }: Context): number {
    return time;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for onExecute destructuring");
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.DestructuringInOnExecuteNotSupported),
      `expected onExecute destructuring error, got: ${JSON.stringify(result.diagnostics)}`
    );
  });
});

describe("class declarations", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("class with constructor and method compiles without errors (stub bodies)", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  magnitude(): number {
    return this.x + this.y;
  }
}

export default Sensor({
  name: "class-test",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("class registers struct type with correct fields", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Vec2 {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export default Sensor({
  name: "struct-reg",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = getBrainServices().types;
    const typeId = registry.resolveByName("Vec2");
    assert.ok(typeId, "Vec2 struct type should be registered");
    const def = registry.get(typeId!);
    assert.ok(def, "Vec2 type def should exist");
    assert.equal(def!.coreType, NativeType.Struct);

    const fieldNames: string[] = [];
    const structDef = def as StructTypeDef;
    structDef.fields.forEach((f) => {
      fieldNames.push(f.name);
    });
    assert.ok(fieldNames.includes("x"), "should have field x");
    assert.ok(fieldNames.includes("y"), "should have field y");
  });

  test("class registers method declarations on struct type", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  increment(): number {
    return this.value;
  }
  add(n: number): number {
    return this.value + n;
  }
}

export default Sensor({
  name: "method-reg",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = getBrainServices().types;
    const typeId = registry.resolveByName("Counter");
    assert.ok(typeId, "Counter struct type should be registered");
    const def = registry.get(typeId!) as StructTypeDef;
    assert.ok(def.methods, "Counter should have methods");

    const methodNames: string[] = [];
    def.methods!.forEach((m) => {
      methodNames.push(m.name);
    });
    assert.ok(methodNames.includes("increment"), "should have method increment");
    assert.ok(methodNames.includes("add"), "should have method add");
  });

  test("function table contains constructor and method entries", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Pair {
  a: number;
  b: number;
  constructor(a: number, b: number) {
    this.a = a;
    this.b = b;
  }
  sum(): number {
    return this.a + this.b;
  }
}

export default Sensor({
  name: "fn-table",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const funcNames: string[] = [];
    prog.functions.forEach((f) => {
      if (f.name) funcNames.push(f.name);
    });
    assert.ok(funcNames.includes("Pair$new"), `expected Pair$new in functions, got: ${funcNames.join(", ")}`);
    assert.ok(funcNames.includes("Pair.sum"), `expected Pair.sum in functions, got: ${funcNames.join(", ")}`);
  });

  test("class with extends produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Base {
  x: number;
  constructor() { this.x = 0; }
}

class Child extends Base {
  y: number;
  constructor() { super(); this.y = 1; }
}

export default Sensor({
  name: "extends-test",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for extends");
    assert.ok(
      result.diagnostics.some((d) => d.code === ValidatorDiagCode.ClassInheritanceNotSupported),
      `expected inheritance error, got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("class with static member produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Foo {
  static count: number = 0;
}

export default Sensor({
  name: "static-test",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for static");
    assert.ok(
      result.diagnostics.some((d) => d.code === ValidatorDiagCode.StaticMembersNotSupported),
      `expected static error, got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("class with private field produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Foo {
  private secret: number;
  constructor() { this.secret = 42; }
}

export default Sensor({
  name: "private-test",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  });

  test("class with no constructor compiles (zero-arg stub)", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Tag {
  label: string = "default";
}

export default Sensor({
  name: "no-ctor",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const funcNames: string[] = [];
    prog.functions.forEach((f) => {
      if (f.name) funcNames.push(f.name);
    });
    assert.ok(funcNames.includes("Tag$new"), `expected Tag$new in functions, got: ${funcNames.join(", ")}`);
  });

  test("class with getter produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Foo {
  _x: number;
  constructor() { this._x = 0; }
  get x(): number { return this._x; }
}

export default Sensor({
  name: "getter-test",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for getter");
    assert.ok(
      result.diagnostics.some((d) => d.code === ValidatorDiagCode.ClassGettersSettersNotSupported),
      `expected getter/setter error, got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("new ClassName(args) creates struct with correct field values", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export default Sensor({
  name: "new-point",
  output: "number",
  onExecute(ctx: Context): number {
    const p = new Point(3, 4);
    return p.x + p.y;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 7);
    }
  });

  test("property initializer sets default value", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Config {
  threshold: number = 42;
  label: string = "hello";
  constructor() {}
}

export default Sensor({
  name: "prop-init",
  output: "number",
  onExecute(ctx: Context): number {
    const c = new Config();
    return c.threshold;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("property initializer runs before constructor body", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  value: number = 10;
  constructor(extra: number) {
    this.value = this.value + extra;
  }
}

export default Sensor({
  name: "init-order",
  output: "number",
  onExecute(ctx: Context): number {
    const c = new Counter(5);
    return c.value;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 15);
    }
  });

  test("new expression with unknown class produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "bad-new",
  output: "number",
  onExecute(ctx: Context): number {
    const p = new UnknownClass();
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for unknown class");
  });

  test("this outside class context produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

function helper(): number {
  return this.x;
}

export default Sensor({
  name: "bad-this",
  output: "number",
  onExecute(ctx: Context): number {
    return helper();
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for this outside class");
  });

  test("constructor returns struct value directly", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Pair {
  a: number;
  b: number;
  constructor(a: number, b: number) {
    this.a = a;
    this.b = b;
  }
}

export default Sensor({
  name: "ctor-struct",
  output: "number",
  onExecute(ctx: Context): number {
    const p = new Pair(10, 20);
    return p.a;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 10);
    }
  });

  test("class with no explicit constructor uses property initializers", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Defaults {
  count: number = 99;
}

export default Sensor({
  name: "no-ctor-init",
  output: "number",
  onExecute(ctx: Context): number {
    const d = new Defaults();
    return d.count;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 99);
    }
  });

  test("method body reads this.x correctly", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Box {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  getValue(): number {
    return this.value;
  }
}

export default Sensor({
  name: "method-read",
  output: "number",
  onExecute(ctx: Context): number {
    const b = new Box(42);
    return b.getValue();
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("method body writes this.x with store-back pattern", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Settable {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  assign(n: number): Settable {
    this.value = n;
    return this;
  }
}

export default Sensor({
  name: "method-write",
  output: "number",
  onExecute(ctx: Context): number {
    const c = new Settable(10);
    const c2 = c.assign(99);
    return c2.value;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 99);
    }
  });

  test("obj.method(args) calls a user-compiled method", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Adder {
  base: number;
  constructor(b: number) {
    this.base = b;
  }
  add(n: number): number {
    return this.base + n;
  }
}

export default Sensor({
  name: "method-call",
  output: "number",
  onExecute(ctx: Context): number {
    const a = new Adder(100);
    return a.add(23);
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 123);
    }
  });

  test("method calls another method on this", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Calc {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  double(): number {
    return this.value * 2;
  }
  quadruple(): number {
    return this.double() + this.double();
  }
}

export default Sensor({
  name: "this-method-call",
  output: "number",
  onExecute(ctx: Context): number {
    const c = new Calc(5);
    return c.quadruple();
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 20);
    }
  });

  test("method returns a computed value", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Rect {
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }
  area(): number {
    return this.w * this.h;
  }
}

export default Sensor({
  name: "method-compute",
  output: "number",
  onExecute(ctx: Context): number {
    const r = new Rect(6, 7);
    return r.area();
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("method with no explicit return returns nil", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Tracker {
  count: number;
  constructor() {
    this.count = 0;
  }
  bump(): void {
    this.count = this.count + 1;
  }
}

export default Sensor({
  name: "method-void",
  output: "number",
  onExecute(ctx: Context): number {
    const t = new Tracker();
    t.bump();
    return 42;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("multiple methods on the same class", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class TwoD {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  getX(): number {
    return this.x;
  }
  getY(): number {
    return this.y;
  }
  sum(): number {
    return this.getX() + this.getY();
  }
}

export default Sensor({
  name: "multi-method",
  output: "number",
  onExecute(ctx: Context): number {
    const c = new TwoD(11, 22);
    return c.sum();
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 33);
    }
  });

  test("compound assignment this.x += value reads, computes, and writes back", () => {
    const ambientSource = buildAmbientDeclarations();
    const source = `
import { Sensor, type Context } from "mindcraft";

class Accumulator {
  total: number;
  constructor(initial: number) {
    this.total = initial;
  }
  add(n: number): Accumulator {
    this.total += n;
    return this;
  }
}

export default Sensor({
  name: "compound-assign",
  output: "number",
  onExecute(ctx: Context): number {
    const a = new Accumulator(10);
    const a2 = a.add(5);
    return a2.total;
  },
});
`;
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 15);
    }
  });

  test("recompiling a class with changed shape picks up new fields", () => {
    const sourceV1 = `
import { Sensor, type Context } from "mindcraft";

class ShapeEvol {
  x: number = 1;
}

export default Sensor({
  name: "shape-evol",
  output: "number",
  onExecute(ctx: Context): number {
    const s = new ShapeEvol();
    return s.x;
  },
});
`;
    const resultV1 = compileUserTile(sourceV1);
    assert.deepStrictEqual(resultV1.diagnostics, [], `V1 diagnostics: ${JSON.stringify(resultV1.diagnostics)}`);
    assert.ok(resultV1.program);

    const registryV1 = getBrainServices().types;
    const typeIdV1 = registryV1.resolveByName("ShapeEvol");
    assert.ok(typeIdV1, "ShapeEvol should be registered after V1");
    const defV1 = registryV1.get(typeIdV1!) as StructTypeDef;
    assert.equal(defV1.fields.size(), 1);

    const sourceV2 = `
import { Sensor, type Context } from "mindcraft";

class ShapeEvol {
  x: number = 1;
  y: number = 2;
}

export default Sensor({
  name: "shape-evol",
  output: "number",
  onExecute(ctx: Context): number {
    const s = new ShapeEvol();
    return s.x + s.y;
  },
});
`;
    const resultV2 = compileUserTile(sourceV2);
    assert.deepStrictEqual(resultV2.diagnostics, [], `V2 diagnostics: ${JSON.stringify(resultV2.diagnostics)}`);
    assert.ok(resultV2.program);

    const registryV2 = getBrainServices().types;
    const typeIdV2 = registryV2.resolveByName("ShapeEvol");
    assert.ok(typeIdV2, "ShapeEvol should be registered after V2");
    const defV2 = registryV2.get(typeIdV2!) as StructTypeDef;
    assert.equal(defV2.fields.size(), 2, "V2 should have 2 fields (x and y)");
  });
});
