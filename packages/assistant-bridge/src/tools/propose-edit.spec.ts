import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DiagCode } from "@mindcraft-lang/core/brain/compiler";
import { ParseDiagCode, TypeDiagCode } from "@mindcraft-lang/core/brain/compiler";
import { createTargetAdapter } from "../testing/index.js";
import type { ProposalRejected } from "./propose-edit.js";
import { proposeEdit } from "./propose-edit.js";
import type { ProposeEditInput, TileRunEntry } from "./tool-schemas.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { createAuthoringWorkspace } from "./workspace.js";

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

/** The rule every edit below is judged on. */
const kRule = "0/0";

/** The run that assigns a value to a variable, as a second statement would place it. */
const assignment: TileRunEntry[] = [
  { tileId: tiles.variableFactory, name: "count" },
  "tile.op->assign",
  { tileId: tiles.numberFactory, value: 1 },
];

/** A workspace over the fake target whose judged rule fires the one action on its DO side. */
function workspaceWithAction(): AuthoringWorkspace {
  const ws = createAuthoringWorkspace(createTargetAdapter(), "fake brain");
  const when = proposeEdit(ws, { op: "placeTiles", ruleId: kRule, side: "when", tileIds: [tiles.sensor] });
  assert.equal(when.ok, true, JSON.stringify(when));
  const doSide = proposeEdit(ws, { op: "placeTiles", ruleId: kRule, side: "do", tileIds: [tiles.actuator] });
  assert.equal(doSide.ok, true, JSON.stringify(doSide));
  return ws;
}

/** The refusal `input` produces on a workspace whose rule already fires the action. */
function refuse(input: ProposeEditInput): ProposalRejected {
  const result = proposeEdit(workspaceWithAction(), input);
  assert.equal(result.ok, false, JSON.stringify(result));
  return result as ProposalRejected;
}

describe("a refused proposal reports where the failure is", () => {
  test("names the rule and the tile a second statement on a full side starts at", () => {
    const refused = refuse({ op: "placeTiles", ruleId: kRule, side: "do", tileIds: assignment });

    assert.equal(refused.code, ParseDiagCode.UnexpectedExpressionAfterExpression);
    assert.equal(refused.params.rulePath, kRule);
    assert.equal(refused.params.side, "do");
    assert.ok(
      String(refused.params.tileId).startsWith("tile.var->"),
      "the refusal names the variable tile the second statement starts at"
    );
  });

  test("names the rule alongside the tile an expression placed ahead of the action displaces", () => {
    const refused = refuse({ op: "placeTiles", ruleId: kRule, side: "do", position: 0, tileIds: assignment });

    assert.deepEqual(refused, {
      ok: false,
      code: ParseDiagCode.UnexpectedActionCallAfterExpression,
      params: { tileId: tiles.actuator, rulePath: kRule, side: "do" },
    });
  });

  test("names the rule when the failure is a type the slot does not take", () => {
    const ws = createAuthoringWorkspace(createTargetAdapter(), "fake brain");

    const result = proposeEdit(ws, {
      op: "placeTiles",
      ruleId: kRule,
      side: "do",
      tileIds: [tiles.actuator, tiles.parameter, tiles.nil],
    });

    assert.deepEqual(result, {
      ok: false,
      code: TypeDiagCode.DataTypeMismatch,
      params: {
        expectedTypeIds: ["number:<number>"],
        actualTypeIds: ["nil:<nil>"],
        rulePath: kRule,
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
      for (const input of verdictCase.before) {
        const setup = proposeEdit(ws, input);
        assert.equal(setup.ok, true, JSON.stringify(setup));
      }

      const result = proposeEdit(ws, verdictCase.edit);

      assert.equal(result.ok, verdictCase.code === undefined, JSON.stringify(result));
      if (verdictCase.code !== undefined) {
        assert.equal((result as ProposalRejected).code, verdictCase.code);
        assert.equal((result as ProposalRejected).params.rulePath, kRule);
      }
    });
  }
});
