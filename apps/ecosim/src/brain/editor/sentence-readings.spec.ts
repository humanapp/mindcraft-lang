/**
 * Pins the sentence every shipped ecosim tile reads in: one arrangement per
 * sensor and actuator of the catalog -- the tile alone, the tile with its first
 * modifier or parameter, and the tile with an object where it takes one -- plus
 * the page paragraph a multi-rule page reads as and the line a rule shows while
 * it is being composed. A wording change moves one of these strings, so a change
 * to tile language metadata or to the projection shows up here as an edit.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { IBrainPageDef, IBrainTileDef } from "@wendoo-lang/core/app";
import { coreModule, createWendooEnvironment, type WendooEnvironment } from "@wendoo-lang/core/app";
import type { BrainServices } from "@wendoo-lang/core/brain";
import {
  mkActuatorTileId,
  mkModifierTileId,
  mkOperatorTileId,
  mkParameterTileId,
  mkSensorTileId,
  mkVariableTileId,
} from "@wendoo-lang/core/brain";
import { __test__appendTile } from "@wendoo-lang/core/brain/__test__";
import {
  paragraphText,
  projectPageParagraph,
  projectRuleSentence,
  segmentDisplayText,
  sentenceText,
  whenTriggerWord,
} from "@wendoo-lang/core/brain/language-service";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo-lang/core/brain/model";
import { BrainTileLiteralDef, BrainTileVariableDef } from "@wendoo-lang/core/brain/tiles";
import type { Localizer } from "@wendoo-lang/core/localization";
import { createDefaultLocalizer } from "@wendoo-lang/core/localization";
import { CoreHostActions, CoreOpId, CoreTypeIds } from "@wendoo-lang/core/runtime";
import { composePivotReading, composeSentenceReading } from "@wendoo-lang/ui/brain-editor/sentence-composer";
import { EcosimHostActions } from "../abi-ids";
import { createEcosimModule } from "../index";
import { TileIds } from "../tileids";

let environment: WendooEnvironment;
let services: BrainServices;
let localizer: Localizer;

before(() => {
  environment = createWendooEnvironment({ modules: [coreModule(), createEcosimModule()] });
  services = environment.brainServices;
  localizer = createDefaultLocalizer();
});

/** The registered catalog tile `tileId` names. */
function tile(tileId: string): IBrainTileDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `catalog tile ${tileId} is registered`);
  return tileDef;
}

const sensor = (key: string) => tile(mkSensorTileId(key));
const actuator = (key: string) => tile(mkActuatorTileId(key));
const modifier = (id: string) => tile(mkModifierTileId(id));
const parameter = (id: string) => tile(mkParameterTileId(id));
const operator = (opId: string) => tile(mkOperatorTileId(opId));

function number(value: number): IBrainTileDef {
  return new BrainTileLiteralDef(CoreTypeIds.Number, value, {}, services);
}

function text(value: string): IBrainTileDef {
  return new BrainTileLiteralDef(CoreTypeIds.String, value, {}, services);
}

function variable(name: string): IBrainTileDef {
  return new BrainTileVariableDef(mkVariableTileId(name), name, CoreTypeIds.Number, name);
}

/** A rule of a real brain document carrying the tiles of each side. */
function rule(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]): BrainRuleDef {
  const brainDef = BrainDef.emptyBrainDef(services, "ecosim-sentence-readings");
  const ruleDef = brainDef.pages().get(0).children().get(0) as BrainRuleDef;
  for (const tileDef of whenTiles) {
    __test__appendTile(ruleDef.when(), tileDef);
  }
  for (const tileDef of doTiles) {
    __test__appendTile(ruleDef.do(), tileDef);
  }
  return ruleDef;
}

/** The settled sentence of a rule holding the tiles of each side. */
function reading(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[] = []): string {
  return sentenceText(projectRuleSentence(rule(whenTiles, doTiles), localizer), localizer);
}

/** One rule of a page fixture: the tiles of each side, plus any child rules. */
interface RuleSpec {
  readonly when?: readonly IBrainTileDef[];
  readonly do?: readonly IBrainTileDef[];
  readonly children?: readonly RuleSpec[];
}

function appendRuleSpecs(page: BrainPageDef, specs: readonly RuleSpec[], depth: number): void {
  for (const spec of specs) {
    const ruleDef = page.appendNewRule();
    for (const tileDef of spec.when ?? []) {
      __test__appendTile(ruleDef.when(), tileDef);
    }
    for (const tileDef of spec.do ?? []) {
      __test__appendTile(ruleDef.do(), tileDef);
    }
    for (let i = 0; i < depth; i++) {
      assert.ok(ruleDef.indent(), `rule indents to depth ${depth}`);
    }
    appendRuleSpecs(page, spec.children ?? [], depth + 1);
  }
}

/** A page of a real brain document holding the rule tree `specs` describes. */
function page(specs: readonly RuleSpec[]): IBrainPageDef {
  const brainDef = BrainDef.emptyBrainDef(services, "ecosim-paragraph-readings");
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  pageDef.removeRuleAtIndex(0);
  appendRuleSpecs(pageDef, specs, 0);
  return pageDef;
}

/** The paragraph of a page holding the rule tree `specs` describes. */
function paragraph(specs: readonly RuleSpec[]): string {
  return paragraphText(projectPageParagraph(page(specs), localizer), localizer);
}

/** The line a rule shows mid-composition, with the pivot comma when `pivoted`. */
function composing(
  whenTiles: readonly IBrainTileDef[],
  doTiles: readonly IBrainTileDef[] = [],
  pivoted = false
): string {
  const settled = projectRuleSentence(rule(whenTiles, doTiles), localizer).toArray();
  const composed = composeSentenceReading(settled);
  const segments = pivoted ? [...composed, ...composePivotReading(composed, whenTriggerWord(localizer))] : composed;
  return segments.map((segment) => segmentDisplayText(segment, localizer)).join("");
}

// -- sensors ------------------------------------------------------------------

describe("ecosim sensor readings", () => {
  test("the see sensor reads its object, its kind, and its distance", () => {
    const see = () => sensor(EcosimHostActions.See.key);

    assert.equal(reading([see()]), "When I see anything,");
    assert.equal(reading([see(), modifier(TileIds.Modifier.ActorKindCarnivore)]), "When I see a carnivore,");
    assert.equal(reading([see(), modifier(TileIds.Modifier.ActorKindHerbivore)]), "When I see a herbivore,");
    assert.equal(reading([see(), modifier(TileIds.Modifier.ActorKindPlant)]), "When I see a plant,");
    assert.equal(reading([see(), modifier(TileIds.Modifier.DistanceNearby)]), "When I see nearby,");
    assert.equal(reading([see(), modifier(TileIds.Modifier.DistanceFarAway)]), "When I see far away,");
    assert.equal(
      reading([see(), modifier(TileIds.Modifier.ActorKindPlant), modifier(TileIds.Modifier.DistanceNearby)]),
      "When I see a plant nearby,"
    );
  });

  test("the bump sensor reads its object and its kind", () => {
    const bump = () => sensor(EcosimHostActions.Bump.key);

    assert.equal(reading([bump()]), "When I bump anything,");
    assert.equal(reading([bump(), modifier(TileIds.Modifier.ActorKindCarnivore)]), "When I bump a carnivore,");
    assert.equal(reading([bump(), modifier(TileIds.Modifier.ActorKindHerbivore)]), "When I bump a herbivore,");
    assert.equal(reading([bump(), modifier(TileIds.Modifier.ActorKindPlant)]), "When I bump a plant,");
  });

  test("a value sensor alone reads with no subject", () => {
    assert.equal(reading([sensor(CoreHostActions.Random.key)]), "When a random number,");
    assert.equal(reading([sensor(CoreHostActions.CurrentPage.key)]), "When the current page,");
    assert.equal(reading([sensor(CoreHostActions.PreviousPage.key)]), "When the previous page,");
  });

  test("a value sensor inside a comparison reads with no subject", () => {
    assert.equal(
      reading([sensor(CoreHostActions.Random.key), operator(CoreOpId.GreaterThan), number(5)]),
      "When a random number is greater than 5,"
    );
  });

  test("the timeout sensor reads its bare word and its duration", () => {
    assert.equal(reading([sensor(CoreHostActions.Timeout.key)]), "When I wait for a moment,");
    assert.equal(reading([sensor(CoreHostActions.Timeout.key), number(3)]), "When I wait for 3,");
  });

  test("the page-entered sensor reads as the event", () => {
    assert.equal(reading([sensor(CoreHostActions.OnPageEntered.key)]), "When this page starts,");
  });
});

// -- actuators ----------------------------------------------------------------

describe("ecosim actuator readings", () => {
  test("the move actuator reads its direction, its manner, and its priority", () => {
    const move = () => actuator(EcosimHostActions.Move.key);

    assert.equal(reading([], [move()]), "Always, move.");
    assert.equal(reading([], [move(), modifier(TileIds.Modifier.MovementForward)]), "Always, move forward.");
    assert.equal(reading([], [move(), modifier(TileIds.Modifier.MovementToward)]), "Always, move toward.");
    assert.equal(reading([], [move(), modifier(TileIds.Modifier.MovementAwayFrom)]), "Always, move away from.");
    assert.equal(reading([], [move(), modifier(TileIds.Modifier.MovementAvoid)]), "Always, move avoiding.");
    assert.equal(reading([], [move(), modifier(TileIds.Modifier.MovementWander)]), "Always, move wandering.");
    assert.equal(reading([], [move(), modifier(TileIds.Modifier.Quickly)]), "Always, move quickly.");
    assert.equal(reading([], [move(), modifier(TileIds.Modifier.Slowly)]), "Always, move slowly.");
    assert.equal(
      reading(
        [],
        [move(), modifier(TileIds.Modifier.MovementWander), parameter(TileIds.Parameter.Priority), number(2)]
      ),
      "Always, move wandering priority 2."
    );
  });

  test("the turn actuator reads its turn, its heading, and its manner", () => {
    const turn = () => actuator(EcosimHostActions.Turn.key);

    assert.equal(reading([], [turn()]), "Always, turn.");
    assert.equal(reading([], [turn(), modifier(TileIds.Modifier.TurnAround)]), "Always, turn around.");
    assert.equal(reading([], [turn(), modifier(TileIds.Modifier.TurnLeft)]), "Always, turn left.");
    assert.equal(reading([], [turn(), modifier(TileIds.Modifier.TurnRight)]), "Always, turn right.");
    assert.equal(reading([], [turn(), modifier(TileIds.Modifier.DirectionNorth)]), "Always, turn north.");
    assert.equal(reading([], [turn(), modifier(TileIds.Modifier.MovementAwayFrom)]), "Always, turn away from.");
    assert.equal(reading([], [turn(), modifier(TileIds.Modifier.Slowly)]), "Always, turn slowly.");
  });

  test("the eat actuator reads as its own word", () => {
    assert.equal(reading([], [actuator(EcosimHostActions.Eat.key)]), "Always, eat.");
  });

  test("the say actuator reads its words and its duration", () => {
    const say = () => actuator(EcosimHostActions.Say.key);

    assert.equal(reading([], [say()]), "Always, say.");
    assert.equal(reading([], [say(), text("hello")]), 'Always, say "hello".');
    assert.equal(
      reading([], [say(), text("hello"), parameter(TileIds.Parameter.Duration), number(2)]),
      'Always, say "hello" duration 2.'
    );
  });

  test("the shoot actuator reads its rate", () => {
    const shoot = () => actuator(EcosimHostActions.Shoot.key);

    assert.equal(reading([], [shoot()]), "Always, shoot.");
    assert.equal(reading([], [shoot(), parameter(TileIds.Parameter.Rate), number(2)]), "Always, shoot per/sec 2.");
  });

  test("the switch-page actuator reads as its own word", () => {
    assert.equal(reading([], [actuator(CoreHostActions.SwitchPage.key)]), "Always, go to.");
  });
});

// -- conditions ---------------------------------------------------------------

describe("ecosim condition readings", () => {
  test("a comparison reads with no subject and keeps it before a DO clause", () => {
    const comparison = () => [variable("energy"), operator(CoreOpId.GreaterThan), number(80)];

    assert.equal(reading(comparison()), "When energy is greater than 80,");
    assert.equal(reading(comparison(), [actuator(EcosimHostActions.Eat.key)]), "When energy is greater than 80, eat.");
  });

  test("the logical operators read in the sentence register, not the chip register", () => {
    const see = () => sensor(EcosimHostActions.See.key);
    const bump = () => sensor(EcosimHostActions.Bump.key);
    const move = () => actuator(EcosimHostActions.Move.key);

    assert.equal(reading([see(), operator(CoreOpId.And), bump()], [move()]), "When I see and bump, move.");
    assert.equal(reading([see(), operator(CoreOpId.Or), bump()], [move()]), "When I see or bump, move.");
    assert.equal(reading([operator(CoreOpId.Not), see()], [move()]), "When I do not see anything, move.");
  });

  test("the else signal reads as the whole trigger, and mid-sentence as an operand", () => {
    const otherwise = () => sensor(CoreHostActions.Otherwise.key);

    assert.equal(reading([otherwise()], [actuator(EcosimHostActions.Move.key)]), "Otherwise, move.");
    assert.equal(reading([otherwise()]), "Otherwise,");
    assert.equal(
      reading([otherwise(), operator(CoreOpId.And), sensor(EcosimHostActions.Bump.key)]),
      "When otherwise and bump,"
    );
  });

  test("a rule with no DO tiles reads as its condition alone", () => {
    assert.equal(
      reading([sensor(EcosimHostActions.See.key), modifier(TileIds.Modifier.ActorKindCarnivore)]),
      "When I see a carnivore,"
    );
  });
});

// -- paragraphs ---------------------------------------------------------------

describe("ecosim paragraph readings", () => {
  const see = () => sensor(EcosimHostActions.See.key);
  const bump = () => sensor(EcosimHostActions.Bump.key);
  const move = () => actuator(EcosimHostActions.Move.key);
  const eat = () => actuator(EcosimHostActions.Eat.key);
  const turn = () => actuator(EcosimHostActions.Turn.key);
  const plant = () => modifier(TileIds.Modifier.ActorKindPlant);
  const carnivore = () => modifier(TileIds.Modifier.ActorKindCarnivore);
  const wander = () => modifier(TileIds.Modifier.MovementWander);

  test("a flat page reads as one sentence per rule", () => {
    assert.equal(
      paragraph([
        { when: [see(), plant()], do: [move(), modifier(TileIds.Modifier.MovementToward)] },
        { when: [bump(), plant()], do: [eat()] },
        { do: [move(), wander()] },
      ]),
      "When I see a plant, move toward. When I bump a plant, eat. Always, move wandering."
    );
  });

  test("a parent with one child reads as one sentence with a continuation", () => {
    assert.equal(
      paragraph([{ when: [see(), plant()], do: [move()], children: [{ when: [bump()], do: [eat()] }] }]),
      "When I see a plant, move, and if I bump anything, eat."
    );
  });

  test("an always-headed parent carries its child's continuation", () => {
    assert.equal(
      paragraph([{ do: [move(), wander()], children: [{ when: [see(), carnivore()], do: [turn()] }] }]),
      "Always, move wandering, and if I see a carnivore, turn."
    );
  });

  test("a parent with no action of its own is completed by its child's clause", () => {
    assert.equal(
      paragraph([
        {
          when: [sensor(CoreHostActions.Otherwise.key)],
          children: [{ when: [bump()], do: [move(), modifier(TileIds.Modifier.MovementAwayFrom)] }],
        },
      ]),
      "Otherwise, when I bump anything, move away from."
    );
  });

  test("a page of rules with no DO tiles reads as conditions in a row", () => {
    assert.equal(
      paragraph([{ when: [see(), plant()] }, { when: [bump()] }]),
      "When I see a plant, When I bump anything,"
    );
  });

  test("two children of one parent and a chain of two read the same continuations", () => {
    const breadth = paragraph([
      {
        when: [see()],
        do: [move()],
        children: [
          { when: [bump()], do: [eat()] },
          { when: [see(), carnivore()], do: [turn()] },
        ],
      },
    ]);
    const depth = paragraph([
      {
        when: [see()],
        do: [move()],
        children: [{ when: [bump()], do: [eat()], children: [{ when: [see(), carnivore()], do: [turn()] }] }],
      },
    ]);

    assert.equal(breadth, "When I see anything, move, and if I bump anything, eat, and if I see a carnivore, turn.");
    assert.equal(depth, breadth);
  });
});

// -- composition --------------------------------------------------------------

describe("ecosim composition readings", () => {
  test("a partial WHEN side reads only the words placed on it", () => {
    assert.equal(composing([sensor(EcosimHostActions.See.key)]), "When I see");
    assert.equal(
      composing([sensor(EcosimHostActions.See.key), modifier(TileIds.Modifier.ActorKindPlant)]),
      "When I see a plant"
    );
    assert.equal(composing([variable("energy"), operator(CoreOpId.GreaterThan)]), "When energy is greater than");
  });

  test("the pivot reads the comma, and the trigger word before it on an empty WHEN side", () => {
    assert.equal(composing([sensor(EcosimHostActions.See.key)], [], true), "When I see,");
    assert.equal(composing([], [], true), "Always,");
  });

  test("a rule composed on both sides reads as one clause with no terminator", () => {
    assert.equal(
      composing([sensor(EcosimHostActions.See.key)], [actuator(EcosimHostActions.Move.key)]),
      "When I see, move"
    );
  });
});
