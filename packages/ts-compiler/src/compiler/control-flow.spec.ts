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
describe("control flow + local variables", () => {
  before(() => {
    services = __test__createBrainServices();
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

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
    const result = compileUserTile(source, { services });
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const args = mkArgsMap({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, 0, List.from<Value>([args]), mkCtx());
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 5);
    }
  });

  test("do...while loop runs at least once", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-do-while",
  output: "number",
  onExecute(ctx: Context): number {
    let count = 0;
    do {
      count = count + 1;
    } while (false);
    return count;
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
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 1);
    }
  });

  test("do...while loop with multiple iterations", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-do-while-multi",
  output: "number",
  params: {
    n: { type: "number" },
  },
  onExecute(ctx: Context, params: { n: number }): number {
    let sum = 0;
    let i = 0;
    do {
      sum = sum + i;
      i = i + 1;
    } while (i < params.n);
    return sum;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

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

  test("break in do...while loop", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-do-while-break",
  output: "number",
  onExecute(ctx: Context): number {
    let i = 0;
    do {
      if (i >= 3) {
        break;
      }
      i = i + 1;
    } while (true);
    return i;
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
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 3);
    }
  });

  test("continue in do...while loop", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-do-while-continue",
  output: "number",
  onExecute(ctx: Context): number {
    let sum = 0;
    let i = 0;
    do {
      i = i + 1;
      if (i === 2 || i === 4 || i === 6) {
        continue;
      }
      sum = sum + i;
    } while (i < 6);
    return sum;
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
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      // odd numbers 1..6: 1 + 3 + 5 = 9
      assert.equal((runResult.result as NumberValue).v, 9);
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

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
    const result = compileUserTile(source, { services });
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
    const result = compileUserTile(source, { services });
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
    const result = compileUserTile(source, { services });
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 50000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      // 0+1+2+4+5+6+7+8+9 = 42
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("switch executes matching case", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-switch-match",
  output: "number",
  onExecute(ctx: Context): number {
    const x: number = 2;
    switch (x) {
      case 1:
        return 10;
      case 2:
        return 20;
      default:
        return 30;
    }
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
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 20);
    }
  });

  test("switch can match a case after default", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-switch-case-after-default",
  output: "number",
  onExecute(ctx: Context): number {
    const x: number = 3;
    switch (x) {
      case 1:
        return 10;
      default:
        return 30;
      case 3:
        return 40;
    }
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
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 40);
    }
  });

  test("switch default can fall through to later cases", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-switch-default-fallthrough",
  output: "number",
  onExecute(ctx: Context): number {
    let sum = 0;
    const x: number = 9;
    switch (x) {
      case 1:
        sum = sum + 1;
        break;
      default:
        sum = sum + 10;
      case 2:
        sum = sum + 100;
    }
    return sum;
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
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 110);
    }
  });

  test("break exits switch without breaking the loop", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-switch-break",
  output: "number",
  onExecute(ctx: Context): number {
    let total = 0;
    for (let i = 0; i < 3; i = i + 1) {
      switch (i) {
        case 1:
          total = total + 10;
          break;
        default:
          total = total + 1;
          break;
      }
      total = total + 100;
    }
    return total;
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
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 312);
    }
  });

  test("continue inside switch continues the enclosing loop", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-switch-continue",
  output: "number",
  onExecute(ctx: Context): number {
    let sum = 0;
    for (let i = 0; i < 5; i = i + 1) {
      switch (i) {
        case 2:
          continue;
        default:
          sum = sum + i;
      }
    }
    return sum;
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
    fiber.instrBudget = 10000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 8);
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
    const result = compileUserTile(source, { services });
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);

    // x = 15 -> return 3
    {
      const vm = new runtime.VM(services, prog, handles);
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
      const vm = new runtime.VM(services, prog, handles);
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
      const vm = new runtime.VM(services, prog, handles);
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
    services = __test__createBrainServices();
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);

    // x = 50 -> clamped to 50 (within range)
    {
      const vm = new runtime.VM(services, prog, handles);
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
      const vm = new runtime.VM(services, prog, handles);
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
      const vm = new runtime.VM(services, prog, handles);
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.numStateSlots > 0, "expected numStateSlots > 0");
    assert.ok(prog.activationFuncId !== undefined, "expected activationFuncId to be set");

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    // First call: count should become 1
    {
      const vm = new runtime.VM(services, prog, handles);
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
      const vm = new runtime.VM(services, prog, handles);
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.equal(prog.numStateSlots, 2);
    assert.ok(prog.activationFuncId !== undefined);

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    // a=10, b=20 -> a+b = 30
    {
      const vm = new runtime.VM(services, prog, handles);
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

  test("activation function resets state when callsiteVars is freshly allocated", () => {
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
    const result = compileUserTile(source, { services });
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);

    // First callsite: activate + two calls -> 1, 2
    const callsiteVars1 = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars1);
    {
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars1;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 1);
    }
    {
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars1;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 2);
    }

    // Fresh callsiteVars2 + activation -> resets to 0, next call -> 1
    const callsiteVars2 = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars2);
    {
      const vm = new runtime.VM(services, prog, handles);
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.numStateSlots > 0);

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    // Call with val=5 -> total becomes 5
    {
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from<Value>([mkArgsMap({ 0: mkNumberValue(5) })]), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 5);
    }

    // Call with val=3 -> total becomes 8
    {
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from<Value>([mkArgsMap({ 0: mkNumberValue(3) })]), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 8);
    }
  });

  test("no top-level vars produces numStateSlots=0 and no activationFuncId", () => {
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    assert.equal(result.program!.numStateSlots, 0);
    assert.equal(result.program!.activationFuncId, undefined);
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    // 3 functions: onExecute + helper1 + helper2
    assert.equal(result.program!.functions.size(), 3);

    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, result.program!, handles);
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, result.program!, handles);
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    // val=15 > THRESHOLD=10 -> true
    {
      const vm = new runtime.VM(services, prog, handles);
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
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.from<Value>([mkArgsMap({ 0: mkNumberValue(5) })]), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as BooleanValue).v, false);
    }
  });
});

describe("activation function", () => {
  before(() => {
    services = __test__createBrainServices();
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.activationFuncId !== undefined, "expected activationFuncId");

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    // Call exec twice -> count = 1, then 2
    for (let expected = 1; expected <= 2; expected++) {
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, expected);
    }

    runActivation(prog, handles, callsiteVars);

    // Next exec call -> count should be 1 again (reset happened)
    {
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 1);
    }
  });

  test("source without onPageEntered still emits activation that runs init", () => {
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.activationFuncId !== undefined, "activation should be generated when state exists");

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    // Call exec twice -> count = 1, 2
    for (let expected = 1; expected <= 2; expected++) {
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, expected);
    }

    runActivation(prog, handles, callsiteVars);

    // Next exec -> count = 1 (re-initialized)
    {
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 1);
    }
  });

  test("activation function calls user function after init (user can override init values)", () => {
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.activationFuncId !== undefined);

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    // exec -> startValue was 100, now becomes 101
    {
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 101);
    }
  });

  test("no activation function is emitted with no callsite vars and no onPageEntered", () => {
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const prog = result.program!;
    assert.equal(prog.numStateSlots, 0);
    assert.equal(prog.activationFuncId, undefined);
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
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    // exec: a=5+1=6, b=50+10=60, return 66
    {
      const vm = new runtime.VM(services, prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 66);
    }
  });
});
