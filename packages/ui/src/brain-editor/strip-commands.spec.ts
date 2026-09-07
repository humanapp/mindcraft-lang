/**
 * Pins the commands the offering leads with: which of them each armed position
 * offers, where they sit among the chips, what a duplicate seeds its editor
 * with, and that opening a duplicate and abandoning it leaves the brain exactly
 * as it stood.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@wendoo/core";
import type { BrainServices, IBrainTileDef } from "@wendoo/core/brain";
import { mkLiteralFactoryTileId, RuleSide } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import {
  BrainCommandHistory,
  BrainDef,
  type BrainRuleDef,
  InsertTileCommand,
  mintDocumentId,
  ReplaceTileCommand,
} from "@wendoo/core/brain/model";
import { BrainTileFactoryDef, BrainTileLiteralDef, manufactureLiteralTile } from "@wendoo/core/brain/tiles";
import type { StructValue, TypeId, Value } from "@wendoo/core/runtime";
import { CoreTypeIds, mkClosedStructValue, mkNumberValue, TARGET_TYPE_ATOM_BASE } from "@wendoo/core/runtime";
import { kBestNextBandKey, type StripOptionBand, visibleStripOptions } from "./candidate-strip-model";
import { type ComposerInputFacts, type ComposerInputState, reduceComposerInput } from "./composer-input-model";
import { routeTileSelection } from "./hooks/useTileSelection";
import { literalForkSeed, type StripCommandContext, StripCommandKinds, stripCommands } from "./strip-commands";

/** Factory id of the unique-identity literal factory these specs register. */
const kBadgeFactoryId = "badge";

/** Strip id the option ids of these specs are built under. */
const kStripId = "strip";

let services: BrainServices;
let badgeTypeId: TypeId;

before(() => {
  services = __test__createBrainServices();
  badgeTypeId = services.runtime.types.addStructType("Badge", {
    atomId: TARGET_TYPE_ATOM_BASE,
    fields: List.from([{ name: "level", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
  });
  services.edit.tiles.registerTileDef(
    new BrainTileFactoryDef(
      mkLiteralFactoryTileId(kBadgeFactoryId),
      kBadgeFactoryId,
      (factoryTileDef, opts) =>
        new BrainTileLiteralDef(
          factoryTileDef.producedDataType,
          opts.value as StructValue,
          { uniqueId: mintDocumentId(services.app.rng), displayName: opts.displayName as string | undefined },
          services
        ),
      badgeTypeId
    )
  );
});

/** A badge value of `level`. */
function badge(level: number): StructValue {
  return mkClosedStructValue(badgeTypeId, List.from<Value>([mkNumberValue(level)]));
}

/** A badge literal of its own identity, reading by `displayName`. */
function namedBadge(displayName: string): BrainTileLiteralDef {
  return new BrainTileLiteralDef(
    badgeTypeId,
    badge(3),
    { uniqueId: mintDocumentId(services.app.rng), displayName },
    services
  );
}

/** The context of a position standing on an editable literal of the brain's own. */
function context(overrides: Partial<StripCommandContext>): StripCommandContext {
  return {
    mode: "replace",
    standsOnLiteral: true,
    literalIsEditable: true,
    positionTakesType: true,
    ...overrides,
  };
}

/** The kinds of the commands `overrides` offers. */
function commandKinds(overrides: Partial<StripCommandContext>): string[] {
  return stripCommands(context(overrides)).map((command) => command.kind);
}

describe("the commands an armed position offers", () => {
  test("replacing a literal of the brain's own offers editing it and duplicating it", () => {
    assert.deepEqual(commandKinds({ mode: "replace" }), [StripCommandKinds.Edit, StripCommandKinds.Duplicate]);
  });

  test("replacing a literal an environment catalog provides offers duplicating it alone", () => {
    assert.deepEqual(commandKinds({ mode: "replace", literalIsEditable: false }), [StripCommandKinds.Duplicate]);
  });

  test("inserting beside a literal offers duplicating it, and never editing it", () => {
    assert.deepEqual(commandKinds({ mode: "insert" }), [StripCommandKinds.Duplicate]);
    assert.deepEqual(commandKinds({ mode: "append" }), [StripCommandKinds.Duplicate]);
    assert.deepEqual(commandKinds({ mode: "insert", literalIsEditable: false }), [StripCommandKinds.Duplicate]);
  });

  test("inserting where the position takes no literal of that type offers nothing", () => {
    assert.deepEqual(commandKinds({ mode: "insert", positionTakesType: false }), []);
    assert.deepEqual(commandKinds({ mode: "append", positionTakesType: false }), []);
  });

  test("replacing offers duplicating even where the position is read as taking no such literal", () => {
    assert.deepEqual(commandKinds({ mode: "replace", positionTakesType: false }), [
      StripCommandKinds.Edit,
      StripCommandKinds.Duplicate,
    ]);
  });

  test("a position standing on no such literal offers nothing, in every mode", () => {
    for (const mode of ["replace", "insert", "append"] as const) {
      assert.deepEqual(commandKinds({ mode, standsOnLiteral: false }), []);
    }
  });
});

describe("where the command chips sit among the offering", () => {
  test("they lead their band, before the tiles it offers", () => {
    const commands = stripCommands(context({}));
    const band: StripOptionBand = {
      key: kBestNextBandKey,
      commands,
      entries: [],
    };

    const options = visibleStripOptions(kStripId, [band]);

    assert.deepEqual(
      options.map((option) => option.candidateKey),
      commands.map((command) => command.key)
    );
  });
});

describe("the seed a duplicate opens its editor on", () => {
  test("carries the literal's own value and the next free number under its word", () => {
    const literalDef = namedBadge("rock");

    const seed = literalForkSeed(literalDef, new Set(["rock", "rock 2"]));

    assert.equal(seed.value, literalDef.value);
    assert.equal(seed.displayName, "rock 3");
  });

  test("numbers under the stem of an already numbered word", () => {
    assert.equal(literalForkSeed(namedBadge("heart 1"), new Set(["heart 1"])).displayName, "heart 2");
  });
});

/** A brain whose first rule holds one badge literal on its DO side. */
function placedBadge(): {
  brainDef: BrainDef;
  ruleDef: BrainRuleDef;
  placed: BrainTileLiteralDef;
  factory: BrainTileFactoryDef;
} {
  const brainDef = BrainDef.emptyBrainDef(services, "duplicate command");
  const ruleDef = brainDef.pages().get(0).children().get(0) as BrainRuleDef;
  const factory = services.edit.tiles.get(mkLiteralFactoryTileId(kBadgeFactoryId)) as BrainTileFactoryDef;
  const placed = manufactureLiteralTile(factory, brainDef.catalog(), badge(1), undefined, "rock");
  assert.ok(placed);
  ruleDef.side(RuleSide.Do).appendTile(placed);
  return { brainDef, ruleDef, placed, factory };
}

describe("opening a duplicate and abandoning it", () => {
  for (const mode of ["replace", "insert"] as const) {
    test(`leaves the brain as it stands, ${mode === "replace" ? "replacing" : "inserting beside"} the literal`, () => {
      const { brainDef, ruleDef, placed, factory } = placedBadge();
      const commandHistory = new BrainCommandHistory();
      const catalogSizeBefore = brainDef.catalog().getAll().size();
      const tilesBefore = ruleDef.side(RuleSide.Do).tiles().size();
      let deferredSeedName: string | undefined;
      let placements = 0;
      const place = (tileDef: IBrainTileDef) => {
        placements += 1;
        commandHistory.executeCommand(
          mode === "replace"
            ? new ReplaceTileCommand(ruleDef, RuleSide.Do, 0, tileDef)
            : new InsertTileCommand(ruleDef, RuleSide.Do, 0, tileDef)
        );
      };

      const completed = routeTileSelection(
        factory,
        place,
        {
          deferVariableCreation: () => assert.fail("a literal factory defers to the literal dialog"),
          deferLiteralCreation: (deferredFactory, _action, seed) => {
            assert.equal(deferredFactory, factory);
            deferredSeedName = seed?.displayName;
          },
        },
        literalForkSeed(placed, new Set(["rock"]))
      );

      assert.equal(completed, false, "the selection waits on the dialog");
      assert.equal(deferredSeedName, "rock 2");
      assert.equal(placements, 0, "nothing is placed until the dialog is submitted");
      assert.equal(brainDef.catalog().getAll().size(), catalogSizeBefore, "no literal is minted");
      assert.equal(ruleDef.side(RuleSide.Do).tiles().size(), tilesBefore);
      assert.equal(commandHistory.canUndo(), false, "nothing is recorded on the history");
      assert.equal(ruleDef.side(RuleSide.Do).tiles().get(0), placed);
    });
  }
});

/** The composer state a strip armed from the tray stands in while its chips are browsed. */
function browsingState(optionId: string): ComposerInputState {
  return {
    caret: undefined,
    armedSide: RuleSide.Do,
    armedEntry: "tray",
    filter: "",
    cursor: { kind: "chip", optionId },
    highlightMode: "browsing",
    pivoted: false,
    textLiteral: undefined,
  };
}

/** Facts reading the offering as standing one highlighted command and nothing else. */
function factsHighlighting(command: ReturnType<typeof stripCommands>[number] | undefined): ComposerInputFacts {
  return {
    mode: "tray-armed",
    caretRun: [],
    textCursor: { start: 0, end: 0 },
    armedSideCanEnd: true,
    positionOffersTile: true,
    ruleIsEmpty: false,
    doTileCount: 1,
    ownNewestPlacement: undefined,
    topCandidate: undefined,
    spaceCandidate: undefined,
    highlightedCandidate: undefined,
    highlightedCommand: command,
    leadCursor: undefined,
    acceptsTextLiteral: false,
    pendingTextLiteral: undefined,
    options: [],
    cellGeometry: [],
  };
}

describe("the keyboard on a command chip", () => {
  test("runs the command it stands on", () => {
    const command = stripCommands(context({}))[0];
    const { effects } = reduceComposerInput(
      browsingState("chip"),
      { kind: "enter", from: "band" },
      factsHighlighting(command)
    );

    assert.deepEqual(
      effects.map((effect) => effect.kind),
      ["consume-key", "run-command"]
    );
  });

  test("standing on no command runs none", () => {
    const { effects } = reduceComposerInput(
      browsingState("chip"),
      { kind: "enter", from: "band" },
      factsHighlighting(undefined)
    );

    assert.equal(
      effects.some((effect) => effect.kind === "run-command"),
      false
    );
  });
});
