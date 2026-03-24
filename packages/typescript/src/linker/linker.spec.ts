import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { Dict, List, UniqueSet } from "@mindcraft-lang/core";
import {
  type BooleanValue,
  type BrainProgram,
  BYTECODE_VERSION,
  ContextTypeIds,
  type ExecutionContext,
  type FunctionBytecode,
  HandleTable,
  type MapValue,
  mkNativeStructValue,
  mkNumberValue,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  Op,
  type PageMetadata,
  registerCoreBrainComponents,
  runtime,
  type Scheduler,
  type StructValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { compileUserTile, initCompiler } from "../compiler/compile.js";
import { linkUserPrograms } from "./linker.js";

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

function mkCtxStruct(ctx?: ExecutionContext): StructValue {
  return mkNativeStructValue(ContextTypeIds.Context, ctx ?? mkCtx());
}

function mkEmptyBrainProgram(): BrainProgram {
  const emptyPage: PageMetadata = {
    pageIndex: 0,
    pageId: "page-0",
    pageName: "Page 0",
    rootRuleFuncIds: List.empty(),
    hostCallSites: List.empty(),
    sensors: new UniqueSet<string>(),
    actuators: new UniqueSet<string>(),
  };
  return {
    version: BYTECODE_VERSION,
    functions: List.empty(),
    constants: List.empty(),
    variableNames: List.empty(),
    entryPoint: 0,
    ruleIndex: Dict.empty(),
    pages: List.from([emptyPage]),
  };
}

function mkBrainProgramWithStubFunction(): BrainProgram {
  const stubFn: FunctionBytecode = {
    code: List.from([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.RET }]),
    numParams: 0,
    numLocals: 0,
    name: "brain-stub",
  };
  const emptyPage: PageMetadata = {
    pageIndex: 0,
    pageId: "page-0",
    pageName: "Page 0",
    rootRuleFuncIds: List.from([0]),
    hostCallSites: List.empty(),
    sensors: new UniqueSet<string>(),
    actuators: new UniqueSet<string>(),
  };
  return {
    version: BYTECODE_VERSION,
    functions: List.from([stubFn]),
    constants: List.from([mkNumberValue(99) as Value]),
    variableNames: List.empty(),
    entryPoint: 0,
    ruleIndex: Dict.empty(),
    pages: List.from([emptyPage]),
  };
}

describe("linker", () => {
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
  });

  test("constant pool indices are correct after merging", () => {
    const brainProg = mkBrainProgramWithStubFunction();
    assert.equal(brainProg.constants.size(), 1);

    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "const-sensor",
  output: "number",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const userProg = result.program!;
    const userConstCount = userProg.constants.size();
    assert.ok(userConstCount > 0, "user program should have constants");

    const { linkedProgram, userLinks } = linkUserPrograms(brainProg, [userProg]);

    assert.equal(linkedProgram.constants.size(), 1 + userConstCount);
    assert.equal((linkedProgram.constants.get(0) as NumberValue).v, 99);

    assert.equal(userLinks.length, 1);
    assert.equal(userLinks[0].linkedEntryFuncId, userProg.entryFuncId + 1);
  });

  test("CALL to a user helper function resolves correctly in the linked program", () => {
    const brainProg = mkBrainProgramWithStubFunction();

    const source = `
import { Sensor, type Context } from "mindcraft";

function double(x: number): number {
  return x + x;
}

export default Sensor({
  name: "call-helper",
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

    const userProg = result.program!;
    const funcOffset = brainProg.functions.size();

    const { linkedProgram, userLinks } = linkUserPrograms(brainProg, [userProg]);

    assert.equal(linkedProgram.functions.size(), brainProg.functions.size() + userProg.functions.size());

    const linkedEntryFuncId = userLinks[0].linkedEntryFuncId;
    const entryFn = linkedProgram.functions.get(linkedEntryFuncId);
    const hasRemappedCall = entryFn.code.toArray().some((instr) => instr.op === Op.CALL && instr.a! >= funcOffset);
    assert.ok(hasRemappedCall, "entry function should have a CALL instruction with remapped funcId");
  });

  test("linked program's user function is callable by funcId from brain code", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "return-42",
  output: "number",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);

    const brainProg = mkEmptyBrainProgram();
    const { linkedProgram, userLinks } = linkUserPrograms(brainProg, [result.program!]);

    const linkedEntryFuncId = userLinks[0].linkedEntryFuncId;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);

    const fiber = vm.spawnFiber(1, linkedEntryFuncId, List.from<Value>([mkCtxStruct()]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("linked user program with helper function executes correctly", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function triple(n: number): number {
  return n + n + n;
}

export default Sensor({
  name: "triple-sensor",
  output: "number",
  params: {
    val: { type: "number" },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    return triple(params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const brainProg = mkBrainProgramWithStubFunction();
    const { linkedProgram, userLinks } = linkUserPrograms(brainProg, [result.program!]);

    const linkedEntryFuncId = userLinks[0].linkedEntryFuncId;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);

    const args = mkArgsMap({ 0: mkNumberValue(7) });
    const fiber = vm.spawnFiber(1, linkedEntryFuncId, List.from<Value>([mkCtxStruct(), args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 21);
    }
  });

  test("multiple user programs link correctly with independent offsets", () => {
    const source1 = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "sensor-a",
  output: "number",
  onExecute(ctx: Context): number {
    return 10;
  },
});
`;
    const source2 = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "sensor-b",
  output: "number",
  onExecute(ctx: Context): number {
    return 20;
  },
});
`;
    const result1 = compileUserTile(source1);
    const result2 = compileUserTile(source2);
    assert.deepStrictEqual(result1.diagnostics, []);
    assert.deepStrictEqual(result2.diagnostics, []);
    assert.ok(result1.program);
    assert.ok(result2.program);

    const brainProg = mkBrainProgramWithStubFunction();
    const { linkedProgram, userLinks } = linkUserPrograms(brainProg, [result1.program!, result2.program!]);

    assert.equal(userLinks.length, 2);
    assert.ok(userLinks[0].linkedEntryFuncId < userLinks[1].linkedEntryFuncId);

    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);

    const fiber1 = vm.spawnFiber(1, userLinks[0].linkedEntryFuncId, List.from<Value>([mkCtxStruct()]), mkCtx());
    fiber1.instrBudget = 1000;
    const run1 = vm.runFiber(fiber1, mkScheduler());
    assert.equal(run1.status, VmStatus.DONE);
    if (run1.status === VmStatus.DONE) {
      assert.equal((run1.result as NumberValue).v, 10);
    }

    const fiber2 = vm.spawnFiber(2, userLinks[1].linkedEntryFuncId, List.from<Value>([mkCtxStruct()]), mkCtx());
    fiber2.instrBudget = 1000;
    const run2 = vm.runFiber(fiber2, mkScheduler());
    assert.equal(run2.status, VmStatus.DONE);
    if (run2.status === VmStatus.DONE) {
      assert.equal((run2.result as NumberValue).v, 20);
    }
  });

  test("onPageEntered funcId is remapped after linking", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "with-page-enter",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return true;
  },
  onPageEntered(ctx: Context): void {
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const userProg = result.program!;
    assert.ok(
      userProg.lifecycleFuncIds.onPageEntered !== undefined,
      "user program should have onPageEntered wrapper funcId"
    );

    const brainProg = mkBrainProgramWithStubFunction();
    const funcOffset = brainProg.functions.size();

    const { userLinks } = linkUserPrograms(brainProg, [userProg]);

    assert.equal(userLinks[0].linkedOnPageEnteredFuncId, userProg.lifecycleFuncIds.onPageEntered! + funcOffset);
  });

  test("brain program's original functions are preserved after linking", () => {
    const brainProg = mkBrainProgramWithStubFunction();

    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "preserve-test",
  output: "number",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const result = compileUserTile(source);
    assert.ok(result.program);

    const { linkedProgram } = linkUserPrograms(brainProg, [result.program!]);

    const originalFn = linkedProgram.functions.get(0);
    assert.equal(originalFn.name, "brain-stub");
    assert.equal(originalFn.code.size(), 2);
    assert.equal(originalFn.code.get(0).op, Op.PUSH_CONST);
    assert.equal(originalFn.code.get(0).a, 0);

    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 1000;
    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 99);
    }
  });

  test("FunctionValue constants have funcId remapped after linking", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function double(x: number): number {
  return x + x;
}

function apply(f: (n: number) => number, v: number): number {
  return f(v);
}

export default Sensor({
  name: "fn-ref-linker",
  output: "number",
  params: {
    val: { type: "number" },
  },
  onExecute(ctx: Context, params: { val: number }): number {
    return apply(double, params.val);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const userProg = result.program!;
    const brainProg = mkBrainProgramWithStubFunction();
    const funcOffset = brainProg.functions.size();

    const originalFuncConsts = userProg.constants
      .toArray()
      .filter((c): c is { t: NativeType.Function; funcId: number } => c.t === NativeType.Function);
    assert.ok(originalFuncConsts.length > 0, "user program should have at least one FunctionValue constant");

    const { linkedProgram, userLinks } = linkUserPrograms(brainProg, [userProg]);

    const constOffset = brainProg.constants.size();
    for (const origFc of originalFuncConsts) {
      const origIndex = userProg.constants.toArray().indexOf(origFc);
      const linkedConst = linkedProgram.constants.get(constOffset + origIndex);
      assert.equal(linkedConst.t, NativeType.Function);
      assert.equal(
        (linkedConst as { funcId: number }).funcId,
        origFc.funcId + funcOffset,
        `FunctionValue at const index ${origIndex} should have funcId remapped by funcOffset ${funcOffset}`
      );
    }

    const linkedEntryFuncId = userLinks[0].linkedEntryFuncId;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);
    const args = mkArgsMap({ 0: mkNumberValue(5) });
    const fiber = vm.spawnFiber(1, linkedEntryFuncId, List.from<Value>([mkCtxStruct(), args]), mkCtx());
    fiber.instrBudget = 1000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.equal((runResult.result as NumberValue).v, 10);
    }
  });
});
