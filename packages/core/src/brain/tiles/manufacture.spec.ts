import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@wendoo/core";
import type { BrainServices, IBrainTileDef, ITileCatalog } from "@wendoo/core/brain";
import {
  CoreLiteralFactoryId,
  CoreVariableFactoryId,
  mkLiteralFactoryTileId,
  mkOperatorTileId,
  mkUniqueLiteralTileId,
  mkVariableFactoryTileId,
} from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { runBrainLinkPipeline } from "@wendoo/core/brain/compiler";
import { BrainDef, mintDocumentId } from "@wendoo/core/brain/model";
import {
  BrainTileFactoryDef,
  BrainTileLiteralDef,
  manufactureLiteralTile,
  manufactureVariableTile,
  TileCatalog,
} from "@wendoo/core/brain/tiles";
import type { NumberValue, StructValue, TypeId, Value } from "@wendoo/core/runtime";
import { CoreOpId, CoreTypeIds, mkClosedStructValue, mkNumberValue, TARGET_TYPE_ATOM_BASE } from "@wendoo/core/runtime";

let services: BrainServices;
let pointTypeId: TypeId;

before(() => {
  services = __test__createBrainServices();
  pointTypeId = services.runtime.types.addStructType("Point", {
    atomId: TARGET_TYPE_ATOM_BASE,
    fields: List.from([
      { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
      { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
    ]),
  });
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

/** A point of the struct type these specs registered, as a struct value. */
function point(x: number, y: number): StructValue {
  return mkClosedStructValue(pointTypeId, List.from<Value>([mkNumberValue(x), mkNumberValue(y)]));
}

/** The label a point literal's tile id carries, read off the point's own fields. */
function pointLabel(value: StructValue): string {
  const fields = value.v as List<Value>;
  return `x${(fields.get(0) as NumberValue).v}y${(fields.get(1) as NumberValue).v}`;
}

/**
 * A literal factory producing point literals, standing for one an application
 * registers. Each tile it manufactures carries a label read off the point's
 * fields, so two points holding the same coordinates mint one tile id.
 */
function pointLiteralFactory(): BrainTileFactoryDef {
  return new BrainTileFactoryDef(
    mkLiteralFactoryTileId("point"),
    "point",
    (factoryTileDef, opts) => {
      const value = opts.value as StructValue;
      return new BrainTileLiteralDef(
        factoryTileDef.producedDataType,
        value,
        { valueLabel: pointLabel(value) },
        services
      );
    },
    pointTypeId
  );
}

/**
 * A literal factory producing point literals that carry their own identity,
 * standing for one an application registers for an asset-like value. Every
 * manufacture mints a fresh identity from the document id source, so two
 * points holding the same coordinates are two tiles.
 */
function uniquePointLiteralFactory(): BrainTileFactoryDef {
  return new BrainTileFactoryDef(
    mkLiteralFactoryTileId("unique-point"),
    "unique-point",
    (factoryTileDef, opts) =>
      new BrainTileLiteralDef(
        factoryTileDef.producedDataType,
        opts.value as StructValue,
        { uniqueId: mintDocumentId(services.app.rng), displayName: opts.displayName as string | undefined },
        services
      ),
    pointTypeId
  );
}

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

  test("reuses the registered tile for a struct value holding the same content", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "struct literal mint");
    const catalog = brainDef.catalog();
    const factoryTileDef = pointLiteralFactory();

    const first = manufactureLiteralTile(factoryTileDef, catalog, point(1, 2));
    const again = manufactureLiteralTile(factoryTileDef, catalog, point(1, 2));

    assert.ok(first);
    assert.equal(again, first, "a second point of the same content resolves to the registered tile");
    assert.deepEqual(mintedTileIds(catalog), [first.tileId]);
  });

  test("registers a separate tile per distinct struct content", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "struct literal mint variants");
    const catalog = brainDef.catalog();
    const factoryTileDef = pointLiteralFactory();

    const here = manufactureLiteralTile(factoryTileDef, catalog, point(1, 2));
    const there = manufactureLiteralTile(factoryTileDef, catalog, point(3, 4));

    assert.ok(here && there);
    assert.notEqual(here.tileId, there.tileId);
    assert.deepEqual(mintedTileIds(catalog).sort(), [here.tileId, there.tileId].sort());
  });

  test("names the minted literal, in its metadata label and its sentence form", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "literal mint named");
    const catalog = brainDef.catalog();

    const minted = manufactureLiteralTile(numberLiteralFactory(), catalog, 7, undefined, "lucky");

    assert.ok(minted);
    assert.equal(minted.displayName, "lucky");
    assert.equal(minted.metadata?.label, "lucky");
    assert.equal(minted.metadata?.language?.form, "lucky");
  });

  test("names the minted literal even where the factory ignores the name option", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "literal mint named by factory");
    const catalog = brainDef.catalog();

    const minted = manufactureLiteralTile(pointLiteralFactory(), catalog, point(1, 2), undefined, "corner");

    assert.ok(minted);
    assert.equal(minted.displayName, "corner");
    assert.equal(minted.metadata?.label, "corner");
  });

  test("renames the registered literal of that content, keeping its tile id", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "literal mint rename");
    const catalog = brainDef.catalog();
    const factoryTileDef = pointLiteralFactory();

    const first = manufactureLiteralTile(factoryTileDef, catalog, point(1, 2), undefined, "corner");
    const again = manufactureLiteralTile(factoryTileDef, catalog, point(1, 2), undefined, "edge");

    assert.ok(first);
    assert.equal(again, first, "the same content resolves to the registered tile");
    assert.equal(first.displayName, "edge");
    assert.deepEqual(mintedTileIds(catalog), [first.tileId]);
  });

  test("keeps the renamed word through a save and load of the catalog", () => {
    const catalog = new TileCatalog();
    const factoryTileDef = pointLiteralFactory();

    const first = manufactureLiteralTile(factoryTileDef, catalog, point(1, 2), undefined, "corner");
    manufactureLiteralTile(factoryTileDef, catalog, point(1, 2), undefined, "edge");
    assert.ok(first);

    const loaded = new TileCatalog();
    loaded.deserializeJson(catalog.toJson(), services);

    assert.equal((loaded.get(first.tileId) as BrainTileLiteralDef).displayName, "edge");
  });

  test("leaves the name of the registered literal standing where none is submitted", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "literal mint unnamed again");
    const catalog = brainDef.catalog();
    const factoryTileDef = pointLiteralFactory();

    const first = manufactureLiteralTile(factoryTileDef, catalog, point(1, 2), undefined, "corner");
    const again = manufactureLiteralTile(factoryTileDef, catalog, point(1, 2), undefined, "   ");

    assert.ok(first);
    assert.equal(again, first);
    assert.equal(first.displayName, "corner");
  });

  test("registers one tile per manufacture where the factory mints its own identity", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "unique literal mint");
    const catalog = brainDef.catalog();
    const factoryTileDef = uniquePointLiteralFactory();

    const first = manufactureLiteralTile(factoryTileDef, catalog, point(1, 2), undefined, "rock");
    const again = manufactureLiteralTile(factoryTileDef, catalog, point(1, 2), undefined, "rock");

    assert.ok(first && again);
    assert.notEqual(again, first, "the same content mints a second tile rather than resolving to the first");
    assert.notEqual(again.tileId, first.tileId);
    assert.deepEqual(mintedTileIds(catalog).sort(), [first.tileId, again.tileId].sort());
    assert.equal(first.displayName, "rock");
    assert.equal(again.displayName, "rock");
  });

  test("draws a literal identity from the source variable identities come from", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "unique literal identity source");
    const catalog = brainDef.catalog();

    const literal = manufactureLiteralTile(uniquePointLiteralFactory(), catalog, point(1, 2), undefined, "rock");
    const variable = manufactureVariableTile(numberVariableFactory(), catalog, "speed");
    const another = manufactureLiteralTile(uniquePointLiteralFactory(), catalog, point(1, 2), undefined, "stone");

    assert.ok(literal?.uniqueId && variable && another?.uniqueId);
    assert.notEqual(literal.uniqueId, another.uniqueId, "two ids minted in a row differ");
    assert.notEqual(literal.uniqueId, variable.uniqueId, "a literal and a variable never share an id");
    assert.equal(literal.tileId, mkUniqueLiteralTileId(literal.uniqueId));
    assert.equal(
      literal.uniqueId.length,
      mintDocumentId(services.app.rng).length,
      "the identity is a document id, not a locally shaped one"
    );
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
