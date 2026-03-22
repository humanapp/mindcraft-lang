import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { Dict, List, UniqueSet } from "@mindcraft-lang/core";
import {
  type BrainProgram,
  BYTECODE_VERSION,
  type ExecutionContext,
  getBrainServices,
  HandleState,
  HandleTable,
  type MapValue,
  mkActuatorTileId,
  mkNumberValue,
  mkParameterTileId,
  mkSensorTileId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type PageMetadata,
  registerCoreBrainComponents,
  runtime,
  type Scheduler,
  type Value,
  ValueDict,
} from "@mindcraft-lang/core/brain";
import { compileUserTile, initCompiler } from "../compiler/compile.js";
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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
  before(async () => {
    registerCoreBrainComponents();
    await initCompiler();
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
