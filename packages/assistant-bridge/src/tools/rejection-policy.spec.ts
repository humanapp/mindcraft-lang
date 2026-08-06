import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DiagCode } from "@mindcraft-lang/core/brain/compiler";
import {
  CompilationDiagCode,
  diagnosticSeverity,
  LinkDiagCode,
  ParseDiagCode,
  TypeDiagCode,
} from "@mindcraft-lang/core/brain/compiler";
import { acceptedDiagCodes, decideProposal, proposalPolicy, proposalVerdict } from "./rejection-policy.js";

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
