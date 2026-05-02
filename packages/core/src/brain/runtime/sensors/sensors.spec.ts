import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { Dict, List } from "@mindcraft-lang/core";
import {
  type BrainServices,
  type BrainSyncFunctionEntry,
  CoreSensorId,
  type ExecutionContext,
  extractNumberValue,
  FALSE_VALUE,
  type HostSyncFn,
  mkNumberValue,
  NativeType,
  NIL_VALUE,
  TRUE_VALUE,
  type Value,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";

function mkCtx(
  overrides: Omit<Partial<ExecutionContext>, "callSiteState"> & { callSiteState?: Dict<number, unknown> } = {}
): ExecutionContext {
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
  } as ExecutionContext;
}

function mkArgs(size = 1): List<Value> {
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

// -- timeout sensor --

describe("timeout sensor", () => {
  let fn: HostSyncFn;

  before(() => {
    fn = getSyncEntry(CoreSensorId.Timeout).fn;
  });

  function setupCtx(callSiteId = 1): ExecutionContext {
    const ctx = mkCtx({ currentCallSiteId: callSiteId, callSiteState: new Dict<number, unknown>() });
    fn.onPageEntered!(ctx);
    return ctx;
  }

  test("does not fire on first tick, fires after default 1s delay", () => {
    const ctx = setupCtx();
    const args = mkArgs();

    // First tick initializes fireTime = 100 + 1000 = 1100
    ctx.time = 100;
    ctx.currentTick = 0;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // Before fire time
    ctx.time = 500;
    ctx.currentTick = 1;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // At fire time
    ctx.time = 1100;
    ctx.currentTick = 2;
    assert.equal(fn.exec(ctx, args), TRUE_VALUE);
  });

  test("fires with custom delay", () => {
    const ctx = setupCtx();
    const args = mkArgs();
    args.set(0, mkNumberValue(3));

    // First tick initializes fireTime = 100 + 3000 = 3100
    ctx.time = 100;
    ctx.currentTick = 0;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    ctx.time = 2999;
    ctx.currentTick = 1;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    ctx.time = 3100;
    ctx.currentTick = 2;
    assert.equal(fn.exec(ctx, args), TRUE_VALUE);
  });

  test("auto-resets after firing (periodic behavior)", () => {
    const ctx = setupCtx();
    const args = mkArgs();
    args.set(0, mkNumberValue(1));

    // First tick initializes fireTime = 0 + 1000 = 1000
    ctx.time = 0;
    ctx.currentTick = 0;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // Fire at 1000ms, fireTime resets to 1000 + 1000 = 2000
    ctx.time = 1000;
    ctx.currentTick = 1;
    assert.equal(fn.exec(ctx, args), TRUE_VALUE);

    // Next tick -- should NOT fire (fireTime = 2000)
    ctx.time = 1016;
    ctx.currentTick = 2;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // At second interval, fireTime resets to 2000 + 1000 = 3000
    ctx.time = 2000;
    ctx.currentTick = 3;
    assert.equal(fn.exec(ctx, args), TRUE_VALUE);

    // Third interval
    ctx.time = 3000;
    ctx.currentTick = 4;
    assert.equal(fn.exec(ctx, args), TRUE_VALUE);
  });

  test("returns TRUE for exactly one tick per interval", () => {
    const ctx = setupCtx();
    const args = mkArgs();

    // First tick initializes fireTime = 0 + 1000 = 1000
    ctx.time = 0;
    ctx.currentTick = 0;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // Fire at 1000ms, fireTime resets to 1000 + 1000 = 2000
    ctx.time = 1000;
    ctx.currentTick = 1;
    assert.equal(fn.exec(ctx, args), TRUE_VALUE);

    // Immediately after -- should be false
    ctx.time = 1016;
    ctx.currentTick = 2;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    ctx.time = 1032;
    ctx.currentTick = 3;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);
  });

  test("tick skip resets timer", () => {
    const ctx = setupCtx();
    const args = mkArgs();
    args.set(0, mkNumberValue(2));

    // First tick initializes fireTime = 100 + 2000 = 2100
    ctx.time = 100;
    ctx.currentTick = 0;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // Normal second tick
    ctx.time = 500;
    ctx.currentTick = 1;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // Skip ticks (currentTick jumps from 1 to 5)
    // Timer resets to 1500 + 2000 = 3500
    ctx.time = 1500;
    ctx.currentTick = 5;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // Before reset fire time
    ctx.time = 3499;
    ctx.currentTick = 6;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // At reset fire time
    ctx.time = 3500;
    ctx.currentTick = 7;
    assert.equal(fn.exec(ctx, args), TRUE_VALUE);
  });

  test("onPageEntered resets state", () => {
    const ctx = setupCtx();
    const args = mkArgs();

    // First tick initializes fireTime = 0 + 1000 = 1000
    ctx.time = 0;
    ctx.currentTick = 0;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // Fire at 1000ms
    ctx.time = 1000;
    ctx.currentTick = 1;
    assert.equal(fn.exec(ctx, args), TRUE_VALUE);

    // Reset via onPageEntered (fireTime -> 0, lastTick -> -2)
    fn.onPageEntered!(ctx);

    // Next tick triggers skip-reset: fireTime = 2000 + 1000 = 3000
    ctx.time = 2000;
    ctx.currentTick = 2;
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // After delay from reset
    ctx.time = 3000;
    ctx.currentTick = 3;
    assert.equal(fn.exec(ctx, args), TRUE_VALUE);
  });
});

// -- on-page-entered sensor --

describe("on-page-entered sensor", () => {
  let fn: HostSyncFn;

  before(() => {
    fn = getSyncEntry(CoreSensorId.OnPageEntered).fn;
  });

  function setupCtx(callSiteId = 1): ExecutionContext {
    const ctx = mkCtx({ currentCallSiteId: callSiteId, callSiteState: new Dict<number, unknown>() });
    fn.onPageEntered!(ctx);
    return ctx;
  }

  test("returns TRUE on first call after page entry", () => {
    const ctx = setupCtx();
    const args = mkArgs();

    assert.equal(fn.exec(ctx, args), TRUE_VALUE);
  });

  test("returns FALSE on subsequent calls", () => {
    const ctx = setupCtx();
    const args = mkArgs();

    fn.exec(ctx, args); // first call fires
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);
  });

  test("onPageEntered resets so it fires again", () => {
    const ctx = setupCtx();
    const args = mkArgs();

    fn.exec(ctx, args); // fires
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);

    // Re-enter page
    fn.onPageEntered!(ctx);
    assert.equal(fn.exec(ctx, args), TRUE_VALUE);
    assert.equal(fn.exec(ctx, args), FALSE_VALUE);
  });
});

// -- random sensor --

describe("random sensor", () => {
  let fn: HostSyncFn;

  before(() => {
    fn = getSyncEntry(CoreSensorId.Random).fn;
  });

  test("returns value from brain.rng()", () => {
    const ctx = mkCtx({
      brain: { rng: () => 0.42 } as never,
    });
    const args = mkArgs();

    const result = fn.exec(ctx, args);
    assert.equal(result.t, NativeType.Number);
    assert.equal(result.v, 0.42);
  });

  test("returns different values from successive rng calls", () => {
    let call = 0;
    const values = [0.1, 0.9];
    const ctx = mkCtx({
      brain: { rng: () => values[call++]! } as never,
    });
    const args = mkArgs();

    assert.equal(extractNumberValue(fn.exec(ctx, args)), 0.1);
    assert.equal(extractNumberValue(fn.exec(ctx, args)), 0.9);
  });
});
