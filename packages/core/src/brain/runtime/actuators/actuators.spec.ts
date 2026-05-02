import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import {
  type BrainServices,
  type BrainSyncFunctionEntry,
  CoreActuatorId,
  CoreParameterId,
  type ExecutionContext,
  getSlotId,
  type HostSyncFn,
  mkNumberValue,
  mkParameterTileId,
  mkStringValue,
  NIL_VALUE,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";

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

function mkArgs(size = 4): List<Value> {
  const list = List.empty<Value>();
  for (let i = 0; i < size; i++) list.push(NIL_VALUE);
  return list;
}

let services: BrainServices;

function getSyncEntry(name: string): BrainSyncFunctionEntry {
  const entry = services.functions.get(name);
  assert.ok(entry, `function '${name}' not found in registry`);
  assert.equal(entry.isAsync, false);
  return entry as BrainSyncFunctionEntry;
}

before(() => {
  services = __test__createBrainServices();
});

// -- switch-page actuator --

describe("switch-page actuator", () => {
  let fn: HostSyncFn;
  let numberSlotId: number;
  let stringSlotId: number;

  before(() => {
    const entry = getSyncEntry(CoreActuatorId.SwitchPage);
    fn = entry.fn;
    numberSlotId = getSlotId(entry.callDef, mkParameterTileId(CoreParameterId.AnonymousNumber));
    stringSlotId = getSlotId(entry.callDef, mkParameterTileId(CoreParameterId.AnonymousString));
  });

  test("calls requestPageChange with 0-based index for number arg", () => {
    let calledWith: number | undefined;
    const ctx = mkCtx({
      brain: {
        requestPageChange: (idx: number) => {
          calledWith = idx;
        },
      } as never,
    });
    const args = mkArgs();
    args.set(numberSlotId, mkNumberValue(3));

    const result = fn.exec(ctx, args);

    assert.equal(result, VOID_VALUE);
    assert.equal(calledWith, 2); // 3 - 1 = 2 (1-based to 0-based)
  });

  test("calls requestPageChangeByPageId for string arg", () => {
    let calledWith: string | undefined;
    const ctx = mkCtx({
      brain: {
        requestPageChangeByPageId: (id: string) => {
          calledWith = id;
        },
      } as never,
    });
    const args = mkArgs();
    args.set(stringSlotId, mkStringValue("my-page"));

    const result = fn.exec(ctx, args);

    assert.equal(result, VOID_VALUE);
    assert.equal(calledWith, "my-page");
  });

  test("calls requestPageRestart with no args", () => {
    let restartCalled = false;
    const ctx = mkCtx({
      brain: {
        requestPageRestart: () => {
          restartCalled = true;
        },
      } as never,
    });
    const args = mkArgs();

    const result = fn.exec(ctx, args);

    assert.equal(result, VOID_VALUE);
    assert.ok(restartCalled);
  });
});

// -- restart-page actuator --

describe("restart-page actuator", () => {
  let fn: HostSyncFn;

  before(() => {
    fn = getSyncEntry(CoreActuatorId.RestartPage).fn;
  });

  test("calls requestPageRestart", () => {
    let called = false;
    const ctx = mkCtx({
      brain: {
        requestPageRestart: () => {
          called = true;
        },
      } as never,
    });
    const args = mkArgs();

    const result = fn.exec(ctx, args);

    assert.equal(result, VOID_VALUE);
    assert.ok(called);
  });
});
