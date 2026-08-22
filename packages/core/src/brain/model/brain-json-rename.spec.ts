import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PersistedBrainJson } from "@wendoo-lang/core/app";
import { renameBrainNamespaces } from "@wendoo-lang/core/app";

const SOURCE = "example-org/cutebot";
const TARGET = "example-org/cutebot-chassis";
const OTHER = "other-org/unrelated";

/**
 * A persisted brain that references library symbols from two namespaces: an
 * action tile, an arg tile, and a named type from SOURCE (nested in an accessor
 * and a nullable), plus one action tile and one named type from OTHER. Ids,
 * files, and bindings are the stable identity a rename must preserve.
 */
function fixtureBrain(): PersistedBrainJson {
  return {
    version: 1,
    id: "brain-1",
    name: "Robot Brain",
    catalog: [
      {
        version: 1,
        kind: "variable",
        varName: "speed",
        varType: { k: "nullable", base: { k: "named", t: "struct", name: "/index.ts::Speed", ns: SOURCE } },
        uniqueId: "u1",
      },
    ],
    pages: [
      {
        version: 2,
        pageId: "page-1",
        name: "Page 1",
        rules: [
          {
            version: 1,
            when: [{ k: "action", area: "sensor", id: "aaa111", ns: SOURCE }],
            do: [
              { k: "arg", area: "parameter", action: "bbb222", name: "power", ns: SOURCE },
              {
                k: "accessor",
                type: { k: "named", t: "struct", name: "/index.ts::Speed", ns: SOURCE },
                field: "value",
              },
              { k: "action", area: "actuator", id: "ccc333", ns: OTHER },
            ],
            children: [
              {
                version: 1,
                when: [{ k: "action", area: "sensor", id: "ddd444", ns: SOURCE }],
                do: [],
                children: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("renameBrainNamespaces", () => {
  const renameSourceToTarget = (ns: string): string => (ns === SOURCE ? TARGET : ns);

  it("rewrites every SOURCE namespace prefix to TARGET, preserving stable ids", () => {
    const result = renameBrainNamespaces(fixtureBrain(), renameSourceToTarget);
    assert.equal(result.changed, true);

    const rule = result.brain.pages[0].rules[0];
    // Tile refs: action and arg carry ns rewritten SOURCE -> TARGET, id/action/name intact.
    assert.deepStrictEqual(rule.when[0], { k: "action", area: "sensor", id: "aaa111", ns: TARGET });
    assert.deepStrictEqual(rule.do[0], { k: "arg", area: "parameter", action: "bbb222", name: "power", ns: TARGET });
    // Nested type ref inside an accessor tile ref.
    assert.deepStrictEqual(rule.do[1], {
      k: "accessor",
      type: { k: "named", t: "struct", name: "/index.ts::Speed", ns: TARGET },
      field: "value",
    });
    // A ref from an unrelated namespace is untouched.
    assert.deepStrictEqual(rule.do[2], { k: "action", area: "actuator", id: "ccc333", ns: OTHER });
    // Child rule rewritten too.
    assert.deepStrictEqual(rule.children[0].when[0], { k: "action", area: "sensor", id: "ddd444", ns: TARGET });
    // Catalog type ref nested in a nullable.
    const varEntry = result.brain.catalog[0];
    assert.ok(varEntry.kind === "variable");
    assert.deepStrictEqual(varEntry.varType, {
      k: "nullable",
      base: { k: "named", t: "struct", name: "/index.ts::Speed", ns: TARGET },
    });
  });

  it("reports no change and returns the same object when no referenced namespace matches", () => {
    const brain = fixtureBrain();
    const result = renameBrainNamespaces(brain, (ns) => (ns === "no-such/coordinate" ? "x/y" : ns));
    assert.equal(result.changed, false);
    assert.equal(result.brain, brain);
  });

  it("leaves a brain with no foreign references unchanged", () => {
    const brain: PersistedBrainJson = {
      version: 1,
      id: "brain-2",
      name: "Empty",
      catalog: [],
      pages: [{ version: 2, pageId: "p", name: "P", rules: [] }],
    };
    const result = renameBrainNamespaces(brain, renameSourceToTarget);
    assert.equal(result.changed, false);
    assert.equal(result.brain, brain);
  });
});
