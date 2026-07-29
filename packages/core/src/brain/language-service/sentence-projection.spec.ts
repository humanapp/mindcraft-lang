import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import type { BrainServices, IBrainRuleDef, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { mkActuatorTileId, mkSensorTileId, mkVariableTileId, TilePlacement } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import {
  flattenRuleTiles,
  projectRuleSentence,
  type SentenceSegment,
  sentenceText,
} from "@mindcraft-lang/core/brain/language-service";
import { BrainDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileModifierDef,
  BrainTileOperatorDef,
  BrainTilePageDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
  BrainTileVariableDef,
} from "@mindcraft-lang/core/brain/tiles";
import type { LocaleCatalog, Localizer } from "@mindcraft-lang/core/localization";
import { createDefaultLocalizer, createLocalizer, defaultPluralRule } from "@mindcraft-lang/core/localization";
import {
  bag,
  CoreHostActions,
  CoreOpId,
  CoreTypeIds,
  mkActionDescriptor,
  mkCallDef,
  NIL_VALUE,
  type TypeId,
} from "@mindcraft-lang/core/runtime";

let services: BrainServices;
let localizer: Localizer;
let nextFnId = 4600;

before(() => {
  services = __test__createBrainServices();
  localizer = createDefaultLocalizer();
});

// -- fixture builders (real tile defs on a real brain document) ---------------

/** Register a stub host function under a name unique to this call. */
function registerFn(name: string) {
  const fnId = nextFnId;
  nextFnId += 1;
  return services.runtime.functions.register(
    fnId,
    `${name}#${fnId}`,
    false,
    { exec: () => NIL_VALUE },
    mkCallDef(bag())
  );
}

function makeSensor(sensorId: string, metadata?: IBrainTileDef["metadata"]): BrainTileSensorDef {
  const descriptor = mkActionDescriptor("sensor", registerFn(sensorId), CoreTypeIds.Boolean);
  return new BrainTileSensorDef(sensorId, descriptor, { metadata });
}

/** A value-producing sensor readable mid-expression, as `inline: true` builds it. */
function makeInlineSensor(sensorId: string, metadata?: IBrainTileDef["metadata"]): BrainTileSensorDef {
  const descriptor = mkActionDescriptor("sensor", registerFn(sensorId), CoreTypeIds.Number);
  return new BrainTileSensorDef(sensorId, descriptor, {
    metadata,
    placement: TilePlacement.EitherSide | TilePlacement.Inline,
  });
}

function makeActuator(actuatorId: string, metadata?: IBrainTileDef["metadata"]): BrainTileActuatorDef {
  const descriptor = mkActionDescriptor("actuator", registerFn(actuatorId));
  return new BrainTileActuatorDef(actuatorId, descriptor, { metadata });
}

function makeLiteral(valueType: TypeId, value: unknown, valueLabel?: string): BrainTileLiteralDef {
  return new BrainTileLiteralDef(valueType, value, { valueLabel }, services);
}

function makeVariable(varName: string, varType: TypeId = CoreTypeIds.Number): BrainTileVariableDef {
  return new BrainTileVariableDef(mkVariableTileId(varName), varName, varType, varName);
}

function makeOperator(opId: string, label: string): BrainTileOperatorDef {
  return new BrainTileOperatorDef(opId, { metadata: { label } }, services);
}

function coreTile(tileId: string): IBrainTileDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `core tile ${tileId} is registered`);
  return tileDef;
}

/** Build a rule on a real brain document from the tiles of each side. */
function makeRule(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]): IBrainRuleDef {
  const brainDef = BrainDef.emptyBrainDef(services, "sentence-projection");
  const rule = brainDef.pages().get(0).children().get(0) as BrainRuleDef;
  for (const tileDef of whenTiles) {
    rule.when().appendTile(tileDef);
  }
  for (const tileDef of doTiles) {
    rule.do().appendTile(tileDef);
  }
  return rule;
}

function word(text: string, sourceTileIndex: number): SentenceSegment {
  return { kind: "word", text, sourceTileIndex };
}

function glue(text: string): SentenceSegment {
  return { kind: "glue", text };
}

function project(rule: IBrainRuleDef, withLocalizer?: Localizer): SentenceSegment[] {
  return projectRuleSentence(rule, withLocalizer ?? localizer).toArray();
}

function projectedText(rule: IBrainRuleDef, withLocalizer?: Localizer): string {
  return sentenceText(projectRuleSentence(rule, withLocalizer ?? localizer));
}

/** One rule per WHEN-side shape the projection renders, for the property sweeps. */
function fixtureRules(): IBrainRuleDef[] {
  return [
    makeRule([makeSensor("hear", { label: "hear" }), makeLiteral(CoreTypeIds.String, "a bang", "a bang")], []),
    makeRule([coreTile(mkSensorTileId(CoreHostActions.Timeout.key))], []),
    makeRule(
      [makeSensor("see", { label: "see" })],
      [makeActuator("walk", { label: "walk" }), makeLiteral(CoreTypeIds.Number, 3)]
    ),
    makeRule(
      [],
      [coreTile(mkActuatorTileId(CoreHostActions.SwitchPage.key)), new BrainTilePageDef("page-home", "Home")]
    ),
    makeRule(
      [makeVariable("speed"), makeOperator(CoreOpId.GreaterThan, ">"), makeLiteral(CoreTypeIds.Number, 5)],
      [makeActuator("walk", { label: "walk" })]
    ),
    makeRule(
      [
        makeInlineSensor("light level", { label: "light level" }),
        makeOperator(CoreOpId.GreaterThan, ">"),
        makeLiteral(CoreTypeIds.Number, 5),
      ],
      [makeActuator("walk", { label: "walk" })]
    ),
  ];
}

// -- golden segment lists -----------------------------------------------------

describe("sentence projection golden segments", () => {
  test("a verb-frame sensor with an object reads as its verb and object", () => {
    const rule = makeRule(
      [makeSensor("hear", { label: "hear" }), makeLiteral(CoreTypeIds.String, "a bang", "a bang")],
      []
    );

    assert.deepEqual(project(rule), [glue("When I "), word("hear", 0), glue(" "), word("a bang", 1), glue(".")]);
    assert.equal(projectedText(rule), "When I hear a bang.");
  });

  test("a state-frame sensor reads through the copula", () => {
    const rule = makeRule([makeSensor("hungry", { label: "hungry", language: { frame: "state" } })], []);

    assert.deepEqual(project(rule), [glue("When I am "), word("hungry", 0), glue(".")]);
    assert.equal(projectedText(rule), "When I am hungry.");
  });

  test("an event-frame sensor reads as the event", () => {
    const rule = makeRule([coreTile(mkSensorTileId(CoreHostActions.OnPageEntered.key))], []);

    assert.deepEqual(project(rule), [glue("When "), word("this page starts", 0), glue(".")]);
    assert.equal(projectedText(rule), "When this page starts.");
  });

  test("an empty WHEN reads as the always-word", () => {
    const rule = makeRule(
      [],
      [coreTile(mkActuatorTileId(CoreHostActions.SwitchPage.key)), new BrainTilePageDef("page-home", "Home")]
    );

    assert.deepEqual(project(rule), [glue("Always, "), word("go to", 0), glue(" "), word("Home", 1), glue(".")]);
    assert.equal(projectedText(rule), "Always, go to Home.");
  });

  test("a bare sensor completes with the bare word its metadata supplies", () => {
    const rule = makeRule([coreTile(mkSensorTileId(CoreHostActions.Timeout.key))], []);

    assert.deepEqual(project(rule), [glue("When I "), word("wait for", 0), glue(" "), word("a moment", 0), glue(".")]);
    assert.equal(projectedText(rule), "When I wait for a moment.");
  });

  test("a bare sensor with no bare word completes with the frame default", () => {
    const rule = makeRule([makeSensor("see", { label: "see" })], []);

    assert.deepEqual(project(rule), [glue("When I "), word("see", 0), glue(" "), word("anything", 0), glue(".")]);
    assert.equal(projectedText(rule), "When I see anything.");
  });

  test("a tile with no language metadata reads from its name", () => {
    const rule = makeRule([makeSensor("sensor.notice")], []);

    assert.deepEqual(project(rule), [glue("When I "), word("notice", 0), glue(" "), word("anything", 0), glue(".")]);
    assert.equal(projectedText(rule), "When I notice anything.");
  });

  test("a comparison-headed WHEN reads with no subject", () => {
    const rule = makeRule(
      [makeVariable("speed"), makeOperator(CoreOpId.GreaterThan, ">"), makeLiteral(CoreTypeIds.Number, 5)],
      []
    );

    assert.deepEqual(project(rule), [
      glue("When "),
      word("speed", 0),
      glue(" "),
      word(">", 1),
      glue(" "),
      word("5", 2),
      glue("."),
    ]);
    assert.equal(projectedText(rule), "When speed > 5.");
  });

  test("a comparison-headed WHEN keeps its subjectless reading before a DO clause", () => {
    const rule = makeRule(
      [makeVariable("speed"), makeOperator(CoreOpId.GreaterThan, ">"), makeLiteral(CoreTypeIds.Number, 5)],
      [makeActuator("walk", { label: "walk" })]
    );

    assert.deepEqual(project(rule), [
      glue("When "),
      word("speed", 0),
      glue(" "),
      word(">", 1),
      glue(" "),
      word("5", 2),
      glue(", "),
      word("walk", 3),
      glue("."),
    ]);
    assert.equal(projectedText(rule), "When speed > 5, walk.");
  });

  test("an inline sensor heading a comparison reads with no subject", () => {
    const rule = makeRule(
      [
        makeInlineSensor("light level", { label: "light level" }),
        makeOperator(CoreOpId.GreaterThan, ">"),
        makeLiteral(CoreTypeIds.Number, 5),
      ],
      []
    );

    assert.deepEqual(project(rule), [
      glue("When "),
      word("light level", 0),
      glue(" "),
      word(">", 1),
      glue(" "),
      word("5", 2),
      glue("."),
    ]);
    assert.equal(projectedText(rule), "When light level > 5.");
  });

  test("an inline sensor comparison keeps its subjectless reading before a DO clause", () => {
    const rule = makeRule(
      [
        makeInlineSensor("light level", { label: "light level" }),
        makeOperator(CoreOpId.GreaterThan, ">"),
        makeLiteral(CoreTypeIds.Number, 5),
      ],
      [makeActuator("walk", { label: "walk" })]
    );

    assert.deepEqual(project(rule), [
      glue("When "),
      word("light level", 0),
      glue(" "),
      word(">", 1),
      glue(" "),
      word("5", 2),
      glue(", "),
      word("walk", 3),
      glue("."),
    ]);
    assert.equal(projectedText(rule), "When light level > 5, walk.");
  });

  test("a non-inline sensor keeps its frame reading when tiles follow it", () => {
    const rule = makeRule(
      [makeSensor("hear", { label: "hear" }), new BrainTileModifierDef("loudly", { metadata: { label: "loudly" } })],
      []
    );

    assert.deepEqual(project(rule), [glue("When I "), word("hear", 0), glue(" "), word("loudly", 1), glue(".")]);
    assert.equal(projectedText(rule), "When I hear loudly.");
  });

  test("an inline sensor alone reads through its frame", () => {
    const rule = makeRule([makeInlineSensor("light level", { label: "light level" })], []);

    assert.deepEqual(project(rule), [
      glue("When I "),
      word("light level", 0),
      glue(" "),
      word("anything", 0),
      glue("."),
    ]);
    assert.equal(projectedText(rule), "When I light level anything.");
  });

  test("a DO side reads its action, modifiers, parameters, and values in tile order", () => {
    const rule = makeRule(
      [makeSensor("see", { label: "see" })],
      [
        makeActuator("walk", { label: "walk" }),
        new BrainTileModifierDef("quickly", { metadata: { label: "quickly" } }),
        new BrainTileParameterDef("speed", CoreTypeIds.Number, { metadata: { label: "at speed" } }),
        makeLiteral(CoreTypeIds.Number, 3),
      ]
    );

    assert.deepEqual(project(rule), [
      glue("When I "),
      word("see", 0),
      glue(" "),
      word("anything", 0),
      glue(", "),
      word("walk", 1),
      glue(" "),
      word("quickly", 2),
      glue(" "),
      word("at speed", 3),
      glue(" "),
      word("3", 4),
      glue("."),
    ]);
    assert.equal(projectedText(rule), "When I see anything, walk quickly at speed 3.");
  });

  test("a rule with no tiles projects no segments", () => {
    assert.deepEqual(project(makeRule([], [])), []);
  });
});

// -- span integrity -----------------------------------------------------------

describe("sentence projection spans", () => {
  test("every word segment resolves to a tile of the rule", () => {
    for (const rule of fixtureRules()) {
      const tiles = flattenRuleTiles(rule);
      for (const segment of project(rule)) {
        if (segment.kind === "word") {
          assert.ok(segment.sourceTileIndex >= 0 && segment.sourceTileIndex < tiles.size());
          assert.ok(tiles.get(segment.sourceTileIndex).tileDef.tileId.length > 0);
        }
      }
    }
  });

  test("every tile of the rule is covered by a word segment", () => {
    for (const rule of fixtureRules()) {
      const covered = new Set<number>();
      for (const segment of project(rule)) {
        if (segment.kind === "word") {
          covered.add(segment.sourceTileIndex);
        }
      }
      const tiles = flattenRuleTiles(rule);
      for (let i = 0; i < tiles.size(); i++) {
        assert.ok(covered.has(i), `tile ${i} of ${tiles.size()} contributes a word`);
      }
    }
  });

  test("the display string is the concatenation of the segments", () => {
    for (const rule of fixtureRules()) {
      const segments = projectRuleSentence(rule, localizer);
      const concatenated = segments
        .toArray()
        .map((segment) => segment.text)
        .join("");
      assert.equal(sentenceText(segments), concatenated);
    }
  });

  test("flattened tiles carry the side and per-side index of each tile", () => {
    const rule = makeRule(
      [makeSensor("see", { label: "see" })],
      [makeActuator("walk", { label: "walk" }), makeLiteral(CoreTypeIds.Number, 3)]
    );
    const tiles = flattenRuleTiles(rule);

    assert.equal(tiles.size(), 3);
    assert.equal(tiles.get(0).tileIndex, 0);
    assert.equal(tiles.get(0).tileDef, rule.when().tiles().get(0));
    assert.equal(tiles.get(1).tileIndex, 0);
    assert.equal(tiles.get(1).tileDef, rule.do().tiles().get(0));
    assert.equal(tiles.get(2).tileIndex, 1);
    assert.equal(tiles.get(2).tileDef, rule.do().tiles().get(1));
  });
});

// -- determinism --------------------------------------------------------------

describe("sentence projection determinism", () => {
  test("the same rule projects identically every time", () => {
    for (const rule of fixtureRules()) {
      assert.deepEqual(project(rule), project(rule));
    }
  });
});

// -- locale parameterization --------------------------------------------------

/**
 * A catalog translating every entry the projection looks up, plus one tile
 * label. Words it omits must survive untranslated.
 */
function testLocaleCatalog(): LocaleCatalog {
  return {
    locale: "zz",
    pluralRule: defaultPluralRule,
    entries: {},
    contexts: {
      "sentence-when": {
        "When I {form} {object}": "ZORP {form} {object} ZAP",
        "When I am {form} {object}": "ZORP MI {form} {object}",
        "When {form} {object}": "ZORP {form} {object}",
        "When {condition}": "ZORP KA {condition}",
        Always: "ALWAZ",
      },
      "sentence-bare": {
        "{frame, select, verb {anything} other {}}": "{frame, select, verb {ANYTHINGZ} other {}}",
      },
      "sentence-glue": {
        "{a} {b}": "{a}-{b}",
        "{trigger}, {action}": "{trigger} ;; {action}",
        "{sentence}.": "{sentence}!",
      },
      "tile-label": {
        see: "ZEE",
        // "walk" is deliberately absent: it must survive untranslated.
        // "Home" names a page -- user content the projection never localizes.
        Home: "HOMEZ",
      },
    },
  };
}

describe("sentence projection locale parameterization", () => {
  test("a catalog drives every projected word and connective", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const rule = makeRule(
      [makeSensor("see", { label: "see" })],
      [makeActuator("walk", { label: "walk" }), new BrainTilePageDef("page-home", "Home")]
    );

    assert.deepEqual(project(rule, translated), [
      glue("ZORP "),
      word("ZEE", 0),
      glue(" "),
      word("ANYTHINGZ", 0),
      glue(" ZAP ;; "),
      word("walk", 1),
      glue("-"),
      word("Home", 2),
      glue("!"),
    ]);
    assert.equal(projectedText(rule, translated), "ZORP ZEE ANYTHINGZ ZAP ;; walk-Home!");
  });

  test("the always-word and the state frame translate too", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const always = makeRule([], [makeActuator("walk", { label: "walk" })]);
    const state = makeRule([makeSensor("hungry", { label: "hungry", language: { frame: "state" } })], []);

    assert.equal(projectedText(always, translated), "ALWAZ ;; walk!");
    assert.equal(projectedText(state, translated), "ZORP MI hungry!");
  });

  test("the subjectless template translates too", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const rule = makeRule(
      [makeVariable("speed"), makeOperator(CoreOpId.GreaterThan, ">"), makeLiteral(CoreTypeIds.Number, 5)],
      []
    );

    assert.deepEqual(project(rule, translated), [
      glue("ZORP KA "),
      word("speed", 0),
      glue("-"),
      word(">", 1),
      glue("-"),
      word("5", 2),
      glue("!"),
    ]);
    assert.equal(projectedText(rule, translated), "ZORP KA speed->-5!");
  });

  test("an inline sensor comparison renders through the translated subjectless template", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const rule = makeRule(
      [
        makeInlineSensor("light level", { label: "light level" }),
        makeOperator(CoreOpId.GreaterThan, ">"),
        makeLiteral(CoreTypeIds.Number, 5),
      ],
      []
    );

    assert.deepEqual(project(rule, translated), [
      glue("ZORP KA "),
      word("light level", 0),
      glue("-"),
      word(">", 1),
      glue("-"),
      word("5", 2),
      glue("!"),
    ]);
  });

  test("switching locale is a pure re-render of the same rule", () => {
    const rule = makeRule([makeSensor("see", { label: "see" })], []);

    assert.equal(projectedText(rule), "When I see anything.");
    assert.equal(projectedText(rule, createLocalizer(testLocaleCatalog())), "ZORP ZEE ANYTHINGZ ZAP!");
    assert.equal(projectedText(rule), "When I see anything.");
  });
});
