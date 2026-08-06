import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { createTargetAdapter } from "../testing/index.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { createAuthoringWorkspace, findRule, locateRules } from "./workspace.js";

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
  test("gives every rule of a nested document the same path on both sides", () => {
    const ws = nestedWorkspace();

    const bridgePaths = locateRules(ws.brainDef).map((located) => located.ruleId);

    assert.equal(bridgePaths.length, 6);
    assert.deepEqual(bridgePaths, compilerRulePaths(ws));
  });

  test("resolves every path the compiler reports back to a rule of the document", () => {
    const ws = nestedWorkspace();

    for (const rulePath of compilerRulePaths(ws)) {
      assert.ok(findRule(ws.brainDef, rulePath), rulePath);
    }
  });
});
