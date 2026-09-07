/**
 * Pins editing a placed literal whose value type the host supplies an editor
 * for: which tiles offer which entries, what the editor's fields are seeded
 * with, and what submitting a value does to the rule, to the brain's catalog,
 * and to every other placement of the same literal.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@wendoo/core";
import type { BrainServices, IBrainTileDef, ITileCatalog } from "@wendoo/core/brain";
import { CoreVariableFactoryId, mkLiteralFactoryTileId, mkVariableFactoryTileId, RuleSide } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import {
  BrainCommandHistory,
  BrainDef,
  type BrainRuleDef,
  InsertRuleCommand,
  mintDocumentId,
} from "@wendoo/core/brain/model";
import {
  BrainTileFactoryDef,
  BrainTileLiteralDef,
  manufactureLiteralTile,
  manufactureVariableTile,
} from "@wendoo/core/brain/tiles";
import type { NumberValue, StructValue, TypeId, Value } from "@wendoo/core/runtime";
import { CoreTypeIds, mkClosedStructValue, mkNumberValue, TARGET_TYPE_ATOM_BASE } from "@wendoo/core/runtime";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type BrainEditorConfig, BrainEditorProvider, type CustomLiteralType } from "./BrainEditorContext";
import {
  CreateLiteralDialog,
  kLiteralNameFieldId,
  LiteralNameField,
  literalNameAccepted,
  literalTypeTakesName,
  submittedLiteralName,
} from "./CreateLiteralDialog";
import {
  buildTileMenuEntries,
  duplicateLiteralValue,
  editLiteralValue,
  literalValueEditor,
  TileMenuEntryKeys,
} from "./tile-menu-model";
import { resolveTileVisualFrom } from "./tile-visual-utils";

/** Factory id of the content-addressed literal factory these specs register. */
const kPointFactoryId = "point";

/** Factory id of the unique-identity literal factory these specs register. */
const kMarkFactoryId = "mark";

let services: BrainServices;
let pointTypeId: TypeId;
let markTypeId: TypeId;

before(() => {
  services = __test__createBrainServices();
  pointTypeId = services.runtime.types.addStructType("Point", {
    atomId: TARGET_TYPE_ATOM_BASE,
    fields: List.from([
      { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
      { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
    ]),
  });
  markTypeId = services.runtime.types.addStructType("Mark", {
    atomId: TARGET_TYPE_ATOM_BASE + 1,
    fields: List.from([
      { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
      { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
    ]),
  });
  services.edit.tiles.registerTileDef(
    new BrainTileFactoryDef(
      mkLiteralFactoryTileId(kPointFactoryId),
      kPointFactoryId,
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
    )
  );
  services.edit.tiles.registerTileDef(
    new BrainTileFactoryDef(
      mkLiteralFactoryTileId(kMarkFactoryId),
      kMarkFactoryId,
      (factoryTileDef, opts) =>
        new BrainTileLiteralDef(
          factoryTileDef.producedDataType,
          opts.value as StructValue,
          { uniqueId: mintDocumentId(services.app.rng) },
          services
        ),
      markTypeId
    )
  );
});

/** A point of the content-addressed struct type these specs registered. */
function point(x: number, y: number): StructValue {
  return mkClosedStructValue(pointTypeId, List.from<Value>([mkNumberValue(x), mkNumberValue(y)]));
}

/** A mark of the unique-identity struct type these specs registered. */
function mark(x: number, y: number): StructValue {
  return mkClosedStructValue(markTypeId, List.from<Value>([mkNumberValue(x), mkNumberValue(y)]));
}

/** The label a point literal's tile id carries, read off the point's own fields. */
function pointLabel(value: StructValue): string {
  const fields = value.v as List<Value>;
  return `x${(fields.get(0) as NumberValue).v}y${(fields.get(1) as NumberValue).v}`;
}

/** The coordinates a struct value carries, as the editor's field state. */
function coordinateInputState(value: unknown): Record<string, string> {
  const structValue = value as StructValue;
  if (!structValue || !(structValue.v instanceof List)) return {};
  const fields = structValue.v as List<Value>;
  return { x: `${(fields.get(0) as NumberValue).v}`, y: `${(fields.get(1) as NumberValue).v}` };
}

/** What a rendered custom literal editor was handed. */
interface EditorCalls {
  /** Every value the editor was asked for a field state for. */
  seededFrom: unknown[];
  /** Every field state the editor was rendered with. */
  renderedWith: Record<string, string>[];
}

/** The host's editor for a coordinate type, recording what it is handed. */
function coordinateLiteralType(
  typeId: TypeId,
  make: (x: number, y: number) => StructValue,
  calls: EditorCalls = { seededFrom: [], renderedWith: [] }
): CustomLiteralType {
  return {
    typeId,
    description: "Name a point.",
    isValid: (state) => state.x !== "" && state.y !== "",
    parseValue: (state) => make(Number.parseFloat(state.x ?? ""), Number.parseFloat(state.y ?? "")),
    toInputState: (value) => {
      calls.seededFrom.push(value);
      return coordinateInputState(value);
    },
    renderInputFields: (state): ReactNode => {
      calls.renderedWith.push(state);
      return null;
    },
    formatValue: (value) => pointLabel(value as StructValue),
  };
}

/** The host's editor for the content-addressed type. */
function pointLiteralType(calls?: EditorCalls): CustomLiteralType {
  return coordinateLiteralType(pointTypeId, point, calls);
}

/** The host's editor for the unique-identity type. */
function markLiteralType(): CustomLiteralType {
  return coordinateLiteralType(markTypeId, mark);
}

/** A literal minted through `factoryId` and placed on the DO side of a fresh brain's first rule. */
function placedLiteral(
  factoryId: string,
  value: StructValue,
  displayName?: string
): { brainDef: BrainDef; ruleDef: BrainRuleDef; placed: BrainTileLiteralDef } {
  const brainDef = BrainDef.emptyBrainDef(services, "literal edit");
  const ruleDef = brainDef.pages().get(0).children().get(0) as BrainRuleDef;
  const factoryTileDef = services.edit.tiles.get(mkLiteralFactoryTileId(factoryId)) as BrainTileFactoryDef;
  const placed = manufactureLiteralTile(factoryTileDef, brainDef.catalog(), value, undefined, displayName);
  assert.ok(placed);
  ruleDef.side(RuleSide.Do).appendTile(placed);
  return { brainDef, ruleDef, placed };
}

/** A second rule of `brainDef`'s first page, holding `tileDef` on its DO side. */
function secondRuleHolding(brainDef: BrainDef, ruleDef: BrainRuleDef, tileDef: IBrainTileDef): BrainRuleDef {
  const command = new InsertRuleCommand(ruleDef, "after");
  new BrainCommandHistory().executeCommand(command);
  const inserted = brainDef.pages().get(0).children().get(1) as BrainRuleDef;
  inserted.side(RuleSide.Do).appendTile(tileDef);
  return inserted;
}

/** The tile standing at `tileIndex` on the DO side of `ruleDef`. */
function placedTile(ruleDef: BrainRuleDef, tileIndex: number): IBrainTileDef {
  return ruleDef.side(RuleSide.Do).tiles().get(tileIndex) as IBrainTileDef;
}

/** Ids of the literal tiles `catalog` holds. */
function literalTileIds(catalog: ITileCatalog): string[] {
  const ids: string[] = [];
  for (const tileDef of catalog.getAll().toArray()) {
    if (tileDef.kind === "literal") ids.push(tileDef.tileId);
  }
  return ids.sort();
}

/** Keys of the entries the menu of `tileDef` offers, with no documentation wired up. */
function entryKeys(
  tileDef: IBrainTileDef,
  customLiteralTypes: CustomLiteralType[],
  tiles?: ITileCatalog,
  documentCatalog?: ITileCatalog
): string[] {
  const editor = literalValueEditor(tileDef, customLiteralTypes, tiles, documentCatalog);
  return buildTileMenuEntries(tileDef, editor, {
    editFormat: () => {},
    editValue: () => {},
    duplicateValue: () => {},
    renameVariable: () => {},
  }).map((entry) => entry.key);
}

describe("the entries a placed tile's menu offers", () => {
  test("a literal the brain's own catalog holds offers editing and duplicating its value", () => {
    const { brainDef, placed } = placedLiteral(kPointFactoryId, point(1, 2));

    assert.deepEqual(entryKeys(placed, [pointLiteralType()], services.edit.tiles, brainDef.catalog()), [
      TileMenuEntryKeys.Value,
      TileMenuEntryKeys.Duplicate,
    ]);
  });

  test("a literal an environment catalog provides offers duplicating it alone", () => {
    const provided = new BrainTileLiteralDef(
      pointTypeId,
      point(9, 9),
      { valueLabel: "corner", persist: false },
      services
    );
    services.edit.tiles.registerTileDef(provided);
    const brainDef = BrainDef.emptyBrainDef(services, "provided literal menu");

    assert.deepEqual(entryKeys(provided, [pointLiteralType()], services.edit.tiles, brainDef.catalog()), [
      TileMenuEntryKeys.Duplicate,
    ]);
  });

  test("a number literal, whose type has no custom editor, offers only its format entry", () => {
    const numberLiteral = new BrainTileLiteralDef(CoreTypeIds.Number, 7, {}, services);

    assert.deepEqual(entryKeys(numberLiteral, [pointLiteralType()], services.edit.tiles), [TileMenuEntryKeys.Format]);
  });

  test("a variable tile offers no value entry", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "variable menu");
    const factoryTileDef = services.edit.tiles.get(
      mkVariableFactoryTileId(CoreVariableFactoryId.Number)
    ) as BrainTileFactoryDef;
    const variableTile = manufactureVariableTile(factoryTileDef, brainDef.catalog(), "score");
    assert.ok(variableTile);

    assert.deepEqual(entryKeys(variableTile, [pointLiteralType()], services.edit.tiles), [TileMenuEntryKeys.Rename]);
  });

  test("a literal whose type has a custom editor but no factory to mint through offers no entry", () => {
    const { brainDef, placed } = placedLiteral(kPointFactoryId, point(1, 2));

    assert.deepEqual(entryKeys(placed, [pointLiteralType()], brainDef.catalog(), brainDef.catalog()), []);
  });

  test("a literal offers no entry where the host registered no editor for its type", () => {
    const { brainDef, placed } = placedLiteral(kPointFactoryId, point(1, 2));

    assert.deepEqual(entryKeys(placed, [], services.edit.tiles, brainDef.catalog()), []);
  });
});

describe("submitting a new value for a literal carrying its own identity", () => {
  test("carries the value and the name to every placement, under one tile id", () => {
    const { brainDef, ruleDef, placed } = placedLiteral(kMarkFactoryId, mark(1, 2), "rock");
    const otherRule = secondRuleHolding(brainDef, ruleDef, placed);
    const editor = literalValueEditor(placed, [markLiteralType()], services.edit.tiles, brainDef.catalog());
    assert.ok(editor);

    const edited = editLiteralValue({
      ruleDef,
      side: RuleSide.Do,
      tileIndex: 0,
      editor,
      value: mark(3, 4),
      displayName: "stone",
      commandHistory: new BrainCommandHistory(),
    });

    assert.ok(edited);
    assert.equal(edited.tileId, placed.tileId, "the identity survives the edit");
    assert.equal(placedTile(ruleDef, 0), edited);
    assert.equal(placedTile(otherRule, 0), edited, "the other placement follows");
    assert.equal(brainDef.catalog().get(placed.tileId), edited);
    assert.deepEqual(literalTileIds(brainDef.catalog()), [placed.tileId]);
    assert.deepEqual(coordinateInputState((edited as BrainTileLiteralDef).value), { x: "3", y: "4" });
    assert.equal((edited as BrainTileLiteralDef).displayName, "stone");
  });

  test("undo restores the value and the name at every placement", () => {
    const { brainDef, ruleDef, placed } = placedLiteral(kMarkFactoryId, mark(1, 2), "rock");
    const otherRule = secondRuleHolding(brainDef, ruleDef, placed);
    const editor = literalValueEditor(placed, [markLiteralType()], services.edit.tiles, brainDef.catalog());
    assert.ok(editor);
    const commandHistory = new BrainCommandHistory();
    editLiteralValue({
      ruleDef,
      side: RuleSide.Do,
      tileIndex: 0,
      editor,
      value: mark(3, 4),
      displayName: "stone",
      commandHistory,
    });

    commandHistory.undo();

    assert.equal(placedTile(ruleDef, 0), placed);
    assert.equal(placedTile(otherRule, 0), placed);
    assert.equal(brainDef.catalog().get(placed.tileId), placed);
    assert.deepEqual(coordinateInputState(placed.value), { x: "1", y: "2" });
    assert.equal(placed.displayName, "rock");
  });
});

describe("submitting a new value for a literal whose id follows its content", () => {
  test("puts a literal of that value in its place and registers it", () => {
    const { brainDef, ruleDef, placed } = placedLiteral(kPointFactoryId, point(1, 2));
    const editor = literalValueEditor(placed, [pointLiteralType()], services.edit.tiles, brainDef.catalog());
    assert.ok(editor);

    const replacement = editLiteralValue({
      ruleDef,
      side: RuleSide.Do,
      tileIndex: 0,
      editor,
      value: point(3, 4),
      commandHistory: new BrainCommandHistory(),
    });

    assert.ok(replacement);
    assert.notEqual(replacement.tileId, placed.tileId, "different content mints a different tile id");
    assert.equal(placedTile(ruleDef, 0), replacement);
    assert.equal(brainDef.catalog().get(replacement.tileId), replacement);
    assert.deepEqual(literalTileIds(brainDef.catalog()), [placed.tileId, replacement.tileId].sort());
  });

  test("places the literal already registered when the value has the same content", () => {
    const { brainDef, ruleDef, placed } = placedLiteral(kPointFactoryId, point(1, 2));
    const editor = literalValueEditor(placed, [pointLiteralType()], services.edit.tiles, brainDef.catalog());
    assert.ok(editor);
    const commandHistory = new BrainCommandHistory();

    const moved = editLiteralValue({
      ruleDef,
      side: RuleSide.Do,
      tileIndex: 0,
      editor,
      value: point(3, 4),
      commandHistory,
    });
    assert.ok(moved);
    const movedEditor = literalValueEditor(moved, [pointLiteralType()], services.edit.tiles, brainDef.catalog());
    assert.ok(movedEditor);
    const back = editLiteralValue({
      ruleDef,
      side: RuleSide.Do,
      tileIndex: 0,
      editor: movedEditor,
      value: point(1, 2),
      commandHistory,
    });

    assert.equal(back, placed, "the registered literal of that content is the one placed");
    assert.deepEqual(literalTileIds(brainDef.catalog()), [placed.tileId, moved.tileId].sort());
  });

  test("undo restores the tile replaced, and redo puts the edit back", () => {
    const { brainDef, ruleDef, placed } = placedLiteral(kPointFactoryId, point(1, 2));
    const editor = literalValueEditor(placed, [pointLiteralType()], services.edit.tiles, brainDef.catalog());
    assert.ok(editor);
    const commandHistory = new BrainCommandHistory();
    const replacement = editLiteralValue({
      ruleDef,
      side: RuleSide.Do,
      tileIndex: 0,
      editor,
      value: point(3, 4),
      commandHistory,
    });
    assert.ok(replacement);

    commandHistory.undo();
    assert.equal(placedTile(ruleDef, 0), placed);

    commandHistory.redo();
    assert.equal(placedTile(ruleDef, 0), replacement);
  });
});

describe("duplicating a placed literal", () => {
  test("mints a literal of its own, leaving the one it was forked from registered", () => {
    const { brainDef, ruleDef, placed } = placedLiteral(kMarkFactoryId, mark(1, 2), "rock");
    const editor = literalValueEditor(placed, [markLiteralType()], services.edit.tiles, brainDef.catalog());
    assert.ok(editor);

    const fork = duplicateLiteralValue({
      ruleDef,
      side: RuleSide.Do,
      tileIndex: 0,
      editor,
      value: mark(1, 2),
      displayName: "rock 2",
      commandHistory: new BrainCommandHistory(),
    });

    assert.ok(fork);
    assert.notEqual(fork.tileId, placed.tileId);
    assert.equal(placedTile(ruleDef, 0), fork);
    assert.deepEqual(literalTileIds(brainDef.catalog()), [placed.tileId, fork.tileId].sort());
  });

  test("takes a name another literal already reads by", () => {
    const { brainDef, ruleDef, placed } = placedLiteral(kMarkFactoryId, mark(1, 2), "rock");
    const editor = literalValueEditor(placed, [markLiteralType()], services.edit.tiles, brainDef.catalog());
    assert.ok(editor);

    const fork = duplicateLiteralValue({
      ruleDef,
      side: RuleSide.Do,
      tileIndex: 0,
      editor,
      value: mark(5, 6),
      displayName: "rock",
      commandHistory: new BrainCommandHistory(),
    });

    assert.ok(fork);
    assert.equal((fork as BrainTileLiteralDef).displayName, "rock");
    assert.equal(placed.displayName, "rock");
    assert.notEqual(fork.tileId, placed.tileId);
    assert.equal(literalTileIds(brainDef.catalog()).length, 2);
  });
});

describe("the editor the value dialog opens", () => {
  test("is seeded with the value the placed literal carries", () => {
    const calls: EditorCalls = { seededFrom: [], renderedWith: [] };
    const customType = pointLiteralType(calls);
    const config: BrainEditorConfig = {
      dataTypeIcons: new Map(),
      dataTypeNames: new Map(),
      customLiteralTypes: [customType],
    };
    const value = point(1, 2);

    renderToStaticMarkup(
      <BrainEditorProvider config={config}>
        <CreateLiteralDialog
          isOpen
          title="Edit Value"
          literalType={pointTypeId}
          initialValue={value}
          onOpenChange={() => {}}
          onSubmit={() => {}}
        />
      </BrainEditorProvider>
    );

    assert.deepEqual(calls.seededFrom, [value]);
    assert.deepEqual(calls.renderedWith, [{ x: "1", y: "2" }]);
  });

  test("opens on empty fields where no value was handed to it", () => {
    const calls: EditorCalls = { seededFrom: [], renderedWith: [] };
    const customType = pointLiteralType(calls);
    const config: BrainEditorConfig = {
      dataTypeIcons: new Map(),
      dataTypeNames: new Map(),
      customLiteralTypes: [customType],
    };

    renderToStaticMarkup(
      <BrainEditorProvider config={config}>
        <CreateLiteralDialog
          isOpen
          title="Create Point"
          literalType={pointTypeId}
          onOpenChange={() => {}}
          onSubmit={() => {}}
        />
      </BrainEditorProvider>
    );

    assert.deepEqual(calls.seededFrom, []);
    assert.deepEqual(calls.renderedWith, [{}]);
  });
});

describe("the field naming a literal", () => {
  test("stands for a type the host supplies an editor for, and for neither built-in form", () => {
    const customTypes = [pointLiteralType()];

    assert.equal(literalTypeTakesName(pointTypeId, customTypes), true);
    assert.equal(literalTypeTakesName(CoreTypeIds.Number, customTypes), false);
    assert.equal(literalTypeTakesName(CoreTypeIds.String, customTypes), false);
  });

  test("stands for no type the host supplied no editor for", () => {
    assert.equal(literalTypeTakesName(pointTypeId, []), false);
  });

  test("holds the name it is given", () => {
    const markup = renderToStaticMarkup(<LiteralNameField value="rock" onChange={() => {}} onSubmit={() => {}} />);

    assert.ok(markup.includes(`data-testid="${kLiteralNameFieldId}"`));
    assert.ok(markup.includes('value="rock"'));
  });

  test("takes no submission while it holds nothing but spaces", () => {
    assert.equal(literalNameAccepted(""), false);
    assert.equal(literalNameAccepted("   "), false);
    assert.equal(literalNameAccepted("\t\n"), false);
    assert.equal(literalNameAccepted("rock"), true);
    assert.equal(literalNameAccepted("  rock  "), true);
  });

  test("puts the padded name it holds on the literal without its padding", () => {
    assert.equal(submittedLiteralName(" rock "), "rock");
    assert.equal(submittedLiteralName("\timage 2\n"), "image 2");
    assert.equal(submittedLiteralName("rock"), "rock");
    assert.equal(submittedLiteralName("   "), undefined);
  });
});

describe("submitting a name for a placed literal", () => {
  test("names the literal put in its place, on every surface reading its word", () => {
    const { brainDef, ruleDef, placed } = placedLiteral(kPointFactoryId, point(1, 2));
    const editor = literalValueEditor(placed, [pointLiteralType()], services.edit.tiles, brainDef.catalog());
    assert.ok(editor);

    const replacement = editLiteralValue({
      ruleDef,
      side: RuleSide.Do,
      tileIndex: 0,
      editor,
      value: point(3, 4),
      displayName: "corner",
      commandHistory: new BrainCommandHistory(),
    });

    assert.ok(replacement);
    assert.equal((replacement as BrainTileLiteralDef).displayName, "corner");
    assert.equal(resolveTileVisualFrom(undefined, replacement).label, "corner");
  });

  test("renames the literal already registered for that content, keeping its tile id", () => {
    const { brainDef, ruleDef, placed } = placedLiteral(kPointFactoryId, point(1, 2));
    const editor = literalValueEditor(placed, [pointLiteralType()], services.edit.tiles, brainDef.catalog());
    assert.ok(editor);

    const renamed = editLiteralValue({
      ruleDef,
      side: RuleSide.Do,
      tileIndex: 0,
      editor,
      value: point(1, 2),
      displayName: "corner",
      commandHistory: new BrainCommandHistory(),
    });

    assert.equal(renamed, placed);
    assert.equal((placed as BrainTileLiteralDef).displayName, "corner");
    assert.deepEqual(literalTileIds(brainDef.catalog()), [placed.tileId]);
  });
});
