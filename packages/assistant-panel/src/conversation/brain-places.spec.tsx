/**
 * Pins where the panel reads the document's places from: how a rule standing on
 * a page is numbered, which rules the standing document places at all, and what
 * showing one records about the person having asked for it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BrainDef } from "@wendoo/core/brain/model";
import type { EditedBrain, EditedBrainPlace } from "@wendoo/ui/brain-editor/EditedBrainContext";
import type { EditedBrainWorkspaces } from "../app/edited-brain-workspaces";
import { brainPlacesOf } from "./brain-places";

/** The brain every document in this file belongs to. */
const brainId = "brain-a";

/** One rule of a document: its durable id, and the rules standing under it. */
interface FakeRule {
  readonly ruleId: string;
  readonly children?: readonly FakeRule[];
}

/** The list form core's documents hand their children back in. */
function list<T>(items: readonly T[]): { size: () => number; get: (at: number) => T | undefined } {
  return { size: () => items.length, get: (at: number) => items[at] };
}

/** `rules` as the document holds them, each answering the page it stands on. */
function ruleDefs(rules: readonly FakeRule[], page: unknown): unknown[] {
  return rules.map((rule) => ({
    ruleId: () => rule.ruleId,
    children: () => list(ruleDefs(rule.children ?? [], page)),
    page: () => page,
  }));
}

/**
 * A document standing `pages`, each page named by its id and holding its rules
 * in order. Every page reads its rules as they stand at the moment it is asked,
 * so a document edited after it was built answers with what it holds now.
 */
function documentOf(pages: readonly { readonly pageId: string; readonly rules: readonly FakeRule[] }[]): BrainDef {
  const pageDefs = pages.map((page) => {
    const pageDef: Record<string, unknown> = { pageId: () => page.pageId };
    pageDef.children = () => list(ruleDefs(page.rules, pageDef));
    return pageDef;
  });
  return { id: () => brainId, pages: () => list(pageDefs) } as unknown as BrainDef;
}

/** What one editor stood for a test: the brain it edits, and the places it was asked to show. */
interface Stand {
  readonly edited: EditedBrain;
  readonly workspaces: EditedBrainWorkspaces;
  readonly revealed: EditedBrainPlace[];
  readonly noted: string[];
}

/** Stand `brainDef` as the brain being edited, watching what it is asked to show and to record. */
function standing(brainDef: BrainDef): Stand {
  const revealed: EditedBrainPlace[] = [];
  const noted: string[] = [];
  return {
    revealed,
    noted,
    edited: {
      brainDef,
      history: undefined as never,
      reveal: (place) => revealed.push(place),
      takeKeyboard: () => false,
    },
    workspaces: {
      workspaceFor: () => undefined as never,
      setEditedBrain: () => {},
      notePersonInteraction: (named: string) => noted.push(named),
    },
  };
}

/** Two pages: one holding a rule with a child, the other holding one rule of its own. */
const twoPages = documentOf([
  { pageId: "page-0", rules: [{ ruleId: "rule-a" }, { ruleId: "rule-b", children: [{ ruleId: "rule-c" }] }] },
  { pageId: "page-1", rules: [{ ruleId: "rule-d" }] },
]);

describe("where the document's rules stand", () => {
  test("numbers a page's rules in document order, counting the rules nested under others", () => {
    const stand = standing(twoPages);
    const places = brainPlacesOf(stand.edited, stand.workspaces);

    assert.deepEqual(places?.locateRule("rule-a"), { pageId: "page-0", line: 1 });
    assert.deepEqual(places?.locateRule("rule-b"), { pageId: "page-0", line: 2 });
    assert.deepEqual(places?.locateRule("rule-c"), { pageId: "page-0", line: 3 });
  });

  test("counts each page's rules from the top of that page", () => {
    const stand = standing(twoPages);

    assert.deepEqual(brainPlacesOf(stand.edited, stand.workspaces)?.locateRule("rule-d"), {
      pageId: "page-1",
      line: 1,
    });
  });

  test("places no rule the document does not hold", () => {
    const stand = standing(twoPages);

    assert.equal(brainPlacesOf(stand.edited, stand.workspaces)?.locateRule("rule-gone"), undefined);
  });

  test("reads the document afresh, so a rule added since is placed too", () => {
    const rules: FakeRule[] = [{ ruleId: "rule-a" }];
    const stand = standing(documentOf([{ pageId: "page-0", rules }]));
    const places = brainPlacesOf(stand.edited, stand.workspaces);
    assert.equal(places?.locateRule("rule-b"), undefined);

    rules.push({ ruleId: "rule-b" });

    assert.deepEqual(places?.locateRule("rule-b"), { pageId: "page-0", line: 2 });
  });

  test("stands nothing where no editor stands a working copy", () => {
    const stand = standing(twoPages);

    assert.equal(brainPlacesOf(undefined, stand.workspaces), undefined);
  });
});

describe("showing a place the person tapped", () => {
  test("shows it through the editor's own reveal", () => {
    const stand = standing(twoPages);

    brainPlacesOf(stand.edited, stand.workspaces)?.reveal({ pageId: "page-0", ruleId: "rule-b" });

    assert.deepEqual(stand.revealed, [{ pageId: "page-0", ruleId: "rule-b" }]);
  });

  test("records the person's own reaching for it, so the view is left alone", () => {
    const stand = standing(twoPages);

    brainPlacesOf(stand.edited, stand.workspaces)?.reveal({ pageId: "page-1" });

    assert.deepEqual(stand.noted, [brainId]);
  });
});
