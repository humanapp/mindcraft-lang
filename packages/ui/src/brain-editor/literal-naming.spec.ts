/**
 * Pins the words a literal is offered: the base a type is numbered from, the
 * names already taken across the catalogs a name has to be free of, and the one
 * sequence a default name is drawn from, whether it is created or forked.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { BrainDef, mintDocumentId } from "@wendoo/core/brain/model";
import { BrainTileLiteralDef } from "@wendoo/core/brain/tiles";
import type { StructValue, TypeId, Value } from "@wendoo/core/runtime";
import { CoreTypeIds, mkClosedStructValue, mkNumberValue, TARGET_TYPE_ATOM_BASE } from "@wendoo/core/runtime";
import type { CustomLiteralType } from "./BrainEditorContext";
import {
  kDefaultLiteralNameBase,
  literalNameBase,
  literalWord,
  takenLiteralNames,
  takenLiteralNamesAround,
  unusedNumberedName,
} from "./literal-naming";

let services: BrainServices;
let badgeTypeId: TypeId;
let otherTypeId: TypeId;

before(() => {
  services = __test__createBrainServices();
  badgeTypeId = services.runtime.types.addStructType("Badge", {
    atomId: TARGET_TYPE_ATOM_BASE,
    fields: List.from([{ name: "level", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
  });
  otherTypeId = services.runtime.types.addStructType("Sticker", {
    atomId: TARGET_TYPE_ATOM_BASE + 1,
    fields: List.from([{ name: "level", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
  });
});

/** A badge value of `level`. */
function badge(typeId: TypeId, level: number): StructValue {
  return mkClosedStructValue(typeId, List.from<Value>([mkNumberValue(level)]));
}

/** A named literal of `typeId` carrying its own identity. */
function namedLiteral(typeId: TypeId, level: number, displayName: string): BrainTileLiteralDef {
  return new BrainTileLiteralDef(
    typeId,
    badge(typeId, level),
    { uniqueId: mintDocumentId(services.app.rng), displayName },
    services
  );
}

/** The host's entry for the badge type, with or without a base word of its own. */
function badgeLiteralType(nameBase?: string): CustomLiteralType {
  return {
    typeId: badgeTypeId,
    nameBase,
    description: "Name a badge.",
    isValid: () => true,
    parseValue: () => badge(badgeTypeId, 0),
    toInputState: () => ({}),
    renderInputFields: () => null,
    formatValue: () => "badge",
  };
}

describe("the base word a type's names are numbered from", () => {
  test("is the type's own where it supplies one", () => {
    const names = new Map([[badgeTypeId, "sticker"]]);

    assert.equal(literalNameBase(badgeTypeId, badgeLiteralType("badge"), names), "badge");
  });

  test("falls back to the word the config calls the type by", () => {
    const names = new Map([[badgeTypeId, "sticker"]]);

    assert.equal(literalNameBase(badgeTypeId, badgeLiteralType(), names), "sticker");
  });

  test("falls back to a generic word where neither names the type", () => {
    assert.equal(literalNameBase(badgeTypeId, badgeLiteralType(), new Map()), kDefaultLiteralNameBase);
    assert.equal(literalNameBase(badgeTypeId, undefined, new Map()), kDefaultLiteralNameBase);
  });
});

describe("the names already taken", () => {
  test("are read from every catalog handed over, and from that value type alone", () => {
    const environment = BrainDef.emptyBrainDef(services, "environment").catalog();
    const document = BrainDef.emptyBrainDef(services, "document").catalog();
    environment.registerTileDef(namedLiteral(badgeTypeId, 1, "rock"));
    environment.registerTileDef(namedLiteral(otherTypeId, 1, "sticker"));
    document.registerTileDef(namedLiteral(badgeTypeId, 2, "paper"));

    const taken = takenLiteralNames([environment, document, undefined], badgeTypeId);

    assert.deepEqual([...taken].sort(), ["paper", "rock"]);
  });

  test("include the word a literal named by its metadata alone reads by", () => {
    const catalog = BrainDef.emptyBrainDef(services, "provided").catalog();
    const provided = new BrainTileLiteralDef(
      badgeTypeId,
      badge(badgeTypeId, 3),
      { valueLabel: "level3", metadata: { label: "heart" } },
      services
    );
    catalog.registerTileDef(provided);

    assert.equal(literalWord(provided), "heart");
    assert.deepEqual([...takenLiteralNames([catalog], badgeTypeId)], ["heart"]);
  });

  test("cover the host's catalogs and the brain's own together", () => {
    const environment = BrainDef.emptyBrainDef(services, "environment").catalog();
    const brain = BrainDef.emptyBrainDef(services, "document").catalog();
    environment.registerTileDef(namedLiteral(badgeTypeId, 1, "rock"));
    brain.registerTileDef(namedLiteral(badgeTypeId, 2, "paper"));

    assert.deepEqual([...takenLiteralNamesAround([environment], brain, badgeTypeId)].sort(), ["paper", "rock"]);
    assert.deepEqual([...takenLiteralNamesAround(undefined, brain, badgeTypeId)], ["paper"]);
    assert.deepEqual([...takenLiteralNamesAround([environment], undefined, badgeTypeId)], ["rock"]);
  });
});

describe("the default name a literal is offered", () => {
  test("numbers a creation from one, taking the smallest free number", () => {
    assert.equal(unusedNumberedName("image", new Set()), "image 1");
    assert.equal(unusedNumberedName("image", new Set(["image 1"])), "image 2");
    assert.equal(unusedNumberedName("image", new Set(["image 1", "image 2", "image 4"])), "image 3");
  });

  test("reuses a freed number rather than counting past the highest taken one", () => {
    assert.equal(unusedNumberedName("image", new Set(["image 1", "image 3"])), "image 2");
  });

  test("numbers from two where the bare word is itself taken", () => {
    assert.equal(unusedNumberedName("rock", new Set(["rock"])), "rock 2");
    assert.equal(unusedNumberedName("rock", new Set(["rock", "rock 2"])), "rock 3");
  });

  test("numbers a fork from the stem of its word, never past a second number", () => {
    assert.equal(unusedNumberedName("image 1", new Set(["image 1"])), "image 2");
    assert.equal(unusedNumberedName("heart 2", new Set(["heart", "heart 2"])), "heart 3");
  });

  test("stems only a trailing run of digits, and takes the whole word otherwise", () => {
    assert.equal(unusedNumberedName("rock v2", new Set(["rock v2"])), "rock v2 2");
    assert.equal(unusedNumberedName("image  ", new Set(["image  "])), "image   2");
    assert.equal(unusedNumberedName("42", new Set(["42"])), "42 2");
  });
});
