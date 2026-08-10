import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DiagCode } from "@mindcraft-lang/core/brain/compiler";
import { ParseDiagCode, TypeDiagCode } from "@mindcraft-lang/core/brain/compiler";
import { createTargetAdapter } from "../testing/index.js";
import type { ProposalAccepted, ProposalRejected } from "./propose-edit.js";
import { proposeEdit } from "./propose-edit.js";
import { readProject } from "./read-project.js";
import type { ProposeEditInput, TileRunEntry } from "./tool-schemas.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { createAuthoringWorkspace, locateRules } from "./workspace.js";

/** Tiles the fake target's brains are authored from. */
const tiles = {
  sensor: "tile.sensor->sensor.fake.signal",
  actuator: "tile.actuator->actuator.fake.emit",
  parameter: "tile.parameter->parameter:fake.strength",
  numberFactory: "tile.lit.factory->number",
  variableFactory: "tile.var.factory->number",
  nil: "tile.literal->nil:<nil>->nil",
  boolean: "tile.literal->boolean:<boolean>->true",
} as const;

/**
 * Placeholder rule id the cases below are authored with; `at` swaps it for the
 * id the document under test actually minted for its one rule.
 */
const kRule = "the-rule-under-test";

/** Id of the one rule a fresh document opens with. */
function firstRuleId(workspace: AuthoringWorkspace): string {
  return locateRules(workspace.brainDef)[0]!.ruleId;
}

/** `input` addressed at `ruleId`, for a case authored against {@link kRule}. */
function at(ruleId: string, input: ProposeEditInput): ProposeEditInput {
  return "ruleId" in input ? { ...input, ruleId } : input;
}

/** The run that assigns a value to a variable, as a second statement would place it. */
const assignment: TileRunEntry[] = [
  { tileId: tiles.variableFactory, name: "count" },
  "tile.op->assign",
  { tileId: tiles.numberFactory, value: 1 },
];

/** A workspace over the fake target whose judged rule fires the one action on its DO side. */
function workspaceWithAction(): AuthoringWorkspace {
  const ws = createAuthoringWorkspace(createTargetAdapter(), "fake brain");
  const ruleId = firstRuleId(ws);
  const when = proposeEdit(ws, { op: "placeTiles", ruleId, side: "when", tileIds: [tiles.sensor] });
  assert.equal(when.ok, true, JSON.stringify(when));
  const doSide = proposeEdit(ws, { op: "placeTiles", ruleId, side: "do", tileIds: [tiles.actuator] });
  assert.equal(doSide.ok, true, JSON.stringify(doSide));
  return ws;
}

/** The refusal `input` produces on a workspace whose rule already fires the action, and that rule's id. */
function refuse(input: ProposeEditInput): { refused: ProposalRejected; ruleId: string } {
  const ws = workspaceWithAction();
  const ruleId = firstRuleId(ws);
  const result = proposeEdit(ws, at(ruleId, input));
  assert.equal(result.ok, false, JSON.stringify(result));
  return { refused: result as ProposalRejected, ruleId };
}

describe("an edit addresses a rule by the id the document carries", () => {
  test("reports an unresolved edit when the id names a rule this document does not hold", () => {
    const ws = createAuthoringWorkspace(createTargetAdapter(), "fake brain");
    const elsewhere = firstRuleId(createAuthoringWorkspace(createTargetAdapter(), "another brain"));

    const result = proposeEdit(ws, { op: "placeTile", ruleId: elsewhere, side: "when", tileId: tiles.sensor });

    assert.deepEqual(result, { ok: false, error: "unknown_rule", named: elsewhere });
  });

  test("refuses under the same id read_project reports the rule by", () => {
    const ws = workspaceWithAction();
    const readBack = readProject(ws).pages[0]!.rules[0]!.ruleId;

    const refused = proposeEdit(ws, {
      op: "placeTiles",
      ruleId: readBack,
      side: "do",
      tileIds: assignment,
    }) as ProposalRejected;

    assert.equal(refused.ok, false, JSON.stringify(refused));
    assert.equal(refused.params.ruleId, readBack);
  });

  test("reads an accepted edit back under the id the request named", () => {
    const ws = createAuthoringWorkspace(createTargetAdapter(), "fake brain");
    const ruleId = firstRuleId(ws);

    const accepted = proposeEdit(ws, { op: "placeTile", ruleId, side: "when", tileId: tiles.sensor });

    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.equal((accepted as ProposalAccepted).rule.ruleId, ruleId);
    assert.equal(readProject(ws).pages[0]!.rules[0]!.ruleId, ruleId);
  });
});

describe("nesting a rule under another", () => {
  test("puts the new rule under the parent the request named, with an id of its own", () => {
    const ws = workspaceWithAction();
    const parentRuleId = firstRuleId(ws);

    const result = proposeEdit(ws, { op: "addChildRule", parentRuleId });

    assert.equal(result.ok, true, JSON.stringify(result));
    const nested = (result as ProposalAccepted).rule;
    assert.notEqual(nested.ruleId, parentRuleId);
    const parent = readProject(ws).pages[0]!.rules[0]!;
    assert.equal(parent.ruleId, parentRuleId, "the parent keeps its id");
    assert.deepEqual(
      parent.children.map((child) => child.ruleId),
      [nested.ruleId],
      "read_project reports the new rule under its parent"
    );
    assert.equal(readProject(ws).pages[0]!.rules.length, 1, "no rule joined the page");
  });

  test("adds each further child after the ones the parent already has", () => {
    const ws = workspaceWithAction();
    const parentRuleId = firstRuleId(ws);

    const first = proposeEdit(ws, { op: "addChildRule", parentRuleId }) as ProposalAccepted;
    const second = proposeEdit(ws, { op: "addChildRule", parentRuleId }) as ProposalAccepted;

    assert.deepEqual(
      readProject(ws).pages[0]!.rules[0]!.children.map((child) => child.ruleId),
      [first.rule.ruleId, second.rule.ruleId]
    );
  });

  test("lands as one undoable entry that takes the whole rule back", () => {
    const ws = workspaceWithAction();
    const parentRuleId = firstRuleId(ws);
    const depthBefore = ws.history.undoDepth();

    const result = proposeEdit(ws, { op: "addChildRule", parentRuleId }) as ProposalAccepted;

    assert.equal(result.historyDepth, depthBefore + 1);
    ws.history.undo();
    assert.deepEqual(readProject(ws).pages[0]!.rules[0]!.children, []);
    assert.equal(readProject(ws).pages[0]!.rules.length, 1, "the rule did not come back as a sibling");
  });

  test("reports a parent id the document does not hold, changing nothing", () => {
    const ws = workspaceWithAction();
    const elsewhere = firstRuleId(createAuthoringWorkspace(createTargetAdapter(), "another brain"));
    const depthBefore = ws.history.undoDepth();

    const result = proposeEdit(ws, { op: "addChildRule", parentRuleId: elsewhere });

    assert.deepEqual(result, { ok: false, error: "unknown_rule", named: elsewhere });
    assert.equal(ws.history.undoDepth(), depthBefore);
    assert.deepEqual(readProject(ws).pages[0]!.rules[0]!.children, []);
  });

  test("reports a parent the document cannot nest another rule under, changing nothing", () => {
    const ws = createAuthoringWorkspace(createTargetAdapter(), "deep brain");
    let parentRuleId = firstRuleId(ws);
    let depth = 0;
    for (;;) {
      const result = proposeEdit(ws, { op: "addChildRule", parentRuleId });
      if (!result.ok) {
        assert.deepEqual(result, { ok: false, error: "rule_nesting_too_deep", named: parentRuleId });
        break;
      }
      parentRuleId = (result as ProposalAccepted).rule.ruleId;
      depth++;
      assert.ok(depth < 100, "nesting stops somewhere");
    }

    const depthBefore = ws.history.undoDepth();
    assert.deepEqual(proposeEdit(ws, { op: "addChildRule", parentRuleId }), {
      ok: false,
      error: "rule_nesting_too_deep",
      named: parentRuleId,
    });
    assert.equal(ws.history.undoDepth(), depthBefore, "the refusal left no history entry");
  });
});

describe("a refused proposal reports where the failure is", () => {
  test("names the rule and the tile a second statement on a full side starts at", () => {
    const { refused, ruleId } = refuse({ op: "placeTiles", ruleId: kRule, side: "do", tileIds: assignment });

    assert.equal(refused.code, ParseDiagCode.UnexpectedExpressionAfterExpression);
    assert.equal(refused.params.ruleId, ruleId);
    assert.equal(refused.params.side, "do");
    assert.ok(
      String(refused.params.tileId).startsWith("tile.var->"),
      "the refusal names the variable tile the second statement starts at"
    );
  });

  test("names the rule alongside the tile an expression placed ahead of the action displaces", () => {
    const { refused, ruleId } = refuse({
      op: "placeTiles",
      ruleId: kRule,
      side: "do",
      position: 0,
      tileIds: assignment,
    });

    assert.deepEqual(refused, {
      ok: false,
      code: ParseDiagCode.UnexpectedActionCallAfterExpression,
      params: { tileId: tiles.actuator, ruleId, side: "do" },
    });
  });

  test("names the rule when the failure is a type the slot does not take", () => {
    const ws = createAuthoringWorkspace(createTargetAdapter(), "fake brain");

    const result = proposeEdit(ws, {
      op: "placeTiles",
      ruleId: firstRuleId(ws),
      side: "do",
      tileIds: [tiles.actuator, tiles.parameter, tiles.nil],
    });

    assert.deepEqual(result, {
      ok: false,
      code: TypeDiagCode.DataTypeMismatch,
      params: {
        expectedTypeIds: ["number:<number>"],
        actualTypeIds: ["nil:<nil>"],
        ruleId: firstRuleId(ws),
      },
    });
  });
});

/** One edit judged against a document, and the outcome the policy gives it. */
interface VerdictCase {
  readonly name: string;
  /** Runs placed on the empty document, in order, before the judged edit. */
  readonly before: readonly ProposeEditInput[];
  readonly edit: ProposeEditInput;
  /** The rejecting code, or `undefined` for an edit that lands. */
  readonly code?: DiagCode;
}

const whenSensor: ProposeEditInput = { op: "placeTiles", ruleId: kRule, side: "when", tileIds: [tiles.sensor] };
const doAction: ProposeEditInput = { op: "placeTiles", ruleId: kRule, side: "do", tileIds: [tiles.actuator] };

const verdictCases: readonly VerdictCase[] = [
  { name: "a sensor opening a WHEN side", before: [], edit: whenSensor },
  { name: "an action on the DO side", before: [whenSensor], edit: doAction },
  {
    name: "an action on the WHEN side",
    before: [],
    edit: { op: "placeTile", ruleId: kRule, side: "when", tileId: tiles.actuator },
    code: ParseDiagCode.TilePlacementSideMismatch,
  },
  {
    name: "a rule added to a page",
    before: [whenSensor, doAction],
    edit: { op: "addRule", pageIndex: 0 },
  },
  {
    name: "a second statement appended to a full DO side",
    before: [whenSensor, doAction],
    edit: { op: "placeTiles", ruleId: kRule, side: "do", tileIds: [{ tileId: tiles.numberFactory, value: 1 }] },
    code: ParseDiagCode.UnexpectedExpressionAfterExpression,
  },
  {
    name: "an expression inserted ahead of the action",
    before: [whenSensor, doAction],
    edit: {
      op: "placeTiles",
      ruleId: kRule,
      side: "do",
      position: 0,
      tileIds: [{ tileId: tiles.numberFactory, value: 1 }],
    },
    code: ParseDiagCode.UnexpectedActionCallAfterExpression,
  },
  {
    name: "a value of the wrong type in an argument slot",
    before: [whenSensor],
    edit: { op: "placeTiles", ruleId: kRule, side: "do", tileIds: [tiles.actuator, tiles.parameter, tiles.nil] },
    code: TypeDiagCode.DataTypeMismatch,
  },
  {
    name: "a value the compiler converts on its own",
    before: [whenSensor],
    edit: { op: "placeTiles", ruleId: kRule, side: "do", tileIds: [tiles.actuator, tiles.parameter, tiles.boolean] },
  },
  {
    name: "a tile deleted from a side that then reads short",
    before: [whenSensor, doAction],
    edit: { op: "deleteTile", ruleId: kRule, side: "do", position: 0 },
  },
];

describe("reporting a refusal decides nothing", () => {
  for (const verdictCase of verdictCases) {
    test(`keeps the verdict and the code for ${verdictCase.name}`, () => {
      const ws = createAuthoringWorkspace(createTargetAdapter(), "fake brain");
      const ruleId = firstRuleId(ws);
      for (const input of verdictCase.before) {
        const setup = proposeEdit(ws, at(ruleId, input));
        assert.equal(setup.ok, true, JSON.stringify(setup));
      }

      const result = proposeEdit(ws, at(ruleId, verdictCase.edit));

      assert.equal(result.ok, verdictCase.code === undefined, JSON.stringify(result));
      if (verdictCase.code !== undefined) {
        assert.equal((result as ProposalRejected).code, verdictCase.code);
        assert.equal((result as ProposalRejected).params.ruleId, ruleId);
      }
    });
  }
});
