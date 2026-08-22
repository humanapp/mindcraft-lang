import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@wendoo-lang/core";
import type { BrainServices, IBrainTileDef, ITileCatalog } from "@wendoo-lang/core/brain";
import {
  CoreLiteralFactoryId,
  CoreVariableFactoryId,
  mkLiteralFactoryTileId,
  mkOperatorTileId,
  mkVariableFactoryTileId,
} from "@wendoo-lang/core/brain";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import { runBrainLinkPipeline } from "@wendoo-lang/core/brain/compiler";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import type { BrainTileFactoryDef } from "@wendoo-lang/core/brain/tiles";
import { manufactureLiteralTile, manufactureVariableTile } from "@wendoo-lang/core/brain/tiles";
import { CoreOpId } from "@wendoo-lang/core/runtime";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

/** The registered factory tile `tileId` names. */
function factory(tileId: string): BrainTileFactoryDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, tileId);
  return tileDef as BrainTileFactoryDef;
}

/** Ids of the literal and variable tiles `catalog` holds. */
function mintedTileIds(catalog: ITileCatalog): string[] {
  const ids: string[] = [];
  catalog.getAll().forEach((tileDef) => {
    if (tileDef.kind === "literal" || tileDef.kind === "variable") ids.push(tileDef.tileId);
  });
  return ids;
}

const numberLiteralFactory = () => factory(mkLiteralFactoryTileId(CoreLiteralFactoryId.Number));
const numberVariableFactory = () => factory(mkVariableFactoryTileId(CoreVariableFactoryId.Number));

describe("manufactureLiteralTile", () => {
  test("registers the minted tile once and reuses it for an equivalent value", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "literal mint");
    const catalog = brainDef.catalog();

    const first = manufactureLiteralTile(numberLiteralFactory(), catalog, 7);
    const again = manufactureLiteralTile(numberLiteralFactory(), catalog, 7);

    assert.ok(first);
    assert.equal(again, first, "an equivalent value resolves to the registered tile");
    assert.deepEqual(mintedTileIds(catalog), [first.tileId]);
  });

  test("registers a separate tile per distinct value and per display format", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "literal mint variants");
    const catalog = brainDef.catalog();

    const seven = manufactureLiteralTile(numberLiteralFactory(), catalog, 7);
    const eight = manufactureLiteralTile(numberLiteralFactory(), catalog, 8);
    const sevenPercent = manufactureLiteralTile(numberLiteralFactory(), catalog, 7, "percent");

    assert.ok(seven && eight && sevenPercent);
    assert.equal(sevenPercent.displayFormat, "percent");
    assert.deepEqual(mintedTileIds(catalog).sort(), [eight.tileId, seven.tileId, sevenPercent.tileId].sort());
  });

  test("mints without registering when no catalog is given", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "literal mint uncatalogued");

    const minted = manufactureLiteralTile(numberLiteralFactory(), undefined, 7);

    assert.ok(minted);
    assert.equal(minted.value, 7);
    assert.deepEqual(mintedTileIds(brainDef.catalog()), []);
  });
});

describe("manufactureVariableTile", () => {
  test("registers the minted tile once and reuses it for the same name and type", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "variable mint");
    const catalog = brainDef.catalog();

    const first = manufactureVariableTile(numberVariableFactory(), catalog, "speed");
    const again = manufactureVariableTile(numberVariableFactory(), catalog, " speed ");

    assert.ok(first);
    assert.equal(first.varName, "speed");
    assert.equal(again, first, "the surrounding blanks name the same variable");
    assert.deepEqual(mintedTileIds(catalog), [first.tileId]);
  });

  test("registers a separate tile per variable type carrying the same name", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "variable mint types");
    const catalog = brainDef.catalog();

    const asNumber = manufactureVariableTile(numberVariableFactory(), catalog, "level");
    const asString = manufactureVariableTile(
      factory(mkVariableFactoryTileId(CoreVariableFactoryId.String)),
      catalog,
      "level"
    );

    assert.ok(asNumber && asString);
    assert.notEqual(asNumber.tileId, asString.tileId);
    assert.notEqual(asNumber.varType, asString.varType);
    assert.equal(mintedTileIds(catalog).length, 2);
  });

  test("mints nothing from a name that is blank", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "variable mint blank");
    const catalog = brainDef.catalog();

    assert.equal(manufactureVariableTile(numberVariableFactory(), catalog, "   "), undefined);
    assert.deepEqual(mintedTileIds(catalog), []);
  });
});

describe("a manufactured tile in a rule", () => {
  test("places on a rule side and links into a program", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "manufactured assignment");
    const catalog = brainDef.catalog();
    const variable = manufactureVariableTile(numberVariableFactory(), catalog, "speed");
    const literal = manufactureLiteralTile(numberLiteralFactory(), catalog, 7);
    assert.ok(variable && literal);

    const rule = brainDef.pages().get(0)!.children().get(0)!;
    rule.do().appendTile(variable as IBrainTileDef);
    rule.do().appendTile(services.edit.tiles.get(mkOperatorTileId(CoreOpId.Assign))!);
    rule.do().appendTile(literal as IBrainTileDef);

    const result = runBrainLinkPipeline(
      brainDef,
      {
        catalogs: List.from([services.edit.tiles, catalog]),
        actionResolver: services.runtime.actions,
        typeRegistry: services.runtime.types,
      },
      services.shared.conversions
    );

    assert.deepEqual(
      result.diagnostics.toArray().filter((diag) => diag.severity === "error"),
      []
    );
    assert.ok(result.program, "the rule holding the manufactured tiles links");
  });
});
