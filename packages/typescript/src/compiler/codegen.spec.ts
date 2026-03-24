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
  registerCoreBrainComponents,
  runtime,
  type Scheduler,
  type StringValue,
  type StructValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { buildAmbientDeclarations } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { compileUserTile, initCompiler } from "./compile.js";

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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
    assert.ok(result.diagnostics[0].message.includes("Unknown output type"));
  });

  test("app-defined output type resolves via registry", () => {
    const types = getBrainServices().types;
    const actorRefTypeId = mkTypeId(NativeType.Struct, "actorRef");
    if (!types.get(actorRefTypeId)) {
      types.addStructType("actorRef", {
        fields: List.from([{ name: "id", typeId: mkTypeId(NativeType.Number, "number") }]),
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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
      result.diagnostics.some((d) => d.message.includes("unable to determine type")),
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
      result.diagnostics.some((d) => d.message.includes("No conversion from")),
      `Expected no-conversion diagnostic but got: ${JSON.stringify(result.diagnostics)}`
    );
  });
});

describe("struct literal compilation", () => {
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();

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
      });
    }
    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityTypeId)) {
      types.addStructType("Entity", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "position", typeId: vec2TypeId },
        ]),
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
    await initCompiler();

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
    await initCompiler();

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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
    await initCompiler();

    const types = getBrainServices().types;
    const numTypeId = mkTypeId(NativeType.Number, "number");

    const vec2TypeId = mkTypeId(NativeType.Struct, "Vector2");
    if (!types.get(vec2TypeId)) {
      types.addStructType("Vector2", {
        fields: List.from([
          { name: "x", typeId: numTypeId },
          { name: "y", typeId: numTypeId },
        ]),
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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
      result.diagnostics.some((d) => d.message.includes("Unsupported typeof comparison")),
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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
    await initCompiler();

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
});

// ---- Function type signatures ----

describe("function type signatures", () => {
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
    await initCompiler();

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
});

describe("enum value literals", () => {
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
    await initCompiler();

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
      });
    }

    const entityTypeId = mkTypeId(NativeType.Struct, "Entity");
    if (!types.get(entityTypeId)) {
      types.addStructType("Entity", {
        fields: List.from([
          { name: "name", typeId: strTypeId },
          { name: "position", typeId: vec2TypeId },
        ]),
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
      result.diagnostics.some((d) => d.message.includes("z")),
      `Expected diagnostic mentioning 'z', got: ${JSON.stringify(result.diagnostics)}`
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
    await initCompiler();

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
      result.diagnostics.some((d) => d.message.includes("nonExistent")),
      `Expected diagnostic mentioning 'nonExistent', got: ${JSON.stringify(result.diagnostics)}`
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
});
