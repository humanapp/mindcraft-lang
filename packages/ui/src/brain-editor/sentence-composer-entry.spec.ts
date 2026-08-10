/**
 * Pins the sentence composer's rendered shape: the entry point on every empty
 * rule of a page, the filter input's move into the sentence position when
 * the rule is armed from there, the combobox wiring the relocated input keeps,
 * the composition reading dropping the words the projection completes for
 * itself, the pivot comma rendering exactly while composition sits on the
 * DO side with nothing placed there, the trigger word standing in for an
 * empty WHEN side at that pivot, the filter field holding the input in one
 * inline wrapper whether or not a text value is open, and the one type the
 * line, its hosted input, and its entry point are all set in.
 *
 * Structural assertions only: every value asserted here is a role, an id
 * reference, a marker attribute, a type utility, or the containment of one
 * element in another. The entry's wording and the input's placeholder are
 * display prose and are never asserted.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { whenTriggerWord } from "@mindcraft-lang/core/brain/language-service";
import {
  BrainCommandHistory,
  BrainDef,
  type BrainPageDef,
  type BrainRuleDef,
  IndentRuleCommand,
  InsertRuleCommand,
} from "@mindcraft-lang/core/brain/model";
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
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type ArmedTargetController,
  type ArmedTargetEntry,
  ArmedTargetProvider,
  type ArmedTileTarget,
} from "./ArmedTargetContext";
import { filterFieldWithQuotes } from "./BrainCandidateStrip";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainPageEditor } from "./BrainPageEditor";
import { BrainRuleEditor } from "./BrainRuleEditor";
import type { CaretPosition } from "./caret-run";

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

/** The append target the given entry point arms for `ruleDef`'s `side`, at that side's end gap. */
function appendTarget(ruleDef: BrainRuleDef, side: RuleSide, entry: ArmedTargetEntry): ArmedTileTarget {
  const caret: CaretPosition = { kind: "gap", side, tileIndex: ruleDef.side(side).tiles().size() };
  return {
    ruleDef,
    side,
    mode: "append",
    caret: entry === "sentence" ? caret : undefined,
    entry,
    onTileSelected: () => true,
  };
}

/** The target a tap on the tile at `tileIndex` of `side` arms through the given entry point. */
function tileTarget(
  ruleDef: BrainRuleDef,
  side: RuleSide,
  tileIndex: number,
  entry: ArmedTargetEntry
): ArmedTileTarget {
  return {
    ruleDef,
    side,
    mode: "replace",
    tileIndex,
    anchorTileIndex: tileIndex,
    caret: entry === "sentence" ? { kind: "element", side, tileIndex } : undefined,
    entry,
    onTileSelected: () => true,
  };
}

function renderRuleCard(ruleDef: BrainRuleDef, options: { depth?: number; target?: ArmedTileTarget } = {}): string {
  const controller: ArmedTargetController = {
    target: options.target ?? null,
    mode: null,
    arm: () => {},
    disarm: () => {},
    reportMode: () => {},
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
          depth: options.depth,
          lineNumber: 1,
          ruleCount: 1,
          revision: "",
          commandHistory: new BrainCommandHistory(),
        })
      )
    )
  );
}

/** The whole page's rules as the editor lays them out. */
function renderPage(pageDef: BrainPageDef): string {
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
      createElement(BrainPageEditor, { pageDef, commandHistory: new BrainCommandHistory() })
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
  test("an empty rule carries it", () => {
    const { ruleDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef);
    assert.equal(countOf(markup, `data-sentence-composer-entry="${ruleDef.ruleId()}"`), 1);
  });

  test("an empty rule carries it at every indent depth", () => {
    const { ruleDef } = makeBrain([], []);
    for (const depth of [0, 1, 2, 3]) {
      const markup = renderRuleCard(ruleDef, { depth });
      assert.equal(
        countOf(markup, `data-sentence-composer-entry="${ruleDef.ruleId()}"`),
        1,
        `an empty rule at depth ${depth} carries the entry`
      );
    }
  });

  test("a rule that already holds tiles does not", () => {
    const { ruleDef } = makeBrain([makeSensor("composer-entry-see")], []);
    assert.equal(countOf(renderRuleCard(ruleDef), "data-sentence-composer-entry"), 0);
  });

  test("it gives way to the filter input once the rule is armed", () => {
    const { ruleDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, {
      target: appendTarget(ruleDef, RuleSide.When, "sentence"),
    });
    assert.equal(countOf(markup, "data-sentence-composer-entry"), 0);
    assert.equal(countOf(markup, 'data-strip-filter="sentence"'), 1);
  });

  test("it gives way to a target armed from a tap as well", () => {
    const { ruleDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, {
      target: appendTarget(ruleDef, RuleSide.When, "tray"),
    });
    assert.equal(countOf(markup, "data-sentence-composer-entry"), 0);
    assert.equal(countOf(markup, 'data-strip-filter="tray"'), 1);
  });
});

describe("the entry point across a page's rules", () => {
  test("a rule blanked in above a settled one carries it, as does the trailing rule", () => {
    const { pageDef, ruleDef: settled } = makeBrain([makeSensor("composer-page-see")], []);
    const trailing = pageDef.appendNewRule() as BrainRuleDef;
    new BrainCommandHistory().executeCommand(new InsertRuleCommand(settled, "before"));
    const inserted = pageDef.children().get(0) as BrainRuleDef;
    const markup = renderPage(pageDef);
    assert.equal(countOf(markup, `data-sentence-composer-entry="${inserted.ruleId()}"`), 1);
    assert.equal(countOf(markup, `data-sentence-composer-entry="${trailing.ruleId()}"`), 1);
    assert.equal(countOf(markup, `data-sentence-composer-entry="${settled.ruleId()}"`), 0);
    assert.equal(countOf(markup, "data-sentence-composer-entry"), 2);
  });

  test("the trailing empty rule keeps it once indented under the rule above", () => {
    const { pageDef } = makeBrain([makeSensor("composer-page-hear")], []);
    const trailing = pageDef.appendNewRule() as BrainRuleDef;
    new BrainCommandHistory().executeCommand(new IndentRuleCommand(trailing));
    const markup = renderPage(pageDef);
    assert.equal(countOf(markup, `data-sentence-composer-entry="${trailing.ruleId()}"`), 1);
  });
});

describe("the filter input's position", () => {
  test("a target armed from the sentence renders the input inside the sentence", () => {
    const { ruleDef } = makeBrain([makeSensor("composer-pos-see")], []);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.When, "sentence") });
    assert.ok(sentenceElement(markup).includes('data-strip-filter="sentence"'));
  });

  test("a target armed from the tray leaves the input outside the sentence", () => {
    const { ruleDef } = makeBrain([makeSensor("composer-pos-hear")], []);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.When, "tray") });
    assert.equal(countOf(markup, 'data-strip-filter="tray"'), 1);
    assert.ok(!sentenceElement(markup).includes("data-strip-filter"));
  });

  test("composing renders one sentence element, not two", () => {
    const { ruleDef } = makeBrain([makeSensor("composer-pos-smell")], [makeActuator("composer-pos-move")]);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.Do, "sentence") });
    assert.equal(countOf(markup, "data-rule-sentence="), 1);
  });

  test("a target armed at the end of the line renders the input after every word", () => {
    const { ruleDef } = makeBrain([makeSensor("composer-pos-end")], [makeActuator("composer-pos-end-move")]);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.Do, "sentence") });
    const line = sentenceElement(markup);
    assert.ok(line.indexOf('data-strip-filter="sentence"') > line.lastIndexOf("data-sentence-tile-index"));
  });

  test("a target armed on a tile renders the input before that tile's word", () => {
    const { ruleDef } = makeBrain([makeSensor("composer-pos-at")], [makeActuator("composer-pos-at-move")]);
    const markup = renderRuleCard(ruleDef, { target: tileTarget(ruleDef, RuleSide.Do, 0, "sentence") });
    const line = sentenceElement(markup);
    const input = line.indexOf('data-strip-filter="sentence"');
    assert.ok(input >= 0, "the input stands in the sentence");
    assert.ok(input < line.indexOf('data-sentence-tile-index="1"'), "the input opens the armed tile's word");
    assert.ok(input > line.indexOf('data-sentence-tile-index="0"'), "the word before it keeps its place");
  });

  test("a rule whose settled reading completes itself hosts the input at the armed word, not past it", () => {
    const { ruleDef } = makeBrain([makeObjectSensor("composer-pos-bump")], [makeActuator("composer-pos-bump-move")]);
    const markup = renderRuleCard(ruleDef, { target: tileTarget(ruleDef, RuleSide.Do, 0, "sentence") });
    const line = sentenceElement(markup);
    assert.equal(countOf(line, "data-sentence-tile-index"), 2, "the composition reading drops the completion word");
    const input = line.indexOf('data-strip-filter="sentence"');
    assert.ok(input >= 0, "the input stands in the sentence");
    assert.ok(input < line.indexOf('data-sentence-tile-index="1"'), "the input opens the armed tile's word");
  });

  test("an armed empty rule renders the sentence line for the input to sit in", () => {
    const { ruleDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, {
      target: appendTarget(ruleDef, RuleSide.When, "sentence"),
    });
    assert.equal(countOf(markup, `data-rule-sentence="${ruleDef.ruleId()}"`), 1);
    assert.equal(countOf(markup, "data-sentence-tile-index"), 0);
  });
});

/** The props the filter field's wrapper carries. */
interface FilterFieldProps {
  readonly className: string;
  readonly children: readonly ReactNode[];
}

/** The wrapper of the filter field built for `inSentence`, with a text value open or not. */
function filterFields(inSentence: boolean) {
  const input = createElement("input", { type: "text" });
  const quoteMark = createElement("span", null, '"');
  return {
    input,
    closed: filterFieldWithQuotes(input, undefined, inSentence) as ReactElement<FilterFieldProps>,
    open: filterFieldWithQuotes(input, quoteMark, inSentence) as ReactElement<FilterFieldProps>,
  };
}

describe("the filter field around an open text value", () => {
  test("the sentence field keeps one wrapper across the mode", () => {
    const { closed, open } = filterFields(true);
    assert.equal(closed.type, open.type);
    assert.equal(closed.props.className, open.props.className);
  });

  test("the sentence field keeps the input in the same place in that wrapper", () => {
    const { input, closed, open } = filterFields(true);
    const place = closed.props.children.indexOf(input);
    assert.ok(place >= 0, "the closed field renders the input");
    assert.equal(open.props.children.indexOf(input), place);
  });

  test("the sentence field's wrapper takes no display of its own", () => {
    const { closed, open } = filterFields(true);
    for (const field of [closed, open]) {
      const tokens = field.props.className.split(" ");
      for (const display of ["block", "flex", "inline-flex", "grid", "table"]) {
        assert.ok(!tokens.includes(display), `the field runs inline, without ${display}`);
      }
    }
  });

  test("the tray field keeps one wrapper and the same place as well", () => {
    const { input, closed, open } = filterFields(false);
    assert.equal(closed.type, open.type);
    assert.equal(closed.props.className, open.props.className);
    const place = closed.props.children.indexOf(input);
    assert.ok(place >= 0, "the closed field renders the input");
    assert.equal(open.props.children.indexOf(input), place);
  });
});

describe("the relocated input's combobox wiring", () => {
  test("it is still the combobox over the candidate list", () => {
    const { ruleDef } = makeBrain([makeSensor("composer-aria-see")], []);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.When, "sentence") });
    assert.equal(attributeOf(markup, 'data-strip-filter="sentence"', "role"), "combobox");
    assert.equal(attributeOf(markup, 'data-strip-filter="sentence"', "aria-autocomplete"), "list");
  });

  test("its controlled list is an element of the card", () => {
    const { ruleDef } = makeBrain([makeSensor("composer-aria-hear")], []);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.When, "sentence") });
    const controls = attributeOf(markup, 'data-strip-filter="sentence"', "aria-controls");
    assert.ok(controls, "the input names the list it controls");
    assert.equal(countOf(markup, `id="${controls}"`), 1);
  });

  test("its description references a rendered element", () => {
    const { ruleDef } = makeBrain([makeSensor("composer-aria-smell")], []);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.When, "sentence") });
    const describedBy = attributeOf(markup, 'data-strip-filter="sentence"', "aria-describedby");
    assert.ok(describedBy, "the input names its description");
    for (const id of describedBy.split(" ")) {
      assert.equal(countOf(markup, `id="${id}"`), 1);
    }
  });
});

/**
 * The class tokens of `className` that set the type: the face, the size, and
 * the measure, sorted so two elements compare regardless of the order they
 * spell them in.
 */
function typeTokens(className: string): string[] {
  return className
    .split(" ")
    .filter((token) => /^(font-|leading-|text-(xs|sm|base|lg|\d?xl)$)/.test(token))
    .sort();
}

/** The type tokens of the element carrying `marker`. */
function typeTokensOf(markup: string, marker: string): string[] {
  const className = attributeOf(markup, marker, "class");
  assert.ok(className, `the element at ${marker} carries a class`);
  const tokens = typeTokens(className);
  assert.ok(tokens.length > 0, `the element at ${marker} sets its own type`);
  return tokens;
}

describe("the sentence's one voice", () => {
  test("the input hosted in the line is set in the line's own type", () => {
    const { ruleDef } = makeBrain([makeSensor("composer-voice-see")], []);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.When, "sentence") });
    assert.deepEqual(
      typeTokensOf(markup, 'data-strip-filter="sentence"'),
      typeTokensOf(markup, `data-rule-sentence="${ruleDef.ruleId()}"`)
    );
  });

  test("the entry point standing in for the line is set in it as well", () => {
    const { ruleDef: settled } = makeBrain([makeSensor("composer-voice-hear")], []);
    const line = typeTokensOf(renderRuleCard(settled), `data-rule-sentence="${settled.ruleId()}"`);
    const { ruleDef } = makeBrain([], []);
    const entry = renderRuleCard(ruleDef);
    assert.deepEqual(typeTokensOf(entry, `data-sentence-composer-entry="${ruleDef.ruleId()}"`), line);
  });
});

describe("the composition reading on the sentence line", () => {
  test("a settled rule reads its sensor's frame completion as a word of its own", () => {
    const { ruleDef } = makeBrain([makeObjectSensor("composer-reading-bump")], []);
    const markup = renderRuleCard(ruleDef);
    assert.equal(countOf(markup, "data-sentence-tile-index"), 2);
  });

  test("the same rule under composition reads only the word it holds", () => {
    const { ruleDef } = makeBrain([makeObjectSensor("composer-reading-bump-2")], []);
    const markup = renderRuleCard(ruleDef, {
      target: appendTarget(ruleDef, RuleSide.When, "sentence"),
    });
    assert.equal(countOf(markup, "data-sentence-tile-index"), 1);
  });

  test("a rule armed from the tray keeps its settled reading", () => {
    const { ruleDef } = makeBrain([makeObjectSensor("composer-reading-bump-3")], []);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.When, "tray") });
    assert.equal(countOf(markup, "data-sentence-tile-index"), 2);
  });
});

describe("the pivot comma", () => {
  const commaMarker = "data-composer-pivot-comma";

  test("renders while composition sits on the armed DO side", () => {
    const { ruleDef } = makeBrain([makeObjectSensor("composer-comma-bump")], []);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.Do, "sentence") });
    assert.equal(countOf(markup, `${commaMarker}="${ruleDef.ruleId()}"`), 1);
  });

  test("renders on an empty rule pivoted from its empty WHEN side", () => {
    const { ruleDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, {
      target: appendTarget(ruleDef, RuleSide.Do, "sentence"),
    });
    assert.equal(countOf(markup, commaMarker), 1);
  });

  test("does not render while composition is still on the WHEN side", () => {
    const { ruleDef } = makeBrain([makeObjectSensor("composer-comma-bump-2")], []);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.When, "sentence") });
    assert.equal(countOf(markup, commaMarker), 0);
  });

  test("gives way to the sentence's own clause comma once a word stands behind it", () => {
    const { ruleDef } = makeBrain([makeObjectSensor("composer-comma-bump-3")], [makeActuator("composer-comma-jump")]);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.Do, "sentence") });
    assert.equal(countOf(markup, commaMarker), 0);
  });

  test("does not render on a settled rule", () => {
    const { ruleDef } = makeBrain([makeObjectSensor("composer-comma-bump-4")], []);
    assert.equal(countOf(renderRuleCard(ruleDef), commaMarker), 0);
  });

  test("does not render for a target armed from the tray", () => {
    const { ruleDef } = makeBrain([makeObjectSensor("composer-comma-bump-5")], []);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.Do, "tray") });
    assert.equal(countOf(markup, commaMarker), 0);
  });
});

describe("the trigger word at the pivot", () => {
  /** The word the projection reads a rule with no condition as, under the fallback localizer the card uses. */
  const trigger = whenTriggerWord(createDefaultLocalizer());

  test("a pivot from an empty WHEN side reads it before the comma", () => {
    const { ruleDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, {
      target: appendTarget(ruleDef, RuleSide.Do, "sentence"),
    });
    assert.equal(countOf(markup, `data-composer-pivot-comma="${ruleDef.ruleId()}"`), 1);
    assert.equal(sentenceReadingText(markup), `${trigger},`);
  });

  test("a pivot from a WHEN side that reads its own words takes the comma alone", () => {
    const { ruleDef } = makeBrain([makeObjectSensor("composer-trigger-bump")], []);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.Do, "sentence") });
    assert.equal(countOf(sentenceReadingText(markup), trigger), 0);
    assert.equal(countOf(sentenceReadingText(markup), ","), 1);
  });

  test("an empty rule still composing on its WHEN side reads neither it nor the comma", () => {
    const { ruleDef } = makeBrain([], []);
    const markup = renderRuleCard(ruleDef, {
      target: appendTarget(ruleDef, RuleSide.When, "sentence"),
    });
    assert.equal(sentenceReadingText(markup), "");
  });

  test("a word placed behind the pivot leaves exactly one trigger word and one comma", () => {
    const { ruleDef } = makeBrain([], [makeActuator("composer-trigger-jump")]);
    const markup = renderRuleCard(ruleDef, { target: appendTarget(ruleDef, RuleSide.Do, "sentence") });
    const reading = sentenceReadingText(markup);
    assert.equal(countOf(reading, trigger), 1);
    assert.equal(countOf(reading, ","), 1);
  });

  test("a settled empty rule reads nothing at all", () => {
    const { ruleDef } = makeBrain([], []);
    assert.equal(countOf(renderRuleCard(ruleDef), trigger), 0);
  });
});
