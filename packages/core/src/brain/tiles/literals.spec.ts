import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { LiteralDisplayFormats, mkUniqueLiteralTileId } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { tileSentenceWord } from "@wendoo/core/brain/language-service";
import type { CatalogTileJson, LiteralTileJson } from "@wendoo/core/brain/tiles";
import { BrainTileLiteralDef, TileCatalog } from "@wendoo/core/brain/tiles";
import { createDefaultLocalizer } from "@wendoo/core/localization";
import type { BufferValue, NumberValue, StructValue, TypeId, Value } from "@wendoo/core/runtime";
import {
  bufferToHex,
  CoreTypeIds,
  mkBufferValueFromHex,
  mkClosedStructValue,
  mkNumberValue,
} from "@wendoo/core/runtime";

/** Field slots of the struct type registered for these tests. */
const PixelGridField = {
  Width: 0,
  Height: 1,
  Pixels: 2,
} as const;

let services: BrainServices;
let pixelGridTypeId: TypeId;

before(() => {
  services = __test__createBrainServices();
  pixelGridTypeId = services.runtime.types.addStructType("PixelGrid", {
    atomId: 20000,
    fields: List.from([
      { name: "width", typeId: CoreTypeIds.Number, fieldIndex: PixelGridField.Width },
      { name: "height", typeId: CoreTypeIds.Number, fieldIndex: PixelGridField.Height },
      { name: "pixels", typeId: CoreTypeIds.Buffer, fieldIndex: PixelGridField.Pixels },
    ]),
  });
});

/** A closed `PixelGrid` struct value whose `pixels` buffer holds the bytes `pixelsHex` names. */
function mkPixelGrid(width: number, height: number, pixelsHex: string): StructValue {
  const slots = List.empty<Value>();
  slots.push(mkNumberValue(width));
  slots.push(mkNumberValue(height));
  slots.push(mkBufferValueFromHex(pixelsHex));
  return mkClosedStructValue(pixelGridTypeId, slots);
}

/** The struct value slots of `tileDef`, as the numeric width/height and the hex of the pixel buffer. */
function pixelGridSlots(tileDef: BrainTileLiteralDef): [number, number, string] {
  const value = tileDef.value as StructValue;
  const slots = value.v;
  assert.ok(slots, "the struct literal value carries field slots");
  assert.equal(slots.size(), 3);
  return [
    (slots.get(PixelGridField.Width) as NumberValue).v,
    (slots.get(PixelGridField.Height) as NumberValue).v,
    bufferToHex(slots.get(PixelGridField.Pixels) as BufferValue),
  ];
}

/** The catalog entry for `tileId`, which must be a literal entry. */
function literalEntry(json: List<CatalogTileJson>, tileId: string): LiteralTileJson {
  const entries = json.toArray().filter((entry) => entry.tileId === tileId);
  assert.equal(entries.length, 1, tileId);
  return entries[0] as LiteralTileJson;
}

/** Save `catalog` to JSON and load it back into a fresh catalog. */
function roundTrip(catalog: TileCatalog): TileCatalog {
  const loaded = new TileCatalog();
  loaded.deserializeJson(catalog.toJson(), services);
  return loaded;
}

describe("struct literal persistence", () => {
  test("round-trips two distinct struct literals slot-exact through the catalog", () => {
    const catalog = new TileCatalog();
    const firstHex = "000102030405060708090a0b0c0d0e0f101112131415161718";
    const secondHex = "ff00ff00ff";
    const first = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 5, firstHex),
      { valueLabel: "grid-5x5-a" },
      services
    );
    const second = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 1, secondHex),
      { valueLabel: "grid-5x1-b" },
      services
    );
    catalog.registerTileDef(first);
    catalog.registerTileDef(second);
    assert.notEqual(first.tileId, second.tileId);

    const loaded = roundTrip(catalog);

    const loadedFirst = loaded.get(first.tileId) as BrainTileLiteralDef;
    const loadedSecond = loaded.get(second.tileId) as BrainTileLiteralDef;
    assert.ok(loadedFirst, first.tileId);
    assert.ok(loadedSecond, second.tileId);
    assert.equal(loadedFirst.valueType, pixelGridTypeId);
    assert.equal(loadedSecond.valueType, pixelGridTypeId);
    assert.deepEqual(pixelGridSlots(loadedFirst), [5, 5, firstHex]);
    assert.deepEqual(pixelGridSlots(loadedSecond), [5, 1, secondHex]);
    assert.deepEqual(pixelGridSlots(loadedFirst), pixelGridSlots(first));
    assert.deepEqual(pixelGridSlots(loadedSecond), pixelGridSlots(second));
  });

  test("round-trips a buffer-typed field byte-exact, including a zero byte", () => {
    const catalog = new TileCatalog();
    const pixelsHex = "00017fff80";
    const tileDef = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 1, pixelsHex),
      { valueLabel: "grid-5x1-bytes" },
      services
    );
    catalog.registerTileDef(tileDef);

    const loaded = roundTrip(catalog).get(tileDef.tileId) as BrainTileLiteralDef;

    const pixels = (loaded.value as StructValue).v!.get(PixelGridField.Pixels) as BufferValue;
    assert.equal(pixels.v.length(), 5);
    assert.equal(bufferToHex(pixels), pixelsHex);
  });

  test("keeps the struct literal entry at the unchanged literal entry version", () => {
    const catalog = new TileCatalog();
    const tileDef = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(2, 2, "01020304"),
      { valueLabel: "grid-2x2" },
      services
    );
    catalog.registerTileDef(tileDef);

    assert.equal(literalEntry(catalog.toJson(), tileDef.tileId).version, 2);
  });
});

describe("primitive literal persistence", () => {
  test("serializes number, string and boolean entries in their existing shape", () => {
    const catalog = new TileCatalog();
    const number = new BrainTileLiteralDef(CoreTypeIds.Number, 42, {}, services);
    const text = new BrainTileLiteralDef(CoreTypeIds.String, "hello", {}, services);
    const flag = new BrainTileLiteralDef(CoreTypeIds.Boolean, true, {}, services);
    catalog.registerTileDef(number);
    catalog.registerTileDef(text);
    catalog.registerTileDef(flag);

    const json = catalog.toJson();

    assert.deepEqual(literalEntry(json, number.tileId), {
      version: 2,
      kind: "literal",
      tileId: number.tileId,
      valueType: CoreTypeIds.Number,
      value: 42,
      valueLabel: "42",
      displayFormat: LiteralDisplayFormats.Default,
    });
    assert.deepEqual(literalEntry(json, text.tileId), {
      version: 2,
      kind: "literal",
      tileId: text.tileId,
      valueType: CoreTypeIds.String,
      value: "hello",
      valueLabel: "hello",
      displayFormat: LiteralDisplayFormats.Default,
    });
    assert.deepEqual(literalEntry(json, flag.tileId), {
      version: 2,
      kind: "literal",
      tileId: flag.tileId,
      valueType: CoreTypeIds.Boolean,
      value: true,
      valueLabel: "true",
      displayFormat: LiteralDisplayFormats.Default,
    });
  });

  test("carries no name field for a literal that was never named", () => {
    const catalog = new TileCatalog();
    const number = new BrainTileLiteralDef(CoreTypeIds.Number, 42, {}, services);
    catalog.registerTileDef(number);

    const entry = literalEntry(catalog.toJson(), number.tileId);

    assert.ok(!Object.hasOwn(entry, "displayName"));
  });

  test("round-trips number, string and boolean values unchanged", () => {
    const catalog = new TileCatalog();
    const number = new BrainTileLiteralDef(CoreTypeIds.Number, 42, {}, services);
    const text = new BrainTileLiteralDef(CoreTypeIds.String, "hello", {}, services);
    const flag = new BrainTileLiteralDef(CoreTypeIds.Boolean, true, {}, services);
    catalog.registerTileDef(number);
    catalog.registerTileDef(text);
    catalog.registerTileDef(flag);

    const loaded = roundTrip(catalog);

    assert.equal((loaded.get(number.tileId) as BrainTileLiteralDef).value, 42);
    assert.equal((loaded.get(text.tileId) as BrainTileLiteralDef).value, "hello");
    assert.equal((loaded.get(flag.tileId) as BrainTileLiteralDef).value, true);
  });
});

describe("literal display names", () => {
  const localizer = createDefaultLocalizer();

  test("keeps the name of a named struct literal across a save and load", () => {
    const catalog = new TileCatalog();
    const tileDef = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 5, "0f0f0f0f0f"),
      { valueLabel: "grid-5x5-named", displayName: "rock" },
      services
    );
    catalog.registerTileDef(tileDef);

    assert.equal(literalEntry(catalog.toJson(), tileDef.tileId).displayName, "rock");
    const loaded = roundTrip(catalog).get(tileDef.tileId) as BrainTileLiteralDef;

    assert.equal(loaded.displayName, "rock");
    assert.equal(loaded.metadata?.label, "rock");
    assert.equal(loaded.metadata?.language?.form, "rock");
  });

  test("leaves the tile id and the value untouched when the literal is renamed", () => {
    const catalog = new TileCatalog();
    const tileDef = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 5, "0102030405"),
      { valueLabel: "grid-5x5-rename", displayName: "rock" },
      services
    );
    catalog.registerTileDef(tileDef);
    const idBefore = tileDef.tileId;

    tileDef.setDisplayName("stone");

    assert.equal(tileDef.tileId, idBefore);
    assert.equal(literalEntry(catalog.toJson(), idBefore).displayName, "stone");
    const loaded = roundTrip(catalog).get(idBefore) as BrainTileLiteralDef;
    assert.equal(loaded.displayName, "stone");
    assert.equal(tileSentenceWord(loaded, localizer), "stone");
    assert.deepEqual(pixelGridSlots(loaded), [5, 5, "0102030405"]);
  });

  test("reads as its name where it carries one, and as its value where it does not", () => {
    const named = new BrainTileLiteralDef(CoreTypeIds.Number, 42, { displayName: "answer" }, services);
    const unnamed = new BrainTileLiteralDef(CoreTypeIds.Number, 42, {}, services);

    assert.equal(tileSentenceWord(named, localizer), "answer");
    assert.equal(tileSentenceWord(unnamed, localizer), "42");
  });

  test("holds two literals of the same name and different content apart", () => {
    const catalog = new TileCatalog();
    const first = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 5, "1111111111"),
      { valueLabel: "grid-5x5-same-name-a", displayName: "rock" },
      services
    );
    const second = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 5, "2222222222"),
      { valueLabel: "grid-5x5-same-name-b", displayName: "rock" },
      services
    );
    catalog.registerTileDef(first);
    catalog.registerTileDef(second);

    assert.notEqual(first.tileId, second.tileId);
    const loaded = roundTrip(catalog);
    assert.equal(loaded.getAll().size(), 2);
    assert.equal((loaded.get(first.tileId) as BrainTileLiteralDef).displayName, "rock");
    assert.equal((loaded.get(second.tileId) as BrainTileLiteralDef).displayName, "rock");
  });
});

describe("unique-identity literals", () => {
  test("holds two literals of identical content and different names apart", () => {
    const catalog = new TileCatalog();
    const pixelsHex = "0f0f0f0f0f";
    const first = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 5, pixelsHex),
      { uniqueId: "gridIdentityA", displayName: "rock" },
      services
    );
    const second = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 5, pixelsHex),
      { uniqueId: "gridIdentityB", displayName: "stone" },
      services
    );
    catalog.registerTileDef(first);
    catalog.registerTileDef(second);

    assert.equal(first.tileId, mkUniqueLiteralTileId("gridIdentityA"));
    assert.notEqual(first.tileId, second.tileId);
    assert.deepEqual(pixelGridSlots(first), pixelGridSlots(second));

    const loaded = roundTrip(catalog);

    assert.equal(loaded.getAll().size(), 2);
    const loadedFirst = loaded.get(first.tileId) as BrainTileLiteralDef;
    const loadedSecond = loaded.get(second.tileId) as BrainTileLiteralDef;
    assert.equal(loadedFirst.uniqueId, "gridIdentityA");
    assert.equal(loadedSecond.uniqueId, "gridIdentityB");
    assert.equal(loadedFirst.displayName, "rock");
    assert.equal(loadedSecond.displayName, "stone");
    assert.deepEqual(pixelGridSlots(loadedFirst), [5, 5, pixelsHex]);
    assert.deepEqual(pixelGridSlots(loadedSecond), [5, 5, pixelsHex]);
  });

  test("carries its identity in the catalog entry", () => {
    const catalog = new TileCatalog();
    const tileDef = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 5, "0102030405"),
      { uniqueId: "gridIdentityJson" },
      services
    );
    catalog.registerTileDef(tileDef);

    const entry = literalEntry(catalog.toJson(), tileDef.tileId);

    assert.equal(entry.uniqueId, "gridIdentityJson");
    assert.equal(entry.valueLabel, "gridIdentityJson", "the value label follows the identity where none is given");
  });

  test("stands still under its own id when its value and name change", () => {
    const original = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 5, "0101010101"),
      { uniqueId: "gridIdentityEdit", displayName: "rock" },
      services
    );

    const edited = original.edited({ value: mkPixelGrid(5, 5, "0202020202"), displayName: "stone" });

    assert.equal(edited.tileId, original.tileId);
    assert.equal(edited.uniqueId, "gridIdentityEdit");
    assert.equal(edited.displayName, "stone");
    assert.deepEqual(pixelGridSlots(edited), [5, 5, "0202020202"]);
    assert.deepEqual(pixelGridSlots(original), [5, 5, "0101010101"], "the edited copy leaves the original alone");
  });

  test("carries over the field an edit leaves out", () => {
    const original = new BrainTileLiteralDef(
      pixelGridTypeId,
      mkPixelGrid(5, 5, "0303030303"),
      { uniqueId: "gridIdentityPartial", displayName: "rock" },
      services
    );

    const renamed = original.edited({ displayName: "stone" });
    const repainted = original.edited({ value: mkPixelGrid(5, 5, "0404040404") });

    assert.deepEqual(pixelGridSlots(renamed), [5, 5, "0303030303"]);
    assert.equal(repainted.displayName, "rock");
  });

  test("refuses to edit a literal whose id follows its content", () => {
    const contentAddressed = new BrainTileLiteralDef(CoreTypeIds.Number, 42, {}, services);

    assert.throws(() => contentAddressed.edited({ value: 43 }));
  });
});
