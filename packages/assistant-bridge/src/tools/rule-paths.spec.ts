import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { createTargetAdapter } from "../testing/index.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { createAuthoringWorkspace, findRule, locateRules, ruleIdsByPath } from "./workspace.js";

/**
 * A workspace whose first page carries a nested rule tree: two top-level rules,
 * the first with two children and a grandchild under the second of them.
 */
function nestedWorkspace(): AuthoringWorkspace {
  const ws = createAuthoringWorkspace(createTargetAdapter(), "nested brain");
  const page = ws.brainDef.pages().get(0) as BrainPageDef;
  const first = page.children().get(0) as BrainRuleDef;
  first.appendNewRule();
  const secondChild = first.appendNewRule();
  secondChild.appendNewRule();
  const second = page.appendNewRule();
  second.appendNewRule();
  return ws;
}

/** Rule paths the compiler keyed its rule index by, ordered by function id. */
function compilerRulePaths(ws: AuthoringWorkspace): string[] {
  const build = ws.environment.linkBrain(ws.brainDef);
  assert.ok(build.program, "the nested document links");
  const byFuncId: string[] = [];
  build.program.ruleIndex.forEach((funcId, rulePath) => {
    byFuncId[funcId] = rulePath;
  });
  return byFuncId;
}

describe("rule addressing across the compiler and the bridge", () => {
  test("reads every rule of a nested document at the path the compiler keys it by", () => {
    const ws = nestedWorkspace();

    const bridgePaths = locateRules(ws.brainDef).map((located) => located.rulePath);

    assert.equal(bridgePaths.length, 6);
    assert.deepEqual(bridgePaths, compilerRulePaths(ws));
  });

  test("resolves every path the compiler reports to a rule the document holds", () => {
    const ws = nestedWorkspace();
    const byPath = ruleIdsByPath(ws.brainDef);

    for (const rulePath of compilerRulePaths(ws)) {
      const ruleId = byPath.get(rulePath);
      assert.ok(ruleId, rulePath);
      assert.ok(findRule(ws.brainDef, ruleId), ruleId);
    }
  });

  test("gives every rule of the document its own id", () => {
    const ws = nestedWorkspace();

    const ruleIds = locateRules(ws.brainDef).map((located) => located.ruleId);

    assert.equal(new Set(ruleIds).size, ruleIds.length);
  });

  test("keeps each rule's id where inserting a rule above it moves every path below", () => {
    const ws = nestedWorkspace();
    const page = ws.brainDef.pages().get(0) as BrainPageDef;
    const before = locateRules(ws.brainDef);

    page.addRuleAtIndex(0, page.appendNewRule() as BrainRuleDef);

    const after = new Map(locateRules(ws.brainDef).map((located) => [located.ruleId, located.rulePath]));
    for (const located of before) {
      assert.ok(after.has(located.ruleId), "the rule is still addressed by the id it had");
      assert.notEqual(after.get(located.ruleId), located.rulePath, "and its path has moved");
    }
  });
});
