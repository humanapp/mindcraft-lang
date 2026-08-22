import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { List } from "@wendoo-lang/core";
import { RuleSide } from "@wendoo-lang/core/brain";
import { ParseDiagCode } from "@wendoo-lang/core/brain/compiler";
import { ruleSideName, serializeDiagParams, toToolDiagnostic } from "./diagnostics.js";

/** No rule path resolves, for the diagnostics that place themselves by no rule. */
const kNoRuleIds = new Map<string, string>();

/** One rule of the document, standing first on the first page. */
const kRuleIds = new Map<string, string>([["0/0", "Ru1eIdOfTheRule"]]);

describe("diagnostic params reaching the model", () => {
  test("carries scalar params through unchanged", () => {
    const params = serializeDiagParams({ tileId: "tile.sensor->see", conversionCost: 2 }, kNoRuleIds);

    assert.deepEqual(params, { tileId: "tile.sensor->see", conversionCost: 2 });
  });

  test("flattens a list-valued param into an array", () => {
    const params = serializeDiagParams(
      { providerTileIds: List.from(["tile.sensor->see", "tile.sensor->bump"]) },
      kNoRuleIds
    );

    assert.deepEqual(params, { providerTileIds: ["tile.sensor->see", "tile.sensor->bump"] });
  });

  test("renders the rule side as the name the model uses", () => {
    assert.deepEqual(serializeDiagParams({ side: RuleSide.When }, kNoRuleIds), { side: "when" });
    assert.deepEqual(serializeDiagParams({ side: RuleSide.Do }, kNoRuleIds), { side: "do" });
    assert.equal(ruleSideName(RuleSide.Either), "either");
  });

  test("omits params entirely when the diagnostic carries none", () => {
    assert.equal(serializeDiagParams(undefined, kNoRuleIds), undefined);
    assert.equal(serializeDiagParams({}, kNoRuleIds), undefined);
    assert.deepEqual(toToolDiagnostic(ParseDiagCode.ExpectedClosingParen, undefined, kNoRuleIds), {
      code: ParseDiagCode.ExpectedClosingParen,
    });
  });

  test("keeps the code alongside the params it carries", () => {
    const diagnostic = toToolDiagnostic(
      ParseDiagCode.TilePlacementSideMismatch,
      {
        tileId: "tile.actuator->eat",
        side: RuleSide.When,
      },
      kNoRuleIds
    );

    assert.deepEqual(diagnostic, {
      code: ParseDiagCode.TilePlacementSideMismatch,
      params: { tileId: "tile.actuator->eat", side: "when" },
    });
  });

  test("reports the rule by the id the document addresses it under, not by its path", () => {
    const diagnostic = toToolDiagnostic(
      ParseDiagCode.TilePlacementSideMismatch,
      { rulePath: "0/0", tileId: "tile.actuator->eat" },
      kRuleIds
    );

    assert.deepEqual(diagnostic.params, { ruleId: "Ru1eIdOfTheRule", tileId: "tile.actuator->eat" });
  });

  test("drops the address when the path names a rule the document no longer holds", () => {
    const diagnostic = toToolDiagnostic(
      ParseDiagCode.TilePlacementSideMismatch,
      { rulePath: "9/9", tileId: "tile.actuator->eat" },
      kRuleIds
    );

    assert.deepEqual(diagnostic.params, { tileId: "tile.actuator->eat" });
  });

  test("survives JSON serialization with its list params intact", () => {
    const diagnostic = toToolDiagnostic(
      ParseDiagCode.TileRequirementsNotProvided,
      {
        providerTileIds: List.from(["tile.sensor->see"]),
      },
      kNoRuleIds
    );

    assert.deepEqual(JSON.parse(JSON.stringify(diagnostic)), {
      code: ParseDiagCode.TileRequirementsNotProvided,
      params: { providerTileIds: ["tile.sensor->see"] },
    });
  });
});
