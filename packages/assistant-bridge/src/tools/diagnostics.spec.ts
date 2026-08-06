import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { ParseDiagCode } from "@mindcraft-lang/core/brain/compiler";
import { ruleSideName, serializeDiagParams, toToolDiagnostic } from "./diagnostics.js";

describe("diagnostic params reaching the model", () => {
  test("carries scalar params through unchanged", () => {
    const params = serializeDiagParams({ tileId: "tile.sensor->see", conversionCost: 2 });

    assert.deepEqual(params, { tileId: "tile.sensor->see", conversionCost: 2 });
  });

  test("flattens a list-valued param into an array", () => {
    const params = serializeDiagParams({ providerTileIds: List.from(["tile.sensor->see", "tile.sensor->bump"]) });

    assert.deepEqual(params, { providerTileIds: ["tile.sensor->see", "tile.sensor->bump"] });
  });

  test("renders the rule side as the name the model uses", () => {
    assert.deepEqual(serializeDiagParams({ side: RuleSide.When }), { side: "when" });
    assert.deepEqual(serializeDiagParams({ side: RuleSide.Do }), { side: "do" });
    assert.equal(ruleSideName(RuleSide.Either), "either");
  });

  test("omits params entirely when the diagnostic carries none", () => {
    assert.equal(serializeDiagParams(undefined), undefined);
    assert.equal(serializeDiagParams({}), undefined);
    assert.deepEqual(toToolDiagnostic(ParseDiagCode.ExpectedClosingParen, undefined), {
      code: ParseDiagCode.ExpectedClosingParen,
    });
  });

  test("keeps the code alongside the params it carries", () => {
    const diagnostic = toToolDiagnostic(ParseDiagCode.TilePlacementSideMismatch, {
      tileId: "tile.actuator->eat",
      side: RuleSide.When,
    });

    assert.deepEqual(diagnostic, {
      code: ParseDiagCode.TilePlacementSideMismatch,
      params: { tileId: "tile.actuator->eat", side: "when" },
    });
  });

  test("survives JSON serialization with its list params intact", () => {
    const diagnostic = toToolDiagnostic(ParseDiagCode.TileRequirementsNotProvided, {
      providerTileIds: List.from(["tile.sensor->see"]),
    });

    assert.deepEqual(JSON.parse(JSON.stringify(diagnostic)), {
      code: ParseDiagCode.TileRequirementsNotProvided,
      params: { providerTileIds: ["tile.sensor->see"] },
    });
  });
});
