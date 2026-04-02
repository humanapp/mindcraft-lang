import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { Dict, List, UniqueSet } from "@mindcraft-lang/core";
import {
  type BrainProgram,
  BYTECODE_VERSION,
  type ExecutionContext,
  FiberState,
  getBrainServices,
  HandleState,
  HandleTable,
  type MapValue,
  mkActuatorTileId,
  mkNativeStructValue,
  mkNumberValue,
  mkParameterTileId,
  mkSensorTileId,
  mkStringValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type PageMetadata,
  registerCoreBrainComponents,
  runtime,
  type Scheduler,
  type StringValue,
  type StructValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { buildAmbientDeclarations } from "../compiler/ambient.js";
import { compileUserTile } from "../compiler/compile.js";
import type { UserTileLinkInfo } from "../compiler/types.js";
import { linkUserPrograms } from "../linker/linker.js";
import { createUserTileExec } from "./authored-function.js";
import { registerUserTile } from "./registration-bridge.js";

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

function compileAndLink(source: string) {
  const result = compileUserTile(source);
  assert.deepStrictEqual(result.diagnostics, [], `Compile errors: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program);

  const brainProg = mkEmptyBrainProgram();
  const { linkedProgram, userLinks } = linkUserPrograms(brainProg, [result.program!]);
  return { linkedProgram, linkInfo: userLinks[0], program: result.program! };
}

function setupExecWrapper(linkedProgram: BrainProgram, linkInfo: UserTileLinkInfo) {
  const handles = new HandleTable(100);
  const vm = new runtime.VM(linkedProgram, handles);
  const scheduler = mkScheduler();
  const wrapper = createUserTileExec(linkedProgram, linkInfo, vm, scheduler);
  return { handles, vm, scheduler, wrapper };
}

function emptyArgs(): MapValue {
  return { t: NativeType.Map, typeId: "map:<args>", v: new ValueDict() };
}

describe("authored-function", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("sync sensor resolves handle within same tick", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "resolve-42",
  output: "number",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLink(source);
    const { handles, wrapper } = setupExecWrapper(linkedProgram, linkInfo);

    const handleId = handles.createPending();
    const ctx = mkCtx({
      currentCallSiteId: 1,
      callSiteState: new Dict<number, unknown>(),
    });

    wrapper.exec(ctx, emptyArgs(), handleId);

    const handle = handles.get(handleId)!;
    assert.equal(handle.state, HandleState.RESOLVED);
    assert.equal(handle.result!.t, NativeType.Number);
    assert.equal((handle.result as NumberValue).v, 42);
  });

  test("callsite vars persist across two invocations of the same tile", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let counter = 0;

export default Sensor({
  name: "persist-counter",
  output: "number",
  onExecute(ctx: Context): number {
    counter = counter + 1;
    return counter;
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLink(source);
    const { handles, wrapper } = setupExecWrapper(linkedProgram, linkInfo);

    const ctx = mkCtx({
      currentCallSiteId: 1,
      callSiteState: new Dict<number, unknown>(),
    });

    const h1 = handles.createPending();
    wrapper.exec(ctx, emptyArgs(), h1);
    assert.equal(handles.get(h1)!.state, HandleState.RESOLVED);
    assert.equal((handles.get(h1)!.result as NumberValue).v, 1);

    const h2 = handles.createPending();
    wrapper.exec(ctx, emptyArgs(), h2);
    assert.equal(handles.get(h2)!.state, HandleState.RESOLVED);
    assert.equal((handles.get(h2)!.result as NumberValue).v, 2);
  });

  test("two callsites get independent callsite var state", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let counter = 0;

export default Sensor({
  name: "independent-cs",
  output: "number",
  onExecute(ctx: Context): number {
    counter = counter + 1;
    return counter;
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLink(source);
    const { handles, wrapper } = setupExecWrapper(linkedProgram, linkInfo);

    const callSiteState = new Dict<number, unknown>();

    const h1 = handles.createPending();
    wrapper.exec(mkCtx({ currentCallSiteId: 1, callSiteState }), emptyArgs(), h1);
    assert.equal((handles.get(h1)!.result as NumberValue).v, 1);

    const h2 = handles.createPending();
    wrapper.exec(mkCtx({ currentCallSiteId: 2, callSiteState }), emptyArgs(), h2);
    assert.equal((handles.get(h2)!.result as NumberValue).v, 1);

    const h3 = handles.createPending();
    wrapper.exec(mkCtx({ currentCallSiteId: 1, callSiteState }), emptyArgs(), h3);
    assert.equal((handles.get(h3)!.result as NumberValue).v, 2);
  });

  test("onPageEntered dispatch resets callsite vars and runs user body", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let counter = 0;

export default Sensor({
  name: "reset-counter",
  output: "number",
  onExecute(ctx: Context): number {
    counter = counter + 1;
    return counter;
  },
  onPageEntered(ctx: Context): void {
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLink(source);
    const { handles, wrapper } = setupExecWrapper(linkedProgram, linkInfo);

    const callSiteState = new Dict<number, unknown>();
    const ctx = () => mkCtx({ currentCallSiteId: 1, callSiteState });

    const h1 = handles.createPending();
    wrapper.exec(ctx(), emptyArgs(), h1);
    assert.equal((handles.get(h1)!.result as NumberValue).v, 1);

    const h2 = handles.createPending();
    wrapper.exec(ctx(), emptyArgs(), h2);
    assert.equal((handles.get(h2)!.result as NumberValue).v, 2);

    wrapper.onPageEntered!(ctx());

    const h3 = handles.createPending();
    wrapper.exec(ctx(), emptyArgs(), h3);
    assert.equal((handles.get(h3)!.result as NumberValue).v, 1);
  });

  test("sensor with parameters receives args correctly", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "add-params",
  output: "number",
  params: {
    a: { type: "number" },
    b: { type: "number" },
  },
  onExecute(ctx: Context, params: { a: number; b: number }): number {
    return params.a + params.b;
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLink(source);
    const { handles, wrapper } = setupExecWrapper(linkedProgram, linkInfo);

    const argsDict = new ValueDict();
    argsDict.set(0, mkNumberValue(10));
    argsDict.set(1, mkNumberValue(32));
    const args: MapValue = { t: NativeType.Map, typeId: "map:<args>", v: argsDict };

    const handleId = handles.createPending();
    const ctx = mkCtx({
      currentCallSiteId: 1,
      callSiteState: new Dict<number, unknown>(),
    });

    wrapper.exec(ctx, args, handleId);

    assert.equal(handles.get(handleId)!.state, HandleState.RESOLVED);
    assert.equal((handles.get(handleId)!.result as NumberValue).v, 42);
  });
});

describe("registration-bridge", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("creates correct BrainTileSensorDef with expected tileId", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "reg-sensor",
  output: "number",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLink(source);
    const { wrapper } = setupExecWrapper(linkedProgram, linkInfo);

    registerUserTile(linkInfo, wrapper);

    const { tiles, functions } = getBrainServices();
    const tileDef = tiles.get(mkSensorTileId("user.sensor.reg-sensor"));
    assert.ok(tileDef, "sensor tile def should exist");
    assert.equal(tileDef!.kind, "sensor");

    const fnEntry = functions.get("user.sensor.reg-sensor");
    assert.ok(fnEntry, "function should be registered");
    assert.equal(fnEntry!.isAsync, true);
  });

  test("creates correct BrainTileActuatorDef with expected tileId", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "reg-actuator",
  onExecute(ctx: Context): void {
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLink(source);
    const { wrapper } = setupExecWrapper(linkedProgram, linkInfo);

    registerUserTile(linkInfo, wrapper);

    const tileDef = getBrainServices().tiles.get(mkActuatorTileId("user.actuator.reg-actuator"));
    assert.ok(tileDef, "actuator tile def should exist");
    assert.equal(tileDef!.kind, "actuator");
  });

  test("parameter tile defs are registered for named and anonymous params", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "param-reg",
  output: "number",
  params: {
    distance: { type: "number" },
    label: { type: "string" },
    speed: { type: "number", anonymous: true },
  },
  onExecute(ctx: Context, params: { distance: number; label: string; speed: number }): number {
    return params.distance + params.speed;
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLink(source);
    const { wrapper } = setupExecWrapper(linkedProgram, linkInfo);

    registerUserTile(linkInfo, wrapper);

    const { tiles } = getBrainServices();
    assert.ok(tiles.has(mkParameterTileId("user.param-reg.distance")), "named distance param tile should exist");
    assert.ok(tiles.has(mkParameterTileId("user.param-reg.label")), "named label param tile should exist");
    assert.ok(tiles.has(mkParameterTileId("anon.number")), "anonymous number param tile should exist");
  });
});

describe("async exec", () => {
  let ambientSource: string;

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
        ]),
      });
    }

    const emptyCallDef = {
      callSpec: { type: "bag" as const, items: [] },
      argSlots: List.empty<never>(),
    };

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
          exec: (_ctx: ExecutionContext, args: MapValue) => {
            const key = (args.v.get(1) as StringValue).v;
            if (key === "score") return mkNumberValue(99);
            return mkNumberValue(0);
          },
        },
        emptyCallDef
      );
    }

    ambientSource = buildAmbientDeclarations();
  });

  function compileAndLinkAsync(source: string) {
    const result = compileUserTile(source, { ambientSource });
    assert.deepStrictEqual(result.diagnostics, [], `Compile errors: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const brainProg = mkEmptyBrainProgram();
    const { linkedProgram, userLinks } = linkUserPrograms(brainProg, [result.program!]);
    return { linkedProgram, linkInfo: userLinks[0], program: result.program! };
  }

  test("async actuator with one await -> fiber suspends, handle resolves on completion", () => {
    const source = `
import { Actuator, type Context, type Widget } from "mindcraft";

export default Actuator({
  name: "patrol-async",
  params: {
    w: { type: "Widget" },
  },
  async onExecute(ctx: Context, params: { w: Widget }): Promise<void> {
    await params.w.fetchData("target");
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLinkAsync(source);
    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);
    const scheduler = new runtime.FiberScheduler(vm, { defaultBudget: 10000, autoGcHandles: false });
    const wrapper = createUserTileExec(linkedProgram, linkInfo, vm, scheduler);

    const outerHandleId = handles.createPending();
    const args = new ValueDict();
    args.set(0, mkNativeStructValue("Widget", { id: 1 }));
    const argsMap: MapValue = { t: NativeType.Map, typeId: "map:<args>", v: args };

    const ctx = mkCtx({
      currentCallSiteId: 1,
      callSiteState: new Dict<number, unknown>(),
    });

    wrapper.exec(ctx, argsMap, outerHandleId);

    scheduler.tick();

    assert.equal(handles.get(outerHandleId)!.state, HandleState.PENDING, "outer handle should still be pending");

    const innerHandleId = outerHandleId + 1;
    handles.resolve(innerHandleId, mkStringValue("done"));

    scheduler.tick();

    assert.equal(handles.get(outerHandleId)!.state, HandleState.RESOLVED, "outer handle should be resolved");
    assert.equal(handles.get(outerHandleId)!.result!.t, NativeType.Nil);
  });

  test("local variable assigned before await, read after -> correct value", () => {
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "local-across-await",
  output: "string",
  params: {
    w: { type: "Widget" },
  },
  async onExecute(ctx: Context, params: { w: Widget }): Promise<string> {
    const prefix = "hello-";
    const fetched = await params.w.fetchData("url");
    return prefix + fetched;
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLinkAsync(source);
    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);
    const scheduler = new runtime.FiberScheduler(vm, { defaultBudget: 10000, autoGcHandles: false });
    const wrapper = createUserTileExec(linkedProgram, linkInfo, vm, scheduler);

    const outerHandleId = handles.createPending();
    const args = new ValueDict();
    args.set(0, mkNativeStructValue("Widget", { id: 1 }));
    const argsMap: MapValue = { t: NativeType.Map, typeId: "map:<args>", v: args };

    const ctx = mkCtx({
      currentCallSiteId: 1,
      callSiteState: new Dict<number, unknown>(),
    });

    wrapper.exec(ctx, argsMap, outerHandleId);

    scheduler.tick();

    assert.equal(handles.get(outerHandleId)!.state, HandleState.PENDING);

    const innerHandleId = outerHandleId + 1;
    handles.resolve(innerHandleId, mkStringValue("world"));

    scheduler.tick();

    assert.equal(handles.get(outerHandleId)!.state, HandleState.RESOLVED);
    const result = handles.get(outerHandleId)!.result as StringValue;
    assert.equal(result.v, "hello-world");
  });

  test("callsite var modified before await, read after -> correct value", () => {
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

let counter = 0;

export default Sensor({
  name: "callsite-across-await",
  output: "number",
  params: {
    w: { type: "Widget" },
  },
  async onExecute(ctx: Context, params: { w: Widget }): Promise<number> {
    counter = counter + 10;
    await params.w.fetchData("url");
    return counter;
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLinkAsync(source);
    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);
    const scheduler = new runtime.FiberScheduler(vm, { defaultBudget: 10000, autoGcHandles: false });
    const wrapper = createUserTileExec(linkedProgram, linkInfo, vm, scheduler);

    const callSiteState = new Dict<number, unknown>();
    const ctx = mkCtx({ currentCallSiteId: 1, callSiteState });

    const outerHandleId = handles.createPending();
    const args = new ValueDict();
    args.set(0, mkNativeStructValue("Widget", { id: 1 }));
    const argsMap: MapValue = { t: NativeType.Map, typeId: "map:<args>", v: args };

    wrapper.exec(ctx, argsMap, outerHandleId);

    scheduler.tick();

    assert.equal(handles.get(outerHandleId)!.state, HandleState.PENDING);

    const innerHandleId = outerHandleId + 1;
    handles.resolve(innerHandleId, mkStringValue("done"));

    scheduler.tick();

    assert.equal(handles.get(outerHandleId)!.state, HandleState.RESOLVED);
    const result = handles.get(outerHandleId)!.result as NumberValue;
    assert.equal(result.v, 10);
  });

  test("async sensor returning a value after await -> handle resolves with return value", () => {
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "fetch-return",
  output: "string",
  params: {
    w: { type: "Widget" },
  },
  async onExecute(ctx: Context, params: { w: Widget }): Promise<string> {
    const result = await params.w.fetchData("data-url");
    return result;
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLinkAsync(source);
    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);
    const scheduler = new runtime.FiberScheduler(vm, { defaultBudget: 10000, autoGcHandles: false });
    const wrapper = createUserTileExec(linkedProgram, linkInfo, vm, scheduler);

    const outerHandleId = handles.createPending();
    const args = new ValueDict();
    args.set(0, mkNativeStructValue("Widget", { id: 1 }));
    const argsMap: MapValue = { t: NativeType.Map, typeId: "map:<args>", v: args };

    const ctx = mkCtx({
      currentCallSiteId: 1,
      callSiteState: new Dict<number, unknown>(),
    });

    wrapper.exec(ctx, argsMap, outerHandleId);

    scheduler.tick();

    assert.equal(handles.get(outerHandleId)!.state, HandleState.PENDING);

    const innerHandleId = outerHandleId + 1;
    handles.resolve(innerHandleId, mkStringValue("fetched-value"));

    scheduler.tick();

    assert.equal(handles.get(outerHandleId)!.state, HandleState.RESOLVED);
    const result = handles.get(outerHandleId)!.result as StringValue;
    assert.equal(result.v, "fetched-value");
  });

  test("user-tile fiber visible in scheduler stats", () => {
    const source = `
import { Actuator, type Context, type Widget } from "mindcraft";

export default Actuator({
  name: "stats-visible",
  params: {
    w: { type: "Widget" },
  },
  async onExecute(ctx: Context, params: { w: Widget }): Promise<void> {
    await params.w.fetchData("url");
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLinkAsync(source);
    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);
    const scheduler = new runtime.FiberScheduler(vm, { defaultBudget: 10000, autoGcHandles: false });
    const wrapper = createUserTileExec(linkedProgram, linkInfo, vm, scheduler);

    const outerHandleId = handles.createPending();
    const args = new ValueDict();
    args.set(0, mkNativeStructValue("Widget", { id: 1 }));
    const argsMap: MapValue = { t: NativeType.Map, typeId: "map:<args>", v: args };

    const ctx = mkCtx({
      currentCallSiteId: 1,
      callSiteState: new Dict<number, unknown>(),
    });

    wrapper.exec(ctx, argsMap, outerHandleId);

    const statsBeforeTick = scheduler.getStats();
    assert.equal(statsBeforeTick.totalFibers, 1, "fiber should be tracked by scheduler");
    assert.equal(statsBeforeTick.runnableFibers, 1, "fiber should be runnable before tick");

    scheduler.tick();

    const statsAfterTick = scheduler.getStats();
    assert.equal(statsAfterTick.waitingFibers, 1, "fiber should be waiting after tick");
  });

  test("user-tile fiber respects scheduler budget (yields after default budget)", () => {
    const source = `
import { Sensor, type Context, type Widget } from "mindcraft";

export default Sensor({
  name: "budget-respect",
  output: "number",
  params: {
    w: { type: "Widget" },
  },
  async onExecute(ctx: Context, params: { w: Widget }): Promise<number> {
    let sum = 0;
    for (let i = 0; i < 500; i++) {
      sum = sum + i;
    }
    const fetched = await params.w.fetchData("url");
    return sum;
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLinkAsync(source);
    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);
    const scheduler = new runtime.FiberScheduler(vm, { defaultBudget: 100, autoGcHandles: false });
    const wrapper = createUserTileExec(linkedProgram, linkInfo, vm, scheduler);

    const outerHandleId = handles.createPending();
    const args = new ValueDict();
    args.set(0, mkNativeStructValue("Widget", { id: 1 }));
    const argsMap: MapValue = { t: NativeType.Map, typeId: "map:<args>", v: args };

    const ctx = mkCtx({
      currentCallSiteId: 1,
      callSiteState: new Dict<number, unknown>(),
    });

    wrapper.exec(ctx, argsMap, outerHandleId);

    scheduler.tick();
    const stats = scheduler.getStats();
    assert.equal(stats.runnableFibers, 1, "fiber should yield and be re-enqueued with low budget");

    for (let i = 0; i < 100; i++) {
      scheduler.tick();
      const s = scheduler.getStats();
      if (s.waitingFibers === 1) break;
    }

    const statsWaiting = scheduler.getStats();
    assert.equal(statsWaiting.waitingFibers, 1, "fiber should eventually hit AWAIT");

    const innerHandleId = outerHandleId + 1;
    handles.resolve(innerHandleId, mkStringValue("done"));

    for (let i = 0; i < 100; i++) {
      scheduler.tick();
      const s = scheduler.getStats();
      if (s.doneFibers === 1) break;
    }

    assert.equal(handles.get(outerHandleId)!.state, HandleState.RESOLVED);
  });

  test("cancellation during suspended async fiber -> fiber cancelled", () => {
    const source = `
import { Actuator, type Context, type Widget } from "mindcraft";

export default Actuator({
  name: "cancel-test",
  params: {
    w: { type: "Widget" },
  },
  async onExecute(ctx: Context, params: { w: Widget }): Promise<void> {
    await params.w.fetchData("url");
  },
});
`;
    const { linkedProgram, linkInfo } = compileAndLinkAsync(source);
    const handles = new HandleTable(100);
    const vm = new runtime.VM(linkedProgram, handles);
    const scheduler = new runtime.FiberScheduler(vm, { defaultBudget: 10000, autoGcHandles: false });
    const wrapper = createUserTileExec(linkedProgram, linkInfo, vm, scheduler);

    const outerHandleId = handles.createPending();
    const args = new ValueDict();
    args.set(0, mkNativeStructValue("Widget", { id: 1 }));
    const argsMap: MapValue = { t: NativeType.Map, typeId: "map:<args>", v: args };

    const ctx = mkCtx({
      currentCallSiteId: 1,
      callSiteState: new Dict<number, unknown>(),
    });

    wrapper.exec(ctx, argsMap, outerHandleId);
    scheduler.tick();

    const stats = scheduler.getStats();
    assert.equal(stats.waitingFibers, 1, "fiber should be waiting");

    scheduler.cancel(-1);

    assert.equal(handles.get(outerHandleId)!.state, HandleState.CANCELLED, "outer handle should be cancelled");

    const postCancelStats = scheduler.getStats();
    assert.equal(postCancelStats.cancelledFibers, 1, "fiber should be cancelled");
  });
});

describe("recompile-and-update", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("re-registering a tile with updated code -> existing entry updated", () => {
    const sourceV1 = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "updatable-sensor",
  output: "number",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const sourceV2 = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "updatable-sensor",
  output: "number",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const { linkedProgram: lp1, linkInfo: li1 } = compileAndLink(sourceV1);
    const { wrapper: w1 } = setupExecWrapper(lp1, li1);
    registerUserTile(li1, w1);

    const { functions, tiles } = getBrainServices();
    const pgmId = "user.sensor.updatable-sensor";
    const entryAfterV1 = functions.get(pgmId);
    assert.ok(entryAfterV1, "function should be registered after v1");
    assert.ok(tiles.get(mkSensorTileId(pgmId)), "tile should exist after v1");

    const { linkedProgram: lp2, linkInfo: li2 } = compileAndLink(sourceV2);
    const { wrapper: w2 } = setupExecWrapper(lp2, li2);
    registerUserTile(li2, w2);

    const entryAfterV2 = functions.get(pgmId);
    assert.ok(entryAfterV2, "function should still be registered after v2");
    assert.equal(entryAfterV2!.id, entryAfterV1!.id, "function ID should be unchanged");

    const handles = new HandleTable(100);
    const vm = new runtime.VM(lp2, handles);
    const scheduler = mkScheduler();
    const wrapper = createUserTileExec(lp2, li2, vm, scheduler);

    const handleId = handles.createPending();
    const ctx = mkCtx({
      currentCallSiteId: 99,
      callSiteState: new Dict<number, unknown>(),
    });

    wrapper.exec(ctx, emptyArgs(), handleId);

    assert.equal(handles.get(handleId)!.state, HandleState.RESOLVED);
    assert.equal((handles.get(handleId)!.result as NumberValue).v, 42, "should return v2 value");
  });
});
