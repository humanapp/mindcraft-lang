import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { Dict, List, UniqueSet } from "@mindcraft-lang/core";
import {
  type BrainServices,
  type BytecodeExecutableAction,
  type ExecutableAction,
  type ExecutableBrainProgram,
  type ExecutionContext,
  HandleTable,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type PageMetadata,
  runtime,
  type Scheduler,
  type StringValue,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { treeshakeProgram } from "@mindcraft-lang/core/brain/runtime";
import { buildAmbientDeclarations } from "./ambient.js";
import { UserTileProject } from "./project.js";
import type { UserAuthoredProgram } from "./types.js";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
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

function wrapAsExecutable(prog: UserAuthoredProgram): ExecutableBrainProgram {
  const page: PageMetadata = {
    pageIndex: 0,
    pageId: "page-0",
    pageName: "Page 0",
    rootRuleFuncIds: List.empty(),
    actionCallSites: List.empty(),
    sensors: new UniqueSet<string>(),
    actuators: new UniqueSet<string>(),
  };
  const action: BytecodeExecutableAction = {
    binding: "bytecode",
    descriptor: { key: prog.key, kind: prog.kind } as never,
    entryFuncId: prog.entryFuncId,
    numStateSlots: prog.numStateSlots,
  };
  if (prog.activationFuncId !== undefined) {
    action.activationFuncId = prog.activationFuncId;
  }
  return {
    version: prog.version,
    functions: prog.functions,
    constantPools: prog.constantPools,
    variableNames: prog.variableNames,
    entryPoint: prog.entryFuncId,
    ruleIndex: Dict.empty(),
    pages: List.from([page]),
    actions: List.from<ExecutableAction>([action]),
  };
}

function runProgram(prog: UserAuthoredProgram): Value | undefined {
  const handles = new HandleTable(100);
  const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));

  if (prog.activationFuncId !== undefined) {
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.activationFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 1000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
  }

  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
  fiber.callsiteVars = callsiteVars;
  fiber.instrBudget = 10000;
  const r = vm.runFiber(fiber, mkScheduler());
  assert.equal(r.status, VmStatus.DONE);
  if (r.status === VmStatus.DONE) {
    return r.result;
  }
  return undefined;
}

function runExecutable(prog: ExecutableBrainProgram): Value | undefined {
  const handles = new HandleTable(100);
  const action = prog.actions.size() > 0 ? prog.actions.get(0) : undefined;
  const numSlots = action?.binding === "bytecode" ? action.numStateSlots : 0;
  const callsiteVars = List.from<Value>(Array.from({ length: numSlots }, () => NIL_VALUE));

  if (action?.binding === "bytecode" && action.activationFuncId !== undefined) {
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, action.activationFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 1000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
  }

  const entryFuncId = action?.binding === "bytecode" ? action.entryFuncId : (prog.entryPoint ?? 0);
  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, entryFuncId, List.empty<Value>(), mkCtx());
  fiber.callsiteVars = callsiteVars;
  fiber.instrBudget = 10000;
  const r = vm.runFiber(fiber, mkScheduler());
  assert.equal(r.status, VmStatus.DONE);
  if (r.status === VmStatus.DONE) {
    return r.result;
  }
  return undefined;
}

describe("tree-shaking compiled user code", () => {
  test("unused exported functions are removed", () => {
    const result = compileProject({
      "helpers/utils.ts": `
export function used(): number {
  return 42;
}

export function unused1(): number {
  return 100;
}

export function unused2(): string {
  return "never called";
}
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { used } from "../helpers/utils";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return used();
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, []);
    assert.ok(entry.program);

    const prog = entry.program!;
    const originalFuncCount = prog.functions.size();

    const executable = wrapAsExecutable(prog);
    const shaken = treeshakeProgram(executable);

    assert.ok(
      shaken.functions.size() < originalFuncCount,
      `expected fewer functions after shaking: ${shaken.functions.size()} < ${originalFuncCount}`
    );

    const originalResult = runProgram(prog);
    const shakenResult = runExecutable(shaken);

    assert.ok(originalResult !== undefined);
    assert.ok(shakenResult !== undefined);
    assert.equal((originalResult as NumberValue).v, 42);
    assert.equal((shakenResult as NumberValue).v, 42);
  });

  test("constants only referenced by dead functions are removed", () => {
    const result = compileProject({
      "helpers/lib.ts": `
export function usedFunc(): number {
  return 10;
}

export function deadFunc(): number {
  return 999 + 888 + 777;
}
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { usedFunc } from "../helpers/lib";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return usedFunc();
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, []);
    assert.ok(entry.program);

    const prog = entry.program!;
    const originalFuncCount = prog.functions.size();
    const originalConstCount = prog.constantPools.values.size();

    const executable = wrapAsExecutable(prog);
    const shaken = treeshakeProgram(executable);

    assert.ok(
      shaken.functions.size() < originalFuncCount,
      `expected fewer functions: ${shaken.functions.size()} < ${originalFuncCount}`
    );
    assert.ok(
      shaken.constantPools.values.size() <= originalConstCount,
      `expected no more constants: ${shaken.constantPools.values.size()} <= ${originalConstCount}`
    );

    const originalResult = runProgram(prog);
    const shakenResult = runExecutable(shaken);

    assert.equal((originalResult as NumberValue).v, 10);
    assert.equal((shakenResult as NumberValue).v, 10);
  });

  test("unused class methods are removed", () => {
    const result = compileProject({
      "helpers/math-helper.ts": `
export class MathHelper {
  static double(x: number): number {
    return x * 2;
  }

  static triple(x: number): number {
    return x * 3;
  }

  static quadruple(x: number): number {
    return x * 4;
  }
}
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { MathHelper } from "../helpers/math-helper";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return MathHelper.double(5);
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, []);
    assert.ok(entry.program);

    const prog = entry.program!;
    const originalFuncCount = prog.functions.size();

    const executable = wrapAsExecutable(prog);
    const shaken = treeshakeProgram(executable);

    assert.ok(
      shaken.functions.size() < originalFuncCount,
      `expected fewer functions after shaking class methods: ${shaken.functions.size()} < ${originalFuncCount}`
    );

    const originalResult = runProgram(prog);
    const shakenResult = runExecutable(shaken);

    assert.equal((originalResult as NumberValue).v, 10);
    assert.equal((shakenResult as NumberValue).v, 10);
  });

  test("unused functions from imported module are removed", () => {
    const result = compileProject({
      "helpers/lib.ts": `
export function getValue(): number {
  return 7;
}

export function neverCalled(): number {
  return 999;
}

export function alsoNeverCalled(): string {
  return "dead code";
}
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { getValue } from "../helpers/lib";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return getValue();
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, []);
    assert.ok(entry.program);

    const prog = entry.program!;
    const originalFuncCount = prog.functions.size();

    const executable = wrapAsExecutable(prog);
    const shaken = treeshakeProgram(executable);

    assert.ok(
      shaken.functions.size() < originalFuncCount,
      `expected fewer functions when unused exports removed: ${shaken.functions.size()} < ${originalFuncCount}`
    );

    const result2 = runExecutable(shaken);
    assert.equal((result2 as NumberValue).v, 7);
  });

  test("tree-shaking preserves correct execution with diamond imports and unused exports", () => {
    const result = compileProject({
      "helpers/shared.ts": `
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function unusedOp(a: number, b: number): number {
  return a - b;
}
`,
      "helpers/a.ts": `
import { add } from "./shared";

export function addTen(x: number): number {
  return add(x, 10);
}

export function unusedHelper(): number {
  return 0;
}
`,
      "helpers/b.ts": `
import { multiply } from "./shared";

export function timesThree(x: number): number {
  return multiply(x, 3);
}
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { addTen } from "../helpers/a";
import { timesThree } from "../helpers/b";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return addTen(timesThree(2));
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, []);
    assert.ok(entry.program);

    const prog = entry.program!;
    const originalFuncCount = prog.functions.size();
    const originalConstCount = prog.constantPools.values.size();

    const executable = wrapAsExecutable(prog);
    const shaken = treeshakeProgram(executable);

    assert.ok(
      shaken.functions.size() < originalFuncCount,
      `expected fewer functions: ${shaken.functions.size()} < ${originalFuncCount}`
    );

    const originalResult = runProgram(prog);
    const shakenResult = runExecutable(shaken);

    assert.equal((originalResult as NumberValue).v, 16, "timesThree(2)=6, addTen(6)=16");
    assert.equal((shakenResult as NumberValue).v, 16);
  });

  test("no unused code produces identical program", () => {
    const result = compileProject({
      "helpers/math.ts": `
export function double(x: number): number {
  return x * 2;
}
`,
      "sensors/entry.ts": `
import { Sensor, type Context } from "mindcraft";
import { double } from "../helpers/math";

export default Sensor({
  name: "entry",
  onExecute(ctx: Context): number {
    return double(21);
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("sensors/entry.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, []);
    assert.ok(entry.program);

    const prog = entry.program!;
    const executable = wrapAsExecutable(prog);
    const shaken = treeshakeProgram(executable);

    assert.equal(shaken.functions.size(), executable.functions.size());

    const originalResult = runProgram(prog);
    const shakenResult = runExecutable(shaken);

    assert.equal((originalResult as NumberValue).v, 42);
    assert.equal((shakenResult as NumberValue).v, 42);
  });
});
