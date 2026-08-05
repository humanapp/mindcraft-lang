/**
 * Unit tests for {@link createProgramServices} and
 * {@link createRuleVariableServices}, the dense-state factories that back
 * `PlatformServices.program` and `PlatformServices.ruleVars` for a brain.
 *
 * The first compiled rule on page 0 lands on funcId 0; any "0 means no rule"
 * sentinel silently drops every rule-variable read/write originating from
 * that rule. The only sentinel for "no rule" is `undefined`.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Dict, List, UniqueSet } from "@mindcraft-lang/core";
import {
  createProgramServices,
  createRuleVariableServices,
  mkNumberValue,
  mkStringValue,
  NIL_VALUE,
  type Program,
  type ProgramTypeEntry,
  type RuleVariableStores,
  type Value,
} from "@mindcraft-lang/core/runtime";

function makeProgram(opts: {
  ruleFuncIds?: UniqueSet<number>;
  ruleAncestors?: Dict<number, number>;
  types?: List<ProgramTypeEntry>;
}): Program {
  return {
    version: 1,
    functions: List.empty(),
    constantPools: { numbers: List.empty(), strings: List.empty(), values: List.empty() },
    variableNames: List.empty(),
    ruleFuncIds: opts.ruleFuncIds,
    ruleAncestors: opts.ruleAncestors,
    types: opts.types,
  };
}

function ruleSet(...ids: readonly number[]): UniqueSet<number> {
  const s = new UniqueSet<number>();
  for (const id of ids) s.add(id);
  return s;
}

function ancestorMap(...pairs: readonly (readonly [number, number])[]): Dict<number, number> {
  const d = new Dict<number, number>();
  for (const [child, parent] of pairs) d.set(child, parent);
  return d;
}

describe("createProgramServices", () => {
  test("returns funcId for known rule entries", () => {
    const program = makeProgram({ ruleFuncIds: ruleSet(0, 3, 7) });
    const services = createProgramServices(program, List.empty());
    assert.equal(services.getRuleFuncIdForFunc(0), 0);
    assert.equal(services.getRuleFuncIdForFunc(3), 3);
    assert.equal(services.getRuleFuncIdForFunc(7), 7);
  });

  test("returns undefined for non-rule funcIds", () => {
    const program = makeProgram({ ruleFuncIds: ruleSet(1, 2) });
    const services = createProgramServices(program, List.empty());
    assert.equal(services.getRuleFuncIdForFunc(0), undefined);
    assert.equal(services.getRuleFuncIdForFunc(99), undefined);
  });

  test("returns undefined for every funcId when ruleFuncIds is absent", () => {
    const program = makeProgram({});
    const services = createProgramServices(program, List.empty());
    assert.equal(services.getRuleFuncIdForFunc(0), undefined);
    assert.equal(services.getRuleFuncIdForFunc(5), undefined);
  });

  test("resolves enum symbol values through the program type table", () => {
    const types = List.from<ProgramTypeEntry>([
      {
        tag: "enum",
        typeId: "enum:</m.ts::Mode>",
        name: "/m.ts::Mode",
        symbols: List.from([
          { key: "Stop", value: 0 },
          { key: "Go", value: 2 },
        ]),
      },
      {
        tag: "enum",
        typeId: "enum:</m.ts::Label>",
        name: "/m.ts::Label",
        symbols: List.from([{ key: "Ready", value: "ready" }]),
      },
    ]);
    const services = createProgramServices(makeProgram({ types }), List.empty());
    assert.equal(services.getEnumSymbolValue("enum:</m.ts::Mode>", "Go"), 2);
    assert.equal(services.getEnumSymbolValue("enum:</m.ts::Mode>", "Stop"), 0);
    assert.equal(services.getEnumSymbolValue("enum:</m.ts::Label>", "Ready"), "ready");
    assert.equal(services.getEnumSymbolValue("enum:</m.ts::Mode>", "Missing"), undefined);
    assert.equal(services.getEnumSymbolValue("enum:</m.ts::Absent>", "Go"), undefined);
  });

  test("returns undefined for enum symbol values when the program has no type table", () => {
    const services = createProgramServices(makeProgram({}), List.empty());
    assert.equal(services.getEnumSymbolValue("enum:</m.ts::Mode>", "Go"), undefined);
  });
});

describe("createRuleVariableServices", () => {
  function build(opts: { ruleAncestors?: Dict<number, number> } = {}): {
    stores: RuleVariableStores;
    ruleVars: ReturnType<typeof createRuleVariableServices>;
  } {
    const stores: RuleVariableStores = new Dict();
    const program = makeProgram({ ruleAncestors: opts.ruleAncestors });
    return { stores, ruleVars: createRuleVariableServices(program, stores) };
  }

  test("setByName then getByName roundtrips for funcId 0 (regression)", () => {
    const { ruleVars } = build();
    const value = mkNumberValue(42);
    ruleVars.setByName(0, "targetActor", value);
    assert.deepEqual(ruleVars.getByName(0, "targetActor"), value);
  });

  test("setByName / getByName roundtrips for funcId 1 and higher", () => {
    const { ruleVars } = build();
    ruleVars.setByName(1, "a", mkNumberValue(10));
    ruleVars.setByName(2, "a", mkNumberValue(20));
    ruleVars.setByName(5, "a", mkStringValue("five"));
    assert.deepEqual(ruleVars.getByName(1, "a"), mkNumberValue(10));
    assert.deepEqual(ruleVars.getByName(2, "a"), mkNumberValue(20));
    assert.deepEqual(ruleVars.getByName(5, "a"), mkStringValue("five"));
  });

  test("clearByName removes the value at funcId 0 (regression)", () => {
    const { ruleVars } = build();
    ruleVars.setByName(0, "x", mkNumberValue(1));
    ruleVars.clearByName(0, "x");
    assert.deepEqual(ruleVars.getByName(0, "x"), NIL_VALUE);
  });

  test("getByName for an unwritten variable returns NIL_VALUE", () => {
    const { ruleVars } = build();
    assert.deepEqual(ruleVars.getByName(0, "missing"), NIL_VALUE);
    assert.deepEqual(ruleVars.getByName(1, "missing"), NIL_VALUE);
  });

  test("getByName with ruleFuncId === undefined returns NIL_VALUE", () => {
    const { ruleVars } = build();
    assert.deepEqual(ruleVars.getByName(undefined, "anything"), NIL_VALUE);
  });

  test("setByName with ruleFuncId === undefined is a no-op", () => {
    const { stores, ruleVars } = build();
    ruleVars.setByName(undefined, "x", mkNumberValue(1));
    assert.equal(stores.size(), 0);
  });

  test("clearByName with ruleFuncId === undefined is a no-op", () => {
    const { stores, ruleVars } = build();
    ruleVars.setByName(0, "x", mkNumberValue(9));
    ruleVars.clearByName(undefined, "x");
    assert.deepEqual(ruleVars.getByName(0, "x"), mkNumberValue(9));
    assert.equal(stores.get(0)!.has("x"), true);
  });

  test("rule var stores are isolated across funcIds (no cross-talk)", () => {
    const { ruleVars } = build();
    ruleVars.setByName(0, "shared", mkNumberValue(100));
    ruleVars.setByName(1, "shared", mkNumberValue(200));
    assert.deepEqual(ruleVars.getByName(0, "shared"), mkNumberValue(100));
    assert.deepEqual(ruleVars.getByName(1, "shared"), mkNumberValue(200));
  });

  test("child rule reads inherit ancestor's rule variable", () => {
    const { ruleVars } = build({ ruleAncestors: ancestorMap([11, 10]) });
    ruleVars.setByName(10, "inherited", mkNumberValue(123));
    assert.deepEqual(ruleVars.getByName(11, "inherited"), mkNumberValue(123));
  });

  test("child rule write does not leak into the parent's storage", () => {
    const { ruleVars } = build({ ruleAncestors: ancestorMap([11, 10]) });
    ruleVars.setByName(11, "scoped", mkNumberValue(7));
    assert.deepEqual(ruleVars.getByName(11, "scoped"), mkNumberValue(7));
    assert.deepEqual(ruleVars.getByName(10, "scoped"), NIL_VALUE);
  });

  test("child rule's own value shadows the parent's value of the same name", () => {
    const { ruleVars } = build({ ruleAncestors: ancestorMap([11, 10]) });
    ruleVars.setByName(10, "x", mkNumberValue(1));
    ruleVars.setByName(11, "x", mkNumberValue(2));
    assert.deepEqual(ruleVars.getByName(10, "x"), mkNumberValue(1));
    assert.deepEqual(ruleVars.getByName(11, "x"), mkNumberValue(2));
  });

  test("ancestor walk traverses multiple generations", () => {
    // funcId 12 -> 11 -> 10 (root)
    const { ruleVars } = build({
      ruleAncestors: ancestorMap([11, 10], [12, 11]),
    });
    ruleVars.setByName(10, "deep", mkNumberValue(999));
    assert.deepEqual(ruleVars.getByName(12, "deep"), mkNumberValue(999));
  });

  test("clearByName on a child does not touch the parent's value", () => {
    const { ruleVars } = build({ ruleAncestors: ancestorMap([11, 10]) });
    ruleVars.setByName(10, "x", mkNumberValue(1));
    ruleVars.setByName(11, "x", mkNumberValue(2));
    ruleVars.clearByName(11, "x");
    // After clearing the child's own value, the read walks up to the parent.
    assert.deepEqual(ruleVars.getByName(11, "x"), mkNumberValue(1));
    assert.deepEqual(ruleVars.getByName(10, "x"), mkNumberValue(1));
  });

  test("getByName on an unknown funcId with no ancestors returns NIL_VALUE", () => {
    const { ruleVars } = build();
    const _v: Value = ruleVars.getByName(99, "x");
    assert.deepEqual(_v, NIL_VALUE);
  });
});
