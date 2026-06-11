import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type BrainActionCallDef,
  DYNAMIC_FUNC_ID_BASE,
  FunctionRegistry,
  type HostSyncFn,
  mkCallDef,
  NIL_VALUE,
  TARGET_FUNC_ID_BASE,
} from "@mindcraft-lang/core/runtime";

const callDef: BrainActionCallDef = mkCallDef({ type: "bag", items: [] });
const noop: HostSyncFn = { exec: () => NIL_VALUE };

describe("FunctionRegistry id assignment", () => {
  test("registers functions under their author-assigned ids", () => {
    const registry = new FunctionRegistry();
    const a = registry.register(1024, "fn-a", false, noop, callDef);
    const b = registry.register(2048, "fn-b", true, noop, callDef);

    assert.equal(a.id, 1024);
    assert.equal(b.id, 2048);
    assert.equal(registry.getSyncById(1024)?.name, "fn-a");
    assert.equal(registry.getAsyncById(2048)?.name, "fn-b");
    assert.equal(registry.size(), 2);
  });

  test("getSyncById/getAsyncById filter on the async flag", () => {
    const registry = new FunctionRegistry();
    registry.register(1024, "sync-fn", false, noop, callDef);
    registry.register(1025, "async-fn", true, noop, callDef);

    assert.equal(registry.getAsyncById(1024), undefined);
    assert.equal(registry.getSyncById(1025), undefined);
  });

  test("unregister releases both the name and the id", () => {
    const registry = new FunctionRegistry();
    registry.register(1024, "transient", false, noop, callDef);
    assert.equal(registry.unregister("transient"), true);

    assert.equal(registry.get("transient"), undefined);
    assert.equal(registry.getSyncById(1024), undefined);
    registry.register(1024, "transient", false, noop, callDef);
    assert.equal(registry.getSyncById(1024)?.name, "transient");
  });

  test("rejects a duplicate name", () => {
    const registry = new FunctionRegistry();
    registry.register(1024, "dup", false, noop, callDef);
    assert.throws(() => registry.register(1025, "dup", false, noop, callDef), /already registered/);
  });
});

describe("FunctionRegistry id validation", () => {
  test("rejects a duplicate id", () => {
    const registry = new FunctionRegistry();
    registry.register(1024, "first", false, noop, callDef);
    assert.throws(() => registry.register(1024, "second", false, noop, callDef), /reuses id 1024/);
  });

  test("rejects a negative id", () => {
    const registry = new FunctionRegistry();
    assert.throws(() => registry.register(-1, "neg", false, noop, callDef), /non-negative integer/);
  });

  test("rejects a fractional id", () => {
    const registry = new FunctionRegistry();
    assert.throws(() => registry.register(1024.5, "frac", false, noop, callDef), /non-negative integer/);
  });

  test("rejects a target-owner id outside the target range", () => {
    const registry = new FunctionRegistry();
    assert.throws(
      () => registry.register(TARGET_FUNC_ID_BASE - 1, "low", false, noop, callDef),
      /outside the target range/
    );
    assert.throws(
      () => registry.register(DYNAMIC_FUNC_ID_BASE, "high", false, noop, callDef),
      /outside the target range/
    );
  });

  test("rejects a core-owner id at or above TARGET_FUNC_ID_BASE", () => {
    const registry = new FunctionRegistry();
    assert.throws(
      () => registry.withOwner("core", () => registry.register(TARGET_FUNC_ID_BASE, "high", false, noop, callDef)),
      /outside the core range/
    );
  });

  test("rejects a dynamic-owner id below DYNAMIC_FUNC_ID_BASE", () => {
    const registry = new FunctionRegistry();
    assert.throws(
      () =>
        registry.withOwner("dynamic", () =>
          registry.register(DYNAMIC_FUNC_ID_BASE - 1, "low-dynamic", false, noop, callDef)
        ),
      /below the dynamic range base/
    );
  });

  test("withOwner restores the previous owner after body throws", () => {
    const registry = new FunctionRegistry();
    assert.throws(() =>
      registry.withOwner("core", () => {
        throw new Error("boom");
      })
    );
    registry.register(1024, "target-after", false, noop, callDef);
    assert.equal(registry.getSyncById(1024)?.name, "target-after");
  });

  test("accepts owner-appropriate ids in each range", () => {
    const registry = new FunctionRegistry();
    registry.withOwner("core", () => registry.register(0, "core-fn", false, noop, callDef));
    registry.register(TARGET_FUNC_ID_BASE, "target-fn", false, noop, callDef);
    registry.withOwner("dynamic", () => registry.register(DYNAMIC_FUNC_ID_BASE, "dynamic-fn", false, noop, callDef));

    assert.equal(registry.getSyncById(0)?.name, "core-fn");
    assert.equal(registry.getSyncById(TARGET_FUNC_ID_BASE)?.name, "target-fn");
    assert.equal(registry.getSyncById(DYNAMIC_FUNC_ID_BASE)?.name, "dynamic-fn");
  });
});
