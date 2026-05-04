/**
 * Unit tests for {@link createCallsiteStore}: the brain-instance-scoped
 * storage primitive that backs the unified `services.callsite` adapter.
 * These tests cover the storage surface in isolation, independent of the
 * runtime-services projection.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createCallsiteStore, mkNumberValue, mkStringValue, NIL_VALUE } from "@mindcraft-lang/core/runtime";

describe("createCallsiteStore -- allocate / reset", () => {
  test("ensure returns true on first call, false thereafter", () => {
    const store = createCallsiteStore();
    assert.equal(store.ensure(1), true);
    assert.equal(store.ensure(1), false);
    assert.equal(store.ensure(1), false);
  });

  test("reset deallocates so the next ensure returns true again", () => {
    const store = createCallsiteStore();
    store.ensure(2);
    store.setSlot(2, 0, mkNumberValue(7));
    store.reset(2);
    assert.equal(store.ensure(2), true);
    assert.deepEqual(store.getSlot(2, 0), NIL_VALUE);
  });

  test("clearAll drops every record and re-arms first-touch detection", () => {
    const store = createCallsiteStore();
    store.ensure(3);
    store.ensure(4);
    store.setSlot(3, 0, mkNumberValue(1));
    store.setHostState(4, "payload");
    store.clearAll();
    assert.equal(store.ensure(3), true);
    assert.equal(store.ensure(4), true);
    assert.deepEqual(store.getSlot(3, 0), NIL_VALUE);
    assert.equal(store.getHostState(4), undefined);
  });
});

describe("createCallsiteStore -- state slots", () => {
  test("setSlot / getSlot round-trip", () => {
    const store = createCallsiteStore();
    store.setSlot(10, 1, mkNumberValue(42));
    assert.deepEqual(store.getSlot(10, 1), mkNumberValue(42));
    store.setSlot(10, 2, mkStringValue("x"));
    assert.deepEqual(store.getSlot(10, 1), mkNumberValue(42));
    assert.deepEqual(store.getSlot(10, 2), mkStringValue("x"));
  });

  test("setSlot auto-allocates the callsite", () => {
    const store = createCallsiteStore();
    store.setSlot(20, 0, mkNumberValue(1));
    assert.equal(store.ensure(20), false);
  });

  test("setSlot grows the slot list on demand", () => {
    const store = createCallsiteStore();
    store.setSlot(30, 4, mkNumberValue(9));
    assert.deepEqual(store.getSlot(30, 0), NIL_VALUE);
    assert.deepEqual(store.getSlot(30, 3), NIL_VALUE);
    assert.deepEqual(store.getSlot(30, 4), mkNumberValue(9));
    assert.deepEqual(store.getSlot(30, 99), NIL_VALUE);
  });

  test("getSlot on an unallocated callsite does not allocate", () => {
    const store = createCallsiteStore();
    assert.deepEqual(store.getSlot(40, 0), NIL_VALUE);
    assert.equal(store.ensure(40), true);
  });

  test("distinct callSiteIds do not alias state slots", () => {
    const store = createCallsiteStore();
    store.setSlot(5, 0, mkNumberValue(100));
    store.setSlot(6, 0, mkNumberValue(200));
    assert.deepEqual(store.getSlot(5, 0), mkNumberValue(100));
    assert.deepEqual(store.getSlot(6, 0), mkNumberValue(200));
  });
});

describe("createCallsiteStore -- host state", () => {
  test("setHostState / getHostState round-trip preserves the stored reference", () => {
    const store = createCallsiteStore();
    const payload = { foo: 1 };
    store.setHostState(50, payload);
    assert.equal(store.getHostState(50), payload);
  });

  test("clearHostState drops host state but leaves slots intact", () => {
    const store = createCallsiteStore();
    store.setSlot(60, 0, mkNumberValue(7));
    store.setHostState(60, "payload");
    store.clearHostState(60);
    assert.equal(store.getHostState(60), undefined);
    assert.deepEqual(store.getSlot(60, 0), mkNumberValue(7));
  });

  test("distinct callSiteIds do not alias host state", () => {
    const store = createCallsiteStore();
    store.setHostState(70, "a");
    store.setHostState(71, "b");
    assert.equal(store.getHostState(70), "a");
    assert.equal(store.getHostState(71), "b");
  });
});
