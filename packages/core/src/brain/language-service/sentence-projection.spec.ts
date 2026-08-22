import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import type { BrainServices, IBrainPageDef, IBrainRuleDef, IBrainTileDef } from "@wendoo/core/brain";
import {
  CoreCapabilityBits,
  CoreControlFlowId,
  CoreLiteralFactoryId,
  mkActuatorTileId,
  mkControlFlowTileId,
  mkLiteralFactoryTileId,
  mkOperatorTileId,
  mkSensorTileId,
  mkVariableTileId,
  TilePlacement,
} from "@wendoo/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@wendoo/core/brain/__test__";
import {
  flattenRuleTiles,
  paragraphText,
  projectPageParagraph,
  projectRuleSentence,
  type SentenceSegment,
  segmentDisplayText,
  sentenceText,
  tileSentenceWord,
  whenTriggerWord,
} from "@wendoo/core/brain/language-service";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import {
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileModifierDef,
  BrainTilePageDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
  BrainTileVariableDef,
  getCatalogFallbackLabel,
} from "@wendoo/core/brain/tiles";
import type { LocaleCatalog, Localizer } from "@wendoo/core/localization";
import { createDefaultLocalizer, createLocalizer, defaultPluralRule } from "@wendoo/core/localization";
import {
  type BrainActionCallSpec,
  bag,
  CoreHostActions,
  CoreOpId,
  CoreTypeIds,
  mkActionDescriptor,
  mkCallDef,
  NIL_VALUE,
  optional,
  param,
  type TypeId,
} from "@wendoo/core/runtime";
import { BitSet } from "@wendoo/core/util";

let services: BrainServices;
let localizer: Localizer;
let nextFnId = 4600;

before(() => {
  services = __test__createBrainServices();
  localizer = createDefaultLocalizer();
});

// -- fixture builders (real tile defs on a real brain document) ---------------

/** Register a stub host function under a name unique to this call. */
function registerFn(name: string, callSpec: BrainActionCallSpec = bag()) {
  const fnId = nextFnId;
  nextFnId += 1;
  return services.runtime.functions.register(
    fnId,
    `${name}#${fnId}`,
    false,
    { exec: () => NIL_VALUE },
    mkCallDef(callSpec)
  );
}

/** A sensor whose call spec declares no argument slot at all. */
function makeSensor(sensorId: string, metadata?: IBrainTileDef["metadata"]): BrainTileSensorDef {
  const descriptor = mkActionDescriptor("sensor", registerFn(sensorId), CoreTypeIds.Boolean);
  return new BrainTileSensorDef(sensorId, descriptor, { metadata });
}

/** A sensor declaring one optional object argument, as a sensor taking a target builds it. */
function makeObjectSensor(sensorId: string, metadata?: IBrainTileDef["metadata"]): BrainTileSensorDef {
  const callSpec = bag(optional(param(`${sensorId}-object`)));
  const descriptor = mkActionDescriptor("sensor", registerFn(sensorId, callSpec), CoreTypeIds.Boolean);
  return new BrainTileSensorDef(sensorId, descriptor, { metadata });
}

/** A presence-gated value sensor: it delivers a value when it fires and nil otherwise. */
function makePresenceGatedSensor(sensorId: string, metadata?: IBrainTileDef["metadata"]): BrainTileSensorDef {
  const descriptor = mkActionDescriptor("sensor", registerFn(sensorId), CoreTypeIds.Number);
  return new BrainTileSensorDef(sensorId, descriptor, {
    metadata,
    capabilities: new BitSet().set(CoreCapabilityBits.PresenceGated),
  });
}

/** A value-producing sensor readable mid-expression, as `inline: true` builds it. */
function makeInlineSensor(sensorId: string, metadata?: IBrainTileDef["metadata"]): BrainTileSensorDef {
  const descriptor = mkActionDescriptor("sensor", registerFn(sensorId), CoreTypeIds.Number);
  return new BrainTileSensorDef(sensorId, descriptor, {
    metadata,
    placement: TilePlacement.EitherSide | TilePlacement.Inline,
  });
}

/** An inline value sensor that is also presence-gated, as the radio receivers are. */
function makeInlinePresenceGatedSensor(sensorId: string, metadata?: IBrainTileDef["metadata"]): BrainTileSensorDef {
  const descriptor = mkActionDescriptor("sensor", registerFn(sensorId), CoreTypeIds.Number);
  return new BrainTileSensorDef(sensorId, descriptor, {
    metadata,
    capabilities: new BitSet().set(CoreCapabilityBits.PresenceGated),
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
    __test__appendTile(rule.when(), tileDef);
  }
  for (const tileDef of doTiles) {
    __test__appendTile(rule.do(), tileDef);
  }
  return rule;
}

/** One rule of a page fixture: the tiles of each side, plus any child rules. */
interface RuleSpec {
  readonly when?: readonly IBrainTileDef[];
  readonly do?: readonly IBrainTileDef[];
  readonly children?: readonly RuleSpec[];
}

/** A page of a real brain document with its auto-appended trailing rule removed. */
function makeEmptyPage(): BrainPageDef {
  const brainDef = BrainDef.emptyBrainDef(services, "page-paragraph");
  const page = brainDef.pages().get(0) as BrainPageDef;
  page.removeRuleAtIndex(0);
  return page;
}

/**
 * Append each spec of `specs` to `page` in document order, indenting it `depth`
 * times so it lands under the rule its spec nests in.
 */
function appendRuleSpecs(page: BrainPageDef, specs: readonly RuleSpec[], depth: number): void {
  for (const spec of specs) {
    const rule = page.appendNewRule();
    for (const tileDef of spec.when ?? []) {
      __test__appendTile(rule.when(), tileDef);
    }
    for (const tileDef of spec.do ?? []) {
      __test__appendTile(rule.do(), tileDef);
    }
    for (let i = 0; i < depth; i++) {
      assert.ok(rule.indent(), `rule indents to depth ${depth}`);
    }
    appendRuleSpecs(page, spec.children ?? [], depth + 1);
  }
}

/** Build a page on a real brain document from the rule tree `specs` describes. */
function makePage(specs: readonly RuleSpec[]): BrainPageDef {
  const page = makeEmptyPage();
  appendRuleSpecs(page, specs, 0);
  return page;
}

/** The reading a tile's own word segment carries: its sentence word, quoted for a text literal. */
function projectedWord(tileDef: IBrainTileDef): string {
  const word = tileSentenceWord(tileDef, localizer);
  const isText = tileDef.kind === "literal" && (tileDef as BrainTileLiteralDef).valueType === CoreTypeIds.String;
  return isText ? `"${word}"` : word;
}

function word(text: string, sourceTileIndex: number): SentenceSegment {
  return { kind: "word", text, sourceTileIndex };
}

/** The word segment standing first in its sentence, which displays in the locale's opening case. */
function initialWord(text: string, sourceTileIndex: number): SentenceSegment {
  return { kind: "word", text, sourceTileIndex, sentenceInitial: true };
}

function glue(text: string): SentenceSegment {
  return { kind: "glue", text };
}

function project(rule: IBrainRuleDef, withLocalizer?: Localizer): SentenceSegment[] {
  return projectRuleSentence(rule, withLocalizer ?? localizer).toArray();
}

function projectedText(rule: IBrainRuleDef, withLocalizer?: Localizer): string {
  const active = withLocalizer ?? localizer;
  return sentenceText(projectRuleSentence(rule, active), active);
}

/** One rule per WHEN-side shape the projection renders, for the property sweeps. */
function fixtureRules(): IBrainRuleDef[] {
  return [
    makeRule([makeSensor("hear", { label: "hear" }), makeLiteral(CoreTypeIds.String, "a bang", "a bang")], []),
    makeRule([coreTile(mkSensorTileId(CoreHostActions.Timeout.key))], []),
    makeRule([makeSensor("hungry", { label: "hungry" })], []),
    makeRule([makePresenceGatedSensor("radio message", { label: "radio message", language: { frame: "event" } })], []),
    makeRule(
      [makeObjectSensor("see", { label: "see" })],
      [makeActuator("walk", { label: "walk" }), makeLiteral(CoreTypeIds.Number, 3)]
    ),
    makeRule(
      [],
      [coreTile(mkActuatorTileId(CoreHostActions.SwitchPage.key)), new BrainTilePageDef("page-home", "Home")]
    ),
    makeRule(
      [makeVariable("speed"), coreTile(mkOperatorTileId(CoreOpId.GreaterThan)), makeLiteral(CoreTypeIds.Number, 5)],
      [makeActuator("walk", { label: "walk" })]
    ),
    makeRule(
      [
        makeInlineSensor("light level", { label: "light level" }),
        coreTile(mkOperatorTileId(CoreOpId.GreaterThan)),
        makeLiteral(CoreTypeIds.Number, 5),
      ],
      [makeActuator("walk", { label: "walk" })]
    ),
    makeRule(
      [coreTile(mkOperatorTileId(CoreOpId.Not)), makeObjectSensor("see", { label: "see" })],
      [makeActuator("walk", { label: "walk" })]
    ),
    makeRule([coreTile(mkSensorTileId(CoreHostActions.Otherwise.key))], [makeActuator("wander", { label: "wander" })]),
  ];
}

// -- golden segment lists -----------------------------------------------------

describe("sentence projection golden segments", () => {
  test("a verb-frame sensor with an object reads as its verb and object", () => {
    const rule = makeRule(
      [makeSensor("hear", { label: "hear" }), makeLiteral(CoreTypeIds.String, "a bang", "a bang")],
      []
    );

    assert.deepEqual(project(rule), [glue("When I "), word("hear", 0), glue(" "), word('"a bang"', 1), glue(",")]);
    assert.equal(projectedText(rule), 'When I hear "a bang",');
  });

  test("a state-frame sensor reads through the copula", () => {
    const rule = makeRule([makeSensor("hungry", { label: "hungry", language: { frame: "state" } })], []);

    assert.deepEqual(project(rule), [glue("When I am "), word("hungry", 0), glue(",")]);
    assert.equal(projectedText(rule), "When I am hungry,");
  });

  test("an event-frame sensor reads as the event", () => {
    const rule = makeRule([coreTile(mkSensorTileId(CoreHostActions.OnPageEntered.key))], []);

    assert.deepEqual(project(rule), [glue("When "), word("this page starts", 0), glue(",")]);
    assert.equal(projectedText(rule), "When this page starts,");
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

    assert.deepEqual(project(rule), [glue("When I "), word("wait for", 0), glue(" "), word("a moment", 0), glue(",")]);
    assert.equal(projectedText(rule), "When I wait for a moment,");
  });

  test("a sensor declaring an object argument completes with the frame default", () => {
    const rule = makeRule([makeObjectSensor("see", { label: "see" })], []);

    assert.deepEqual(project(rule), [glue("When I "), word("see", 0), glue(" "), word("anything", 0), glue(",")]);
    assert.equal(projectedText(rule), "When I see anything,");
  });

  test("a sensor declaring no argument takes no bare completion", () => {
    const rule = makeRule([makeSensor("hungry", { label: "hungry" })], []);

    assert.deepEqual(project(rule), [glue("When I "), word("hungry", 0), glue(",")]);
    assert.equal(projectedText(rule), "When I hungry,");
  });

  test("an argless sensor still completes with the bare word its metadata supplies", () => {
    const rule = makeRule([makeSensor("nap", { label: "nap", language: { bare: "for a while" } })], []);

    assert.equal(projectedText(rule), "When I nap for a while,");
  });

  test("a presence-gated sensor alone reads through its own frame", () => {
    const event = makeRule(
      [makePresenceGatedSensor("radio message", { label: "radio message", language: { frame: "event" } })],
      []
    );
    const state = makeRule([makePresenceGatedSensor("thirst", { label: "thirsty", language: { frame: "state" } })], []);

    assert.deepEqual(project(event), [glue("When "), word("radio message", 0), glue(",")]);
    assert.equal(projectedText(event), "When radio message,");
    assert.equal(projectedText(state), "When I am thirsty,");
  });

  test("a presence-gated sensor reads the same way when more tiles follow it", () => {
    const rule = makeRule(
      [
        makePresenceGatedSensor("radio message", { label: "radio message", language: { frame: "event" } }),
        new BrainTileModifierDef("loudly", { metadata: { label: "loudly" } }),
      ],
      []
    );

    assert.equal(projectedText(rule), "When radio message loudly,");
  });

  test("a tile with no language metadata reads from its name", () => {
    const rule = makeRule([makeSensor("sensor.notice")], []);

    assert.deepEqual(project(rule), [glue("When I "), word("notice", 0), glue(",")]);
    assert.equal(projectedText(rule), "When I notice,");
  });

  test("a comparison-headed WHEN reads with no subject", () => {
    const rule = makeRule(
      [makeVariable("speed"), coreTile(mkOperatorTileId(CoreOpId.GreaterThan)), makeLiteral(CoreTypeIds.Number, 5)],
      []
    );

    assert.deepEqual(project(rule), [
      glue("When "),
      word("speed", 0),
      glue(" "),
      word("is greater than", 1),
      glue(" "),
      word("5", 2),
      glue(","),
    ]);
    assert.equal(projectedText(rule), "When speed is greater than 5,");
  });

  test("a comparison-headed WHEN keeps its subjectless reading before a DO clause", () => {
    const rule = makeRule(
      [makeVariable("speed"), coreTile(mkOperatorTileId(CoreOpId.GreaterThan)), makeLiteral(CoreTypeIds.Number, 5)],
      [makeActuator("walk", { label: "walk" })]
    );

    assert.deepEqual(project(rule), [
      glue("When "),
      word("speed", 0),
      glue(" "),
      word("is greater than", 1),
      glue(" "),
      word("5", 2),
      glue(", "),
      word("walk", 3),
      glue("."),
    ]);
    assert.equal(projectedText(rule), "When speed is greater than 5, walk.");
  });

  test("an inline sensor heading a comparison reads with no subject", () => {
    const rule = makeRule(
      [
        makeInlineSensor("light level", { label: "light level" }),
        coreTile(mkOperatorTileId(CoreOpId.GreaterThan)),
        makeLiteral(CoreTypeIds.Number, 5),
      ],
      []
    );

    assert.deepEqual(project(rule), [
      glue("When "),
      word("light level", 0),
      glue(" "),
      word("is greater than", 1),
      glue(" "),
      word("5", 2),
      glue(","),
    ]);
    assert.equal(projectedText(rule), "When light level is greater than 5,");
  });

  test("an inline sensor comparison keeps its subjectless reading before a DO clause", () => {
    const rule = makeRule(
      [
        makeInlineSensor("light level", { label: "light level" }),
        coreTile(mkOperatorTileId(CoreOpId.GreaterThan)),
        makeLiteral(CoreTypeIds.Number, 5),
      ],
      [makeActuator("walk", { label: "walk" })]
    );

    assert.deepEqual(project(rule), [
      glue("When "),
      word("light level", 0),
      glue(" "),
      word("is greater than", 1),
      glue(" "),
      word("5", 2),
      glue(", "),
      word("walk", 3),
      glue("."),
    ]);
    assert.equal(projectedText(rule), "When light level is greater than 5, walk.");
  });

  test("a non-inline sensor keeps its frame reading when tiles follow it", () => {
    const rule = makeRule(
      [makeSensor("hear", { label: "hear" }), new BrainTileModifierDef("loudly", { metadata: { label: "loudly" } })],
      []
    );

    assert.deepEqual(project(rule), [glue("When I "), word("hear", 0), glue(" "), word("loudly", 1), glue(",")]);
    assert.equal(projectedText(rule), "When I hear loudly,");
  });

  test("an inline sensor alone reads with no subject", () => {
    const rule = makeRule([makeInlineSensor("light level", { label: "light level" })], []);

    assert.deepEqual(project(rule), [glue("When "), word("light level", 0), glue(",")]);
    assert.equal(projectedText(rule), "When light level,");
  });

  test("an inline presence-gated sensor alone reads with no subject", () => {
    const rule = makeRule([makeInlinePresenceGatedSensor("radio message", { label: "radio message" })], []);

    assert.deepEqual(project(rule), [glue("When "), word("radio message", 0), glue(",")]);
    assert.equal(projectedText(rule), "When radio message,");
  });

  test("a DO side reads its action, modifiers, parameters, and values in tile order", () => {
    const rule = makeRule(
      [makeObjectSensor("see", { label: "see" })],
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

// -- the shipped core catalog -------------------------------------------------

describe("shipped core catalog readings", () => {
  test("a value sensor alone reads with no subject", () => {
    assert.equal(
      projectedText(makeRule([coreTile(mkSensorTileId(CoreHostActions.Random.key))], [])),
      "When a random number,"
    );
    assert.equal(
      projectedText(makeRule([coreTile(mkSensorTileId(CoreHostActions.CurrentPage.key))], [])),
      "When the current page,"
    );
    assert.equal(
      projectedText(makeRule([coreTile(mkSensorTileId(CoreHostActions.PreviousPage.key))], [])),
      "When the previous page,"
    );
  });

  test("a value sensor inside a comparison reads with no subject", () => {
    const rule = makeRule(
      [
        coreTile(mkSensorTileId(CoreHostActions.Random.key)),
        coreTile(mkOperatorTileId(CoreOpId.GreaterThan)),
        makeLiteral(CoreTypeIds.Number, 5),
      ],
      []
    );

    assert.equal(projectedText(rule), "When a random number is greater than 5,");
  });

  test("a page actuator reads as the word it authors", () => {
    assert.equal(
      projectedText(makeRule([], [coreTile(mkActuatorTileId(CoreHostActions.SwitchPage.key))])),
      "Always, go to."
    );
    assert.equal(
      projectedText(makeRule([], [coreTile(mkActuatorTileId(CoreHostActions.RestartPage.key))])),
      "Always, restart this page."
    );
  });

  test("the logical operators read in the sentence register, not the chip register", () => {
    const hear = () => makeSensor("hear", { label: "hear" });
    const walk = () => makeActuator("walk", { label: "walk" });
    const hungry = () => makeSensor("hungry", { label: "hungry", language: { frame: "state" } });

    assert.equal(
      projectedText(makeRule([hear(), coreTile(mkOperatorTileId(CoreOpId.And)), hungry()], [walk()])),
      "When I hear and hungry, walk."
    );
    assert.equal(
      projectedText(makeRule([hear(), coreTile(mkOperatorTileId(CoreOpId.Or)), hungry()], [walk()])),
      "When I hear or hungry, walk."
    );
    assert.equal(
      projectedText(makeRule([coreTile(mkOperatorTileId(CoreOpId.Not)), hear()], [walk()])),
      "When I do not hear, walk."
    );
  });

  test("a parenthesised condition reads with its groupings", () => {
    const rule = makeRule(
      [
        coreTile(mkControlFlowTileId(CoreControlFlowId.OpenParen)),
        makeSensor("hear", { label: "hear" }),
        coreTile(mkOperatorTileId(CoreOpId.Or)),
        makeSensor("hungry", { label: "hungry", language: { frame: "state" } }),
        coreTile(mkControlFlowTileId(CoreControlFlowId.CloseParen)),
      ],
      [makeActuator("walk", { label: "walk" })]
    );

    assert.equal(projectedText(rule), "When ( hear or hungry ), walk.");
  });

  test("an arithmetic operator reads as its own label", () => {
    const rule = makeRule(
      [
        makeVariable("speed"),
        coreTile(mkOperatorTileId(CoreOpId.Add)),
        makeLiteral(CoreTypeIds.Number, 1),
        coreTile(mkOperatorTileId(CoreOpId.GreaterThan)),
        makeLiteral(CoreTypeIds.Number, 5),
      ],
      []
    );

    assert.equal(projectedText(rule), "When speed plus 1 is greater than 5,");
  });
});

// -- negated conditions -------------------------------------------------------

describe("negated WHEN readings", () => {
  const not = () => coreTile(mkOperatorTileId(CoreOpId.Not));
  const walk = () => makeActuator("walk", { label: "walk" });

  test("a negated verb sensor reads its negation inside the clause", () => {
    const rule = makeRule([not(), makeObjectSensor("see", { label: "see" })], [walk()]);

    assert.deepEqual(project(rule), [
      glue("When I do "),
      word("not", 0),
      glue(" "),
      word("see", 1),
      glue(" "),
      word("anything", 1),
      glue(", "),
      word("walk", 2),
      glue("."),
    ]);
    assert.equal(projectedText(rule), "When I do not see anything, walk.");
  });

  test("a negated state sensor reads through the negated copula", () => {
    const rule = makeRule([not(), makeSensor("hungry", { label: "hungry", language: { frame: "state" } })], [walk()]);

    assert.equal(projectedText(rule), "When I am not hungry, walk.");
  });

  test("a negated event sensor reads the event with its negation", () => {
    const rule = makeRule([not(), coreTile(mkSensorTileId(CoreHostActions.OnPageEntered.key))], [walk()]);

    assert.equal(projectedText(rule), "When not this page starts, walk.");
  });

  test("a negated sensor keeps the arguments placed on it", () => {
    const rule = makeRule(
      [not(), makeSensor("hear", { label: "hear" }), makeLiteral(CoreTypeIds.String, "a bang", "a bang")],
      [walk()]
    );

    assert.equal(projectedText(rule), 'When I do not hear "a bang", walk.');
  });

  test("a negated expression keeps its subjectless reading", () => {
    const rule = makeRule(
      [
        not(),
        coreTile(mkControlFlowTileId(CoreControlFlowId.OpenParen)),
        makeVariable("speed"),
        coreTile(mkOperatorTileId(CoreOpId.GreaterThan)),
        makeLiteral(CoreTypeIds.Number, 5),
        coreTile(mkControlFlowTileId(CoreControlFlowId.CloseParen)),
      ],
      [walk()]
    );

    assert.equal(projectedText(rule), "When not ( speed is greater than 5 ), walk.");
  });

  test("a negated sensor an operator continues keeps its subjectless reading", () => {
    const rule = makeRule(
      [
        not(),
        makeSensor("hear", { label: "hear" }),
        coreTile(mkOperatorTileId(CoreOpId.And)),
        makeSensor("hungry", { label: "hungry", language: { frame: "state" } }),
      ],
      [walk()]
    );

    assert.equal(projectedText(rule), "When not hear and hungry, walk.");
  });

  test("a negation the head does not carry leaves the clause unnegated", () => {
    const rule = makeRule(
      [
        makeSensor("hear", { label: "hear" }),
        coreTile(mkOperatorTileId(CoreOpId.And)),
        not(),
        makeSensor("hungry", { label: "hungry", language: { frame: "state" } }),
      ],
      [walk()]
    );

    assert.equal(projectedText(rule), "When I hear and not hungry, walk.");
  });
});

// -- adverb-frame conditions --------------------------------------------------

describe("adverb-frame WHEN readings", () => {
  const otherwise = () => coreTile(mkSensorTileId(CoreHostActions.Otherwise.key));
  const wander = () => makeActuator("wander", { label: "wander" });

  test("an adverb-frame sensor alone is the rule's whole trigger", () => {
    const rule = makeRule([otherwise()], [wander()]);

    assert.deepEqual(project(rule), [initialWord("otherwise", 0), glue(", "), word("wander", 1), glue(".")]);
    assert.equal(projectedText(rule), "Otherwise, wander.");
  });

  test("an adverb-frame sensor with no DO side reads as its word alone", () => {
    const rule = makeRule([otherwise()], []);

    assert.deepEqual(project(rule), [initialWord("otherwise", 0), glue(",")]);
    assert.equal(projectedText(rule), "Otherwise,");
  });

  test("the trigger is one word segment carrying the tile's own span", () => {
    const rule = makeRule([otherwise()], [wander()]);
    const spans: number[] = [];
    for (const segment of project(rule)) {
      if (segment.kind === "word") {
        spans.push(segment.sourceTileIndex);
      }
    }

    assert.deepEqual(spans, [0, 1]);
  });

  test("an adverb-frame sensor beside other tiles reads as an ordinary operand", () => {
    const rule = makeRule(
      [otherwise(), coreTile(mkOperatorTileId(CoreOpId.And)), coreTile(mkSensorTileId(CoreHostActions.Random.key))],
      [wander()]
    );

    assert.deepEqual(project(rule), [
      glue("When "),
      word("otherwise", 0),
      glue(" "),
      word("and", 1),
      glue(" "),
      word("a random number", 2),
      glue(", "),
      word("wander", 3),
      glue("."),
    ]);
    assert.equal(projectedText(rule), "When otherwise and a random number, wander.");
  });

  test("a negation over an adverb-frame sensor selects no negated frame", () => {
    const rule = makeRule([coreTile(mkOperatorTileId(CoreOpId.Not)), otherwise()], [wander()]);

    assert.deepEqual(project(rule), [
      glue("When "),
      word("not", 0),
      glue(" "),
      word("otherwise", 1),
      glue(", "),
      word("wander", 2),
      glue("."),
    ]);
    assert.equal(projectedText(rule), "When not otherwise, wander.");
  });
});

// -- the sentence a rule with no action reads ---------------------------------

describe("a rule whose DO side is empty", () => {
  const walk = () => makeActuator("walk", { label: "walk" });

  test("its sentence ends on the incomplete terminal", () => {
    const rule = makeRule([makeSensor("terminal-see", { label: "see" })], []);

    assert.deepEqual(project(rule), [glue("When I "), word("see", 0), glue(",")]);
    assert.equal(projectedText(rule), "When I see,");
  });

  test("an adverb-frame trigger reads the same way", () => {
    const rule = makeRule([coreTile(mkSensorTileId(CoreHostActions.Otherwise.key))], []);

    assert.equal(projectedText(rule), "Otherwise,");
  });

  test("one tile on the DO side finishes the sentence", () => {
    const rule = makeRule([makeSensor("terminal-see-finished", { label: "see" })], [walk()]);

    assert.equal(projectedText(rule), "When I see, walk.");
  });

  /** One WHEN side per shape the projection renders, built afresh on each call. */
  const whenShapes: readonly (() => IBrainTileDef[])[] = [
    () => [makeSensor("terminal-verb", { label: "hear" })],
    () => [makeSensor("terminal-state", { label: "hungry", language: { frame: "state" } })],
    () => [coreTile(mkSensorTileId(CoreHostActions.OnPageEntered.key))],
    () => [makeAdverbSensor("terminal-adverb", "meanwhile")],
    () => [makeVariable("speed"), coreTile(mkOperatorTileId(CoreOpId.GreaterThan)), makeLiteral(CoreTypeIds.Number, 5)],
    () => [coreTile(mkOperatorTileId(CoreOpId.Not)), makeObjectSensor("terminal-negated", { label: "see" })],
  ];

  test("the terminal follows the DO side alone, whatever heads the WHEN side", () => {
    for (const whenTiles of whenShapes) {
      const unfinished = projectedText(makeRule(whenTiles(), []));
      const finished = projectedText(makeRule(whenTiles(), [walk()]));

      assert.equal(unfinished.endsWith(","), true, unfinished);
      assert.equal(finished.endsWith("."), true, finished);
    }
  });
});

// -- sentence-initial case ----------------------------------------------------

/**
 * A tile whose word opens a sentence on its own, for the positional case rule:
 * an adverb-frame sensor alone on a WHEN side is the whole trigger, so its word
 * stands first.
 */
function makeAdverbSensor(sensorId: string, form: string): IBrainTileDef {
  return makeSensor(sensorId, { label: form, language: { form, frame: "adverb" } });
}

describe("sentence-initial case", () => {
  const walk = () => makeActuator("walk", { label: "walk" });

  test("the word a sentence opens with is marked, and no other word is", () => {
    const rule = makeRule([makeAdverbSensor("initial-mark-probe", "meanwhile")], [walk()]);
    const marked: boolean[] = [];
    for (const segment of project(rule)) {
      if (segment.kind === "word") {
        marked.push(segment.sentenceInitial === true);
      }
    }

    assert.deepEqual(marked, [true, false]);
  });

  test("a sentence opening with template text marks no word at all", () => {
    for (const rule of [
      makeRule([makeObjectSensor("initial-template-see", { label: "see" })], [walk()]),
      makeRule([], [walk()]),
      makeRule(
        [makeVariable("speed"), coreTile(mkOperatorTileId(CoreOpId.GreaterThan)), makeLiteral(CoreTypeIds.Number, 5)],
        [walk()]
      ),
    ]) {
      for (const segment of project(rule)) {
        if (segment.kind === "word") {
          assert.notEqual(segment.sentenceInitial, true);
        }
      }
    }
  });

  test("the marked word keeps its authored text and takes the opening case only at display", () => {
    const rule = makeRule([makeAdverbSensor("initial-authored-probe", "meanwhile")], [walk()]);
    const opening = project(rule)[0];

    assert.equal(opening.text, "meanwhile");
    assert.equal(segmentDisplayText(opening, localizer), "Meanwhile");
    assert.equal(projectedText(rule), "Meanwhile, walk.");
  });

  test("a word authored with a capital reads as authored wherever it stands", () => {
    const proper = () => makeAdverbSensor("initial-proper-noun-probe", "Reykjavik");
    const opening = makeRule([proper()], [walk()]);
    const inside = makeRule(
      [proper(), coreTile(mkOperatorTileId(CoreOpId.And)), coreTile(mkSensorTileId(CoreHostActions.Random.key))],
      [walk()]
    );

    assert.equal(projectedText(opening), "Reykjavik, walk.");
    assert.equal(projectedText(inside), "When Reykjavik and a random number, walk.");
  });

  test("no word is ever lowercased, opening one included", () => {
    const rule = makeRule([makeAdverbSensor("initial-no-lowercase-probe", "ALLCAPS")], [walk()]);

    assert.equal(projectedText(rule), "ALLCAPS, walk.");
  });

  test("the locale decides the opening case, and can decline to change it", () => {
    const lowercasing = createLocalizer({
      locale: "zz",
      pluralRule: defaultPluralRule,
      entries: {},
      contexts: {},
      sentenceCase: { capitalizes: false },
    });
    const rule = makeRule([makeAdverbSensor("initial-locale-probe", "meanwhile")], [walk()]);

    assert.equal(projectedText(rule), "Meanwhile, walk.");
    assert.equal(projectedText(rule, lowercasing), "meanwhile, walk.");
  });
});

// -- tile words ---------------------------------------------------------------

/** The word a tile's own metadata authors: its sentence form, else its label. */
function authoredWord(tileDef: IBrainTileDef): string | undefined {
  return tileDef.metadata?.language?.form || tileDef.metadata?.label;
}

/** The registered core tiles of each vocabulary set the word resolver serves. */
function coreVocabularyTiles(): { operators: IBrainTileDef[]; parens: IBrainTileDef[]; factories: IBrainTileDef[] } {
  const registered = (tileIds: string[]) =>
    tileIds.map((tileId) => services.edit.tiles.get(tileId)).filter((tileDef) => !!tileDef) as IBrainTileDef[];
  return {
    operators: registered(Object.values(CoreOpId).map((opId) => mkOperatorTileId(opId))),
    parens: registered([
      mkControlFlowTileId(CoreControlFlowId.OpenParen),
      mkControlFlowTileId(CoreControlFlowId.CloseParen),
    ]),
    factories: registered([
      mkLiteralFactoryTileId(CoreLiteralFactoryId.Number),
      mkLiteralFactoryTileId(CoreLiteralFactoryId.String),
    ]),
  };
}

describe("tile sentence words", () => {
  test("an authored form outranks the tile's label", () => {
    const tileDef = makeSensor("word-form-and-label", { label: "authored label", language: { form: "authored form" } });
    assert.equal(tileSentenceWord(tileDef, localizer), "authored form");
  });

  test("a tile with no form reads as its label", () => {
    const tileDef = makeSensor("word-label-only", { label: "authored label" });
    assert.equal(tileSentenceWord(tileDef, localizer), "authored label");
  });

  test("a tile with neither form nor label reads as its catalog name", () => {
    const tileDef = makeSensor("word.unlabelled");
    assert.equal(tileSentenceWord(tileDef, localizer), getCatalogFallbackLabel(tileDef));
  });

  test("a variable reads as its own name, which never localizes", () => {
    const catalog: LocaleCatalog = {
      locale: "xx",
      pluralRule: defaultPluralRule,
      entries: { speedy: "XX-speedy" },
      contexts: { "tile-label": { speedy: "XX-speedy" } },
    };
    assert.equal(tileSentenceWord(makeVariable("speedy"), createLocalizer(catalog)), "speedy");
  });

  test("an authored form localizes through the active catalog", () => {
    const catalog: LocaleCatalog = {
      locale: "xx",
      pluralRule: defaultPluralRule,
      entries: {},
      contexts: { "tile-label": { "authored form": "XX-form" } },
    };
    const tileDef = makeSensor("word-localized-form", {
      label: "authored label",
      language: { form: "authored form" },
    });
    assert.equal(tileSentenceWord(tileDef, createLocalizer(catalog)), "XX-form");
  });

  test("the projection reads every tile of a rule with its sentence word", () => {
    for (const rule of fixtureRules()) {
      const tiles = flattenRuleTiles(rule);
      const words = project(rule)
        .filter((segment) => segment.kind === "word")
        .map((segment) => segment.text);
      for (let i = 0; i < tiles.size(); i++) {
        const tileDef = tiles.get(i).tileDef;
        assert.ok(words.includes(projectedWord(tileDef)), tileDef.tileId);
      }
    }
  });

  test("core registers a word for every operator, paren, and literal factory", () => {
    const { operators, parens, factories } = coreVocabularyTiles();
    assert.equal(operators.length, 15);
    assert.equal(parens.length, 2);
    assert.equal(factories.length, 2);
    const unauthored = [...operators, ...parens, ...factories]
      .filter((tileDef) => !authoredWord(tileDef))
      .map((tileDef) => tileDef.tileId);
    assert.deepEqual(unauthored, [], `core tiles authoring no word: ${unauthored.join(", ")}`);
  });

  test("no core operator, paren, or literal factory reads as its tile id", () => {
    const { operators, parens, factories } = coreVocabularyTiles();
    const leaking = [...operators, ...parens, ...factories]
      .filter((tileDef) => tileSentenceWord(tileDef, localizer) === getCatalogFallbackLabel(tileDef))
      .map((tileDef) => tileDef.tileId);
    assert.deepEqual(leaking, [], `core tiles reading as their tile id: ${leaking.join(", ")}`);
  });

  test("each core operator, paren, and literal factory reads as the word it authors", () => {
    const { operators, parens, factories } = coreVocabularyTiles();
    for (const tileDef of [...operators, ...parens, ...factories]) {
      assert.equal(tileSentenceWord(tileDef, localizer), authoredWord(tileDef), tileDef.tileId);
    }
  });

  test("an operator declaring a spoken form reads with it, not with its chip label", () => {
    const spoken = coreVocabularyTiles().operators.filter((tileDef) => !!tileDef.metadata?.language?.form);
    assert.ok(spoken.length > 0, "some operators declare a spoken form distinct from their chip label");
    for (const tileDef of spoken) {
      const form = tileDef.metadata?.language?.form;
      assert.equal(tileSentenceWord(tileDef, localizer), form, tileDef.tileId);
      assert.notEqual(form, tileDef.metadata?.label, tileDef.tileId);
    }
  });
});

// -- literal readings ---------------------------------------------------------

describe("literal value readings", () => {
  const say = () => makeActuator("say", { label: "say" });

  test("a text literal reads quoted inside the sentence", () => {
    const rule = makeRule([], [say(), makeLiteral(CoreTypeIds.String, "go left")]);

    assert.equal(projectedText(rule), 'Always, say "go left".');
  });

  test("a text value keeps its own punctuation inside the quotes", () => {
    const rule = makeRule([], [say(), makeLiteral(CoreTypeIds.String, "cost: $5. ok, then")]);

    assert.equal(projectedText(rule), 'Always, say "cost: $5. ok, then".');
  });

  test("an empty text value reads as an empty pair of quotes", () => {
    const rule = makeRule([], [say(), makeLiteral(CoreTypeIds.String, "")]);

    assert.equal(projectedText(rule), 'Always, say "".');
  });

  test("a number literal reads unquoted", () => {
    const rule = makeRule([], [say(), makeLiteral(CoreTypeIds.Number, 5)]);

    assert.equal(projectedText(rule), "Always, say 5.");
  });

  test("a boolean literal reads unquoted", () => {
    const rule = makeRule([], [say(), makeLiteral(CoreTypeIds.Boolean, true, "true")]);

    assert.equal(projectedText(rule), "Always, say true.");
  });

  test("the quoted value is one word segment carrying the literal's own tile index", () => {
    const rule = makeRule([], [say(), makeLiteral(CoreTypeIds.String, "go left")]);

    assert.deepEqual(project(rule), [glue("Always, "), word("say", 0), glue(" "), word('"go left"', 1), glue(".")]);
  });

  test("the word a candidate chip resolves stays the raw value", () => {
    assert.equal(tileSentenceWord(makeLiteral(CoreTypeIds.String, "go left"), localizer), "go left");
    assert.equal(tileSentenceWord(makeLiteral(CoreTypeIds.String, ""), localizer), "");
  });

  test("a text value inside a page paragraph reads quoted too", () => {
    const page = makePage([{ do: [say(), makeLiteral(CoreTypeIds.String, "go left")] }]);

    assert.equal(paragraphText(projectPageParagraph(page, localizer), localizer), 'Always, say "go left".');
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
        .map((segment) => segmentDisplayText(segment, localizer))
        .join("");
      assert.equal(sentenceText(segments, localizer), concatenated);
    }
  });

  test("flattened tiles carry the side and per-side index of each tile", () => {
    const rule = makeRule(
      [makeObjectSensor("see", { label: "see" })],
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
        "{form} {object}": "ADVERBZ {form} {object}",
        "When {condition}": "ZORP KA {condition}",
        "When I do {negation} {form} {object}": "ZORP NAY {negation} {form} {object}",
        "When I am {negation} {form} {object}": "ZORP MI NAY {negation} {form} {object}",
        "When {negation} {form} {object}": "ZORP EVENTZ NAY {negation} {form} {object}",
        Always: "ALWAZ",
      },
      "sentence-bare": {
        "{frame, select, verb {anything} other {}}": "{frame, select, verb {ANYTHINGZ} other {}}",
      },
      "sentence-value": {
        '"{value}"': "<<{value}>>",
      },
      "sentence-glue": {
        "{a} {b}": "{a}-{b}",
        "{trigger}, {action}": "{trigger} ;; {action}",
        "{sentence}.": "{sentence}!",
        "{sentence},": "{sentence}?",
      },
      "sentence-connective": {
        "{parent}, and if {condition}": "{parent} ++IFZ {condition}",
        "{parent}, and {consequence}": "{parent} ++ANDZ {consequence}",
        "{parent}, when {condition}": "{parent} ++WHENZ {condition}",
        "{parent}, {consequence}": "{parent} ++SOZ {consequence}",
        "{condition}, {action}": "{condition} >> {action}",
        "{sentence} {rest}": "{sentence} // {rest}",
        "I {form} {object}": "MI {form} {object}",
        "I am {form} {object}": "MI ESTA {form} {object}",
        "{form} {object}": "EVENTZ {form} {object}",
        "{condition}": "KAZ {condition}",
        "I do {negation} {form} {object}": "MI NAY {negation} {form} {object}",
        "I am {negation} {form} {object}": "MI ESTA NAY {negation} {form} {object}",
        "{negation} {form} {object}": "EVENTZ NAY {negation} {form} {object}",
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
      [makeObjectSensor("see", { label: "see" })],
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

  test("the quotation marks around a text value come from the catalog", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const rule = makeRule([], [makeActuator("say", { label: "say" }), makeLiteral(CoreTypeIds.String, "go left")]);

    assert.equal(projectedText(rule, translated), "ALWAZ ;; say-<<go left>>!");
  });

  test("the always-word and the state frame translate too", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const always = makeRule([], [makeActuator("walk", { label: "walk" })]);
    const state = makeRule([makeSensor("hungry", { label: "hungry", language: { frame: "state" } })], []);

    assert.equal(projectedText(always, translated), "ALWAZ ;; walk!");
    assert.equal(projectedText(state, translated), "ZORP MI hungry?");
  });

  test("the event frame translates too", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const rule = makeRule([coreTile(mkSensorTileId(CoreHostActions.OnPageEntered.key))], []);

    assert.deepEqual(project(rule, translated), [glue("ZORP "), word("this page starts", 0), glue("?")]);
  });

  test("the adverb frame translates too", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const rule = makeRule(
      [coreTile(mkSensorTileId(CoreHostActions.Otherwise.key))],
      [makeActuator("wander", { label: "wander" })]
    );

    assert.deepEqual(project(rule, translated), [
      glue("ADVERBZ "),
      word("otherwise", 0),
      glue(" ;; "),
      word("wander", 1),
      glue("!"),
    ]);
    assert.equal(projectedText(rule, translated), "ADVERBZ otherwise ;; wander!");
  });

  test("the subjectless template translates too", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const rule = makeRule(
      [makeVariable("speed"), coreTile(mkOperatorTileId(CoreOpId.GreaterThan)), makeLiteral(CoreTypeIds.Number, 5)],
      []
    );

    assert.deepEqual(project(rule, translated), [
      glue("ZORP KA "),
      word("speed", 0),
      glue("-"),
      word("is greater than", 1),
      glue("-"),
      word("5", 2),
      glue("?"),
    ]);
    assert.equal(projectedText(rule, translated), "ZORP KA speed-is greater than-5?");
  });

  test("the negated frame templates translate too", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const not = () => coreTile(mkOperatorTileId(CoreOpId.Not));
    const verb = makeRule([not(), makeObjectSensor("see", { label: "see" })], []);
    const state = makeRule([not(), makeSensor("hungry", { label: "hungry", language: { frame: "state" } })], []);
    const event = makeRule([not(), coreTile(mkSensorTileId(CoreHostActions.OnPageEntered.key))], []);

    assert.deepEqual(project(verb, translated), [
      glue("ZORP NAY "),
      word("not", 0),
      glue(" "),
      word("ZEE", 1),
      glue(" "),
      word("ANYTHINGZ", 1),
      glue("?"),
    ]);
    assert.equal(projectedText(state, translated), "ZORP MI NAY not hungry?");
    assert.equal(projectedText(event, translated), "ZORP EVENTZ NAY not this page starts?");
  });

  test("an inline sensor comparison renders through the translated subjectless template", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const rule = makeRule(
      [
        makeInlineSensor("light level", { label: "light level" }),
        coreTile(mkOperatorTileId(CoreOpId.GreaterThan)),
        makeLiteral(CoreTypeIds.Number, 5),
      ],
      []
    );

    assert.deepEqual(project(rule, translated), [
      glue("ZORP KA "),
      word("light level", 0),
      glue("-"),
      word("is greater than", 1),
      glue("-"),
      word("5", 2),
      glue("?"),
    ]);
  });

  test("switching locale is a pure re-render of the same rule", () => {
    const rule = makeRule([makeObjectSensor("see", { label: "see" })], []);

    assert.equal(projectedText(rule), "When I see anything,");
    assert.equal(projectedText(rule, createLocalizer(testLocaleCatalog())), "ZORP ZEE ANYTHINGZ ZAP?");
    assert.equal(projectedText(rule), "When I see anything,");
  });
});

// -- the trigger word ---------------------------------------------------------

describe("the trigger word accessor", () => {
  test("it reads the word the empty WHEN projects as the rule's trigger", () => {
    const rule = makeRule([], [makeActuator("walk", { label: "walk" })]);

    assert.ok(projectedText(rule).startsWith(whenTriggerWord(localizer)));
  });

  test("it reads through the catalog the localizer carries", () => {
    const translated = createLocalizer(testLocaleCatalog());

    assert.equal(whenTriggerWord(translated), "ALWAZ");
    assert.ok(projectedText(makeRule([], [makeActuator("walk", { label: "walk" })]), translated).startsWith("ALWAZ"));
  });

  test("a rule empty on both sides projects no segments even though the trigger word reads", () => {
    assert.notEqual(whenTriggerWord(localizer), "");
    assert.deepEqual(project(makeRule([], [])), []);
  });
});

// -- page paragraph -----------------------------------------------------------

/** A paragraph entry with its segments as a plain array, for golden comparison. */
type FlatParagraphEntry =
  | { readonly kind: "rule"; readonly ruleId: string; readonly segments: SentenceSegment[] }
  | { readonly kind: "glue"; readonly text: string };

function paragraph(page: IBrainPageDef, withLocalizer?: Localizer): FlatParagraphEntry[] {
  return projectPageParagraph(page, withLocalizer ?? localizer)
    .toArray()
    .map((entry) =>
      entry.kind === "rule" ? { kind: "rule", ruleId: entry.ruleId, segments: entry.segments.toArray() } : entry
    );
}

function paragraphAsText(page: IBrainPageDef, withLocalizer?: Localizer): string {
  const active = withLocalizer ?? localizer;
  return paragraphText(projectPageParagraph(page, active), active);
}

/** The expected entry carrying `rule`'s own clause. */
function clause(rule: IBrainRuleDef, ...segments: SentenceSegment[]): FlatParagraphEntry {
  return { kind: "rule", ruleId: rule.ruleId(), segments };
}

/** The expected glue entry between two rules' clauses. */
function connective(text: string): FlatParagraphEntry {
  return { kind: "glue", text };
}

function topRule(page: IBrainPageDef, index: number): IBrainRuleDef {
  return page.children().get(index);
}

function childRule(rule: IBrainRuleDef, index: number): IBrainRuleDef {
  return rule.children().get(index);
}

/** Every rule of `page`, at any depth, keyed by its id. */
function rulesById(page: IBrainPageDef): Map<string, IBrainRuleDef> {
  const out = new Map<string, IBrainRuleDef>();
  const visit = (rules: readonly IBrainRuleDef[]) => {
    for (const rule of rules) {
      out.set(rule.ruleId(), rule);
      visit(rule.children().toArray());
    }
  };
  visit(page.children().toArray());
  return out;
}

// -- the shapes the paragraph composition has to cover ------------------------

function seeSensor(): IBrainTileDef {
  return makeObjectSensor("see", { label: "see" });
}

function hungrySensor(): IBrainTileDef {
  return makeSensor("hungry", { label: "hungry", language: { frame: "state" } });
}

function hearSensor(): IBrainTileDef {
  return makeSensor("hear", { label: "hear" });
}

function walkAction(): IBrainTileDef {
  return makeActuator("walk", { label: "walk" });
}

function eatAction(): IBrainTileDef {
  return makeActuator("eat", { label: "eat" });
}

function restAction(): IBrainTileDef {
  return makeActuator("rest", { label: "rest" });
}

/** One page per composition shape the paragraph renders, for the property sweeps. */
function fixturePages(): IBrainPageDef[] {
  return [
    makePage([]),
    makePage([{}]),
    makePage([
      { when: [seeSensor()], do: [walkAction()] },
      { when: [hungrySensor()], do: [eatAction()] },
    ]),
    makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [
          { when: [hungrySensor()], do: [eatAction()], children: [{ when: [hearSensor()], do: [restAction()] }] },
        ],
      },
    ]),
    makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [{ when: [hungrySensor()], do: [eatAction()] }, { do: [restAction()] }],
      },
    ]),
    makePage([{ do: [walkAction()], children: [{ when: [hungrySensor()] }] }]),
    makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [
          {
            when: [
              makeVariable("speed"),
              coreTile(mkOperatorTileId(CoreOpId.GreaterThan)),
              makeLiteral(CoreTypeIds.Number, 5),
            ],
            do: [eatAction()],
          },
          {
            when: [makePresenceGatedSensor("radio message", { label: "radio message", language: { frame: "event" } })],
            do: [restAction()],
          },
        ],
      },
    ]),
    makePage([
      { when: [seeSensor()], do: [walkAction()] },
      {
        when: [coreTile(mkSensorTileId(CoreHostActions.Otherwise.key))],
        children: [
          { when: [hungrySensor()], do: [eatAction()] },
          { when: [coreTile(mkSensorTileId(CoreHostActions.Otherwise.key))], do: [restAction()] },
        ],
      },
    ]),
    makePage([{ when: [hungrySensor()] }]),
    makePage([{ when: [hungrySensor()], children: [{ do: [restAction()] }] }]),
    makePage([{ when: [hungrySensor()], children: [{ when: [hearSensor()] }] }]),
  ];
}

describe("page paragraph golden entries", () => {
  test("a flat page reads as one sentence per rule", () => {
    const page = makePage([
      { when: [seeSensor()], do: [walkAction()] },
      { when: [hungrySensor()], do: [eatAction()] },
    ]);
    const first = topRule(page, 0);
    const second = topRule(page, 1);

    assert.deepEqual(paragraph(page), [
      clause(first, glue("When I "), word("see", 0), glue(" "), word("anything", 0), glue(", "), word("walk", 1)),
      connective(". "),
      clause(second, glue("When I am "), word("hungry", 0), glue(", "), word("eat", 1)),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "When I see anything, walk. When I am hungry, eat.");
  });

  test("a child rule extends its parent's sentence", () => {
    const page = makePage([
      { when: [seeSensor()], do: [walkAction()], children: [{ when: [hungrySensor()], do: [eatAction()] }] },
    ]);
    const parent = topRule(page, 0);

    assert.deepEqual(paragraph(page), [
      clause(parent, glue("When I "), word("see", 0), glue(" "), word("anything", 0), glue(", "), word("walk", 1)),
      connective(", and if "),
      clause(childRule(parent, 0), glue("I am "), word("hungry", 0), glue(", "), word("eat", 1)),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "When I see anything, walk, and if I am hungry, eat.");
  });

  test("a deeper child chains a further continuation", () => {
    const page = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [
          {
            when: [hungrySensor()],
            do: [eatAction()],
            children: [
              { when: [hearSensor(), makeLiteral(CoreTypeIds.String, "a bang", "a bang")], do: [restAction()] },
            ],
          },
        ],
      },
    ]);
    const parent = topRule(page, 0);
    const child = childRule(parent, 0);

    assert.deepEqual(paragraph(page), [
      clause(parent, glue("When I "), word("see", 0), glue(" "), word("anything", 0), glue(", "), word("walk", 1)),
      connective(", and if "),
      clause(child, glue("I am "), word("hungry", 0), glue(", "), word("eat", 1)),
      connective(", and if "),
      clause(
        childRule(child, 0),
        glue("I "),
        word("hear", 0),
        glue(" "),
        word('"a bang"', 1),
        glue(", "),
        word("rest", 2)
      ),
      connective("."),
    ]);
    assert.equal(
      paragraphAsText(page),
      'When I see anything, walk, and if I am hungry, eat, and if I hear "a bang", rest.'
    );
  });

  test("each child of one parent adds its own continuation", () => {
    const page = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [
          { when: [hungrySensor()], do: [eatAction()] },
          { when: [hearSensor()], do: [restAction()] },
        ],
      },
    ]);
    const parent = topRule(page, 0);

    assert.deepEqual(paragraph(page), [
      clause(parent, glue("When I "), word("see", 0), glue(" "), word("anything", 0), glue(", "), word("walk", 1)),
      connective(", and if "),
      clause(childRule(parent, 0), glue("I am "), word("hungry", 0), glue(", "), word("eat", 1)),
      connective(", and if "),
      clause(childRule(parent, 1), glue("I "), word("hear", 0), glue(", "), word("rest", 1)),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "When I see anything, walk, and if I am hungry, eat, and if I hear, rest.");
  });

  test("an always-headed parent carries its child's continuation", () => {
    const page = makePage([{ do: [walkAction()], children: [{ when: [hungrySensor()], do: [eatAction()] }] }]);
    const parent = topRule(page, 0);

    assert.deepEqual(paragraph(page), [
      clause(parent, glue("Always, "), word("walk", 0)),
      connective(", and if "),
      clause(childRule(parent, 0), glue("I am "), word("hungry", 0), glue(", "), word("eat", 1)),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "Always, walk, and if I am hungry, eat.");
  });

  test("a page with no rules projects no entries", () => {
    assert.deepEqual(paragraph(makePage([])), []);
    assert.equal(paragraphAsText(makePage([])), "");
  });

  test("a page holding only the trailing empty rule projects no entries", () => {
    assert.deepEqual(paragraph(makePage([{}])), []);
  });
});

describe("page paragraph edge shapes", () => {
  test("a child with no WHEN tiles reads as a further consequence", () => {
    const page = makePage([{ when: [seeSensor()], do: [walkAction()], children: [{ do: [eatAction()] }] }]);
    const parent = topRule(page, 0);

    assert.deepEqual(paragraph(page), [
      clause(parent, glue("When I "), word("see", 0), glue(" "), word("anything", 0), glue(", "), word("walk", 1)),
      connective(", and "),
      clause(childRule(parent, 0), word("eat", 0)),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "When I see anything, walk, and eat.");
  });

  test("a child with no DO tiles reads as its condition alone", () => {
    const page = makePage([{ when: [seeSensor()], do: [walkAction()], children: [{ when: [hungrySensor()] }] }]);
    const parent = topRule(page, 0);

    assert.deepEqual(paragraph(page), [
      clause(parent, glue("When I "), word("see", 0), glue(" "), word("anything", 0), glue(", "), word("walk", 1)),
      connective(", and if "),
      clause(childRule(parent, 0), glue("I am "), word("hungry", 0)),
      connective(","),
    ]);
    assert.equal(paragraphAsText(page), "When I see anything, walk, and if I am hungry,");
  });

  test("a top-level rule with no DO tiles reads as its trigger alone", () => {
    const page = makePage([{ when: [hungrySensor()] }, { when: [seeSensor()], do: [walkAction()] }]);

    assert.equal(paragraphAsText(page), "When I am hungry, When I see anything, walk.");
  });

  test("a subjectless child keeps its subjectless reading", () => {
    const page = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [
          {
            when: [
              makeVariable("speed"),
              coreTile(mkOperatorTileId(CoreOpId.GreaterThan)),
              makeLiteral(CoreTypeIds.Number, 5),
            ],
            do: [eatAction()],
          },
        ],
      },
    ]);
    const parent = topRule(page, 0);

    assert.deepEqual(paragraph(page), [
      clause(parent, glue("When I "), word("see", 0), glue(" "), word("anything", 0), glue(", "), word("walk", 1)),
      connective(", and if "),
      clause(
        childRule(parent, 0),
        word("speed", 0),
        glue(" "),
        word("is greater than", 1),
        glue(" "),
        word("5", 2),
        glue(", "),
        word("eat", 3)
      ),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "When I see anything, walk, and if speed is greater than 5, eat.");
  });

  test("a presence-gated child reads through its own frame", () => {
    const page = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [
          {
            when: [makePresenceGatedSensor("radio message", { label: "radio message", language: { frame: "event" } })],
            do: [eatAction()],
          },
        ],
      },
    ]);

    assert.equal(paragraphAsText(page), "When I see anything, walk, and if radio message, eat.");
  });

  test("a negated child reads its negation inside its own clause", () => {
    const page = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [{ when: [coreTile(mkOperatorTileId(CoreOpId.Not)), hearSensor()], do: [eatAction()] }],
      },
    ]);
    const parent = topRule(page, 0);

    assert.deepEqual(paragraph(page), [
      clause(parent, glue("When I "), word("see", 0), glue(" "), word("anything", 0), glue(", "), word("walk", 1)),
      connective(", and if "),
      clause(
        childRule(parent, 0),
        glue("I do "),
        word("not", 0),
        glue(" "),
        word("hear", 1),
        glue(", "),
        word("eat", 2)
      ),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "When I see anything, walk, and if I do not hear, eat.");
  });

  test("an adverb-frame child reads its word as its whole subordinate clause", () => {
    const page = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [{ when: [coreTile(mkSensorTileId(CoreHostActions.Otherwise.key))], do: [restAction()] }],
      },
    ]);
    const parent = topRule(page, 0);

    assert.deepEqual(paragraph(page), [
      clause(parent, glue("When I "), word("see", 0), glue(" "), word("anything", 0), glue(", "), word("walk", 1)),
      connective(", and if "),
      clause(childRule(parent, 0), word("otherwise", 0), glue(", "), word("rest", 1)),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "When I see anything, walk, and if otherwise, rest.");
  });

  test("an adverb-frame root rule opens its own sentence with no trigger word", () => {
    const page = makePage([
      { when: [seeSensor()], do: [walkAction()] },
      { when: [coreTile(mkSensorTileId(CoreHostActions.Otherwise.key))], do: [restAction()] },
    ]);
    const second = topRule(page, 1);

    assert.deepEqual(paragraph(page), [
      clause(
        topRule(page, 0),
        glue("When I "),
        word("see", 0),
        glue(" "),
        word("anything", 0),
        glue(", "),
        word("walk", 1)
      ),
      connective(". "),
      clause(second, initialWord("otherwise", 0), glue(", "), word("rest", 1)),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "When I see anything, walk. Otherwise, rest.");
  });

  test("an event-frame child reads as the event", () => {
    const page = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [{ when: [coreTile(mkSensorTileId(CoreHostActions.OnPageEntered.key))], do: [eatAction()] }],
      },
    ]);

    assert.equal(paragraphAsText(page), "When I see anything, walk, and if this page starts, eat.");
  });

  test("a rule with no tiles contributes nothing and its children take its place", () => {
    const page = makePage([{ children: [{ when: [hungrySensor()], do: [eatAction()] }] }]);
    const child = childRule(topRule(page, 0), 0);

    assert.deepEqual(paragraph(page), [
      clause(child, glue("When I am "), word("hungry", 0), glue(", "), word("eat", 1)),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "When I am hungry, eat.");
  });

  test("a tileless child promotes its own children into its parent's sentence", () => {
    const page = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [{ children: [{ when: [hungrySensor()], do: [eatAction()] }] }],
      },
    ]);

    assert.equal(paragraphAsText(page), "When I see anything, walk, and if I am hungry, eat.");
  });
});

// -- a parent whose DO side is empty ------------------------------------------

describe("page paragraph under a parent with no action", () => {
  const otherwise = () => coreTile(mkSensorTileId(CoreHostActions.Otherwise.key));
  const bumpSensor = () => makeObjectSensor("bump", { label: "bump" });
  const moveAwayAction = () => makeActuator("move-away", { label: "move away from it" });

  test("the child's clause completes the parent's own sentence", () => {
    const page = makePage([{ when: [otherwise()], children: [{ when: [bumpSensor()], do: [moveAwayAction()] }] }]);
    const parent = topRule(page, 0);

    assert.deepEqual(paragraph(page), [
      clause(parent, initialWord("otherwise", 0)),
      connective(", when "),
      clause(
        childRule(parent, 0),
        glue("I "),
        word("bump", 0),
        glue(" "),
        word("anything", 0),
        glue(", "),
        word("move away from it", 1)
      ),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "Otherwise, when I bump anything, move away from it.");
  });

  test("any parent with no action takes the completing connective", () => {
    const page = makePage([{ when: [hungrySensor()], children: [{ when: [bumpSensor()], do: [moveAwayAction()] }] }]);

    assert.equal(paragraphAsText(page), "When I am hungry, when I bump anything, move away from it.");
  });

  test("a child with no condition completes it with no conjunction at all", () => {
    const page = makePage([{ when: [otherwise()], children: [{ do: [moveAwayAction()] }] }]);
    const parent = topRule(page, 0);

    assert.deepEqual(paragraph(page), [
      clause(parent, initialWord("otherwise", 0)),
      connective(", "),
      clause(childRule(parent, 0), word("move away from it", 0)),
      connective("."),
    ]);
    assert.equal(paragraphAsText(page), "Otherwise, move away from it.");
  });

  test("the next child joins the completed sentence with the ordinary conjunction", () => {
    const page = makePage([
      {
        when: [otherwise()],
        children: [
          { when: [bumpSensor()], do: [moveAwayAction()] },
          { when: [hungrySensor()], do: [eatAction()] },
        ],
      },
    ]);

    assert.equal(paragraphAsText(page), "Otherwise, when I bump anything, move away from it, and if I am hungry, eat.");
  });

  test("a child that carries no action of its own leaves the sentence unfinished", () => {
    const page = makePage([{ when: [otherwise()], children: [{ when: [hungrySensor()] }] }]);

    assert.equal(paragraphAsText(page), "Otherwise, when I am hungry,");
  });
});

// -- sequences ----------------------------------------------------------------

describe("page paragraph sequences", () => {
  test("several sentences in a row read as one paragraph", () => {
    const page = makePage([
      { when: [seeSensor()], do: [walkAction()] },
      { when: [hungrySensor()], do: [eatAction()] },
      { when: [hearSensor(), makeLiteral(CoreTypeIds.String, "a bang", "a bang")], do: [restAction()] },
      { do: [walkAction()] },
    ]);

    assert.equal(
      paragraphAsText(page),
      'When I see anything, walk. When I am hungry, eat. When I hear "a bang", rest. Always, walk.'
    );
  });

  test("two children of one parent and a chain of two read the same continuations", () => {
    const breadth = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [
          { when: [hungrySensor()], do: [eatAction()] },
          { when: [hearSensor()], do: [restAction()] },
        ],
      },
    ]);
    const depth = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [
          { when: [hungrySensor()], do: [eatAction()], children: [{ when: [hearSensor()], do: [restAction()] }] },
        ],
      },
    ]);

    assert.equal(paragraphAsText(breadth), "When I see anything, walk, and if I am hungry, eat, and if I hear, rest.");
    assert.equal(paragraphAsText(depth), paragraphAsText(breadth));
  });

  test("a consequence-only child after a conditioned sibling reads on the end of the chain", () => {
    const page = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [{ when: [hungrySensor()], do: [eatAction()] }, { do: [restAction()] }],
      },
    ]);

    assert.equal(paragraphAsText(page), "When I see anything, walk, and if I am hungry, eat, and rest.");
  });

  test("rules with no DO tiles read as conditions in a row", () => {
    const page = makePage([{ when: [seeSensor()] }, { when: [hungrySensor()] }, { when: [hearSensor()] }]);

    assert.equal(paragraphAsText(page), "When I see anything, When I am hungry, When I hear,");
  });
});

// -- span integrity -----------------------------------------------------------

describe("page paragraph spans", () => {
  test("every word segment resolves into its own rule's tiles", () => {
    for (const page of fixturePages()) {
      const rules = rulesById(page);
      for (const entry of paragraph(page)) {
        if (entry.kind !== "rule") {
          continue;
        }
        const rule = rules.get(entry.ruleId);
        assert.ok(rule, `entry ${entry.ruleId} names a rule of the page`);
        const tiles = flattenRuleTiles(rule);
        const words: string[] = [];
        for (const segment of entry.segments) {
          if (segment.kind === "word") {
            assert.ok(segment.sourceTileIndex >= 0 && segment.sourceTileIndex < tiles.size());
            assert.ok(tiles.get(segment.sourceTileIndex).tileDef.tileId.length > 0);
            words.push(segment.text);
          }
        }
        for (let i = 0; i < tiles.size(); i++) {
          const tileDef = tiles.get(i).tileDef;
          assert.ok(words.includes(projectedWord(tileDef)), tileDef.tileId);
        }
      }
    }
  });

  test("every tile of every rule is covered by a word segment of its own rule's entry", () => {
    for (const page of fixturePages()) {
      const rules = rulesById(page);
      for (const entry of paragraph(page)) {
        if (entry.kind !== "rule") {
          continue;
        }
        const covered = new Set<number>();
        for (const segment of entry.segments) {
          if (segment.kind === "word") {
            covered.add(segment.sourceTileIndex);
          }
        }
        const tiles = flattenRuleTiles(rules.get(entry.ruleId)!);
        for (let i = 0; i < tiles.size(); i++) {
          assert.ok(covered.has(i), `tile ${i} of rule ${entry.ruleId} contributes a word`);
        }
      }
    }
  });

  test("every rule carrying tiles contributes exactly one entry", () => {
    for (const page of fixturePages()) {
      const withTiles = [...rulesById(page).values()]
        .filter((rule) => !rule.when().tiles().isEmpty() || !rule.do().tiles().isEmpty())
        .map((rule) => rule.ruleId())
        .sort();
      const projected = paragraph(page)
        .filter((entry) => entry.kind === "rule")
        .map((entry) => (entry as { ruleId: string }).ruleId)
        .sort();

      assert.deepEqual(projected, withTiles);
    }
  });

  test("the display string is the concatenation of the entries", () => {
    for (const page of fixturePages()) {
      const concatenated = paragraph(page)
        .map((entry) =>
          entry.kind === "rule"
            ? entry.segments.map((segment) => segmentDisplayText(segment, localizer)).join("")
            : entry.text
        )
        .join("");
      assert.equal(paragraphAsText(page), concatenated);
    }
  });

  test("a page of one childless rule reads exactly as that rule's sentence", () => {
    const page = makePage([{ when: [seeSensor()], do: [walkAction()] }]);

    assert.equal(paragraphAsText(page), sentenceText(projectRuleSentence(topRule(page, 0), localizer), localizer));
  });
});

// -- determinism --------------------------------------------------------------

describe("page paragraph determinism", () => {
  test("the same page projects identically every time", () => {
    for (const page of fixturePages()) {
      assert.deepEqual(paragraph(page), paragraph(page));
    }
  });

  test("switching locale is a pure re-render of the same page", () => {
    const page = makePage([
      { when: [seeSensor()], do: [walkAction()], children: [{ when: [hungrySensor()], do: [eatAction()] }] },
    ]);

    assert.equal(paragraphAsText(page), "When I see anything, walk, and if I am hungry, eat.");
    assert.equal(
      paragraphAsText(page, createLocalizer(testLocaleCatalog())),
      "ZORP ZEE ANYTHINGZ ZAP ;; walk ++IFZ MI ESTA hungry >> eat!"
    );
    assert.equal(paragraphAsText(page), "When I see anything, walk, and if I am hungry, eat.");
  });
});

// -- locale parameterization --------------------------------------------------

/** The source string of every `sentence-connective` entry the paragraph engine looks up. */
const kConnectiveSources = [
  "{parent}, and if {condition}",
  "{parent}, and {consequence}",
  "{parent}, when {condition}",
  "{parent}, {consequence}",
  "{condition}, {action}",
  "{sentence} {rest}",
  "I {form} {object}",
  "I am {form} {object}",
  "{form} {object}",
  "{condition}",
  "I do {negation} {form} {object}",
  "I am {negation} {form} {object}",
  "{negation} {form} {object}",
];

describe("page paragraph locale parameterization", () => {
  test("a catalog drives every connective the paragraph composes", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const page = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [{ when: [hungrySensor()], do: [eatAction()] }, { do: [restAction()] }],
      },
    ]);
    const parent = topRule(page, 0);

    assert.deepEqual(paragraph(page, translated), [
      clause(parent, glue("ZORP "), word("ZEE", 0), glue(" "), word("ANYTHINGZ", 0), glue(" ZAP ;; "), word("walk", 1)),
      connective(" ++IFZ "),
      clause(childRule(parent, 0), glue("MI ESTA "), word("hungry", 0), glue(" >> "), word("eat", 1)),
      connective(" ++ANDZ "),
      clause(childRule(parent, 1), word("rest", 0)),
      connective("!"),
    ]);
  });

  test("a catalog drives the connectives a clause with no action takes", () => {
    const translated = createLocalizer(testLocaleCatalog());
    const condition = makePage([{ when: [hungrySensor()], children: [{ when: [hearSensor()], do: [eatAction()] }] }]);
    const consequence = makePage([{ when: [hungrySensor()], children: [{ do: [restAction()] }] }]);
    const unfinished = makePage([{ when: [hungrySensor()] }]);

    assert.equal(paragraphAsText(condition, translated), "ZORP MI hungry ++WHENZ MI hear >> eat!");
    assert.equal(paragraphAsText(consequence, translated), "ZORP MI hungry ++SOZ rest!");
    assert.equal(paragraphAsText(unfinished, translated), "ZORP MI hungry?");
  });

  test("a catalog translates every connective source the engine looks up", () => {
    const catalog = testLocaleCatalog();
    const translated = createLocalizer(catalog);
    const untranslated = kConnectiveSources.filter((source) => !catalog.contexts["sentence-connective"]?.[source]);
    assert.deepEqual(untranslated, [], `connective sources the test catalog omits: ${untranslated.join(", ")}`);

    // One page whose composition reaches every connective source: two sentences,
    // a child per WHEN-side shape, a consequence-only child, and a parent with
    // no action of its own carrying a child of each kind.
    const page = makePage([
      {
        when: [seeSensor()],
        do: [walkAction()],
        children: [
          { when: [hearSensor()], do: [eatAction()] },
          { when: [hungrySensor()], do: [eatAction()] },
          { when: [coreTile(mkSensorTileId(CoreHostActions.OnPageEntered.key))], do: [eatAction()] },
          {
            when: [
              makeVariable("speed"),
              coreTile(mkOperatorTileId(CoreOpId.GreaterThan)),
              makeLiteral(CoreTypeIds.Number, 5),
            ],
            do: [eatAction()],
          },
          { when: [coreTile(mkOperatorTileId(CoreOpId.Not)), hearSensor()], do: [eatAction()] },
          { when: [coreTile(mkOperatorTileId(CoreOpId.Not)), hungrySensor()], do: [eatAction()] },
          {
            when: [
              coreTile(mkOperatorTileId(CoreOpId.Not)),
              coreTile(mkSensorTileId(CoreHostActions.OnPageEntered.key)),
            ],
            do: [eatAction()],
          },
          { do: [restAction()] },
        ],
      },
      { when: [hungrySensor()], children: [{ when: [hearSensor()], do: [eatAction()] }] },
      { when: [hungrySensor()], children: [{ do: [restAction()] }] },
      { when: [hungrySensor()], do: [eatAction()] },
    ]);
    const text = paragraphAsText(page, translated);

    for (const marker of [
      "++IFZ",
      "++ANDZ",
      "++WHENZ",
      "++SOZ",
      ">>",
      "//",
      "MI hear",
      "MI ESTA",
      "EVENTZ",
      "KAZ",
      "MI NAY",
      "MI ESTA NAY",
      "EVENTZ NAY",
    ]) {
      assert.ok(text.includes(marker), `${marker} appears in ${text}`);
    }
    // User vocabulary the catalog omits survives untranslated.
    assert.ok(text.includes("walk"), text);
    assert.ok(text.includes("speed"), text);
  });
});
