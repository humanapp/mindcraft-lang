import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type ExecutionContext,
  HandleTable,
  mkNumberValue,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  registerCoreBrainComponents,
  runtime,
  type Scheduler,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { buildAmbientDeclarations } from "./ambient.js";
import { UserTileProject } from "./project.js";

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

function compileProject(files: Record<string, string>) {
  const ambientSource = buildAmbientDeclarations();
  const project = new UserTileProject({ ambientSource });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

describe("multi-file: helper module variables", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("entry-point reads a constant from a helper module", () => {
    const result = compileProject({
      "helpers/config.ts": `
export const THRESHOLD = 42;
`,
      "sensors/check.ts": `
import { Sensor, type Context } from "mindcraft";
import { THRESHOLD } from "../helpers/config";

export default Sensor({
  name: "check",
  output: "number",
  onExecute(ctx: Context): number {
    return THRESHOLD;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/check.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `Diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    assert.ok(prog.numCallsiteVars >= 1, "expected at least 1 callsite var for THRESHOLD");

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 42);
      }
    }
  });

  test("helper module mutable variable is updated by imported function", () => {
    const result = compileProject({
      "helpers/counter.ts": `
export let count = 0;

export function increment(): number {
  count += 1;
  return count;
}
`,
      "sensors/counter-sensor.ts": `
import { Sensor, type Context } from "mindcraft";
import { increment } from "../helpers/counter";

export default Sensor({
  name: "counter",
  output: "number",
  onExecute(ctx: Context): number {
    return increment();
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/counter-sensor.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `Diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    for (let expected = 1; expected <= 3; expected++) {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, expected);
      }
    }
  });

  test("diamond import: two helpers import same module, entry-point gets one copy of state", () => {
    const result = compileProject({
      "helpers/shared.ts": `
export let value = 10;

export function addToValue(n: number): number {
  value += n;
  return value;
}
`,
      "helpers/a.ts": `
import { addToValue } from "./shared";

export function addFive(): number {
  return addToValue(5);
}
`,
      "helpers/b.ts": `
import { addToValue } from "./shared";

export function addThree(): number {
  return addToValue(3);
}
`,
      "sensors/diamond.ts": `
import { Sensor, type Context } from "mindcraft";
import { addFive } from "../helpers/a";
import { addThree } from "../helpers/b";

export default Sensor({
  name: "diamond",
  output: "number",
  onExecute(ctx: Context): number {
    addFive();
    return addThree();
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/diamond.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `Diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 18, "10 + 5 + 3 = 18");
      }
    }
  });

  test("init ordering: deeper helper modules init before shallower ones", () => {
    const result = compileProject({
      "helpers/base.ts": `
export let order = 1;
`,
      "helpers/mid.ts": `
import { order } from "./base";

export let midValue = order * 10;
`,
      "sensors/init-order.ts": `
import { Sensor, type Context } from "mindcraft";
import { midValue } from "../helpers/mid";

export default Sensor({
  name: "init-order",
  output: "number",
  onExecute(ctx: Context): number {
    return midValue;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/init-order.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `Diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numCallsiteVars }, () => NIL_VALUE));

    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    {
      const vm = new runtime.VM(prog, handles);
      const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = callsiteVars;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 10, "base.order=1 inited first, then mid.midValue=1*10=10");
      }
    }
  });

  test("helper module with function but no variables compiles without init", () => {
    const result = compileProject({
      "helpers/math.ts": `
export function double(x: number): number {
  return x * 2;
}
`,
      "sensors/use-math.ts": `
import { Sensor, type Context } from "mindcraft";
import { double } from "../helpers/math";

export default Sensor({
  name: "use-math",
  output: "number",
  params: { n: { type: "number" } },
  onExecute(ctx: Context, params: { n: number }): number {
    return double(params.n);
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("sensors/use-math.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, []);
    assert.ok(entry.program);
    assert.equal(entry.program!.numCallsiteVars, 0);
  });

  test("per-importer isolation: two entry-points get separate callsite var spaces", () => {
    const result = compileProject({
      "helpers/state.ts": `
export let counter = 0;

export function bump(): number {
  counter += 1;
  return counter;
}
`,
      "sensors/a.ts": `
import { Sensor, type Context } from "mindcraft";
import { bump } from "../helpers/state";

export default Sensor({
  name: "sensor-a",
  output: "number",
  onExecute(ctx: Context): number {
    return bump();
  },
});
`,
      "sensors/b.ts": `
import { Sensor, type Context } from "mindcraft";
import { bump } from "../helpers/state";

export default Sensor({
  name: "sensor-b",
  output: "number",
  onExecute(ctx: Context): number {
    return bump();
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0);
    const entryA = result.results.get("sensors/a.ts");
    const entryB = result.results.get("sensors/b.ts");
    assert.ok(entryA?.program);
    assert.ok(entryB?.program);

    const handles = new HandleTable(100);

    const progA = entryA.program!;
    const varsA = List.from<Value>(Array.from({ length: progA.numCallsiteVars }, () => NIL_VALUE));
    {
      const vm = new runtime.VM(progA, handles);
      const fiber = vm.spawnFiber(1, progA.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = varsA;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    const progB = entryB.program!;
    const varsB = List.from<Value>(Array.from({ length: progB.numCallsiteVars }, () => NIL_VALUE));
    {
      const vm = new runtime.VM(progB, handles);
      const fiber = vm.spawnFiber(1, progB.initFuncId!, List.empty(), mkCtx());
      fiber.callsiteVars = varsB;
      fiber.instrBudget = 1000;
      vm.runFiber(fiber, mkScheduler());
    }

    {
      const vm = new runtime.VM(progA, handles);
      const fiber = vm.spawnFiber(1, progA.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = varsA;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 1);
    }

    {
      const vm = new runtime.VM(progA, handles);
      const fiber = vm.spawnFiber(1, progA.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = varsA;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 2);
    }

    {
      const vm = new runtime.VM(progB, handles);
      const fiber = vm.spawnFiber(1, progB.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = varsB;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 1, "sensor-b should have its own counter starting at 0");
      }
    }
  });
});
