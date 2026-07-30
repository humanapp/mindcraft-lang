/**
 * Pins the sentence composer's rendered shape: the entry point on the page's
 * trailing empty rule, the filter input's move into the sentence position when
 * the rule is armed from there, the combobox wiring the relocated input keeps,
 * the composition reading dropping the words the projection completes for
 * itself, the pivot comma rendering exactly while composition sits on the
 * DO side with nothing placed there, and the trigger word standing in for an
 * empty WHEN side at that pivot.
 *
 * Structural assertions only: every value asserted here is a role, an id
 * reference, a marker attribute, or the containment of one element in another.
 * The entry's wording and the input's placeholder are display prose and are
 * never asserted.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { whenTriggerWord } from "@mindcraft-lang/core/brain/language-service";
import { BrainCommandHistory, BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileActuatorDef, BrainTileModifierDef, BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import { createDefaultLocalizer } from "@mindcraft-lang/core/localization";
import {
  bag,
  CoreTypeIds,
  choice,
  mkActionDescriptor,
  mkCallDef,
  mod,
  NIL_VALUE,
  optional,
} from "@mindcraft-lang/core/runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type ArmedTargetController,
  type ArmedTargetEntry,
  ArmedTargetProvider,
  type ArmedTileTarget,
} from "./ArmedTargetContext";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainRuleEditor } from "./BrainRuleEditor";

let services: BrainServices;
let nextFnId = 4990;

function makeSensor(sensorId: string): BrainTileSensorDef {
  const fnId = nextFnId;
  nextFnId += 1;
  const fnEntry = services.runtime.functions.register(
    fnId,
    `${sensorId}#${fnId}`,
    false,
    { exec: () => NIL_VALUE },
    mkCallDef(bag())
  );
  return new BrainTileSensorDef(sensorId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
    metadata: { label: sensorId },
  });
}

/** Modifier ids of the object modifiers the object sensor's one slot accepts. */
const objectModifierIds = { carnivore: "composer-entry-carnivore", plant: "composer-entry-plant" } as const;

/** Register the object modifiers the object sensor's slot accepts. */
function registerObjectModifiers(): void {
  for (const modifierId of [objectModifierIds.carnivore, objectModifierIds.plant]) {
    services.edit.tiles.registerTileDef(new BrainTileModifierDef(modifierId, { metadata: { label: modifierId } }));
  }
}

/**
 * A sensor whose one optional slot takes an object modifier, so its bare
 * placement projects the frame's completion word alongside its own.
 */
function makeObjectSensor(sensorId: string): BrainTileSensorDef {
  const fnId = nextFnId;
  nextFnId += 1;
  const fnEntry = services.runtime.functions.register(
    fnId,
    `${sensorId}#${fnId}`,
    false,
    { exec: () => NIL_VALUE },
    mkCallDef(bag(optional(choice(mod(objectModifierIds.carnivore), mod(objectModifierIds.plant)))))
  );
  return new BrainTileSensorDef(sensorId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
    metadata: { label: sensorId },
  });
}

function makeActuator(actuatorId: string): BrainTileActuatorDef {
  const fnId = nextFnId;
  nextFnId += 1;
  const fnEntry = services.runtime.functions.register(
    fnId,
    `${actuatorId}#${fnId}`,
    false,
    { exec: () => NIL_VALUE },
    mkCallDef(bag())
  );
  return new BrainTileActuatorDef(actuatorId, mkActionDescriptor("actuator", fnEntry), {
    metadata: { label: actuatorId },
  });
}

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
};

/** A brain whose first rule holds `whenTiles` and `doTiles`. */
function makeBrain(whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]) {
  const brainDef = BrainDef.emptyBrainDef(services, "sentence-composer");
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  const ruleDef = pageDef.children().get(0) as BrainRuleDef;
  for (const tileDef of whenTiles) ruleDef.when().appendTile(tileDef);
  for (const tileDef of doTiles) ruleDef.do().appendTile(tileDef);
  return { brainDef, pageDef, ruleDef };
}

/** The append target the given entry point arms for `ruleDef`'s `side`. */
function appendTarget(ruleDef: BrainRuleDef, side: RuleSide, entry: ArmedTargetEntry): ArmedTileTarget {
  return { ruleDef, side, mode: "append", entry, onTileSelected: () => true };
}

function renderRuleCard(
  ruleDef: BrainRuleDef,
  pageDef: BrainPageDef,
  options: { isLastRule?: boolean; target?: ArmedTileTarget } = {}
): string {
  const controller: ArmedTargetController = {
    target: options.target ?? null,
    arm: () => {},
    disarm: () => {},
  };
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
      createElement(
        ArmedTargetProvider,
        { value: controller },
        createElement(BrainRuleEditor, {
          ruleDef,
          index: 0,
          pageDef,
          lineNumber: 1,
          updateCounter: 0,
          commandHistory: new BrainCommandHistory(),
          isLastRule: options.isLastRule,
        })
      )
    )
  );
}

/** How many times `pattern` occurs in `markup`. */
function countOf(markup: string, pattern: string): number {
  return markup.split(pattern).length - 1;
}

/** The markup of the sentence element, from its own attribute to its closing tag. */
function sentenceElement(markup: string): string {
  const start = markup.indexOf("data-rule-sentence=");
  assert.ok(start >= 0, "the card renders a sentence element");
  const end = markup.indexOf("</p>", start);
  assert.ok(end > start, "the sentence element is closed");
  return markup.slice(start, end);
}

/** The text the sentence element reads, with its own tag and every nested tag removed. */
function sentenceReadingText(markup: string): string {
  const element = sentenceElement(markup);
  return element.slice(element.indexOf(">") + 1).replace(/<[^>]*>/g, "");
}

/** The value of `attribute` on the element carrying `marker`. */
function attributeOf(markup: string, marker: string, attribute: string): string | undefined {
  const start = markup.indexOf(marker);
  if (start < 0) return undefined;
  const tagStart = markup.lastIndexOf("<", start);
  const tagEnd = markup.indexOf(">", start);
  const tag = markup.slice(tagStart, tagEnd);
  return new RegExp(`${attribute}="([^"]+)"`).exec(tag)?.[1];
}

before(() => {
  services = __test__createBrainServices();
  registerObjectModifiers();
});

describe("the sentence composer's entry point", () => {
  test("the page's trailing empty rule carries it", () => {
    const { ruleDef, pageDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, pageDef, { isLastRule: true });
    assert.equal(countOf(markup, `data-sentence-composer-entry="${ruleDef.id()}"`), 1);
  });

  test("an empty rule that is not the trailing one does not", () => {
    const { ruleDef, pageDef } = makeBrain([], []);
    assert.equal(countOf(renderRuleCard(ruleDef, pageDef, { isLastRule: false }), "data-sentence-composer-entry"), 0);
  });

  test("a trailing rule that already holds tiles does not", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("composer-entry-see")], []);
    assert.equal(countOf(renderRuleCard(ruleDef, pageDef, { isLastRule: true }), "data-sentence-composer-entry"), 0);
  });

  test("it gives way to the filter input once the rule is armed", () => {
    const { ruleDef, pageDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, pageDef, {
      isLastRule: true,
      target: appendTarget(ruleDef, RuleSide.When, "sentence"),
    });
    assert.equal(countOf(markup, "data-sentence-composer-entry"), 0);
    assert.equal(countOf(markup, 'data-strip-filter="sentence"'), 1);
  });

  test("it gives way to a target armed from a tap as well", () => {
    const { ruleDef, pageDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, pageDef, {
      isLastRule: true,
      target: appendTarget(ruleDef, RuleSide.When, "tray"),
    });
    assert.equal(countOf(markup, "data-sentence-composer-entry"), 0);
    assert.equal(countOf(markup, 'data-strip-filter="tray"'), 1);
  });
});

describe("the filter input's position", () => {
  test("a target armed from the sentence renders the input inside the sentence", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("composer-pos-see")], []);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.When, "sentence") });
    assert.ok(sentenceElement(markup).includes('data-strip-filter="sentence"'));
  });

  test("a target armed from the tray leaves the input outside the sentence", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("composer-pos-hear")], []);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.When, "tray") });
    assert.equal(countOf(markup, 'data-strip-filter="tray"'), 1);
    assert.ok(!sentenceElement(markup).includes("data-strip-filter"));
  });

  test("composing renders one sentence element, not two", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("composer-pos-smell")], [makeActuator("composer-pos-move")]);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.Do, "sentence") });
    assert.equal(countOf(markup, "data-rule-sentence="), 1);
  });

  test("an armed empty rule renders the sentence line for the input to sit in", () => {
    const { ruleDef, pageDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, pageDef, {
      isLastRule: true,
      target: appendTarget(ruleDef, RuleSide.When, "sentence"),
    });
    assert.equal(countOf(markup, `data-rule-sentence="${ruleDef.id()}"`), 1);
    assert.equal(countOf(markup, "data-sentence-tile-index"), 0);
  });
});

describe("the relocated input's combobox wiring", () => {
  test("it is still the combobox over the candidate list", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("composer-aria-see")], []);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.When, "sentence") });
    assert.equal(attributeOf(markup, 'data-strip-filter="sentence"', "role"), "combobox");
    assert.equal(attributeOf(markup, 'data-strip-filter="sentence"', "aria-autocomplete"), "list");
  });

  test("its controlled list is an element of the card", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("composer-aria-hear")], []);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.When, "sentence") });
    const controls = attributeOf(markup, 'data-strip-filter="sentence"', "aria-controls");
    assert.ok(controls, "the input names the list it controls");
    assert.equal(countOf(markup, `id="${controls}"`), 1);
  });

  test("its description references a rendered element", () => {
    const { ruleDef, pageDef } = makeBrain([makeSensor("composer-aria-smell")], []);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.When, "sentence") });
    const describedBy = attributeOf(markup, 'data-strip-filter="sentence"', "aria-describedby");
    assert.ok(describedBy, "the input names its description");
    for (const id of describedBy.split(" ")) {
      assert.equal(countOf(markup, `id="${id}"`), 1);
    }
  });
});

describe("the composition reading on the sentence line", () => {
  test("a settled rule reads its sensor's frame completion as a word of its own", () => {
    const { ruleDef, pageDef } = makeBrain([makeObjectSensor("composer-reading-bump")], []);
    const markup = renderRuleCard(ruleDef, pageDef);
    assert.equal(countOf(markup, "data-sentence-tile-index"), 2);
  });

  test("the same rule under composition reads only the word it holds", () => {
    const { ruleDef, pageDef } = makeBrain([makeObjectSensor("composer-reading-bump-2")], []);
    const markup = renderRuleCard(ruleDef, pageDef, {
      target: appendTarget(ruleDef, RuleSide.When, "sentence"),
    });
    assert.equal(countOf(markup, "data-sentence-tile-index"), 1);
  });

  test("a rule armed from the tray keeps its settled reading", () => {
    const { ruleDef, pageDef } = makeBrain([makeObjectSensor("composer-reading-bump-3")], []);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.When, "tray") });
    assert.equal(countOf(markup, "data-sentence-tile-index"), 2);
  });
});

describe("the pivot comma", () => {
  const commaMarker = "data-composer-pivot-comma";

  test("renders while composition sits on the armed DO side", () => {
    const { ruleDef, pageDef } = makeBrain([makeObjectSensor("composer-comma-bump")], []);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.Do, "sentence") });
    assert.equal(countOf(markup, `${commaMarker}="${ruleDef.id()}"`), 1);
  });

  test("renders on an empty rule pivoted from its empty WHEN side", () => {
    const { ruleDef, pageDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, pageDef, {
      isLastRule: true,
      target: appendTarget(ruleDef, RuleSide.Do, "sentence"),
    });
    assert.equal(countOf(markup, commaMarker), 1);
  });

  test("does not render while composition is still on the WHEN side", () => {
    const { ruleDef, pageDef } = makeBrain([makeObjectSensor("composer-comma-bump-2")], []);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.When, "sentence") });
    assert.equal(countOf(markup, commaMarker), 0);
  });

  test("gives way to the sentence's own clause comma once a word stands behind it", () => {
    const { ruleDef, pageDef } = makeBrain(
      [makeObjectSensor("composer-comma-bump-3")],
      [makeActuator("composer-comma-jump")]
    );
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.Do, "sentence") });
    assert.equal(countOf(markup, commaMarker), 0);
  });

  test("does not render on a settled rule", () => {
    const { ruleDef, pageDef } = makeBrain([makeObjectSensor("composer-comma-bump-4")], []);
    assert.equal(countOf(renderRuleCard(ruleDef, pageDef), commaMarker), 0);
  });

  test("does not render for a target armed from the tray", () => {
    const { ruleDef, pageDef } = makeBrain([makeObjectSensor("composer-comma-bump-5")], []);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.Do, "tray") });
    assert.equal(countOf(markup, commaMarker), 0);
  });
});

describe("the trigger word at the pivot", () => {
  /** The word the projection reads a rule with no condition as, under the fallback localizer the card uses. */
  const trigger = whenTriggerWord(createDefaultLocalizer());

  test("a pivot from an empty WHEN side reads it before the comma", () => {
    const { ruleDef, pageDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, pageDef, {
      isLastRule: true,
      target: appendTarget(ruleDef, RuleSide.Do, "sentence"),
    });
    assert.equal(countOf(markup, `data-composer-pivot-comma="${ruleDef.id()}"`), 1);
    assert.equal(sentenceReadingText(markup), `${trigger},`);
  });

  test("a pivot from a WHEN side that reads its own words takes the comma alone", () => {
    const { ruleDef, pageDef } = makeBrain([makeObjectSensor("composer-trigger-bump")], []);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.Do, "sentence") });
    assert.equal(countOf(sentenceReadingText(markup), trigger), 0);
    assert.equal(countOf(sentenceReadingText(markup), ","), 1);
  });

  test("an empty rule still composing on its WHEN side reads neither it nor the comma", () => {
    const { ruleDef, pageDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, pageDef, {
      isLastRule: true,
      target: appendTarget(ruleDef, RuleSide.When, "sentence"),
    });
    assert.equal(sentenceReadingText(markup), "");
  });

  test("a word placed behind the pivot leaves exactly one trigger word and one comma", () => {
    const { ruleDef, pageDef } = makeBrain([], [makeActuator("composer-trigger-jump")]);
    const markup = renderRuleCard(ruleDef, pageDef, { target: appendTarget(ruleDef, RuleSide.Do, "sentence") });
    const reading = sentenceReadingText(markup);
    assert.equal(countOf(reading, trigger), 1);
    assert.equal(countOf(reading, ","), 1);
  });

  test("a settled empty rule reads nothing at all", () => {
    const { ruleDef, pageDef } = makeBrain([], []);
    assert.equal(countOf(renderRuleCard(ruleDef, pageDef, { isLastRule: true }), trigger), 0);
  });
});
