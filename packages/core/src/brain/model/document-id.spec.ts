import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import type { BrainJson, BrainPageDef, RuleJson } from "@wendoo-lang/core/brain/model";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import type { IRngServices } from "@wendoo-lang/core/runtime";

/** A linear-congruential [0,1) stream, so a run started from `seed` repeats exactly. */
function seededRng(seed: number): IRngServices {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    },
  };
}

/**
 * Builds the same document -- two pages, nested rules -- in an environment
 * whose random stream starts at `seed`, and returns its serialized form.
 */
function buildDocument(seed: number): BrainJson {
  const services = __test__createBrainServices({ rng: seededRng(seed) });
  const brain = BrainDef.emptyBrainDef(services, "Seeded Brain");
  const firstPage = brain.pages().get(0) as BrainPageDef;
  const parent = firstPage.appendNewRule();
  parent.appendNewRule();
  firstPage.appendNewRule();
  brain.appendNewPage();
  return brain.toJson();
}

/** The brain id, every page id, and every rule id of `json`, in document order. */
function documentIds(json: BrainJson): string[] {
  const ids: string[] = [json.id ?? ""];
  const visitRules = (rules: readonly RuleJson[]): void => {
    for (const rule of rules) {
      ids.push(rule.ruleId ?? "");
      visitRules(rule.children.toArray());
    }
  };
  for (const page of json.pages.toArray()) {
    ids.push(page.pageId);
    visitRules(page.rules.toArray());
  }
  return ids;
}

describe("document ids are drawn from the environment's random stream", () => {
  test("the same seed builds the same document, ids and all, every time", () => {
    const first = buildDocument(7);
    const second = buildDocument(7);

    assert.deepEqual(documentIds(second), documentIds(first));
    assert.equal(JSON.stringify(second), JSON.stringify(first));
  });

  test("every id in the document is a distinct non-empty value", () => {
    const ids = documentIds(buildDocument(7));

    assert.equal(ids.length, 8, "one brain id, two page ids, and five rule ids");
    for (const id of ids) assert.ok(id.length > 0);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("a different seed builds the same document under different ids", () => {
    const ids = documentIds(buildDocument(7));
    const otherIds = documentIds(buildDocument(8));

    assert.equal(otherIds.length, ids.length);
    assert.equal(new Set([...ids, ...otherIds]).size, ids.length + otherIds.length);
  });
});
