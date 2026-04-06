import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import {
  type BrainSyncFunctionEntry,
  CoreActuatorId,
  type ExecutionContext,
  getBrainServices,
  type HostSyncFn,
  type MapValue,
  mkNumberValue,
  mkStringValue,
  NativeType,
  registerCoreBrainComponents,
  ValueDict,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";

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

function mkArgs(): MapValue {
  return { t: NativeType.Map, typeId: "", v: new ValueDict() };
}

function getSyncEntry(name: string): BrainSyncFunctionEntry {
  const entry = getBrainServices().functions.get(name);
  assert.ok(entry, `function '${name}' not found in registry`);
  assert.equal(entry.isAsync, false);
  return entry as BrainSyncFunctionEntry;
}

before(() => {
  registerCoreBrainComponents();
});

// -- switch-page actuator --

describe("switch-page actuator", () => {
  let fn: HostSyncFn;

  before(() => {
    fn = getSyncEntry(CoreActuatorId.SwitchPage).fn;
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
    args.v.set(0, mkNumberValue(3));

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
    args.v.set(0, mkStringValue("my-page"));

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
