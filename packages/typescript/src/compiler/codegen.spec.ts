import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type BooleanValue,
  type ExecutionContext,
  getBrainServices,
  HandleTable,
  isStructValue,
  type MapValue,
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
    fiberId: 0,
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
    const fiber = vm.spawnFiber(1, 0, List.from([args]), ctx);
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
    const fiber = vm.spawnFiber(1, 0, List.from([args]), ctx);
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.from([args]), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.from([args]), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.from([args]), mkCtx());
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.from([args]), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.from([args]), mkCtx());
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
      const fiber = vm.spawnFiber(1, 0, List.from([mkArgsMap({ 0: mkNumberValue(15) })]), mkCtx());
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
      const fiber = vm.spawnFiber(1, 0, List.from([mkArgsMap({ 0: mkNumberValue(7) })]), mkCtx());
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
      const fiber = vm.spawnFiber(1, 0, List.from([mkArgsMap({ 0: mkNumberValue(2) })]), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from([mkArgsMap({ 0: mkNumberValue(50) })]), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from([mkArgsMap({ 0: mkNumberValue(-10) })]), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from([mkArgsMap({ 0: mkNumberValue(200) })]), mkCtx());
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
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from([mkArgsMap({ 0: mkNumberValue(7) })]), mkCtx());
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
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from([mkArgsMap({ 0: mkNumberValue(10) })]), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars1;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 1);
    }
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from([mkArgsMap({ 0: mkNumberValue(5) })]), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 5);
    }

    // Call with val=3 -> total becomes 8
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from([mkArgsMap({ 0: mkNumberValue(3) })]), mkCtx());
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
    const fiber = vm.spawnFiber(1, result.program!.entryFuncId, List.empty(), mkCtx());
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
      List.from([mkArgsMap({ 0: mkNumberValue(5) })]),
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from([mkArgsMap({ 0: mkNumberValue(15) })]), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as BooleanValue).v, true);
    }

    // val=5 > THRESHOLD=10 -> false
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from([mkArgsMap({ 0: mkNumberValue(5) })]), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, expected);
    }

    // Run onPageEntered wrapper -> resets count via init + user onPageEntered
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.lifecycleFuncIds.onPageEntered!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
    }

    // Next exec call -> count should be 1 again (reset happened)
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, expected);
    }

    // Run onPageEntered wrapper -> no user function, but runs init -> count = 0
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.lifecycleFuncIds.onPageEntered!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
    }

    // Next exec -> count = 1 (re-initialized)
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.lifecycleFuncIds.onPageEntered!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
    }

    // exec -> startValue was 100, now becomes 101
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, prog.lifecycleFuncIds.onPageEntered!, List.empty(), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.lifecycleFuncIds.onPageEntered!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    // exec: a=5+1=6, b=50+10=60, return 66
    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.from([args]), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.from([args]), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber2 = vm2.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
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

    const fiber = vm.spawnFiber(1, 0, List.empty(), ctx);
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
