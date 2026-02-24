/**
 * Parser tests -- verifies that the brain tile parser correctly handles
 * action call specs, parentheses, conditionals, field access, and bag
 * repeat interleaving.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import {
  type BrainActionCallSpec,
  bag,
  CoreControlFlowId,
  CoreTypeIds,
  choice,
  getBrainServices,
  type IBrainTileDef,
  mkCallDef,
  mkModifierTileId,
  mkParameterTileId,
  mkTypeId,
  mkVariableTileId,
  mod,
  NativeType,
  optional,
  param,
  registerCoreBrainComponents,
  repeated,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { parseRule } from "@mindcraft-lang/core/brain/compiler";
import {
  BrainTileAccessorDef,
  BrainTileActuatorDef,
  BrainTileControlFlowDef,
  BrainTileLiteralDef,
  BrainTileModifierDef,
  BrainTileOperatorDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
  BrainTileVariableDef,
} from "@mindcraft-lang/core/brain/tiles";

// ---- Shared setup ----

let everySensor: BrainTileSensorDef;
let modTimeMs: BrainTileModifierDef;
let modTimeSecs: BrainTileModifierDef;
let paramDelayMs: BrainTileParameterDef;
let literal5: BrainTileLiteralDef;
let literal1000: BrainTileLiteralDef;
let literal2: BrainTileLiteralDef;
let literal3: BrainTileLiteralDef;
let literal10: BrainTileLiteralDef;
let opAdd: BrainTileOperatorDef;
let opMultiply: BrainTileOperatorDef;
let opSubtract: BrainTileOperatorDef;
let opAssign: BrainTileOperatorDef;
let openParen: BrainTileControlFlowDef;
let closeParen: BrainTileControlFlowDef;

before(() => {
  registerCoreBrainComponents();

  const kParameterId_AnonymousNumber = "anon.number";
  const kModifierId_TimeMs = "time.ms";
  const kModifierId_TimeSecs = "time.secs";
  const kSensorId_Every = "every";
  const kParameterId_DelayMs = "delay.ms";

  const kEverySensorCallSpec: BrainActionCallSpec = {
    type: "bag",
    items: [
      {
        type: "arg",
        name: "anonNumber",
        tileId: mkParameterTileId(kParameterId_AnonymousNumber),
        required: true,
        anonymous: true,
      },
      {
        type: "conditional",
        condition: "anonNumber",
        then: {
          type: "optional",
          item: {
            type: "choice",
            options: [
              { type: "arg", tileId: mkModifierTileId(kModifierId_TimeMs) },
              { type: "arg", tileId: mkModifierTileId(kModifierId_TimeSecs) },
            ],
          },
        },
      },
      {
        type: "optional",
        item: {
          type: "arg",
          tileId: mkParameterTileId(kParameterId_DelayMs),
        },
      },
    ],
  };

  const everyFnEntry = getBrainServices().functions.register(
    kSensorId_Every,
    false,
    { exec: () => VOID_VALUE },
    mkCallDef(kEverySensorCallSpec)
  );

  everySensor = new BrainTileSensorDef(kSensorId_Every, everyFnEntry, CoreTypeIds.Void);
  modTimeMs = new BrainTileModifierDef(kModifierId_TimeMs);
  modTimeSecs = new BrainTileModifierDef(kModifierId_TimeSecs);
  paramDelayMs = new BrainTileParameterDef(kParameterId_DelayMs, CoreTypeIds.Number);
  literal5 = new BrainTileLiteralDef(CoreTypeIds.Number, 5);
  literal1000 = new BrainTileLiteralDef(CoreTypeIds.Number, 1000);
  literal2 = new BrainTileLiteralDef(CoreTypeIds.Number, 2);
  literal3 = new BrainTileLiteralDef(CoreTypeIds.Number, 3);
  literal10 = new BrainTileLiteralDef(CoreTypeIds.Number, 10);
  opAdd = new BrainTileOperatorDef("add");
  opMultiply = new BrainTileOperatorDef("mul");
  opSubtract = new BrainTileOperatorDef("sub");
  opAssign = new BrainTileOperatorDef("assign");
  openParen = new BrainTileControlFlowDef(CoreControlFlowId.OpenParen);
  closeParen = new BrainTileControlFlowDef(CoreControlFlowId.CloseParen);
});

// ---- Helpers ----

interface TestCase {
  name: string;
  tiles: IBrainTileDef[];
  shouldPass: boolean;
}

function runParseTest(tc: TestCase): void {
  test(tc.name, () => {
    const tiles = List.from(tc.tiles);
    const emptyTiles = List.empty<IBrainTileDef>();
    const result = parseRule(tiles, emptyTiles, List.from([getBrainServices().tiles]));
    const hasDiags = result.parseResult.diags.size() > 0;

    if (tc.shouldPass) {
      assert.ok(!hasDiags, `Expected no diagnostics but got ${result.parseResult.diags.size()}`);
    } else {
      assert.ok(hasDiags, "Expected diagnostics but got none");
    }
  });
}

// ---- Every sensor call spec tests ----

describe("Every sensor call spec", () => {
  const cases: TestCase[] = [
    { name: "Every [5] - anonymous parameter only", tiles: () => [everySensor, literal5], shouldPass: true } as never,
  ];

  test("Every [5] - anonymous parameter only", () => {
    runParseTest({ name: "Every [5]", tiles: [everySensor, literal5], shouldPass: true });
  });
  test("Every [5] TimeMs - anonymous parameter with child modifier", () => {
    runParseTest({ name: "Every [5] TimeMs", tiles: [everySensor, literal5, modTimeMs], shouldPass: true });
  });
  test("Every [5] TimeSecs - anonymous parameter with different child modifier", () => {
    runParseTest({ name: "Every [5] TimeSecs", tiles: [everySensor, literal5, modTimeSecs], shouldPass: true });
  });
  test("Every TimeMs - child modifier without required parent arg", () => {
    runParseTest({ name: "Every TimeMs", tiles: [everySensor, modTimeMs], shouldPass: false });
  });
  test("Every [5] TimeMs TimeSecs - both child modifiers (should reject second)", () => {
    runParseTest({ name: "both mods", tiles: [everySensor, literal5, modTimeMs, modTimeSecs], shouldPass: false });
  });
  test("Every [5] TimeMs TimeMs - duplicate modifier", () => {
    runParseTest({ name: "dup mod", tiles: [everySensor, literal5, modTimeMs, modTimeMs], shouldPass: false });
  });
  test("Every [5] [5] - duplicate anon parameter", () => {
    runParseTest({ name: "dup anon", tiles: [everySensor, literal5, literal5], shouldPass: false });
  });
  test("Every [5] TimeMs delayMs [1000] - full valid with all args", () => {
    runParseTest({
      name: "full valid",
      tiles: [everySensor, literal5, modTimeMs, paramDelayMs, literal1000],
      shouldPass: true,
    });
  });
  test("Every [5] delayMs [1000] TimeMs - full valid, reordered", () => {
    runParseTest({
      name: "reordered",
      tiles: [everySensor, literal5, paramDelayMs, literal1000, modTimeMs],
      shouldPass: true,
    });
  });
  test("Every delayMs [1000] [5] TimeMs - full valid, reordered v2", () => {
    runParseTest({
      name: "reordered v2",
      tiles: [everySensor, paramDelayMs, literal1000, literal5, modTimeMs],
      shouldPass: true,
    });
  });
  test("Every delayMs [1000] - missing required anonymous parameter", () => {
    runParseTest({
      name: "missing anon",
      tiles: [everySensor, paramDelayMs, literal1000],
      shouldPass: false,
    });
  });
  test("Every - missing required anonymous parameter (empty)", () => {
    runParseTest({ name: "empty", tiles: [everySensor], shouldPass: false });
  });
});

// ---- Parentheses expression tests ----

describe("Parentheses expressions", () => {
  test("Every (5) - parenthesized literal", () => {
    runParseTest({
      name: "(5)",
      tiles: [everySensor, openParen, literal5, closeParen],
      shouldPass: true,
    });
  });
  test("Every (2 + 3) - parenthesized addition", () => {
    runParseTest({
      name: "(2+3)",
      tiles: [everySensor, openParen, literal2, opAdd, literal3, closeParen],
      shouldPass: true,
    });
  });
  test("Every (2 + 3) * 10 - parentheses override precedence", () => {
    runParseTest({
      name: "(2+3)*10",
      tiles: [everySensor, openParen, literal2, opAdd, literal3, closeParen, opMultiply, literal10],
      shouldPass: true,
    });
  });
  test("Every ((2 + 3)) - nested parentheses", () => {
    runParseTest({
      name: "((2+3))",
      tiles: [everySensor, openParen, openParen, literal2, opAdd, literal3, closeParen, closeParen],
      shouldPass: true,
    });
  });
  test("Every 2 * (3 + (5 - 2)) - complex nested parentheses", () => {
    runParseTest({
      name: "2*(3+(5-2))",
      tiles: [
        everySensor,
        literal2,
        opMultiply,
        openParen,
        literal3,
        opAdd,
        openParen,
        literal5,
        opSubtract,
        literal2,
        closeParen,
        closeParen,
      ],
      shouldPass: true,
    });
  });
  test("Every (2 + 3) TimeMs delayMs [1000] - parentheses with modifiers", () => {
    runParseTest({
      name: "(2+3) with mods",
      tiles: [everySensor, openParen, literal2, opAdd, literal3, closeParen, modTimeMs, paramDelayMs, literal1000],
      shouldPass: true,
    });
  });
  test("Every (2 + 3 - missing closing paren", () => {
    runParseTest({
      name: "missing close",
      tiles: [everySensor, openParen, literal2, opAdd, literal3],
      shouldPass: false,
    });
  });
  test("Every 2 + 3) - unmatched closing paren", () => {
    runParseTest({
      name: "unmatched close",
      tiles: [everySensor, literal2, opAdd, literal3, closeParen],
      shouldPass: false,
    });
  });
  test("Every () - empty parentheses", () => {
    runParseTest({
      name: "empty parens",
      tiles: [everySensor, openParen, closeParen],
      shouldPass: false,
    });
  });
  test("Every (2 + (3 - missing inner closing paren", () => {
    runParseTest({
      name: "missing inner close",
      tiles: [everySensor, openParen, literal2, opAdd, openParen, literal3, closeParen],
      shouldPass: false,
    });
  });
  test("Every (+) - operator without operands in parentheses", () => {
    runParseTest({
      name: "(+)",
      tiles: [everySensor, openParen, opAdd, closeParen],
      shouldPass: false,
    });
  });
});

// ---- Parentheses in parameter value tests ----

describe("Parentheses in parameter values", () => {
  test("Every [5] delayMs [(2 + 3)] - parentheses in named parameter value", () => {
    runParseTest({
      name: "parens in param",
      tiles: [everySensor, literal5, paramDelayMs, openParen, literal2, opAdd, literal3, closeParen],
      shouldPass: true,
    });
  });
  test("Every delayMs [(2 + 3) * 10] [5] - complex expression in parameter value", () => {
    runParseTest({
      name: "complex in param",
      tiles: [
        everySensor,
        paramDelayMs,
        openParen,
        literal2,
        opAdd,
        literal3,
        closeParen,
        opMultiply,
        literal10,
        literal5,
      ],
      shouldPass: true,
    });
  });
  test("Every delayMs [((2 + 3))] [10] - nested parentheses in parameter value", () => {
    runParseTest({
      name: "nested in param",
      tiles: [
        everySensor,
        paramDelayMs,
        openParen,
        openParen,
        literal2,
        opAdd,
        literal3,
        closeParen,
        closeParen,
        literal10,
      ],
      shouldPass: true,
    });
  });
  test("Every [2 + 3] delayMs [(5 * 2)] - parentheses in both anon and named", () => {
    runParseTest({
      name: "parens in both",
      tiles: [
        everySensor,
        literal2,
        opAdd,
        literal3,
        paramDelayMs,
        openParen,
        literal5,
        opMultiply,
        literal2,
        closeParen,
      ],
      shouldPass: true,
    });
  });
  test("Every [(2 + 3)] delayMs [10] TimeMs - parens in anon with modifiers", () => {
    runParseTest({
      name: "parens anon + mods",
      tiles: [everySensor, openParen, literal2, opAdd, literal3, closeParen, paramDelayMs, literal10, modTimeMs],
      shouldPass: true,
    });
  });
  test("Every delayMs [2 * (3 + 5)] [(1000)] - nested parens in param", () => {
    runParseTest({
      name: "nested parens mix",
      tiles: [
        everySensor,
        paramDelayMs,
        literal2,
        opMultiply,
        openParen,
        literal3,
        opAdd,
        literal5,
        closeParen,
        openParen,
        literal1000,
        closeParen,
      ],
      shouldPass: true,
    });
  });
  test("Every [5] delayMs [(2 + 3] - missing closing paren in parameter value", () => {
    runParseTest({
      name: "missing close in param",
      tiles: [everySensor, literal5, paramDelayMs, openParen, literal2, opAdd, literal3],
      shouldPass: false,
    });
  });
  test("Every delayMs [2 + 3)] [5] - unmatched closing paren in parameter value", () => {
    runParseTest({
      name: "unmatched close in param",
      tiles: [everySensor, paramDelayMs, literal2, opAdd, literal3, closeParen, literal5],
      shouldPass: false,
    });
  });
  test("Every [(5] delayMs [10] - missing closing paren in anonymous parameter", () => {
    runParseTest({
      name: "missing close in anon",
      tiles: [everySensor, openParen, literal5, paramDelayMs, literal10],
      shouldPass: false,
    });
  });
  test("Every delayMs [()] [5] - empty parentheses in parameter value", () => {
    runParseTest({
      name: "empty parens in param",
      tiles: [everySensor, paramDelayMs, openParen, closeParen, literal5],
      shouldPass: false,
    });
  });
  test("Every [5] delayMs [(2 + (3)] - mismatched nested parens in parameter", () => {
    runParseTest({
      name: "mismatched nested",
      tiles: [everySensor, literal5, paramDelayMs, openParen, literal2, opAdd, openParen, literal3, closeParen],
      shouldPass: false,
    });
  });
});

// ---- Conditional call spec tests ----

describe("Conditional call specs", () => {
  test("Every [5] TimeMs - conditional allows TimeMs when anon present", () => {
    runParseTest({
      name: "cond allows mod",
      tiles: [everySensor, literal5, modTimeMs],
      shouldPass: true,
    });
  });
  test("Every TimeMs [5] - conditional rejects TimeMs before anon", () => {
    runParseTest({
      name: "cond rejects early mod",
      tiles: [everySensor, modTimeMs, literal5],
      shouldPass: false,
    });
  });

  test("ConditionalTest RequiredFirst - just required modifier", () => {
    const kSensorId = "conditional-test";
    const kModRequired = "required-first";
    const kParamOptional = "optional-after";

    const callSpec: BrainActionCallSpec = {
      type: "bag",
      items: [
        { type: "arg", name: "requiredFirstMod", tileId: mkModifierTileId(kModRequired), required: true },
        {
          type: "conditional",
          condition: "requiredFirstMod",
          then: { type: "optional", item: { type: "arg", tileId: mkParameterTileId(kParamOptional) } },
        },
      ],
    };

    const fnEntry = getBrainServices().functions.register(
      kSensorId,
      false,
      { exec: () => VOID_VALUE },
      mkCallDef(callSpec)
    );

    const sensor = new BrainTileSensorDef(kSensorId, fnEntry, CoreTypeIds.Void);
    const modReq = new BrainTileModifierDef(kModRequired);
    const paramOpt = new BrainTileParameterDef(kParamOptional, CoreTypeIds.Number);

    runParseTest({ name: "just required mod", tiles: [sensor, modReq], shouldPass: true });
  });

  test("ConditionalTest RequiredFirst OptionalAfter [100] - modifier enables param", () => {
    const kSensorId = "conditional-test-2";
    const kModRequired = "required-first-2";
    const kParamOptional = "optional-after-2";

    const callSpec: BrainActionCallSpec = {
      type: "bag",
      items: [
        { type: "arg", name: "requiredFirstMod", tileId: mkModifierTileId(kModRequired), required: true },
        {
          type: "conditional",
          condition: "requiredFirstMod",
          then: { type: "optional", item: { type: "arg", tileId: mkParameterTileId(kParamOptional) } },
        },
      ],
    };

    const fnEntry = getBrainServices().functions.register(
      kSensorId,
      false,
      { exec: () => VOID_VALUE },
      mkCallDef(callSpec)
    );

    const sensor = new BrainTileSensorDef(kSensorId, fnEntry, CoreTypeIds.Void);
    const modReq = new BrainTileModifierDef(kModRequired);
    const paramOpt = new BrainTileParameterDef(kParamOptional, CoreTypeIds.Number);

    runParseTest({
      name: "mod enables param",
      tiles: [sensor, modReq, paramOpt, literal1000],
      shouldPass: true,
    });
  });

  test("ConditionalTest OptionalAfter [100] - parameter without required modifier fails", () => {
    const kSensorId = "conditional-test-3";
    const kModRequired = "required-first-3";
    const kParamOptional = "optional-after-3";

    const callSpec: BrainActionCallSpec = {
      type: "bag",
      items: [
        { type: "arg", name: "requiredFirstMod", tileId: mkModifierTileId(kModRequired), required: true },
        {
          type: "conditional",
          condition: "requiredFirstMod",
          then: { type: "optional", item: { type: "arg", tileId: mkParameterTileId(kParamOptional) } },
        },
      ],
    };

    const fnEntry = getBrainServices().functions.register(
      kSensorId,
      false,
      { exec: () => VOID_VALUE },
      mkCallDef(callSpec)
    );

    const sensor = new BrainTileSensorDef(kSensorId, fnEntry, CoreTypeIds.Void);
    const paramOpt = new BrainTileParameterDef(kParamOptional, CoreTypeIds.Number);

    runParseTest({
      name: "param without mod fails",
      tiles: [sensor, paramOpt, literal1000],
      shouldPass: false,
    });
  });

  test("ConditionalTest - missing required modifier", () => {
    const kSensorId = "conditional-test-4";
    const kModRequired = "required-first-4";

    const callSpec: BrainActionCallSpec = {
      type: "bag",
      items: [{ type: "arg", name: "requiredFirstMod", tileId: mkModifierTileId(kModRequired), required: true }],
    };

    const fnEntry = getBrainServices().functions.register(
      kSensorId,
      false,
      { exec: () => VOID_VALUE },
      mkCallDef(callSpec)
    );

    const sensor = new BrainTileSensorDef(kSensorId, fnEntry, CoreTypeIds.Void);

    runParseTest({ name: "missing required mod", tiles: [sensor], shouldPass: false });
  });
});

// ---- Conditional with else branch ----

describe("Conditional with else branch", () => {
  let condElseSensor: BrainTileSensorDef;
  let modToggle: BrainTileModifierDef;
  let paramWhenPresent: BrainTileParameterDef;
  let paramWhenAbsent: BrainTileParameterDef;

  before(() => {
    const kSensorId = "conditional-else-test";
    const kModToggle = "toggle";
    const kParamPresent = "when-present";
    const kParamAbsent = "when-absent";

    const callSpec: BrainActionCallSpec = {
      type: "bag",
      items: [
        { type: "arg", name: "toggleMod", tileId: mkModifierTileId(kModToggle), required: false },
        {
          type: "conditional",
          condition: "toggleMod",
          then: { type: "optional", item: { type: "arg", tileId: mkParameterTileId(kParamPresent) } },
          else: { type: "optional", item: { type: "arg", tileId: mkParameterTileId(kParamAbsent) } },
        },
      ],
    };

    const fnEntry = getBrainServices().functions.register(
      kSensorId,
      false,
      { exec: () => VOID_VALUE },
      mkCallDef(callSpec)
    );

    condElseSensor = new BrainTileSensorDef(kSensorId, fnEntry, CoreTypeIds.Void);
    modToggle = new BrainTileModifierDef(kModToggle);
    paramWhenPresent = new BrainTileParameterDef(kParamPresent, CoreTypeIds.Number);
    paramWhenAbsent = new BrainTileParameterDef(kParamAbsent, CoreTypeIds.Number);
  });

  test("Toggle WhenPresent [5] - toggle present, use then branch", () => {
    runParseTest({
      name: "then branch",
      tiles: [condElseSensor, modToggle, paramWhenPresent, literal5],
      shouldPass: true,
    });
  });
  test("WhenAbsent [5] - no toggle, use else branch", () => {
    runParseTest({
      name: "else branch",
      tiles: [condElseSensor, paramWhenAbsent, literal5],
      shouldPass: true,
    });
  });
  test("Toggle WhenAbsent [5] - toggle present but wrong param", () => {
    runParseTest({
      name: "wrong branch param",
      tiles: [condElseSensor, modToggle, paramWhenAbsent, literal5],
      shouldPass: false,
    });
  });
  test("WhenPresent [5] - no toggle but using then param", () => {
    runParseTest({
      name: "then without toggle",
      tiles: [condElseSensor, paramWhenPresent, literal5],
      shouldPass: false,
    });
  });
  test("Toggle - toggle alone with no optional params", () => {
    runParseTest({ name: "toggle alone", tiles: [condElseSensor, modToggle], shouldPass: true });
  });
  test("Empty - empty call with optional params available from else", () => {
    runParseTest({ name: "empty call", tiles: [condElseSensor], shouldPass: true });
  });
});

// ---- Conditional ordering in bags ----

describe("Conditional ordering in bags", () => {
  test("Every [5] delayMs [1000] - has-param allows delayMs", () => {
    runParseTest({
      name: "has-param",
      tiles: [everySensor, literal5, paramDelayMs, literal1000],
      shouldPass: true,
    });
  });
  test("Every delayMs [1000] [5] TimeMs - bag reorders to satisfy conditional", () => {
    runParseTest({
      name: "bag reorder",
      tiles: [everySensor, paramDelayMs, literal1000, literal5, modTimeMs],
      shouldPass: true,
    });
  });
  test("Every TimeMs delayMs [1000] [5] - TimeMs tried first but fails before anon", () => {
    runParseTest({
      name: "TimeMs before anon",
      tiles: [everySensor, modTimeMs, paramDelayMs, literal1000, literal5],
      shouldPass: false,
    });
  });
});

// ---- Field access (accessor tile) tests ----

describe("Field access (accessor tiles)", () => {
  let varPosition: BrainTileVariableDef;
  let accessorX: BrainTileAccessorDef;
  let accessorY: BrainTileAccessorDef;
  let accessorMag: BrainTileAccessorDef;

  before(() => {
    const vector2TypeId = mkTypeId(NativeType.Struct, "vector2");
    accessorX = new BrainTileAccessorDef(vector2TypeId, "x", CoreTypeIds.Number);
    accessorY = new BrainTileAccessorDef(vector2TypeId, "y", CoreTypeIds.Number);
    accessorMag = new BrainTileAccessorDef(vector2TypeId, "mag", CoreTypeIds.Number, { readOnly: true });
    varPosition = new BrainTileVariableDef(
      mkVariableTileId("my-position"),
      "my_position",
      vector2TypeId,
      "my-position"
    );
  });

  test("[$pos] [x] - simple field access", () => {
    runParseTest({ name: "pos.x", tiles: [varPosition, accessorX], shouldPass: true });
  });
  test("[$pos] [y] - simple field access (y)", () => {
    runParseTest({ name: "pos.y", tiles: [varPosition, accessorY], shouldPass: true });
  });
  test("[$pos] [x] + [5] - field access in arithmetic", () => {
    runParseTest({ name: "pos.x+5", tiles: [varPosition, accessorX, opAdd, literal5], shouldPass: true });
  });
  test("[5] + [$pos] [x] - field access on right side", () => {
    runParseTest({ name: "5+pos.x", tiles: [literal5, opAdd, varPosition, accessorX], shouldPass: true });
  });
  test("[$pos] [x] + [$pos] [y] - two field accesses", () => {
    runParseTest({
      name: "pos.x+pos.y",
      tiles: [varPosition, accessorX, opAdd, varPosition, accessorY],
      shouldPass: true,
    });
  });
  test("[$pos] [x] * [2] + [$pos] [y] - with precedence", () => {
    runParseTest({
      name: "pos.x*2+pos.y",
      tiles: [varPosition, accessorX, opMultiply, literal2, opAdd, varPosition, accessorY],
      shouldPass: true,
    });
  });
  test("([$pos] [x]) - in parentheses", () => {
    runParseTest({
      name: "(pos.x)",
      tiles: [openParen, varPosition, accessorX, closeParen],
      shouldPass: true,
    });
  });
  test("([$pos] [x] + [3]) * [2] - complex parenthesized", () => {
    runParseTest({
      name: "(pos.x+3)*2",
      tiles: [openParen, varPosition, accessorX, opAdd, literal3, closeParen, opMultiply, literal2],
      shouldPass: true,
    });
  });
  test("[$pos] [x] = [10] - field assignment", () => {
    runParseTest({
      name: "pos.x=10",
      tiles: [varPosition, accessorX, opAssign, literal10],
      shouldPass: true,
    });
  });
  test("[$pos] [y] = [5] + [3] - field assignment with expression", () => {
    runParseTest({
      name: "pos.y=5+3",
      tiles: [varPosition, accessorY, opAssign, literal5, opAdd, literal3],
      shouldPass: true,
    });
  });
  test("[x] - accessor without object (bare accessor)", () => {
    runParseTest({ name: "bare x", tiles: [accessorX], shouldPass: false });
  });
  test("[5] [x] - accessor on non-struct literal (parser allows, type checker rejects)", () => {
    runParseTest({ name: "5.x", tiles: [literal5, accessorX], shouldPass: true });
  });
  test("[5] = [10] - assignment to literal", () => {
    runParseTest({ name: "5=10", tiles: [literal5, opAssign, literal10], shouldPass: false });
  });
  test("[$pos] [mag] = [10] - assignment to read-only field", () => {
    runParseTest({
      name: "pos.mag=10",
      tiles: [varPosition, accessorMag, opAssign, literal10],
      shouldPass: false,
    });
  });
});

// ---- Field access AST shape checks ----

describe("Field access AST shape", () => {
  let varPosition: BrainTileVariableDef;
  let accessorX: BrainTileAccessorDef;
  let accessorMag: BrainTileAccessorDef;

  before(() => {
    const vector2TypeId = mkTypeId(NativeType.Struct, "vector2-shape");
    accessorX = new BrainTileAccessorDef(vector2TypeId, "x", CoreTypeIds.Number);
    accessorMag = new BrainTileAccessorDef(vector2TypeId, "mag", CoreTypeIds.Number, { readOnly: true });
    varPosition = new BrainTileVariableDef(
      mkVariableTileId("my-position-shape"),
      "my_position",
      vector2TypeId,
      "my-position-shape"
    );
  });

  test("[$pos] [x] produces fieldAccess node", () => {
    const tiles = List.from<IBrainTileDef>([varPosition, accessorX]);
    const emptyTiles = List.empty<IBrainTileDef>();
    const result = parseRule(tiles, emptyTiles, List.from([getBrainServices().tiles]));
    const expr = result.parseResult.exprs.get(0);

    assert.equal(expr.kind, "fieldAccess");
    if (expr.kind === "fieldAccess") {
      assert.equal(expr.object.kind, "variable");
      assert.equal(expr.accessor.fieldName, "x");
    }
  });

  test("[$pos] [x] + [5] produces binaryOp(fieldAccess, literal)", () => {
    const tiles = List.from<IBrainTileDef>([varPosition, accessorX, opAdd, literal5]);
    const emptyTiles = List.empty<IBrainTileDef>();
    const result = parseRule(tiles, emptyTiles, List.from([getBrainServices().tiles]));
    const expr = result.parseResult.exprs.get(0);

    assert.equal(expr.kind, "binaryOp");
    if (expr.kind === "binaryOp") {
      assert.equal(expr.left.kind, "fieldAccess");
      assert.equal(expr.right.kind, "literal");
    }
  });

  test("[$pos] [x] = [10] produces assignment(fieldAccess, literal)", () => {
    const tiles = List.from<IBrainTileDef>([varPosition, accessorX, opAssign, literal10]);
    const emptyTiles = List.empty<IBrainTileDef>();
    const result = parseRule(tiles, emptyTiles, List.from([getBrainServices().tiles]));
    const expr = result.parseResult.exprs.get(0);

    assert.equal(expr.kind, "assignment");
    if (expr.kind === "assignment") {
      assert.equal(expr.target.kind, "fieldAccess");
      assert.equal(expr.value.kind, "literal");
    }
  });

  test("[$pos] [mag] = [10] produces errorExpr (read-only)", () => {
    const tiles = List.from<IBrainTileDef>([varPosition, accessorMag, opAssign, literal10]);
    const emptyTiles = List.empty<IBrainTileDef>();
    const result = parseRule(tiles, emptyTiles, List.from([getBrainServices().tiles]));
    const expr = result.parseResult.exprs.get(0);

    assert.equal(expr.kind, "errorExpr");
    assert.ok(result.parseResult.diags.size() > 0, "should have diagnostic for read-only assignment");
    const diag = result.parseResult.diags.get(0);
    assert.equal(diag.code, 1014, "diagnostic code should be ReadOnlyFieldAssignment (1014)");
  });
});

// ---- Bag repeat interleaving tests ----

describe("Bag repeat interleaving", () => {
  test("[act] [slowly] [priority] [1] [slowly] -- interleaved repeat", () => {
    const kActId = "bag-repeat-test";
    const kModSlowly = "bag-repeat.slowly";
    const kModQuickly = "bag-repeat.quickly";
    const kParamPriority = "bag-repeat.priority";

    const callDef = mkCallDef(
      bag(
        optional(choice(repeated(mod(kModSlowly), { max: 3 }), repeated(mod(kModQuickly), { max: 3 }))),
        optional(param(kParamPriority))
      )
    );
    const fnEntry = getBrainServices().functions.register(kActId, false, { exec: () => VOID_VALUE }, callDef);
    const actuator = new BrainTileActuatorDef(kActId, fnEntry);
    const modSlowly = new BrainTileModifierDef(kModSlowly);
    const paramPriority = new BrainTileParameterDef(kParamPriority, CoreTypeIds.Number);

    const tiles = List.from<IBrainTileDef>([actuator, modSlowly, paramPriority, literal1000, modSlowly]);
    const emptyTiles = List.empty<IBrainTileDef>();
    const result = parseRule(emptyTiles, tiles, List.from([getBrainServices().tiles]));
    const expr = result.parseResult.exprs.get(0);

    assert.equal(result.parseResult.diags.size(), 0, "should have no diagnostics");
    if (expr.kind === "actuator") {
      assert.equal(expr.modifiers.size(), 2, "2 modifier slots filled");
      assert.equal(expr.parameters.size(), 1, "1 parameter slot filled");
    }
  });

  test("[act] [slowly] [slowly] [priority] [1] -- consecutive repeats", () => {
    const kActId = "bag-repeat-test-2";
    const kModSlowly = "bag-repeat.slowly2";
    const kModQuickly = "bag-repeat.quickly2";
    const kParamPriority = "bag-repeat.priority2";

    const callDef = mkCallDef(
      bag(
        optional(choice(repeated(mod(kModSlowly), { max: 3 }), repeated(mod(kModQuickly), { max: 3 }))),
        optional(param(kParamPriority))
      )
    );
    const fnEntry = getBrainServices().functions.register(kActId, false, { exec: () => VOID_VALUE }, callDef);
    const actuator = new BrainTileActuatorDef(kActId, fnEntry);
    const modSlowly = new BrainTileModifierDef(kModSlowly);
    const paramPriority = new BrainTileParameterDef(kParamPriority, CoreTypeIds.Number);

    const tiles = List.from<IBrainTileDef>([actuator, modSlowly, modSlowly, paramPriority, literal1000]);
    const emptyTiles = List.empty<IBrainTileDef>();
    const result = parseRule(emptyTiles, tiles, List.from([getBrainServices().tiles]));

    assert.equal(result.parseResult.diags.size(), 0, "should have no diagnostics");
  });

  test("[act] [slowly] [priority] [1] [slowly] [slowly] -- three repeats interleaved", () => {
    const kActId = "bag-repeat-test-3";
    const kModSlowly = "bag-repeat.slowly3";
    const kModQuickly = "bag-repeat.quickly3";
    const kParamPriority = "bag-repeat.priority3";

    const callDef = mkCallDef(
      bag(
        optional(choice(repeated(mod(kModSlowly), { max: 3 }), repeated(mod(kModQuickly), { max: 3 }))),
        optional(param(kParamPriority))
      )
    );
    const fnEntry = getBrainServices().functions.register(kActId, false, { exec: () => VOID_VALUE }, callDef);
    const actuator = new BrainTileActuatorDef(kActId, fnEntry);
    const modSlowly = new BrainTileModifierDef(kModSlowly);
    const paramPriority = new BrainTileParameterDef(kParamPriority, CoreTypeIds.Number);

    const tiles = List.from<IBrainTileDef>([actuator, modSlowly, paramPriority, literal1000, modSlowly, modSlowly]);
    const emptyTiles = List.empty<IBrainTileDef>();
    const result = parseRule(emptyTiles, tiles, List.from([getBrainServices().tiles]));

    assert.equal(result.parseResult.diags.size(), 0, "should have no diagnostics");
  });
});
