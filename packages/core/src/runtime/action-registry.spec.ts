import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type ActionDescriptor,
  BrainActionRegistry,
  type HostActionBinding,
  mkCallDef,
  NIL_VALUE,
} from "@mindcraft-lang/core/runtime";

function mkHostAction(key: string, isAsync = false): HostActionBinding {
  const descriptor: ActionDescriptor = {
    key,
    kind: "sensor",
    callDef: mkCallDef({ type: "seq", items: [] }),
    isAsync,
  };
  const binding: HostActionBinding = { binding: "host", descriptor };
  if (isAsync) {
    binding.execAsync = () => undefined;
  } else {
    binding.execSync = () => NIL_VALUE;
  }
  return binding;
}

describe("BrainActionRegistry id assignment", () => {
  test("assigns dense ids in registration order", () => {
    const registry = new BrainActionRegistry();
    const a = registry.register(mkHostAction("a"));
    const b = registry.register(mkHostAction("b"));
    const c = registry.register(mkHostAction("c", true));

    assert.equal(a.binding === "host" ? a.id : undefined, 0);
    assert.equal(b.binding === "host" ? b.id : undefined, 1);
    assert.equal(c.binding === "host" ? c.id : undefined, 2);
    assert.equal(registry.size(), 3);
  });

  test("getById returns the same action as getByKey", () => {
    const registry = new BrainActionRegistry();
    registry.register(mkHostAction("first"));
    registry.register(mkHostAction("second"));

    assert.equal(registry.getById(0), registry.getByKey("first"));
    assert.equal(registry.getById(1), registry.getByKey("second"));
  });

  test("getById returns undefined for an unassigned id", () => {
    const registry = new BrainActionRegistry();
    registry.register(mkHostAction("only"));

    assert.equal(registry.getById(1), undefined);
    assert.equal(registry.getById(-1), undefined);
  });

  test("rejects a duplicate key", () => {
    const registry = new BrainActionRegistry();
    registry.register(mkHostAction("dup"));
    assert.throws(() => registry.register(mkHostAction("dup")));
  });
});
