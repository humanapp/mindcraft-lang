import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type ActionDescriptor,
  BrainActionRegistry,
  type HostActionBinding,
  mkCallDef,
  NIL_VALUE,
  TARGET_ACTION_ID_BASE,
} from "@wendoo/core/runtime";

function mkHostAction(key: string, id: number, isAsync = false): HostActionBinding {
  const descriptor: ActionDescriptor = {
    key,
    kind: "sensor",
    callDef: mkCallDef({ type: "seq", items: [] }),
    isAsync,
  };
  const binding: HostActionBinding = { binding: "host", id, descriptor };
  if (isAsync) {
    binding.execAsync = () => undefined;
  } else {
    binding.execSync = () => NIL_VALUE;
  }
  return binding;
}

describe("BrainActionRegistry id assignment", () => {
  test("registers host actions under their author-assigned ids", () => {
    const registry = new BrainActionRegistry();
    const a = registry.register(mkHostAction("a", 1700));
    const b = registry.register(mkHostAction("b", 1810));
    const c = registry.register(mkHostAction("c", 1923, true));

    assert.equal(a.binding === "host" ? a.id : undefined, 1700);
    assert.equal(b.binding === "host" ? b.id : undefined, 1810);
    assert.equal(c.binding === "host" ? c.id : undefined, 1923);
    assert.equal(registry.size(), 3);
  });

  test("getById returns the same action as getByKey", () => {
    const registry = new BrainActionRegistry();
    registry.register(mkHostAction("first", 1024));
    registry.register(mkHostAction("second", 1025));

    assert.equal(registry.getById(1024), registry.getByKey("first"));
    assert.equal(registry.getById(1025), registry.getByKey("second"));
  });

  test("getById returns undefined for an unassigned id", () => {
    const registry = new BrainActionRegistry();
    registry.register(mkHostAction("only", 1024));

    assert.equal(registry.getById(1025), undefined);
    assert.equal(registry.getById(-1), undefined);
  });

  test("rejects a duplicate key", () => {
    const registry = new BrainActionRegistry();
    registry.register(mkHostAction("dup", 1024));
    assert.throws(() => registry.register(mkHostAction("dup", 1025)));
  });
});

describe("BrainActionRegistry id validation", () => {
  test("rejects a duplicate id", () => {
    const registry = new BrainActionRegistry();
    registry.register(mkHostAction("first", 1024));
    assert.throws(() => registry.register(mkHostAction("second", 1024)), /reuses id 1024/);
  });

  test("rejects a negative id", () => {
    const registry = new BrainActionRegistry();
    assert.throws(() => registry.register(mkHostAction("neg", -1)), /non-negative integer/);
  });

  test("rejects a fractional id", () => {
    const registry = new BrainActionRegistry();
    assert.throws(() => registry.register(mkHostAction("frac", 1024.5)), /non-negative integer/);
  });

  test("rejects a target-owner id below TARGET_ACTION_ID_BASE", () => {
    const registry = new BrainActionRegistry();
    assert.throws(
      () => registry.register(mkHostAction("low", TARGET_ACTION_ID_BASE - 1)),
      /below the target range base/
    );
  });

  test("rejects a core-owner id at or above TARGET_ACTION_ID_BASE", () => {
    const registry = new BrainActionRegistry();
    assert.throws(
      () => registry.withOwner("core", () => registry.register(mkHostAction("high", TARGET_ACTION_ID_BASE))),
      /outside the core range/
    );
  });

  test("accepts core-owner ids inside the core range and restores the previous owner", () => {
    const registry = new BrainActionRegistry();
    registry.withOwner("core", () => registry.register(mkHostAction("core-action", 0)));
    assert.equal(registry.getById(0), registry.getByKey("core-action"));
    assert.throws(() => registry.register(mkHostAction("target-low", 1)), /below the target range base/);
  });
});
