import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type BrainServices,
  CoreOpId,
  CoreTypeIds,
  type ExecutionContext,
  HandleTable,
  mkNumberValue,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  runtime,
  type Scheduler,
  type StringValue,
  type StructTypeDef,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { CompileDiagCode } from "./diag-codes.js";
import { UserTileProject } from "./project.js";
import type { ExtractedOptional, ExtractedParam, UserAuthoredProgram } from "./types.js";

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

function compileProject(files: Record<string, string>) {
  const ambientSource = buildAmbientDeclarations(services.types);
  const project = new UserTileProject({ ambientSource, services });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

function runActivation(prog: UserAuthoredProgram, handles: HandleTable, callsiteVars: List<Value>): void {
  if (prog.activationFuncId === undefined) {
    return;
  }

  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, prog.activationFuncId, List.empty<Value>(), mkCtx());
  fiber.callsiteVars = callsiteVars;
  fiber.instrBudget = 1000;

  const result = vm.runFiber(fiber, mkScheduler());
  assert.equal(result.status, VmStatus.DONE);
}

describe("multi-file: helper module variables", () => {
  before(() => {
    services = __test__createBrainServices();
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
    assert.ok(prog.numStateSlots >= 1, "expected at least 1 callsite var for THRESHOLD");

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    {
      const vm = new runtime.VM(services, prog, handles);
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
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    for (let expected = 1; expected <= 3; expected++) {
      const vm = new runtime.VM(services, prog, handles);
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
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    {
      const vm = new runtime.VM(services, prog, handles);
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
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    runActivation(prog, handles, callsiteVars);

    {
      const vm = new runtime.VM(services, prog, handles);
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
import { Sensor, param, type Context } from "mindcraft";
import { double } from "../helpers/math";

export default Sensor({
  name: "use-math",
  args: [
    param("n", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { n: number }): number {
    return double(args.n);
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("sensors/use-math.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, []);
    assert.ok(entry.program);
    assert.equal(entry.program!.numStateSlots, 0);
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
    const varsA = List.from<Value>(Array.from({ length: progA.numStateSlots }, () => NIL_VALUE));
    runActivation(progA, handles, varsA);

    const progB = entryB.program!;
    const varsB = List.from<Value>(Array.from({ length: progB.numStateSlots }, () => NIL_VALUE));
    runActivation(progB, handles, varsB);

    {
      const vm = new runtime.VM(services, progA, handles);
      const fiber = vm.spawnFiber(1, progA.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = varsA;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 1);
    }

    {
      const vm = new runtime.VM(services, progA, handles);
      const fiber = vm.spawnFiber(1, progA.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = varsA;
      fiber.instrBudget = 1000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) assert.equal((r.result as NumberValue).v, 2);
    }

    {
      const vm = new runtime.VM(services, progB, handles);
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

describe("multi-file: importing symbols across files", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("one file imports a function symbol from another file", () => {
    const result = compileProject({
      "lib/greet.ts": `
export function add(a: number, b: number): number {
  return a + b;
}
`,
      "sensors/sum.ts": `
import { Sensor, type Context } from "mindcraft";
import { add } from "../lib/greet";

export default Sensor({
  name: "sum",
  onExecute(ctx: Context): number {
    return add(3, 7);
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/sum.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `Diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 1000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 10);
    }
  });

  test("import with alias: { foo as bar } resolves correctly", () => {
    const result = compileProject({
      "lib/math.ts": `
export function triple(x: number): number {
  return x * 3;
}
`,
      "sensors/alias.ts": `
import { Sensor, type Context } from "mindcraft";
import { triple as mul3 } from "../lib/math";

export default Sensor({
  name: "alias-test",
  onExecute(ctx: Context): number {
    return mul3(4);
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/alias.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `Diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 1000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 12);
    }
  });

  test("files without default export are not included in results", () => {
    const result = compileProject({
      "lib/utils.ts": `
export function noop(): void {}
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { noop } from "../lib/utils";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    noop();
    return 1;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0);
    assert.ok(!result.results.has("lib/utils.ts"), "helper without default export should not appear in results");
    assert.ok(result.results.has("sensors/entry.ts"), "entry-point should appear in results");
  });

  test("TypeScript error in helper module is reported in tsErrors", () => {
    const result = compileProject({
      "lib/broken.ts": `
export function bad(): number {
  const x: number = "not a number";
  return x;
}
`,
      "sensors/use-broken.ts": `
import { Sensor, type Context } from "mindcraft";
import { bad } from "../lib/broken";

export default Sensor({
  name: "use-broken",
  onExecute(ctx: Context): number {
    return bad();
  },
});
`,
    });

    assert.ok(result.tsErrors.size > 0, "expected TypeScript errors");
    assert.ok(result.tsErrors.has("lib/broken.ts"), "error should be associated with the broken helper file");
    assert.equal(result.results.size, 0, "no results when there are TS errors");
  });

  test("transitive import: A imports B which imports C", () => {
    const result = compileProject({
      "lib/base.ts": `
export function square(x: number): number {
  return x * x;
}
`,
      "lib/mid.ts": `
import { square } from "./base";

export function squarePlusOne(x: number): number {
  return square(x) + 1;
}
`,
      "sensors/chain.ts": `
import { Sensor, type Context } from "mindcraft";
import { squarePlusOne } from "../lib/mid";

export default Sensor({
  name: "chain",
  onExecute(ctx: Context): number {
    return squarePlusOne(5);
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/chain.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `Diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 1000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 26, "5*5 + 1 = 26");
    }
  });
});

describe("multi-file: imported enums", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("imported enum member works across files", () => {
    const result = compileProject({
      "helpers/direction.ts": `
export enum Direction {
  Up = "north",
  Down = "south",
}
`,
      "sensors/use-direction.ts": `
import { Sensor, type Context } from "mindcraft";
import { Direction } from "../helpers/direction";

export default Sensor({
  name: "use-direction",
  onExecute(ctx: Context): string {
    return Direction.Up;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/use-direction.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as StringValue).v, "north");
    }
  });

  test("aliased enum import works across files", () => {
    const result = compileProject({
      "helpers/direction.ts": `
export enum Direction {
  Up = "north",
  Down = "south",
}
`,
      "sensors/use-direction-alias.ts": `
import { Sensor, type Context } from "mindcraft";
import { Direction as Dir } from "../helpers/direction";

export default Sensor({
  name: "use-direction-alias",
  onExecute(ctx: Context): string {
    return Dir.Down;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/use-direction-alias.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as StringValue).v, "south");
    }
  });
});

describe("multi-file: enum recompilation cleanup", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("deleting a user enum removes its registered type and derived artifacts", () => {
    const project = new UserTileProject({ ambientSource: buildAmbientDeclarations(services.types), services });
    project.setFiles(
      new Map(
        Object.entries({
          "helpers/mode.ts": `
export enum Mode {
  Idle = 0,
  Fast = 2,
}
`,
          "sensors/use-mode.ts": `
import { Sensor, type Context } from "mindcraft";
import { Mode } from "../helpers/mode";

export default Sensor({
  name: "use-mode",
  onExecute(ctx: Context): number {
    const value: number = Mode.Fast;
    return value;
  },
});
`,
        })
      )
    );

    let result = project.compileAll();
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    let entry = result.results.get("sensors/use-mode.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);

    const registry = services.types;
    const typeId = registry.resolveByName("/helpers/mode.ts::Mode");
    assert.ok(typeId, "Mode should be registered before deletion");
    assert.ok(services.conversions.get(typeId!, CoreTypeIds.String));
    assert.ok(services.conversions.get(typeId!, CoreTypeIds.Number));
    assert.ok(services.operatorOverloads.resolve(CoreOpId.EqualTo, [typeId!, typeId!]));

    project.deleteFile("helpers/mode.ts");
    project.updateFile(
      "sensors/use-mode.ts",
      `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "use-mode",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`
    );

    result = project.compileAffected();
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    entry = result.results.get("sensors/use-mode.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);

    assert.equal(registry.resolveByName("/helpers/mode.ts::Mode"), undefined);
    assert.equal(services.conversions.get(typeId!, CoreTypeIds.String), undefined);
    assert.equal(services.conversions.get(typeId!, CoreTypeIds.Number), undefined);
    assert.equal(services.operatorOverloads.resolve(CoreOpId.EqualTo, [typeId!, typeId!]), undefined);
  });

  test("changing a user enum between numeric and string forms refreshes conversions", () => {
    const project = new UserTileProject({ ambientSource: buildAmbientDeclarations(services.types), services });
    project.setFiles(
      new Map(
        Object.entries({
          "helpers/mode.ts": `
export enum Mode {
  Fast = 2,
  Slow = 4,
}
`,
          "sensors/use-mode.ts": `
import { Sensor, type Context } from "mindcraft";
import { Mode } from "../helpers/mode";

export default Sensor({
  name: "refresh-mode",
  onExecute(ctx: Context): number {
    const value: number = Mode.Fast;
    return value;
  },
});
`,
        })
      )
    );

    let result = project.compileAll();
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);

    const registry = services.types;
    const typeId = registry.resolveByName("/helpers/mode.ts::Mode");
    assert.ok(typeId, "Mode should be registered before recompilation");
    assert.ok(services.conversions.get(typeId!, CoreTypeIds.Number));

    project.updateFile(
      "helpers/mode.ts",
      `
export enum Mode {
  Fast = "fast",
  Slow = "slow",
}
`
    );
    project.updateFile(
      "sensors/use-mode.ts",
      `
import { Sensor, type Context } from "mindcraft";
import { Mode } from "../helpers/mode";

export default Sensor({
  name: "refresh-mode",
  onExecute(ctx: Context): string {
    return Mode.Fast;
  },
});
`
    );

    result = project.compileAffected();
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/use-mode.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);

    assert.equal(registry.resolveByName("/helpers/mode.ts::Mode"), typeId);
    assert.ok(services.conversions.get(typeId!, CoreTypeIds.String));
    assert.equal(services.conversions.get(typeId!, CoreTypeIds.Number), undefined);
  });
});

describe("multi-file: module-qualified TypeIds (M2)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("same-named classes in different files get distinct TypeIds", () => {
    const result = compileProject({
      "sensors/a.ts": `
import { Sensor, type Context } from "mindcraft";

class Foo {
  x: number;
  constructor(x: number) { this.x = x; }
}

export default Sensor({
  name: "a-sensor",
  onExecute(ctx: Context): number {
    const f = new Foo(10);
    return f.x;
  },
});
`,
      "sensors/b.ts": `
import { Sensor, type Context } from "mindcraft";

class Foo {
  name: string;
  constructor(name: string) { this.name = name; }
}

export default Sensor({
  name: "b-sensor",
  onExecute(ctx: Context): string {
    const f = new Foo("hello");
    return f.name;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);

    const entryA = result.results.get("sensors/a.ts");
    assert.ok(entryA, "expected result for a.ts");
    assert.deepStrictEqual(entryA.diagnostics, [], `a.ts diagnostics: ${JSON.stringify(entryA.diagnostics)}`);
    assert.ok(entryA.program);

    const entryB = result.results.get("sensors/b.ts");
    assert.ok(entryB, "expected result for b.ts");
    assert.deepStrictEqual(entryB.diagnostics, [], `b.ts diagnostics: ${JSON.stringify(entryB.diagnostics)}`);
    assert.ok(entryB.program);

    const registry = services.types;
    const typeIdA = registry.resolveByName("/sensors/a.ts::Foo");
    const typeIdB = registry.resolveByName("/sensors/b.ts::Foo");
    assert.ok(typeIdA, "Foo from a.ts should be registered");
    assert.ok(typeIdB, "Foo from b.ts should be registered");
    assert.notEqual(typeIdA, typeIdB, "TypeIds should be distinct");

    const defA = registry.get(typeIdA!) as StructTypeDef;
    const defB = registry.get(typeIdB!) as StructTypeDef;
    const fieldNamesA: string[] = [];
    defA.fields.forEach((f) => {
      fieldNamesA.push(f.name);
    });
    const fieldNamesB: string[] = [];
    defB.fields.forEach((f) => {
      fieldNamesB.push(f.name);
    });
    assert.ok(fieldNamesA.includes("x"), "Foo from a.ts should have field x");
    assert.ok(fieldNamesB.includes("name"), "Foo from b.ts should have field name");
  });

  test("core types resolve with bare name after compilation", () => {
    compileProject({
      "sensors/test.ts": `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "host-check",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`,
    });

    const registry = services.types;
    const boolTypeId = registry.resolveByName("boolean");
    assert.ok(boolTypeId, "boolean should still resolve with bare name");
    const def = registry.get(boolTypeId!);
    assert.ok(def, "boolean type def should exist");
    assert.equal(def!.coreType, NativeType.Boolean);
  });

  test("single-file class gets module-qualified TypeId", () => {
    const result = compileProject({
      "sensors/single.ts": `
import { Sensor, type Context } from "mindcraft";

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) { this.x = x; this.y = y; }
}

export default Sensor({
  name: "single-class",
  onExecute(ctx: Context): number {
    const p = new Point(3, 4);
    return p.x + p.y;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/single.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, []);
    assert.ok(entry.program);

    const registry = services.types;
    const typeId = registry.resolveByName("/sensors/single.ts::Point");
    assert.ok(typeId, "Point should be registered with qualified name");

    const bareTypeId = registry.resolveByName("Point");
    assert.equal(bareTypeId, undefined, "Point should NOT be registered with bare name");
  });
});

describe("multi-file: descriptor qualified types (M3)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("sensor output type resolves to qualified class name", () => {
    const result = compileProject({
      "sensors/detect.ts": `
import { Sensor, type Context } from "mindcraft";

class Result {
  value: number;
  constructor(value: number) { this.value = value; }
}

export default Sensor({
  name: "detect",
  onExecute(ctx: Context): Result {
    return new Result(1);
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/detect.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const registry = services.types;
    const qualifiedTypeId = registry.resolveByName("/sensors/detect.ts::Result");
    assert.ok(qualifiedTypeId, "Result should be registered with qualified name");
    assert.equal(entry.program!.outputType, qualifiedTypeId, "program outputType should use qualified TypeId");
  });

  test("param type resolves to qualified class name", () => {
    const result = compileProject({
      "actuators/move.ts": `
import { Actuator, param, type Context } from "mindcraft";

class Vec2 {
  x: number;
  y: number;
  constructor(x: number, y: number) { this.x = x; this.y = y; }
}

export default Actuator({
  name: "move",
  args: [
    param("target", { type: "Vec2" }),
  ],
  onExecute(ctx: Context, args: { target: Vec2 }): void {
    const v = args.target;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("actuators/move.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    assert.equal(
      (entry.program!.args[0] as ExtractedParam).type,
      "/actuators/move.ts::Vec2",
      "param type should carry qualified name"
    );
  });

  test("host type param stays bare", () => {
    const result = compileProject({
      "sensors/simple.ts": `
import { Sensor, optional, param, type Context } from "mindcraft";

export default Sensor({
  name: "simple",
  args: [
    optional(param("range", { type: "number", default: 5 })),
  ],
  onExecute(ctx: Context, args: { range: number }): number {
    return args.range;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/simple.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    assert.equal(
      ((entry.program!.args[0] as ExtractedOptional).item as ExtractedParam).type,
      "number",
      "host type should stay bare"
    );
    assert.ok(entry.program!.outputType, "output type should resolve");
  });
});

describe("multi-file: export-only collection", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("non-exported functions in imported files are not collected", () => {
    const result = compileProject({
      "helpers/a.ts": `
function internalA(): number { return 1; }
export function publicA(): number { return 42; }
`,
      "helpers/b.ts": `
function internalA(): number { return 99; }
export function publicB(): number { return 7; }
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { publicA } from "../helpers/a";
import { publicB } from "../helpers/b";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return publicA() + publicB();
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);
  });

  test("non-exported variables in imported files are not collected", () => {
    const result = compileProject({
      "helpers/a.ts": `
let cache = 0;
export const VALUE_A = 10;
`,
      "helpers/b.ts": `
let cache = 0;
export const VALUE_B = 20;
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { VALUE_A } from "../helpers/a";
import { VALUE_B } from "../helpers/b";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return VALUE_A + VALUE_B;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);
  });
});

describe("multi-file: collision diagnostics (C3.5 D2)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("two imported files exporting same-named function -> collision diagnostic", () => {
    const result = compileProject({
      "helpers/a.ts": `
export function compute(): number { return 1; }
`,
      "helpers/b.ts": `
export function compute(): number { return 2; }
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { compute } from "../helpers/a";
import {} from "../helpers/b";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return compute();
  },
});
`,
    });

    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.ok(entry.diagnostics.length > 0, "expected collision diagnostic");
    assert.ok(
      entry.diagnostics.some((d) => d.code === CompileDiagCode.DuplicateImportedSymbol),
      `expected DuplicateImportedSymbol, got: ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("two imported files exporting same-named variable -> collision diagnostic", () => {
    const result = compileProject({
      "helpers/a.ts": `
export const VALUE = 10;
`,
      "helpers/b.ts": `
export const VALUE = 20;
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { VALUE } from "../helpers/a";
import {} from "../helpers/b";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return VALUE;
  },
});
`,
    });

    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.ok(entry.diagnostics.length > 0, "expected collision diagnostic");
    assert.ok(
      entry.diagnostics.some((d) => d.code === CompileDiagCode.DuplicateImportedSymbol),
      `expected DuplicateImportedSymbol, got: ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("entry file function with same name as transitively imported function -> entry wins, no diagnostic", () => {
    const result = compileProject({
      "helpers/a.ts": `
export function compute(): number { return 99; }
export function helperOnly(): number { return 1; }
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { helperOnly } from "../helpers/a";

function compute(): number { return 42; }

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return compute() + helperOnly();
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);
  });
});

describe("multi-file: cross-file class support (C4)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("class defined in helper, instantiated in entry", () => {
    const result = compileProject({
      "helpers/point.ts": `
export class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
`,
      "sensors/use-point.ts": `
import { Sensor, type Context } from "mindcraft";
import { Point } from "../helpers/point";

export default Sensor({
  name: "use-point",
  onExecute(ctx: Context): number {
    const p = new Point(3, 4);
    return p.x + p.y;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/use-point.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 7);
    }
  });

  test("class method called across files", () => {
    const result = compileProject({
      "helpers/counter.ts": `
export class Counter {
  value: number;
  constructor(start: number) {
    this.value = start;
  }
  increment(): number {
    this.value = this.value + 1;
    return this.value;
  }
}
`,
      "sensors/use-counter.ts": `
import { Sensor, type Context } from "mindcraft";
import { Counter } from "../helpers/counter";

export default Sensor({
  name: "use-counter",
  onExecute(ctx: Context): number {
    const c = new Counter(10);
    c.increment();
    c.increment();
    return c.value;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/use-counter.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 3000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 12);
    }
  });

  test("class-typed variable passed to a function across files", () => {
    const result = compileProject({
      "helpers/vec.ts": `
export class Vec2 {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export function lengthSquared(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}
`,
      "sensors/use-vec.ts": `
import { Sensor, type Context } from "mindcraft";
import { Vec2, lengthSquared } from "../helpers/vec";

export default Sensor({
  name: "use-vec",
  onExecute(ctx: Context): number {
    const v = new Vec2(3, 4);
    return lengthSquared(v);
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/use-vec.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 3000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 25);
    }
  });

  test("class with no explicit constructor imported from helper", () => {
    const result = compileProject({
      "helpers/config.ts": `
export class Config {
  threshold: number = 42;
  label: string = "default";
}
`,
      "sensors/use-config.ts": `
import { Sensor, type Context } from "mindcraft";
import { Config } from "../helpers/config";

export default Sensor({
  name: "use-config",
  onExecute(ctx: Context): number {
    const c = new Config();
    return c.threshold;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/use-config.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 42);
    }
  });

  test("class destructured: const { x, y } = point", () => {
    const result = compileProject({
      "helpers/point.ts": `
export class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
`,
      "sensors/destruct.ts": `
import { Sensor, type Context } from "mindcraft";
import { Point } from "../helpers/point";

export default Sensor({
  name: "destruct",
  onExecute(ctx: Context): number {
    const p = new Point(5, 12);
    const { x, y } = p;
    return x + y;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/destruct.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 3000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 17);
    }
  });

  test("array of class instances", () => {
    const result = compileProject({
      "helpers/point.ts": `
export class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
`,
      "sensors/array-class.ts": `
import { Sensor, type Context } from "mindcraft";
import { Point } from "../helpers/point";

export default Sensor({
  name: "array-class",
  onExecute(ctx: Context): number {
    const points: Point[] = [new Point(1, 2), new Point(3, 4)];
    return points[0].x + points[1].y;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/array-class.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 5000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 5);
    }
  });

  test("non-exported class not collected from helper", () => {
    const result = compileProject({
      "helpers/internal.ts": `
class Internal {
  x: number = 0;
}

export function create(): number {
  return 42;
}
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { create } from "../helpers/internal";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return create();
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);
  });

  test("duplicate class names from different files produce diagnostic", () => {
    const result = compileProject({
      "helpers/a.ts": `
export class Widget {
  x: number = 1;
}
`,
      "helpers/b.ts": `
export class Widget {
  y: number = 2;
}
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { Widget } from "../helpers/a";
import {} from "../helpers/b";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    const w = new Widget();
    return w.x;
  },
});
`,
    });

    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.ok(entry.diagnostics.length > 0, "expected collision diagnostic");
    assert.ok(
      entry.diagnostics.some((d) => d.code === CompileDiagCode.DuplicateImportedSymbol),
      `expected DuplicateImportedSymbol, got: ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("both files at root level: import class from sibling", () => {
    const result = compileProject({
      "point.ts": `
export class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}
`,
      "use-point.ts": `
import { Sensor, type Context } from "mindcraft";
import { Point } from "./point";

export default Sensor({
  name: "root-import",
  onExecute(ctx: Context): number {
    const p = new Point(10, 20);
    return p.sum();
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("use-point.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 3000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 30);
    }
  });
});

describe("multi-file: cross-file static members", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("static field read from imported class", () => {
    const result = compileProject({
      "helpers/counter.ts": `
export class Counter {
  static count: number = 42;
}
`,
      "sensors/read-static.ts": `
import { Sensor, type Context } from "mindcraft";
import { Counter } from "../helpers/counter";

export default Sensor({
  name: "read-static",
  onExecute(ctx: Context): number {
    return Counter.count;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/read-static.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 42);
    }
  });

  test("static method call on imported class", () => {
    const result = compileProject({
      "helpers/counter.ts": `
export class Counter {
  static count: number = 0;
  static increment(): void {
    Counter.count += 1;
  }
}
`,
      "sensors/call-static.ts": `
import { Sensor, type Context } from "mindcraft";
import { Counter } from "../helpers/counter";

export default Sensor({
  name: "call-static",
  onExecute(ctx: Context): number {
    Counter.increment();
    Counter.increment();
    Counter.increment();
    return Counter.count;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/call-static.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 3000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 3);
    }
  });

  test("static field assignment from importing file", () => {
    const result = compileProject({
      "helpers/counter.ts": `
export class Counter {
  static count: number = 0;
}
`,
      "sensors/assign-static.ts": `
import { Sensor, type Context } from "mindcraft";
import { Counter } from "../helpers/counter";

export default Sensor({
  name: "assign-static",
  onExecute(ctx: Context): number {
    Counter.count = 99;
    return Counter.count;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/assign-static.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 99);
    }
  });

  test("static compound assignment and increment from importing file", () => {
    const result = compileProject({
      "helpers/counter.ts": `
export class Counter {
  static count: number = 10;
}
`,
      "sensors/compound-static.ts": `
import { Sensor, type Context } from "mindcraft";
import { Counter } from "../helpers/counter";

export default Sensor({
  name: "compound-static",
  onExecute(ctx: Context): number {
    Counter.count += 5;
    ++Counter.count;
    return Counter.count;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/compound-static.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 3000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 16);
    }
  });

  test("type error caught for wrong static field type across files", () => {
    const result = compileProject({
      "helpers/counter.ts": `
export class Counter {
  static count: number = 0;
}
`,
      "sensors/type-error.ts": `
import { Sensor, type Context } from "mindcraft";
import { Counter } from "../helpers/counter";

export default Sensor({
  name: "type-error",
  onExecute(ctx: Context): number {
    Counter.count = "hello";
    return Counter.count;
  },
});
`,
    });

    assert.ok(result.tsErrors.size > 0, "expected TS type error for string-to-number assignment");
  });

  test("class with both static and instance members accessed cross-file", () => {
    const result = compileProject({
      "helpers/tracker.ts": `
export class Tracker {
  static total: number = 0;
  value: number;
  constructor(v: number) {
    this.value = v;
    Tracker.total += v;
  }
}
`,
      "sensors/use-tracker.ts": `
import { Sensor, type Context } from "mindcraft";
import { Tracker } from "../helpers/tracker";

export default Sensor({
  name: "use-tracker",
  onExecute(ctx: Context): number {
    const a = new Tracker(10);
    const b = new Tracker(20);
    return Tracker.total;
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/use-tracker.ts");
    assert.ok(entry, "expected entry-point result");
    assert.deepStrictEqual(entry.diagnostics, [], `diagnostics: ${JSON.stringify(entry.diagnostics)}`);
    assert.ok(entry.program);

    const prog = entry.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 5000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 30);
    }
  });

  test("two tiles importing same static class get independent callsite copies", () => {
    const files = {
      "helpers/state.ts": `
export class State {
  static value: number = 0;
  static add(n: number): void {
    State.value += n;
  }
}
`,
      "sensors/tile-a.ts": `
import { Sensor, type Context } from "mindcraft";
import { State } from "../helpers/state";

export default Sensor({
  name: "tile-a",
  onExecute(ctx: Context): number {
    State.add(10);
    State.add(20);
    return State.value;
  },
});
`,
      "sensors/tile-b.ts": `
import { Sensor, type Context } from "mindcraft";
import { State } from "../helpers/state";

export default Sensor({
  name: "tile-b",
  onExecute(ctx: Context): number {
    State.add(100);
    return State.value;
  },
});
`,
    };

    const result = compileProject(files);
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);

    const entryA = result.results.get("sensors/tile-a.ts");
    assert.ok(entryA);
    assert.deepStrictEqual(entryA.diagnostics, [], `tile-a diagnostics: ${JSON.stringify(entryA.diagnostics)}`);
    assert.ok(entryA.program);

    const entryB = result.results.get("sensors/tile-b.ts");
    assert.ok(entryB);
    assert.deepStrictEqual(entryB.diagnostics, [], `tile-b diagnostics: ${JSON.stringify(entryB.diagnostics)}`);
    assert.ok(entryB.program);

    const progA = entryA.program!;
    const handlesA = new HandleTable(100);
    const csvA = List.from<Value>(Array.from({ length: progA.numStateSlots }, () => NIL_VALUE));
    runActivation(progA, handlesA, csvA);

    const progB = entryB.program!;
    const handlesB = new HandleTable(100);
    const csvB = List.from<Value>(Array.from({ length: progB.numStateSlots }, () => NIL_VALUE));
    runActivation(progB, handlesB, csvB);

    {
      const vm = new runtime.VM(services, progA, handlesA);
      const fiber = vm.spawnFiber(1, progA.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = csvA;
      fiber.instrBudget = 5000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 30, "tile-a: 0 + 10 + 20 = 30");
      }
    }

    {
      const vm = new runtime.VM(services, progB, handlesB);
      const fiber = vm.spawnFiber(1, progB.entryFuncId, List.empty<Value>(), mkCtx());
      fiber.callsiteVars = csvB;
      fiber.instrBudget = 5000;
      const r = vm.runFiber(fiber, mkScheduler());
      assert.equal(r.status, VmStatus.DONE);
      if (r.status === VmStatus.DONE) {
        assert.equal((r.result as NumberValue).v, 100, "tile-b: 0 + 100 = 100 (independent from tile-a)");
      }
    }
  });
});
