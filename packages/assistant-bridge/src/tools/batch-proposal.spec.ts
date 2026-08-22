import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ParseDiagCode } from "@wendoo-lang/core/brain/compiler";
import { createTargetAdapter } from "../testing/index.js";
import type { BatchAccepted, BatchResult, ProposalRejected, ProposalUnresolved } from "./propose-edit.js";
import { batchReplayStepMs, proposeEdit, proposeEditBatch } from "./propose-edit.js";
import type { ProjectRule } from "./read-project.js";
import { readProject } from "./read-project.js";
import type { ProposeEditInput } from "./tool-schemas.js";
import type { AuthoringWorkspace, LandedEdit } from "./workspace.js";
import { createAuthoringWorkspace, locateRules } from "./workspace.js";

/** Tiles the fake target's brains are authored from. */
const tiles = {
  sensor: "tile.sensor->sensor.fake.signal",
  actuator: "tile.actuator->actuator.fake.emit",
  parameter: "tile.parameter->parameter:fake.strength",
  numberFactory: "tile.lit.factory->number",
  nil: "tile.literal->nil:<nil>->nil",
} as const;

/** Id of the one rule a fresh document opens with. */
function firstRuleId(workspace: AuthoringWorkspace): string {
  return locateRules(workspace.brainDef)[0]!.ruleId;
}

/** A fresh workspace over the fake target. */
function workspace(): AuthoringWorkspace {
  return createAuthoringWorkspace(createTargetAdapter(), "fake brain");
}

/** Tile ids standing on `side` of `rules[index]`, as read_project reports them. */
function tilesOn(rules: readonly ProjectRule[], index: number, side: "when" | "do"): string[] {
  return (rules[index]?.[side] ?? []).map((tile) => tile.tileId);
}

/** The batch that fills the opening rule in and builds a second rule beside it. */
function twoRuleBuild(ruleId: string): ProposeEditInput[] {
  return [
    { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
    { op: "placeTiles", ruleId, side: "do", tileIds: [tiles.actuator] },
    { op: "addRule", pageIndex: 0 },
    { op: "placeTiles", ruleId: "#2", side: "do", tileIds: [tiles.actuator] },
  ];
}

describe("a batch lands as one thing or not at all", () => {
  test("applies its commands in order and leaves the document holding all of them", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);

    const result = await proposeEditBatch(ws, { op: "batch", commands: twoRuleBuild(ruleId) });

    assert.equal(result.ok, true, JSON.stringify(result));
    const rules = readProject(ws).pages[0]!.rules;
    assert.equal(rules.length, 2);
    assert.deepEqual(tilesOn(rules, 0, "when"), [tiles.sensor]);
    assert.deepEqual(tilesOn(rules, 0, "do"), [tiles.actuator]);
    assert.deepEqual(tilesOn(rules, 1, "do"), [tiles.actuator]);
  });

  test("takes one undo, and takes the whole batch back", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);
    const depthBefore = ws.history.undoDepth();

    const result = (await proposeEditBatch(ws, { op: "batch", commands: twoRuleBuild(ruleId) })) as BatchAccepted;

    assert.equal(result.historyDepth, depthBefore + 1);
    ws.history.undo();
    const rules = readProject(ws).pages[0]!.rules;
    assert.equal(rules.length, 1);
    assert.deepEqual(tilesOn(rules, 0, "when"), []);
    assert.deepEqual(tilesOn(rules, 0, "do"), []);
    assert.equal(ws.history.undoDepth(), depthBefore);
  });

  test("reports one outcome per command, under the ids the document ends up holding", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);

    const result = (await proposeEditBatch(ws, { op: "batch", commands: twoRuleBuild(ruleId) })) as BatchAccepted;

    const standing = readProject(ws).pages[0]!.rules.map((rule) => rule.ruleId);
    assert.deepEqual(
      result.results.map((outcome) => outcome.rule?.ruleId),
      [standing[0], standing[0], standing[1], standing[1]]
    );
    assert.deepEqual(
      result.results[3]?.rule?.do.map((tile) => tile.tileId),
      [tiles.actuator]
    );
  });

  test("nests a rule under one the same batch made", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);

    const result = (await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        { op: "addRule", pageIndex: 0 },
        { op: "placeTiles", ruleId: "#1", side: "when", tileIds: [tiles.sensor] },
        { op: "addChildRule", parentRuleId: "#1" },
        { op: "placeTiles", ruleId: "#3", side: "do", tileIds: [tiles.actuator] },
      ],
    })) as BatchAccepted;

    assert.equal(result.ok, true, JSON.stringify(result));
    const rules = readProject(ws).pages[0]!.rules;
    assert.equal(rules.length, 2);
    const child = rules[1]!.children[0];
    assert.equal(child?.ruleId, result.results[3]?.rule?.ruleId);
    assert.deepEqual(
      child?.do.map((tile) => tile.tileId),
      [tiles.actuator]
    );
  });

  test("judges only the state the whole run leaves, so a rebuild through a broken middle lands", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);
    const opening = proposeEdit(ws, { op: "placeTiles", ruleId, side: "do", tileIds: [tiles.actuator] });
    assert.equal(opening.ok, true, JSON.stringify(opening));

    const result = await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "deleteTile", ruleId, side: "do", position: 0 },
        {
          op: "placeTiles",
          ruleId,
          side: "do",
          tileIds: [tiles.actuator, tiles.parameter, { tileId: tiles.numberFactory, value: 5 }],
        },
      ],
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(tilesOn(readProject(ws).pages[0]!.rules, 0, "do").slice(0, 2), [tiles.actuator, tiles.parameter]);
  });
});

describe("a refused batch leaves nothing behind", () => {
  /** The batch whose last command puts a value the argument slot does not take. */
  function mistyped(ruleId: string): ProposeEditInput[] {
    return [
      { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
      { op: "placeTiles", ruleId, side: "do", tileIds: [tiles.actuator, tiles.parameter, tiles.nil] },
    ];
  }

  test("returns the code that rejected the end state, addressed to the rule it names", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);

    const result = (await proposeEditBatch(ws, { op: "batch", commands: mistyped(ruleId) })) as ProposalRejected;

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.params.ruleId, ruleId);
  });

  test("leaves the document, the history, and the catalog exactly as they stood", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);
    const depthBefore = ws.history.undoDepth();
    const catalogBefore = ws.brainDef.catalog().getAll().size();

    const result = await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        {
          op: "placeTiles",
          ruleId,
          side: "do",
          tileIds: [tiles.actuator, tiles.parameter, { tileId: tiles.numberFactory, value: 7 }],
        },
        { op: "placeTile", ruleId, side: "when", tileId: tiles.actuator },
      ],
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    const rules = readProject(ws).pages[0]!.rules;
    assert.equal(rules.length, 1);
    assert.deepEqual(tilesOn(rules, 0, "when"), []);
    assert.deepEqual(tilesOn(rules, 0, "do"), []);
    assert.equal(ws.history.undoDepth(), depthBefore);
    assert.equal(ws.brainDef.catalog().getAll().size(), catalogBefore, "the tile the batch minted is not registered");
  });

  test("takes back a rule the batch added before the refusal", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);

    const result = await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "addRule", pageIndex: 0 },
        { op: "placeTile", ruleId, side: "when", tileId: tiles.actuator },
      ],
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal((result as ProposalRejected).code, ParseDiagCode.TilePlacementSideMismatch);
    assert.equal(readProject(ws).pages[0]!.rules.length, 1);
  });
});

describe("a batch command that cannot apply names its own index", () => {
  test("reports a rule id the document does not hold", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);
    const elsewhere = firstRuleId(workspace());

    const result = await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        { op: "placeTiles", ruleId: elsewhere, side: "do", tileIds: [tiles.actuator] },
      ],
    });

    assert.deepEqual(result, { ok: false, error: "unknown_rule", named: elsewhere, commandIndex: 1 });
    assert.deepEqual(tilesOn(readProject(ws).pages[0]!.rules, 0, "when"), [], "the commands before it came back out");
  });

  test("reports a batch reference naming no command that makes a rule", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);

    const result = await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        { op: "placeTiles", ruleId: "#0", side: "do", tileIds: [tiles.actuator] },
      ],
    });

    assert.deepEqual(result, { ok: false, error: "unknown_batch_reference", named: "#0", commandIndex: 1 });
    assert.equal(ws.history.undoDepth(), 0);
  });

  test("reports a position past the end of a side", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);

    const result = await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        { op: "deleteTile", ruleId, side: "do", position: 3 },
      ],
    });

    assert.deepEqual(result, { ok: false, error: "position_out_of_range", named: "3", commandIndex: 1 });
    assert.deepEqual(tilesOn(readProject(ws).pages[0]!.rules, 0, "when"), []);
  });
});

describe("an accepted batch replays into the document one command at a time", () => {
  /** How many tiles stand across every rule of `ws` right now. */
  function tileCount(ws: AuthoringWorkspace): number {
    return locateRules(ws.brainDef).reduce(
      (total, located) => total + located.rule.when().tiles().size() + located.rule.do().tiles().size(),
      0
    );
  }

  test("no task boundary sees the state the validation pass built and took back", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);
    const observed: number[] = [];
    const observer = setInterval(() => observed.push(tileCount(ws)), 1);

    await proposeEditBatch(ws, { op: "batch", commands: twoRuleBuild(ruleId) });
    clearInterval(observer);

    assert.ok(observed.length > 0, "the observer ran while the batch was replaying");
    assert.ok(observed[0]! < tileCount(ws), "the observer watched the document fill in");
    assert.deepEqual(
      [...observed].sort((a, b) => a - b),
      observed,
      "the count only ever rises, so no observer saw the validation pass undone"
    );
  });

  test("a refused batch is never in the document at a task boundary", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);
    const observed: number[] = [];
    const observer = setInterval(() => observed.push(tileCount(ws)), 1);

    await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        { op: "placeTiles", ruleId, side: "do", tileIds: [tiles.actuator, tiles.parameter, tiles.nil] },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, batchReplayStepMs));
    clearInterval(observer);

    assert.deepEqual(new Set(observed), new Set([0]));
  });

  test("tells the editor the document changed once per command, spread over the replay", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);
    const commands = twoRuleBuild(ruleId);
    const changedAt: number[] = [];
    const startedAt = Date.now();
    ws.history.onChange(() => changedAt.push(Date.now() - startedAt));

    await proposeEditBatch(ws, { op: "batch", commands });

    // One notification per replayed command, and one more as the batch closes.
    assert.equal(changedAt.length, commands.length + 1);
    const first = changedAt[0] ?? 0;
    const last = changedAt[changedAt.length - 1] ?? 0;
    assert.ok(last - first >= (commands.length - 1) * batchReplayStepMs, "the changes arrive spread out, not at once");
  });

  test("paces the replay and returns once the whole batch stands in the document", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);
    const commands = twoRuleBuild(ruleId);
    const startedAt = Date.now();

    const result = await proposeEditBatch(ws, { op: "batch", commands });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(Date.now() - startedAt >= (commands.length - 1) * batchReplayStepMs);
    assert.equal(tileCount(ws), 3);
  });
});

describe("a batch runs through the same path a single proposal does", () => {
  test("leaves the same document a run of single proposals leaves", async () => {
    const commands = (ruleId: string): ProposeEditInput[] => [
      { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
      { op: "placeTiles", ruleId, side: "do", tileIds: [tiles.actuator] },
    ];

    const oneAtATime = workspace();
    for (const command of commands(firstRuleId(oneAtATime))) {
      const result = proposeEdit(oneAtATime, command);
      assert.equal(result.ok, true, JSON.stringify(result));
    }

    const batched = workspace();
    const result: BatchResult = await proposeEditBatch(batched, {
      op: "batch",
      commands: commands(firstRuleId(batched)),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const single = readProject(oneAtATime).pages[0]!.rules[0]!;
    const batch = readProject(batched).pages[0]!.rules[0]!;
    assert.deepEqual(
      batch.when.map((tile) => tile.tileId),
      single.when.map((tile) => tile.tileId)
    );
    assert.deepEqual(
      batch.do.map((tile) => tile.tileId),
      single.do.map((tile) => tile.tileId)
    );
    assert.equal(batched.history.undoDepth(), 1, "the batch is one entry where the run of proposals is two");
    assert.equal(oneAtATime.history.undoDepth(), 2);
  });

  test("names the failing command's index only when a command could not apply", async () => {
    const ws = workspace();
    const ruleId = firstRuleId(ws);

    const rejected = (await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        { op: "placeTile", ruleId, side: "when", tileId: tiles.actuator },
      ],
    })) as ProposalRejected & ProposalUnresolved;

    assert.equal(rejected.ok, false);
    assert.equal(rejected.commandIndex, undefined);
    assert.equal(rejected.code, ParseDiagCode.TilePlacementSideMismatch);
  });
});

describe("what a watching workspace is told about landed edits", () => {
  /** A fresh workspace whose landed edits are gathered as they are reported. */
  function watched(): { readonly ws: AuthoringWorkspace; readonly landed: LandedEdit[] } {
    const landed: LandedEdit[] = [];
    return { ws: { ...workspace(), onEditLanded: (edit) => landed.push(edit) }, landed };
  }

  /** Durable id of the page at `pageIndex` of `ws`. */
  function pageIdAt(ws: AuthoringWorkspace, pageIndex: number): string {
    return ws.brainDef.pages().get(pageIndex).pageId();
  }

  test("names the page and rule one accepted proposal landed on", () => {
    const { ws, landed } = watched();
    const ruleId = firstRuleId(ws);

    const result = proposeEdit(ws, { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(landed, [{ pageId: pageIdAt(ws, 0), ruleId }]);
  });

  test("names the page a rule made away from the shown one stands on", () => {
    const { ws, landed } = watched();
    ws.brainDef.appendNewPage();

    const result = proposeEdit(ws, { op: "addRule", pageIndex: 1 });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(landed.length, 1);
    assert.equal(landed[0]?.pageId, pageIdAt(ws, 1));
  });

  test("says nothing about a proposal the policy refused", async () => {
    const { ws, landed } = watched();
    const ruleId = firstRuleId(ws);

    const result = await proposeEditBatch(ws, {
      op: "batch",
      commands: [
        { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] },
        { op: "placeTiles", ruleId, side: "do", tileIds: [tiles.actuator, tiles.parameter, tiles.nil] },
      ],
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.deepEqual(landed, []);
  });

  test("names one place per step of an accepted batch's replay, in the order the steps land", async () => {
    const { ws, landed } = watched();
    const ruleId = firstRuleId(ws);

    const result = await proposeEditBatch(ws, { op: "batch", commands: twoRuleBuild(ruleId) });

    assert.equal(result.ok, true, JSON.stringify(result));
    const pageId = pageIdAt(ws, 0);
    const madeRuleId = locateRules(ws.brainDef)[1]!.ruleId;
    assert.deepEqual(landed, [
      { pageId, ruleId },
      { pageId, ruleId },
      { pageId, ruleId: madeRuleId },
      { pageId, ruleId: madeRuleId },
    ]);
  });
});
