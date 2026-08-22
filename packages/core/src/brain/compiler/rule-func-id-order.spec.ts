/**
 * Pins the ordering property of the rule funcIds the brain compiler assigns:
 * a pre-order depth-first walk in document order. Two consequences follow, and
 * runtime code that recovers document structure from funcIds alone depends on
 * both:
 *
 * - sibling rules' funcIds increase in document order at every level;
 * - a rule's funcId is smaller than every funcId in its subtree, so a
 *   descendant can never be mistaken for a preceding sibling.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { type Dict, List } from "@wendoo-lang/core";
import type { BrainServices, IBrainRuleDef } from "@wendoo-lang/core/brain";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import { compileBrain, runBrainLinkPipeline } from "@wendoo-lang/core/brain/compiler";
import { BrainDef, type BrainRuleDef } from "@wendoo-lang/core/brain/model";
import type { BrainLinkEnvironment } from "@wendoo-lang/core/runtime";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

/** Appends a child rule to `rule` and returns it. */
function addChild(rule: IBrainRuleDef): BrainRuleDef {
  return (rule as BrainRuleDef).appendNewRule();
}

/**
 * A two-page brain whose rules nest three levels deep with several siblings at
 * each level. Rule paths are `pageIndex/ruleIndex[/childIndex...]`, matching the
 * keys the compiler writes into `ruleIndex`.
 */
function buildNestedBrain(): BrainDef {
  const brainDef = BrainDef.emptyBrainDef(services);
  brainDef.appendNewPage();

  const page0 = brainDef.pages().get(0)!;
  const page0Rule0 = page0.children().get(0)!;
  const page0Rule0Child0 = addChild(page0Rule0);
  addChild(page0Rule0Child0);
  addChild(page0Rule0Child0);
  addChild(page0Rule0);
  addChild(page0Rule0);

  const page0Rule1 = page0.appendNewRule()!;
  addChild(page0Rule1);

  const page1 = brainDef.pages().get(1)!;
  addChild(page1.children().get(0)!);

  return brainDef;
}

/** Every rule path in `brainDef`, in document order, as `pageIndex/ruleIndex[/childIndex...]`. */
function rulePathsInDocumentOrder(brainDef: BrainDef): List<string> {
  const paths = List.empty<string>();

  function visit(rule: IBrainRuleDef, path: string): void {
    paths.push(path);
    const children = rule.children();
    for (let i = 0; i < children.size(); i++) {
      visit(children.get(i)!, `${path}/${i}`);
    }
  }

  const pages = brainDef.pages();
  for (let p = 0; p < pages.size(); p++) {
    const rules = pages.get(p)!.children();
    for (let r = 0; r < rules.size(); r++) {
      visit(rules.get(r)!, `${p}/${r}`);
    }
  }
  return paths;
}

/** The path of `path`'s parent rule, or `undefined` when `path` names a root rule. */
function parentPath(path: string): string | undefined {
  const head = path.substring(0, path.lastIndexOf("/"));
  return head.indexOf("/") === -1 ? undefined : head;
}

/** True when `path` lies strictly inside the subtree rooted at `ancestor`. */
function isDescendantOf(path: string, ancestor: string): boolean {
  return path.length > ancestor.length && path.substring(0, ancestor.length + 1) === `${ancestor}/`;
}

/** Compiles `brainDef` and returns its rule-path to funcId index. */
function compileRuleIndex(brainDef: BrainDef): Dict<string, number> {
  const compiled = compileBrain(
    brainDef,
    List.from([services.edit.tiles, brainDef.catalog()]),
    services.shared.conversions,
    services.runtime.actions,
    services.runtime.types
  );
  assert.ok(compiled.program, "the nested brain must compile");
  return compiled.program.ruleIndex;
}

/**
 * Runs `brainDef` through compile -> link -> treeshake and returns the linked
 * program's rule-path to funcId index. The tree shaker renumbers every surviving
 * function, so this index carries the ids the runtime actually resolves.
 */
function linkedRuleIndex(brainDef: BrainDef): Dict<string, number> {
  const linkEnvironment: BrainLinkEnvironment = {
    catalogs: List.from([services.edit.tiles, brainDef.catalog()]),
    actionResolver: services.runtime.actions,
    typeRegistry: services.runtime.types,
  };
  const built = runBrainLinkPipeline(brainDef, linkEnvironment, services.shared.conversions);
  assert.ok(built.program, "the nested brain must link");
  return built.program.ruleIndex;
}

/** Asserts the pre-order property over `ruleIndex`, returning the pairs compared. */
function assertPreOrder(
  ruleIndex: Dict<string, number>,
  paths: List<string>
): { siblingPairs: number; descendantPairs: number } {
  let siblingPairs = 0;
  let descendantPairs = 0;
  for (let i = 0; i < paths.size(); i++) {
    for (let j = 0; j < paths.size(); j++) {
      const earlier = paths.get(i)!;
      const later = paths.get(j)!;
      const earlierFuncId = ruleIndex.get(earlier);
      const laterFuncId = ruleIndex.get(later);
      assert.ok(earlierFuncId !== undefined, `${earlier} must have a funcId`);
      assert.ok(laterFuncId !== undefined, `${later} must have a funcId`);
      if (j > i && parentPath(earlier) === parentPath(later)) {
        assert.ok(
          earlierFuncId < laterFuncId,
          `sibling ${earlier} (funcId ${earlierFuncId}) must precede ${later} (funcId ${laterFuncId})`
        );
        siblingPairs++;
      }
      if (isDescendantOf(later, earlier)) {
        assert.ok(
          earlierFuncId < laterFuncId,
          `${earlier} (funcId ${earlierFuncId}) must precede its descendant ${later} (funcId ${laterFuncId})`
        );
        descendantPairs++;
      }
    }
  }
  return { siblingPairs, descendantPairs };
}

describe("brain compiler -- rule funcId assignment order", () => {
  test("sibling rules' funcIds increase in document order at every level", () => {
    const brainDef = buildNestedBrain();
    const ruleIndex = compileRuleIndex(brainDef);
    const paths = rulePathsInDocumentOrder(brainDef);
    assert.equal(paths.size(), 10, "the fixture brain must nest several siblings at several levels");

    let comparedSiblingPairs = 0;
    for (let i = 0; i < paths.size(); i++) {
      for (let j = i + 1; j < paths.size(); j++) {
        const earlier = paths.get(i)!;
        const later = paths.get(j)!;
        if (parentPath(earlier) !== parentPath(later)) {
          continue;
        }
        const earlierFuncId = ruleIndex.get(earlier);
        const laterFuncId = ruleIndex.get(later);
        assert.ok(earlierFuncId !== undefined, `${earlier} must have a funcId`);
        assert.ok(laterFuncId !== undefined, `${later} must have a funcId`);
        assert.ok(
          earlierFuncId < laterFuncId,
          `sibling ${earlier} (funcId ${earlierFuncId}) must precede ${later} (funcId ${laterFuncId})`
        );
        comparedSiblingPairs++;
      }
    }
    assert.ok(comparedSiblingPairs >= 5, "the fixture must compare sibling pairs at more than one level");
  });

  test("a rule's funcId is smaller than every funcId in its subtree", () => {
    const brainDef = buildNestedBrain();
    const ruleIndex = compileRuleIndex(brainDef);
    const paths = rulePathsInDocumentOrder(brainDef);

    let comparedDescendantPairs = 0;
    for (let i = 0; i < paths.size(); i++) {
      for (let j = 0; j < paths.size(); j++) {
        const ancestor = paths.get(i)!;
        const descendant = paths.get(j)!;
        if (!isDescendantOf(descendant, ancestor)) {
          continue;
        }
        const ancestorFuncId = ruleIndex.get(ancestor);
        const descendantFuncId = ruleIndex.get(descendant);
        assert.ok(ancestorFuncId !== undefined, `${ancestor} must have a funcId`);
        assert.ok(descendantFuncId !== undefined, `${descendant} must have a funcId`);
        assert.ok(
          ancestorFuncId < descendantFuncId,
          `${ancestor} (funcId ${ancestorFuncId}) must precede its descendant ${descendant} (funcId ${descendantFuncId})`
        );
        comparedDescendantPairs++;
      }
    }
    assert.ok(
      comparedDescendantPairs >= 6,
      "the fixture must compare ancestor/descendant pairs at more than one depth"
    );
  });

  test("the linked, treeshaken program keeps both orderings", () => {
    // The tree shaker renumbers every surviving function through
    // `buildRemapTable`, which assigns new ids ascending in original id order.
    // The runtime resolves siblings from the ids in this program, so the
    // pre-order property has to survive the renumbering.
    const brainDef = buildNestedBrain();
    const paths = rulePathsInDocumentOrder(brainDef);
    const linked = linkedRuleIndex(brainDef);

    const compared = assertPreOrder(linked, paths);
    assert.ok(compared.siblingPairs >= 5, "the fixture must compare sibling pairs at more than one level");
    assert.ok(
      compared.descendantPairs >= 6,
      "the fixture must compare ancestor/descendant pairs at more than one depth"
    );
  });
});
