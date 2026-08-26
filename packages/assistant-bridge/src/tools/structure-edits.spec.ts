import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mkPageTileId } from "@wendoo/core/brain";
import { kMaxBrainPageCount } from "@wendoo/core/brain/model";
import { createTargetAdapter } from "../testing/index.js";
import type { BatchAccepted, ProposalAccepted, ProposalUnresolved } from "./propose-edit.js";
import { proposeEdit, proposeEditBatch } from "./propose-edit.js";
import { readProject } from "./read-project.js";
import type { AuthoringWorkspace, LandedEdit } from "./workspace.js";
import { createAuthoringWorkspace, locateRules } from "./workspace.js";

/** Tiles the fake target's brains are authored from. */
const tiles = {
  sensor: "tile.sensor->sensor.fake.signal",
  actuator: "tile.actuator->actuator.fake.emit",
  switchPage: "tile.actuator->switch-page",
} as const;

/** A fresh workspace over the fake target. */
function workspace(): AuthoringWorkspace {
  return createAuthoringWorkspace(createTargetAdapter(), "fake brain");
}

/** A fresh workspace whose landed edits are gathered as they are reported. */
function watched(): { readonly ws: AuthoringWorkspace; readonly landed: LandedEdit[] } {
  const landed: LandedEdit[] = [];
  return { ws: { ...workspace(), onEditLanded: (edit) => landed.push(edit) }, landed };
}

/** Id of the one rule a fresh document opens with. */
function firstRuleId(ws: AuthoringWorkspace): string {
  return locateRules(ws.brainDef)[0]!.ruleId;
}

/** Durable page ids of `ws`, in document order. */
function pageIds(ws: AuthoringWorkspace): string[] {
  return readProject(ws).pages.map((page) => page.pageId);
}

describe("addPage appends a page the rest of the vocabulary can address", () => {
  test("reports the page it minted, and read_project holds it under the same id", () => {
    const ws = workspace();

    const result = proposeEdit(ws, { op: "addPage" }) as ProposalAccepted;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.page?.pageIndex, 1);
    assert.deepEqual(pageIds(ws), [readProject(ws).pages[0]!.pageId, result.page?.pageId]);
  });

  test("the page arrives holding one empty rule, which the edit reports", () => {
    const ws = workspace();

    const result = proposeEdit(ws, { op: "addPage" }) as ProposalAccepted;

    const opening = readProject(ws).pages[1]!.rules;
    assert.equal(opening.length, 1);
    assert.equal(result.rule?.ruleId, opening[0]!.ruleId);
    assert.deepEqual(result.rule?.when, []);
    assert.deepEqual(result.rule?.do, []);
  });

  test("shows the editor the new page and the rule it opens with", () => {
    const { ws, landed } = watched();

    const result = proposeEdit(ws, { op: "addPage" }) as ProposalAccepted;

    assert.deepEqual(landed, [{ pageId: result.page?.pageId, ruleId: result.rule?.ruleId }]);
  });

  test("takes one undo, and takes the page back out", () => {
    const ws = workspace();
    const depthBefore = ws.history.undoDepth();

    const result = proposeEdit(ws, { op: "addPage" }) as ProposalAccepted;

    assert.equal(result.historyDepth, depthBefore + 1);
    ws.history.undo();
    assert.equal(readProject(ws).pages.length, 1);
  });

  test("gives the page the name the request asks for, and reports it", () => {
    const ws = workspace();

    const result = proposeEdit(ws, { op: "addPage", name: "Night" }) as ProposalAccepted;

    assert.equal(result.page?.name, "Night");
    assert.equal(readProject(ws).pages[1]!.name, "Night");
  });

  test("names the page as one undoable step, and keeps the name across undo and redo", () => {
    const ws = workspace();
    const depthBefore = ws.history.undoDepth();

    const result = proposeEdit(ws, { op: "addPage", name: "Night" }) as ProposalAccepted;

    assert.equal(result.historyDepth, depthBefore + 1, "naming does not cost a second history entry");
    ws.history.undo();
    assert.equal(readProject(ws).pages.length, 1);
    ws.history.redo();
    const back = readProject(ws).pages[1]!;
    assert.equal(back.name, "Night");
    assert.equal(back.pageId, result.page?.pageId);
  });

  test("registers a placeable page tile for the page it made", () => {
    const ws = workspace();

    const result = proposeEdit(ws, { op: "addPage", name: "Night" }) as ProposalAccepted;

    const pageTile = ws.brainDef.catalog().get(mkPageTileId(result.page!.pageId));
    assert.ok(pageTile, "the brain's catalog holds a tile for the new page");
    assert.notEqual(pageTile?.hidden, true, "and it is not hidden, so it can be placed");
  });

  test("refuses a brain already holding as many pages as it may have", () => {
    const ws = workspace();
    for (let i = ws.brainDef.pages().size(); i < kMaxBrainPageCount; i++) {
      const result = proposeEdit(ws, { op: "addPage" });
      assert.equal(result.ok, true, JSON.stringify(result));
    }

    const result = proposeEdit(ws, { op: "addPage" });

    assert.deepEqual(result, { ok: false, error: "page_limit_reached", named: String(kMaxBrainPageCount) });
    assert.equal(readProject(ws).pages.length, kMaxBrainPageCount);
  });
});

describe("deleteRule takes the rule and everything under it", () => {
  test("removes the family and reports the rule as it stood", () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);
    const child = proposeEdit(ws, { op: "addChildRule", parentRuleId: ruleId }) as ProposalAccepted;
    const childId = child.rule!.ruleId;
    const placed = proposeEdit(ws, { op: "placeTiles", ruleId: childId, side: "do", tileIds: [tiles.actuator] });
    assert.equal(placed.ok, true, JSON.stringify(placed));

    const result = proposeEdit(ws, { op: "deleteRule", ruleId }) as ProposalAccepted;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.removed, "rule");
    assert.equal(result.rule?.ruleId, ruleId);
    assert.deepEqual(
      result.rule?.children.map((rule) => rule.ruleId),
      [childId],
      "the report carries the family that went with it"
    );
    assert.deepEqual(readProject(ws).pages[0]!.rules, [], "the page is empty");
  });

  test("shows the editor the page the rule stood on, and the rule that is now gone", () => {
    const { ws, landed } = watched();
    const ruleId = firstRuleId(ws);

    const result = proposeEdit(ws, { op: "deleteRule", ruleId });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(landed, [{ pageId: pageIds(ws)[0], ruleId }]);
  });

  test("one undo brings the family back under the ids it had", () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);
    const child = proposeEdit(ws, { op: "addChildRule", parentRuleId: ruleId }) as ProposalAccepted;
    const before = readProject(ws).pages[0]!.rules;

    proposeEdit(ws, { op: "deleteRule", ruleId });
    ws.history.undo();

    assert.deepEqual(readProject(ws).pages[0]!.rules, before);
    assert.equal(readProject(ws).pages[0]!.rules[0]!.children[0]!.ruleId, child.rule!.ruleId);
  });

  test("reports a rule id the document does not hold", () => {
    const ws = workspace();
    const elsewhere = firstRuleId(workspace());

    assert.deepEqual(proposeEdit(ws, { op: "deleteRule", ruleId: elsewhere }), {
      ok: false,
      error: "unknown_rule",
      named: elsewhere,
    });
  });
});

describe("deletePage takes the page and every rule on it", () => {
  /** A workspace holding a second page, with that page's id. */
  function twoPages(): { readonly ws: AuthoringWorkspace; readonly secondPageId: string } {
    const ws = workspace();
    const added = proposeEdit(ws, { op: "addPage" }) as ProposalAccepted;
    return { ws, secondPageId: added.page!.pageId };
  }

  test("removes the page and reports it as it stood", () => {
    const { ws, secondPageId } = twoPages();
    const firstPageId = pageIds(ws)[0];

    const result = proposeEdit(ws, { op: "deletePage", pageId: secondPageId }) as ProposalAccepted;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.removed, "page");
    assert.equal(result.page?.pageId, secondPageId);
    assert.equal(result.page?.pageIndex, 1);
    assert.equal(result.rule, undefined, "a removed page leaves no one rule to report");
    assert.deepEqual(pageIds(ws), [firstPageId]);
  });

  test("shows the editor a page the document still holds, and no rule", () => {
    const ws = workspace();
    const added = proposeEdit(ws, { op: "addPage" }) as ProposalAccepted;
    const landed: LandedEdit[] = [];
    const watching: AuthoringWorkspace = { ...ws, onEditLanded: (edit) => landed.push(edit) };

    const result = proposeEdit(watching, { op: "deletePage", pageId: added.page!.pageId });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(landed, [{ pageId: pageIds(watching)[0] }]);
  });

  test("one undo brings the page back with its rules under the ids they had", () => {
    const { ws, secondPageId } = twoPages();
    const before = readProject(ws).pages;

    proposeEdit(ws, { op: "deletePage", pageId: secondPageId });
    ws.history.undo();

    assert.deepEqual(readProject(ws).pages, before);
  });

  test("refuses the only page the brain has left", () => {
    const ws = workspace();
    const onlyPageId = pageIds(ws)[0]!;

    assert.deepEqual(proposeEdit(ws, { op: "deletePage", pageId: onlyPageId }), {
      ok: false,
      error: "last_page",
      named: onlyPageId,
    });
    assert.equal(readProject(ws).pages.length, 1);
  });

  test("refuses a page another rule still switches to, and names that rule", () => {
    const { ws, secondPageId } = twoPages();
    const ruleId = firstRuleId(ws);
    const placed = proposeEdit(ws, {
      op: "placeTiles",
      ruleId,
      side: "do",
      tileIds: [tiles.switchPage, mkPageTileId(secondPageId)],
    });
    assert.equal(placed.ok, true, JSON.stringify(placed));

    const result = proposeEdit(ws, { op: "deletePage", pageId: secondPageId }) as ProposalUnresolved;

    assert.equal(result.error, "page_still_referenced");
    assert.equal(result.named, secondPageId);
    assert.deepEqual(result.referencedBy, [ruleId]);
    assert.equal(readProject(ws).pages.length, 2, "the page is still there");
  });

  test("a rule on the page that switches to it goes with the page", () => {
    const { ws, secondPageId } = twoPages();
    const onIt = readProject(ws).pages[1]!.rules[0]!.ruleId;
    const placed = proposeEdit(ws, {
      op: "placeTiles",
      ruleId: onIt,
      side: "do",
      tileIds: [tiles.switchPage, mkPageTileId(secondPageId)],
    });
    assert.equal(placed.ok, true, JSON.stringify(placed));

    const result = proposeEdit(ws, { op: "deletePage", pageId: secondPageId });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readProject(ws).pages.length, 1);
  });

  test("reports a page id the document does not hold", () => {
    const { ws } = twoPages();

    assert.deepEqual(proposeEdit(ws, { op: "deletePage", pageId: "no-such-page" }), {
      ok: false,
      error: "unknown_page",
      named: "no-such-page",
    });
  });
});

describe("a batch builds a page and fills it as one thing", () => {
  test("names the rule the new page opens with as the addPage command's #N", async () => {
    const { ws, landed } = watched();

    const result = (await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "addPage" },
        { op: "placeTiles", ruleId: "#0", side: "when", tileIds: [tiles.sensor] },
        { op: "placeTiles", ruleId: "#0", side: "do", tileIds: [tiles.actuator] },
      ],
    })) as BatchAccepted;

    assert.equal(result.ok, true, JSON.stringify(result));
    const pages = readProject(ws).pages;
    assert.equal(pages.length, 2);
    assert.deepEqual(
      pages[1]!.rules[0]!.when.map((tile) => tile.tileId),
      [tiles.sensor]
    );
    assert.deepEqual(
      pages[1]!.rules[0]!.do.map((tile) => tile.tileId),
      [tiles.actuator]
    );
    assert.equal(result.historyDepth, 1, "the whole build is one undo");
    assert.ok(
      landed.every((edit) => edit.pageId === pages[1]!.pageId),
      "every step of the replay showed the new page"
    );
  });

  test("wires a switch to the page the same batch made, through its page-tile reference", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);

    const result = (await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "addPage", name: "Night" },
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        { op: "placeTiles", ruleId, side: "do", tileIds: [tiles.switchPage, "#0.page"] },
      ],
    })) as BatchAccepted;

    assert.equal(result.ok, true, JSON.stringify(result));
    const pages = readProject(ws).pages;
    assert.deepEqual(
      pages[0]!.rules[0]!.do.map((tile) => tile.tileId),
      [tiles.switchPage, mkPageTileId(pages[1]!.pageId)],
      "the placed tile names the page the document ended up holding"
    );
  });

  test("the page tile placed for a batch-made page survives the replay unhidden", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);

    const result = await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "addPage", name: "Night" },
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        { op: "placeTiles", ruleId, side: "do", tileIds: [tiles.switchPage, "#0.page"] },
      ],
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const madePageId = readProject(ws).pages[1]!.pageId;
    const pageTile = ws.brainDef.catalog().get(mkPageTileId(madePageId));
    assert.ok(pageTile, "the catalog still holds the tile the rule now names");
    assert.notEqual(pageTile?.hidden, true);
  });

  test("reports a page-tile reference naming no command that makes a page", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);

    const result = await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        { op: "placeTiles", ruleId, side: "do", tileIds: [tiles.switchPage, "#0.page"] },
      ],
    });

    assert.deepEqual(result, { ok: false, error: "unknown_batch_reference", named: "#0.page", commandIndex: 1 });
    assert.equal(readProject(ws).pages.length, 1);
  });

  test("reports the pageId the document holds once the replay has run", async () => {
    const ws = workspace();

    const result = (await proposeEditBatch(ws, {
      op: "batch",
      commands: [{ op: "addPage" }, { op: "placeTiles", ruleId: "#0", side: "when", tileIds: [tiles.sensor] }],
    })) as BatchAccepted;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.results[0]?.page?.pageId, readProject(ws).pages[1]!.pageId);
    assert.equal(result.results[0]?.rule?.ruleId, readProject(ws).pages[1]!.rules[0]!.ruleId);
  });

  test("leaves one page tile per living page after an accepted batch", async () => {
    const ws = workspace();

    await proposeEditBatch(ws, {
      op: "batch",
      commands: [{ op: "addPage" }, { op: "placeTiles", ruleId: "#0", side: "when", tileIds: [tiles.sensor] }],
    });

    const pageTiles = ws.brainDef
      .catalog()
      .getAll()
      .toArray()
      .filter((tile) => tile.tileId.startsWith("tile.page->"));
    assert.equal(pageTiles.length, readProject(ws).pages.length);
    assert.deepEqual(
      pageTiles.map((tile) => tile.tileId).sort(),
      pageIds(ws)
        .map((pageId) => mkPageTileId(pageId))
        .sort()
    );
  });

  test("a refused batch leaves no page and no page tile behind", async () => {
    const ws = workspace();
    const catalogBefore = ws.brainDef.catalog().getAll().size();
    const depthBefore = ws.history.undoDepth();

    const result = await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "addPage" },
        { op: "placeTiles", ruleId: "#0", side: "when", tileIds: [tiles.sensor] },
        { op: "placeTile", ruleId: "#0", side: "when", tileId: tiles.actuator },
      ],
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(readProject(ws).pages.length, 1);
    assert.equal(ws.brainDef.catalog().getAll().size(), catalogBefore);
    assert.equal(ws.history.undoDepth(), depthBefore);
  });
});

describe("a batch empties a brain completely", () => {
  /** A brain of two pages, each holding one rule that fires the action. */
  async function seeded(): Promise<AuthoringWorkspace> {
    const ws = workspace();
    const ruleId = firstRuleId(ws);
    const built = await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        { op: "placeTiles", ruleId, side: "do", tileIds: [tiles.actuator] },
        { op: "addPage" },
        { op: "placeTiles", ruleId: "#2", side: "do", tileIds: [tiles.actuator] },
      ],
    });
    assert.equal(built.ok, true, JSON.stringify(built));
    ws.history.clear();
    return ws;
  }

  test("deletes every rule and every surplus page, and one undo puts it all back", async () => {
    const ws = await seeded();
    const before = readProject(ws);
    const [firstPage, secondPage] = before.pages;

    const result = (await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "deleteRule", ruleId: firstPage!.rules[0]!.ruleId },
        { op: "deleteRule", ruleId: secondPage!.rules[0]!.ruleId },
        { op: "deletePage", pageId: secondPage!.pageId },
      ],
    })) as BatchAccepted;

    assert.equal(result.ok, true, JSON.stringify(result));
    const emptied = readProject(ws);
    assert.equal(emptied.pages.length, 1, "one page is left");
    assert.deepEqual(emptied.pages[0]!.rules, [], "holding no rules at all");
    assert.equal(emptied.pages[0]!.pageId, firstPage!.pageId, "and it is the page that was already there");

    assert.equal(result.historyDepth, 1, "the whole clearing is one undo");
    ws.history.undo();
    assert.deepEqual(readProject(ws), before, "which puts the brain back exactly as it stood");
  });

  test("reports one outcome per command, saying what each took out", async () => {
    const ws = await seeded();
    const [firstPage, secondPage] = readProject(ws).pages;

    const result = (await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "deleteRule", ruleId: firstPage!.rules[0]!.ruleId },
        { op: "deleteRule", ruleId: secondPage!.rules[0]!.ruleId },
        { op: "deletePage", pageId: secondPage!.pageId },
      ],
    })) as BatchAccepted;

    assert.deepEqual(
      result.results.map((outcome) => outcome.removed),
      ["rule", "rule", "page"]
    );
    assert.deepEqual(
      result.results.map((outcome) => outcome.rule?.ruleId ?? outcome.page?.pageId),
      [firstPage!.rules[0]!.ruleId, secondPage!.rules[0]!.ruleId, secondPage!.pageId]
    );
  });

  test("a delete that leaves the brain no worse is never refused for what it removed", async () => {
    const ws = await seeded();
    const [firstPage] = readProject(ws).pages;
    // Leave a rule that cannot compile, then take it out again.
    const broken = proposeEdit(ws, { op: "addRule", pageIndex: 0 }) as ProposalAccepted;

    const result = proposeEdit(ws, { op: "deleteRule", ruleId: broken.rule!.ruleId });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readProject(ws).pages[0]!.rules.length, firstPage!.rules.length);
  });
});

describe("an accepted edit says which page it landed on", () => {
  /** A workspace holding a second page, with the ids of both pages. */
  function twoPages(): { readonly ws: AuthoringWorkspace; readonly first: string; readonly second: string } {
    const ws = workspace();
    const added = proposeEdit(ws, { op: "addPage", name: "Scared" }) as ProposalAccepted;
    assert.equal(added.ok, true, JSON.stringify(added));
    return { ws, first: readProject(ws).pages[0]!.pageId, second: added.page!.pageId };
  }

  test("a tile placement names the page holding the rule it changed, by id, position, and name", () => {
    const ws = workspace();
    const page = readProject(ws).pages[0]!;

    const result = proposeEdit(ws, {
      op: "placeTiles",
      ruleId: firstRuleId(ws),
      side: "when",
      tileIds: [tiles.sensor],
    }) as ProposalAccepted;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.onPage, { pageId: page.pageId, pageIndex: 0, name: page.name });
  });

  test("edits on different pages name different pages", () => {
    const { ws, first, second } = twoPages();

    const here = proposeEdit(ws, { op: "addRule", pageIndex: 0 }) as ProposalAccepted;
    const there = proposeEdit(ws, { op: "addRule", pageIndex: 1 }) as ProposalAccepted;

    assert.equal(here.onPage?.pageId, first);
    assert.equal(there.onPage?.pageId, second);
    assert.equal(there.onPage?.name, "Scared");
  });

  test("a nested rule names the page its parent stands on", () => {
    const { ws, second } = twoPages();
    const parent = proposeEdit(ws, { op: "addRule", pageIndex: 1 }) as ProposalAccepted;

    const result = proposeEdit(ws, { op: "addChildRule", parentRuleId: parent.rule!.ruleId }) as ProposalAccepted;

    assert.equal(result.onPage?.pageId, second);
  });

  test("addPage names the page it minted as the page its opening rule stands on", () => {
    const ws = workspace();

    const result = proposeEdit(ws, { op: "addPage", name: "Wandering" }) as ProposalAccepted;

    assert.deepEqual(result.onPage, result.page);
  });

  test("a removed rule names the page it stood on the moment before it went", () => {
    const { ws, second } = twoPages();
    const rule = proposeEdit(ws, { op: "addRule", pageIndex: 1 }) as ProposalAccepted;

    const result = proposeEdit(ws, { op: "deleteRule", ruleId: rule.rule!.ruleId }) as ProposalAccepted;

    assert.equal(result.removed, "rule");
    assert.equal(result.onPage?.pageId, second);
  });

  test("a removed page names no page it landed on, having left none", () => {
    const { ws, second } = twoPages();

    const result = proposeEdit(ws, { op: "deletePage", pageId: second }) as ProposalAccepted;

    assert.equal(result.removed, "page");
    assert.equal(result.onPage, undefined);
  });

  test("a batch names a page per command, so its commands sort by the page each touched", async () => {
    const { ws, first, second } = twoPages();

    const result = (await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "addRule", pageIndex: 1 },
        { op: "placeTiles", ruleId: firstRuleId(ws), side: "when", tileIds: [tiles.sensor] },
        { op: "addRule", pageIndex: 0 },
      ],
    })) as BatchAccepted;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(
      result.results.map((outcome) => outcome.onPage?.pageId),
      [second, first, first]
    );
  });
});
