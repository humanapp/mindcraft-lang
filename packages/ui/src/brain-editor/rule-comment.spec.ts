/**
 * Pins that the rule card renders nothing of a rule's comment: the editor is
 * not a surface a comment is read or written on, while the model keeps the
 * field and the documentation views keep rendering it.
 *
 * The comment text asserted absent is dynamic data carried by the rule, not
 * product wording.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { BrainCommandHistory, BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainRuleEditor } from "./BrainRuleEditor";

let services: BrainServices;

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

/** The first rule of a fresh brain, carrying `comment`. */
function ruleWithComment(comment: string): BrainRuleDef {
  const brainDef = BrainDef.emptyBrainDef(services, "rule-comment");
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  const ruleDef = pageDef.children().get(0) as BrainRuleDef;
  ruleDef.setComment(comment);
  return ruleDef;
}

function renderRuleCard(ruleDef: BrainRuleDef): string {
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
      createElement(BrainRuleEditor, {
        ruleDef,
        lineNumber: 1,
        ruleCount: 1,
        revision: "",
        commandHistory: new BrainCommandHistory(),
      })
    )
  );
}

before(() => {
  services = __test__createBrainServices();
});

describe("rule comments in the editor", () => {
  test("a rule card renders none of the rule's comment", () => {
    const commentText = "cmt-9f3a2b";
    const ruleDef = ruleWithComment(commentText);
    assert.equal(ruleDef.comment(), commentText);
    assert.ok(!renderRuleCard(ruleDef).includes(commentText));
  });

  test("a rule card renders no textarea for a rule carrying a comment", () => {
    assert.ok(!renderRuleCard(ruleWithComment("cmt-textarea")).includes("<textarea"));
  });

  test("a commented rule's card renders the same markup as an uncommented one", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "rule-comment-shape");
    const pageDef = brainDef.pages().get(0) as BrainPageDef;
    const ruleDef = pageDef.children().get(0) as BrainRuleDef;
    const bare = renderRuleCard(ruleDef);
    ruleDef.setComment("cmt-shape");
    assert.equal(renderRuleCard(ruleDef), bare);
  });
});
