/**
 * Tests for List.subview() -- the ReadonlyList<T> subrange view.
 *
 * Roblox-ts copy semantics are documented in list.rbx.ts and verified by
 * `npm run build` (rbxtsc). The Node implementation is a zero-copy view;
 * tests below confirm that mutations to the underlying List are visible
 * through the view.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { List, type ReadonlyList } from "@mindcraft-lang/core";

describe("List.subview -- basic addressing", () => {
  test("size() returns count", () => {
    const list = List.from([10, 20, 30, 40, 50]);
    const view = list.subview(1, 3);
    assert.equal(view.size(), 3);
  });

  test("isEmpty() is false for non-empty view", () => {
    const list = List.from([1, 2, 3]);
    assert.equal(list.subview(0, 2).isEmpty(), false);
  });

  test("isEmpty() is true for empty view", () => {
    const list = List.from([1, 2, 3]);
    assert.equal(list.subview(1, 0).isEmpty(), true);
  });

  test("get(i) returns element at start+i in the underlying list", () => {
    const list = List.from([10, 20, 30, 40, 50]);
    const view = list.subview(1, 3);
    assert.equal(view.get(0), 20);
    assert.equal(view.get(1), 30);
    assert.equal(view.get(2), 40);
  });

  test("forEach iterates only the view range with view-local indices", () => {
    const list = List.from([10, 20, 30, 40, 50]);
    const view = list.subview(2, 2);
    const seen: [number, number][] = [];
    view.forEach((v, i) => {
      seen.push([v, i]);
    });
    assert.deepEqual(seen, [
      [30, 0],
      [40, 1],
    ]);
  });

  test("map returns new list scoped to the view", () => {
    const list = List.from([10, 20, 30, 40]);
    const view = list.subview(1, 2);
    const mapped = view.map((v) => v * 2);
    assert.equal(mapped.size(), 2);
    assert.equal(mapped.get(0), 40);
    assert.equal(mapped.get(1), 60);
  });

  test("filter returns new list scoped to the view", () => {
    const list = List.from([1, 2, 3, 4, 5]);
    const view = list.subview(1, 3); // [2, 3, 4]
    const filtered = view.filter((v) => v % 2 === 0);
    assert.equal(filtered.size(), 2);
    assert.equal(filtered.get(0), 2);
    assert.equal(filtered.get(1), 4);
  });

  test("find returns value within the view", () => {
    const list = List.from([1, 2, 3, 4, 5]);
    const view = list.subview(2, 3);
    assert.equal(
      view.find((v) => v === 4),
      4
    );
    assert.equal(
      view.find((v) => v === 1),
      undefined
    );
  });

  test("findIndex returns view-local index", () => {
    const list = List.from([1, 2, 3, 4, 5]);
    const view = list.subview(2, 3); // [3, 4, 5]
    assert.equal(
      view.findIndex((v) => v > 3),
      1
    );
    assert.equal(
      view.findIndex((v) => v > 10),
      -1
    );
  });

  test("indexOf returns view-local index", () => {
    const list = List.from([10, 20, 30, 40, 50]);
    const view = list.subview(1, 3);
    assert.equal(view.indexOf(20), 0);
    assert.equal(view.indexOf(40), 2);
    assert.equal(view.indexOf(50), -1);
  });

  test("contains returns true only for values inside the view", () => {
    const list = List.from([10, 20, 30, 40, 50]);
    const view = list.subview(1, 3);
    assert.equal(view.contains(30), true);
    assert.equal(view.contains(50), false);
  });

  test("slice materializes a fresh List scoped to the view", () => {
    const list = List.from([10, 20, 30, 40, 50]);
    const view = list.subview(1, 3);
    const sliced = view.slice(1, 3);
    assert.equal(sliced.size(), 2);
    assert.equal(sliced.get(0), 30);
    assert.equal(sliced.get(1), 40);
  });

  test("toArray materializes the view window", () => {
    const list = List.from([10, 20, 30, 40, 50]);
    const view = list.subview(1, 3);
    assert.deepEqual(view.toArray(), [20, 30, 40]);
  });
});

describe("List.subview -- bounds", () => {
  test("subview(0, size()) returns a full-range view", () => {
    const list = List.from([1, 2, 3]);
    const view = list.subview(0, 3);
    assert.equal(view.size(), 3);
    assert.equal(view.get(0), 1);
    assert.equal(view.get(2), 3);
  });

  test("subview(0, 0) returns an empty view", () => {
    const list = List.from([1, 2, 3]);
    const view = list.subview(0, 0);
    assert.equal(view.size(), 0);
    assert.equal(view.isEmpty(), true);
  });

  test("subview on an empty list with (0, 0) is valid", () => {
    const list = List.empty<number>();
    const view = list.subview(0, 0);
    assert.equal(view.size(), 0);
  });

  test("negative start faults", () => {
    const list = List.from([1, 2, 3]);
    assert.throws(() => list.subview(-1, 2));
  });

  test("negative count faults", () => {
    const list = List.from([1, 2, 3]);
    assert.throws(() => list.subview(0, -1));
  });

  test("start + count > size() faults", () => {
    const list = List.from([1, 2, 3]);
    assert.throws(() => list.subview(2, 2));
  });

  test("start == size(), count == 0 is valid (empty view at end)", () => {
    const list = List.from([1, 2, 3]);
    const view = list.subview(3, 0);
    assert.equal(view.size(), 0);
  });

  test("get out of range on a view faults", () => {
    const list = List.from([1, 2, 3]);
    const view = list.subview(0, 2);
    assert.throws(() => view.get(2));
    assert.throws(() => view.get(-1));
  });
});

describe("List.subview -- Node view semantics (mutations are visible)", () => {
  test("mutations to the underlying List are reflected through the view", () => {
    const list = List.from([10, 20, 30, 40, 50]);
    const view: ReadonlyList<number> = list.subview(1, 3);

    assert.equal(view.get(1), 30);
    list.set(2, 99);
    assert.equal(view.get(1), 99);
  });

  test("push to underlying list beyond view range does not affect view size", () => {
    const list = List.from([1, 2, 3, 4]);
    const view = list.subview(0, 2);
    list.push(5);
    assert.equal(view.size(), 2);
    assert.equal(view.get(0), 1);
    assert.equal(view.get(1), 2);
  });
});

describe("List.subview -- subview of subview", () => {
  test("subview chaining addresses the original list correctly", () => {
    const list = List.from([0, 10, 20, 30, 40, 50]);
    const outer = list.subview(1, 4);
    const inner = outer.subview(1, 2);
    assert.equal(inner.size(), 2);
    assert.equal(inner.get(0), 20);
    assert.equal(inner.get(1), 30);
  });
});

describe("List.subview -- reduce", () => {
  test("reduce without initial sums within the view", () => {
    const list = List.from([1, 2, 3, 4, 5]);
    const view = list.subview(1, 3);
    const sum = view.reduce((acc, v) => acc + v);
    assert.equal(sum, 9);
  });

  test("reduce with initial sums within the view", () => {
    const list = List.from([1, 2, 3, 4, 5]);
    const view = list.subview(1, 3);
    const sum = view.reduce((acc, v) => acc + v, 100);
    assert.equal(sum, 109);
  });
});
