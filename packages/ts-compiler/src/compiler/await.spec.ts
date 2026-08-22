import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, type ReadonlyList, runtime } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import type { ExecutionContext } from "@wendoo/core/runtime";
import {
  type AsyncHandle,
  type BooleanValue,
  ContextTypeIds,
  CoreTypeIds,
  type EnumValue,
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
  type Scheduler,
  type StringValue,
  type StructTypeDef,
  type StructValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { expectDiagnostic } from "../testsupport/diag-coverage.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, LoweringDiagCode, ValidatorDiagCode } from "./diag-codes.js";
import type { UserAuthoredProgram } from "./types.js";

let services: BrainServices;

function toVmServices(b: BrainServices) {
  return __test__createPlatformServices({ runtime: { functions: b.runtime.functions, types: b.runtime.types } })
    .runtime;
}

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
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

function mkArgsList(entries: Record<number, Value>): List<Value> {
  const args = List.empty<Value>();
  for (const [key, value] of Object.entries(entries)) {
    const idx = Number(key);
    while (args.size() <= idx) {
      args.push(NIL_VALUE);
    }
    args.set(idx, value);
  }
  return args;
}

function runActivation(prog: UserAuthoredProgram, handles: HandleTable, callsiteVars?: List<Value>): void {
  const runFn = (funcId: number): void => {
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
    const fiber = vm.spawnFiber(1, funcId, List.empty<Value>(), mkCtx());
    if (callsiteVars) {
      fiber.callsiteVars = callsiteVars;
    }
    fiber.instrBudget = 1000;
    const result = vm.runFiber(fiber, mkScheduler());
    assert.equal(result.status, VmStatus.DONE);
  };
  if (prog.initializerFuncId !== undefined) {
    runFn(prog.initializerFuncId);
  }
  if (prog.activationFuncId !== undefined) {
    runFn(prog.activationFuncId);
  }
}
describe("await expression", () => {
  before(async () => {
    services = __test__createBrainServices();

    const types = services.runtime.types;
    const fns = services.runtime.functions;
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
        atomId: 1024,
        fields: List.from([{ name: "id", typeId: numTypeId, fieldIndex: 0 }]),
        methods: List.from([
          {
            name: "fetchData",
            params: List.from([{ name: "url", typeId: strTypeId }]),
            returnTypeId: strTypeId,
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
      });
    }

    if (!fns.get("Widget.fetchData")) {
      fns.register(
        6001,
        "Widget.fetchData",
        true,
        { exec: (_ctx: ExecutionContext, _args: ReadonlyList<Value>, _handle: AsyncHandle) => {} },
        emptyCallDef
      );
    }

    if (!fns.get("Widget.getValue")) {
      fns.register(
        6002,
        "Widget.getValue",
        false,
        {
          exec: (_ctx: ExecutionContext, _args: ReadonlyList<Value>) => {
            return mkNumberValue(42);
          },
        },
        emptyCallDef
      );
    }

    if (!fns.get("Widget.reset")) {
      fns.register(6003, "Widget.reset", false, { exec: () => NIL_VALUE }, emptyCallDef);
    }
  });

  test("single await: fiber suspends, resolves, and returns value", () => {
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "wendoo";

export default Sensor({
  name: "fetch-await",
  args: [
    param("w", { type: "Widget" }),
  ],
  async onExecute(ctx: Context, args: { w: Widget }): Promise<string> {
    const result = await args.w.fetchData("test-url");
    return result;
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const hasAsyncCall = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.HOST_CALL_ASYNC));
    assert.ok(hasAsyncCall, "Expected HOST_CALL_ASYNC opcode");

    const hasAwait = prog.functions.some((fn) => fn.code.some((instr) => instr.op === Op.AWAIT));
    assert.ok(hasAwait, "Expected AWAIT opcode");

    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
    const args = mkArgsList({ 0: mkNativeStructValue("Widget", { id: 1 }) });
    const fiber = vm.spawnFiber(1, 0, args, mkCtx());
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
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "wendoo";

export default Sensor({
  name: "double-await",
  args: [
    param("w", { type: "Widget" }),
  ],
  async onExecute(ctx: Context, args: { w: Widget }): Promise<string> {
    const a = await args.w.fetchData("first");
    const b = await args.w.fetchData("second");
    return a + b;
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
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
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
    const args = mkArgsList({ 0: mkNativeStructValue("Widget", { id: 1 }) });
    const fiber = vm.spawnFiber(1, 0, args, mkCtx());
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
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "wendoo";

export default Sensor({
  name: "local-across-await",
  args: [
    param("w", { type: "Widget" }),
  ],
  async onExecute(ctx: Context, args: { w: Widget }): Promise<string> {
    const before = "prefix-";
    const fetched = await args.w.fetchData("data");
    return before + fetched;
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(prog, toVmServices(services), { handles });
    const args = mkArgsList({ 0: mkNativeStructValue("Widget", { id: 1 }) });
    const fiber = vm.spawnFiber(1, 0, args, mkCtx());
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
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, param, type Context, type Widget } from "wendoo";

export default Sensor({
  name: "bad-await",
  args: [
    param("w", { type: "Widget" }),
  ],
  async onExecute(ctx: Context, args: { w: Widget }): Promise<number> {
    const val = await args.w.getValue("score");
    return val;
  },
});
`;
    const result = compileUserTile(source, {
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    assert.ok(result.diagnostics.length > 0, "Expected compile error for await on sync call");
    expectDiagnostic(result.diagnostics, LoweringDiagCode.AwaitOnNonAsyncHostCall);
  });
});
