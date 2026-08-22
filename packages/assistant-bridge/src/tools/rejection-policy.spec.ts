import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DiagCode } from "@wendoo-lang/core/brain/compiler";
import {
  CompilationDiagCode,
  diagnosticSeverity,
  LinkDiagCode,
  ParseDiagCode,
  TypeDiagCode,
} from "@wendoo-lang/core/brain/compiler";
import type { ToolDiagnostic } from "./diagnostics.js";
import {
  acceptedDiagCodes,
  decideProposal,
  proposalPolicy,
  proposalVerdict,
  rejectionParams,
} from "./rejection-policy.js";

/** Every numeric member of the four core diagnostic-code enums. */
function everyDiagCode(): DiagCode[] {
  const codes: DiagCode[] = [];
  for (const enumObject of [ParseDiagCode, TypeDiagCode, CompilationDiagCode, LinkDiagCode]) {
    for (const value of Object.values(enumObject)) {
      if (typeof value === "number") codes.push(value as DiagCode);
    }
  }
  return codes;
}

describe("proposal policy table", () => {
  test("covers every diagnostic code the compile pipeline can report, once each", () => {
    const covered = proposalPolicy.map((entry) => entry.code).sort((a, b) => a - b);
    const expected = everyDiagCode().sort((a, b) => a - b);

    assert.deepEqual(covered, expected);
    assert.equal(new Set(covered).size, covered.length, "no code appears twice");
  });

  test("records the severity core actually reports for each code", () => {
    for (const entry of proposalPolicy) {
      assert.equal(entry.coreSeverity, diagnosticSeverity(entry.code), `severity of code ${entry.code}`);
    }
  });

  test("accepts exactly the codes that report a resolution the compiler made on its own", () => {
    const accepted = proposalPolicy.filter((entry) => entry.verdict === "accept").map((entry) => entry.code);

    assert.deepEqual(accepted, [TypeDiagCode.DataTypeConverted]);
    assert.deepEqual([...acceptedDiagCodes], accepted);
  });

  test("rejects every code core reports below error severity as well", () => {
    const rejectedWarnings = proposalPolicy.filter(
      (entry) => entry.coreSeverity !== "error" && entry.verdict === "reject"
    );

    assert.ok(rejectedWarnings.length > 0, "the pipeline reports codes below error severity");
    for (const entry of rejectedWarnings) {
      assert.notEqual(entry.code, TypeDiagCode.DataTypeConverted);
    }
  });

  test("rejects the codes a dropped expression and a type mismatch report", () => {
    assert.equal(proposalVerdict(ParseDiagCode.UnexpectedExpressionAfterExpression), "reject");
    assert.equal(proposalVerdict(CompilationDiagCode.UncompilableExpressionDropped), "reject");
    assert.equal(proposalVerdict(TypeDiagCode.DataTypeMismatch), "reject");
    assert.equal(proposalVerdict(ParseDiagCode.TilePlacementSideMismatch), "reject");
    assert.equal(proposalVerdict(LinkDiagCode.MissingActionBinding), "reject");
    assert.equal(proposalVerdict(TypeDiagCode.DataTypeConverted), "accept");
  });
});

describe("deciding one proposed edit", () => {
  test("accepts an edit that reported nothing", () => {
    assert.deepEqual(decideProposal([]), { verdict: "accept" });
  });

  test("accepts an edit whose only diagnostic is an accepted code", () => {
    assert.deepEqual(decideProposal([{ code: TypeDiagCode.DataTypeConverted }]), { verdict: "accept" });
  });

  test("reports the rejecting code and its params", () => {
    const decision = decideProposal([
      { code: TypeDiagCode.DataTypeConverted },
      { code: ParseDiagCode.UnexpectedExpressionAfterExpression, params: { tileId: "tile.sensor->x" } },
    ]);

    assert.equal(decision.verdict, "reject");
    assert.equal(decision.rejectedBy?.code, ParseDiagCode.UnexpectedExpressionAfterExpression);
    assert.deepEqual(decision.rejectedBy?.params, { tileId: "tile.sensor->x" });
  });

  test("reports the most severe rejecting code when several were reported", () => {
    const decision = decideProposal([
      { code: CompilationDiagCode.UncompilableExpressionDropped },
      { code: ParseDiagCode.TilePlacementSideMismatch },
    ]);

    assert.equal(decision.rejectedBy?.code, ParseDiagCode.TilePlacementSideMismatch);
  });

  test("reports the first of equally severe rejecting codes", () => {
    const decision = decideProposal([
      { code: ParseDiagCode.UnexpectedExpressionAfterExpression },
      { code: TypeDiagCode.DataTypeMismatch },
    ]);

    assert.equal(decision.rejectedBy?.code, ParseDiagCode.UnexpectedExpressionAfterExpression);
  });
});

/** The rule every corpus edit below was judged on. */
const kRule = "ruleUnderTest01";

/**
 * One refused edit's diagnostics as `propose_edit` reports them: the rule's own
 * typecheck first, then the whole-brain build, which attributes each diagnostic
 * to the rule it was reported in.
 */
interface RefusedCase {
  readonly name: string;
  readonly diagnostics: readonly ToolDiagnostic[];
  readonly code: DiagCode;
  readonly params: Record<string, unknown>;
}

const refusedCases: readonly RefusedCase[] = [
  {
    name: "a second statement on a side that takes one",
    diagnostics: [
      { code: ParseDiagCode.UnexpectedExpressionAfterExpression },
      { code: ParseDiagCode.UnexpectedExpressionAfterExpression, params: { ruleId: kRule } },
      {
        code: CompilationDiagCode.UncompilableExpressionDropped,
        params: { ruleId: kRule, side: "do", tileId: "tile.var->count" },
      },
    ],
    code: ParseDiagCode.UnexpectedExpressionAfterExpression,
    params: { ruleId: kRule, side: "do", tileId: "tile.var->count" },
  },
  {
    name: "an expression placed ahead of the action it was meant to follow",
    diagnostics: [
      { code: ParseDiagCode.UnexpectedActionCallAfterExpression, params: { tileId: "tile.actuator->emit" } },
      {
        code: ParseDiagCode.UnexpectedActionCallAfterExpression,
        params: { tileId: "tile.actuator->emit", ruleId: kRule },
      },
      {
        code: CompilationDiagCode.UncompilableExpressionDropped,
        params: { ruleId: kRule, side: "do", tileId: "tile.actuator->emit" },
      },
    ],
    code: ParseDiagCode.UnexpectedActionCallAfterExpression,
    params: { tileId: "tile.actuator->emit", ruleId: kRule, side: "do" },
  },
  {
    name: "a value of the wrong type in an argument slot",
    diagnostics: [
      {
        code: TypeDiagCode.DataTypeMismatch,
        params: { expectedTypeIds: ["number:<number>"], actualTypeIds: ["nil:<nil>"] },
      },
    ],
    code: TypeDiagCode.DataTypeMismatch,
    params: { expectedTypeIds: ["number:<number>"], actualTypeIds: ["nil:<nil>"], ruleId: kRule },
  },
];

describe("reporting the refusal", () => {
  for (const refused of refusedCases) {
    test(`reports the rule, and any tile pinned for it, on ${refused.name}`, () => {
      const decision = decideProposal(refused.diagnostics);

      assert.equal(decision.rejectedBy?.code, refused.code);
      assert.deepEqual(rejectionParams(decision.rejectedBy!, refused.diagnostics, kRule), refused.params);
    });
  }

  test("keeps the rule a diagnostic named itself over the rule the edit was judged on", () => {
    const rejectedBy: ToolDiagnostic = {
      code: ParseDiagCode.TilePlacementSideMismatch,
      params: { ruleId: "anotherRule0002" },
    };

    const params = rejectionParams(rejectedBy, [rejectedBy], kRule);

    assert.deepEqual(params, { ruleId: "anotherRule0002" });
  });

  test("takes no tile from a dropped expression reported in another rule", () => {
    const rejectedBy: ToolDiagnostic = { code: ParseDiagCode.UnexpectedExpressionAfterExpression };
    const elsewhere: ToolDiagnostic = {
      code: CompilationDiagCode.UncompilableExpressionDropped,
      params: { ruleId: "anotherRule0003", side: "when", tileId: "tile.sensor->signal" },
    };

    const params = rejectionParams(rejectedBy, [rejectedBy, elsewhere], kRule);

    assert.deepEqual(params, { ruleId: kRule });
  });

  test("only ever adds params: no case loses a value its rejecting diagnostic reported", () => {
    const corpus: readonly (readonly ToolDiagnostic[])[] = [
      [],
      [{ code: TypeDiagCode.DataTypeConverted }],
      [
        { code: TypeDiagCode.DataTypeConverted },
        { code: ParseDiagCode.UnexpectedExpressionAfterExpression, params: { tileId: "tile.sensor->x" } },
      ],
      [{ code: CompilationDiagCode.UncompilableExpressionDropped }, { code: ParseDiagCode.TilePlacementSideMismatch }],
      [{ code: ParseDiagCode.UnexpectedExpressionAfterExpression }, { code: TypeDiagCode.DataTypeMismatch }],
      ...refusedCases.map((refused) => refused.diagnostics),
    ];

    for (const diagnostics of corpus) {
      const decision = decideProposal(diagnostics);
      if (!decision.rejectedBy) {
        assert.equal(decision.verdict, "accept");
        continue;
      }
      const params = rejectionParams(decision.rejectedBy, diagnostics, kRule);
      assert.equal(decision.verdict, "reject");
      for (const [key, value] of Object.entries(decision.rejectedBy.params ?? {})) {
        assert.deepEqual(params[key], value, `${key} survives reporting`);
      }
    }
  });
});
