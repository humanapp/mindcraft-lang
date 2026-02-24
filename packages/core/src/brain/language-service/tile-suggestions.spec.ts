/**
 * Tile suggestion language service tests.
 *
 * Verifies that suggestTiles returns the correct tile suggestions based on
 * insertion context, rule side, type constraints, action call specs,
 * operator overloads, parentheses depth, and capability requirements.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  bag,
  CoreActuatorId,
  CoreControlFlowId,
  CoreOpId,
  CoreParameterId,
  CoreSensorId,
  CoreTypeIds,
  choice,
  conditional,
  type ExecutionContext,
  getBrainServices,
  type IBrainTileDef,
  type IConversionRegistry,
  type ITileCatalog,
  type MapValue,
  mkAccessorTileId,
  mkActuatorTileId,
  mkCallDef,
  mkControlFlowTileId,
  mkModifierTileId,
  mkOperatorTileId,
  mkParameterTileId,
  mkSensorTileId,
  mod,
  NIL_VALUE,
  optional,
  param,
  RuleSide,
  registerCoreBrainComponents,
  repeated,
  type SlotExpr,
  seq,
  TilePlacement,
  TRUE_VALUE,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import type {
  ActuatorExpr,
  BinaryOpExpr,
  Expr,
  FieldAccessExpr,
  LiteralExpr,
  ParameterExpr,
  SensorExpr,
  UnaryOpExpr,
  VariableExpr,
} from "@mindcraft-lang/core/brain/compiler";
import {
  countUnclosedParens,
  getTileOutputType,
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
  TileCompatibility,
  type TileSuggestionResult,
} from "@mindcraft-lang/core/brain/language-service";
import {
  BrainTileAccessorDef,
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileModifierDef,
  type BrainTileOperatorDef,
  BrainTilePageDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
  BrainTileVariableDef,
} from "@mindcraft-lang/core/brain/tiles";
import { BitSet } from "@mindcraft-lang/core/util";

// ---- Initialize ----

let services: ReturnType<typeof getBrainServices>;

before(() => {
  registerCoreBrainComponents();
  services = getBrainServices();
});

// ---- Helpers ----

function catalogList(): List<ITileCatalog> {
  return List.from([services.tiles]);
}

function listFind<T>(list: List<T>, predicate: (item: T) => boolean): T | undefined {
  for (let i = 0; i < list.size(); i++) {
    const item = list.get(i);
    if (predicate(item)) return item;
  }
  return undefined;
}

function listEvery<T>(list: List<T>, predicate: (item: T) => boolean): boolean {
  for (let i = 0; i < list.size(); i++) {
    if (!predicate(list.get(i))) return false;
  }
  return true;
}

function resultContains(result: TileSuggestionResult, tileId: string): boolean {
  return listFind(result.exact, (s) => s.tileDef.tileId === tileId) !== undefined;
}

// ---- Test 1: No type constraint, WHEN side ----

test("Test 1: Expression position, WHEN side, no type constraint", () => {
  const ctx: InsertionContext = { ruleSide: RuleSide.When };
  const result = suggestTiles(ctx, catalogList());

  const hasSensor = listFind(result.exact, (s) => s.tileDef.kind === "sensor") !== undefined;
  assert.ok(hasSensor, "Should include sensor tiles on WHEN side");

  const hasActuator = listFind(result.exact, (s) => s.tileDef.kind === "actuator") !== undefined;
  assert.ok(!hasActuator, "Should NOT include actuator tiles on WHEN side");

  const hasParam = listFind(result.exact, (s) => s.tileDef.kind === "parameter") !== undefined;
  const hasMod = listFind(result.exact, (s) => s.tileDef.kind === "modifier") !== undefined;
  assert.ok(!hasParam, "Should NOT include parameter tiles outside action context");
  assert.ok(!hasMod, "Should NOT include modifier tiles outside action context");

  const allUnchecked = listEvery(result.exact, (s) => s.compatibility === TileCompatibility.Unchecked);
  assert.ok(allUnchecked, "All exact results should be Unchecked when no expectedType");

  assert.equal(result.withConversion.size(), 0, "No conversion results when no type constraint");
});

// ---- Test 2: Expected Number type, Either side ----

test("Test 2: Expression position, Either side, expected Number", () => {
  const ctx: InsertionContext = {
    ruleSide: RuleSide.Either,
    expectedType: CoreTypeIds.Number,
  };
  const result = suggestTiles(ctx, catalogList());

  const hasFactory =
    listFind(
      result.exact,
      (s) => s.tileDef.kind === "factory" && getTileOutputType(s.tileDef) === CoreTypeIds.Number
    ) !== undefined;
  assert.ok(hasFactory, "Should include Number factory as exact match");

  const hasRandom =
    listFind(
      result.exact,
      (s) => s.tileDef.kind === "sensor" && getTileOutputType(s.tileDef) === CoreTypeIds.Number
    ) !== undefined;
  assert.ok(hasRandom, "Should include Random sensor as exact match for Number");

  const boolConversion = listFind(result.withConversion, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Boolean);
  assert.ok(boolConversion !== undefined, "Boolean tiles should be in withConversion for Number");
  if (boolConversion) {
    assert.ok(boolConversion.conversionCost > 0, "Conversion cost should be > 0");
  }

  const strConversion = listFind(result.withConversion, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.String);
  assert.ok(strConversion !== undefined, "String tiles should be in withConversion for Number");
});

// ---- Test 3: DO side placement filtering ----

test("Test 3: Expression position, DO side, no type constraint", () => {
  const ctx: InsertionContext = { ruleSide: RuleSide.Do };
  const result = suggestTiles(ctx, catalogList());

  const hasActuator = listFind(result.exact, (s) => s.tileDef.kind === "actuator") !== undefined;
  assert.ok(hasActuator, "Should include actuator tiles on DO side");

  const hasInfixOp =
    listFind(
      result.exact,
      (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "infix"
    ) !== undefined;
  assert.ok(!hasInfixOp, "Should NOT include infix operators at expression start");

  const hasCompare =
    listFind(result.exact, (s) => s.tileDef.kind === "operator" && s.tileDef.tileId.includes("eq")) !== undefined;
  assert.ok(!hasCompare, "Should NOT include comparison operators on DO side");
});

// ---- Test 4: Action call context (switch-page actuator) ----

test("Test 4: Action call context for switch-page actuator", () => {
  const switchPageTileId = mkActuatorTileId(CoreActuatorId.SwitchPage);
  const switchPageTile = services.tiles.get(switchPageTileId) as BrainTileActuatorDef;
  assert.ok(switchPageTile !== undefined, "switch-page actuator exists in catalog");

  if (switchPageTile) {
    const expr: ActuatorExpr = {
      nodeId: 0,
      kind: "actuator",
      tileDef: switchPageTile,
      anons: List.empty<SlotExpr>(),
      parameters: List.empty<SlotExpr>(),
      modifiers: List.empty<SlotExpr>(),
      span: { from: 0, to: 0 },
    };

    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
    const result = suggestTiles(ctx, catalogList());

    const hasNumberMatch =
      listFind(result.exact, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Number) !== undefined;
    const hasStringMatch =
      listFind(result.exact, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.String) !== undefined;
    assert.ok(hasNumberMatch, "Should suggest Number-typed tiles for switch-page anonymous slot");
    assert.ok(hasStringMatch, "Should suggest String-typed tiles for switch-page anonymous slot");

    const boolInConversion =
      listFind(result.withConversion, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Boolean) !== undefined;
    assert.ok(boolInConversion, "Boolean tiles should be in withConversion for switch-page");
  }
});

// ---- Test 5: Expected Boolean type ----

test("Test 5: Expression position, WHEN side, expected Boolean", () => {
  const ctx: InsertionContext = {
    ruleSide: RuleSide.When,
    expectedType: CoreTypeIds.Boolean,
  };
  const result = suggestTiles(ctx, catalogList());

  const hasTrueLit =
    listFind(
      result.exact,
      (s) => s.tileDef.kind === "literal" && getTileOutputType(s.tileDef) === CoreTypeIds.Boolean
    ) !== undefined;
  assert.ok(hasTrueLit, "Should include Boolean literals as exact match");

  const numInConv =
    listFind(result.withConversion, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Number) !== undefined;
  assert.ok(numInConv, "Number tiles should be in withConversion for Boolean");
});

// ---- Test 6: getTileOutputType utility ----

test("Test 6: getTileOutputType helper", () => {
  const allTiles = services.tiles.getAll();
  let checkedCount = 0;
  for (let i = 0; i < allTiles.size(); i++) {
    const tileDef = allTiles.get(i);
    const outputType = getTileOutputType(tileDef);
    if (tileDef.kind === "literal" || tileDef.kind === "variable" || tileDef.kind === "sensor") {
      assert.ok(
        outputType !== undefined,
        `getTileOutputType should return a type for ${tileDef.kind} tile ${tileDef.tileId}`
      );
      checkedCount++;
    }
  }
  assert.ok(checkedCount > 0, "Should have checked at least some tiles");
});

// ---- Test 7: Complete value expr -> infix operators only ----

test("Test 7: Complete value expr (literal) -> infix operators only", () => {
  const litTileDef = new BrainTileLiteralDef(CoreTypeIds.Number, 42);
  const expr: LiteralExpr = { nodeId: 0, kind: "literal", tileDef: litTileDef, span: { from: 0, to: 0 } };
  const ctx: InsertionContext = { ruleSide: RuleSide.Either, expr };
  const result = suggestTiles(ctx, catalogList());

  const allOperators = listEvery(result.exact, (s) => s.tileDef.kind === "operator");
  assert.ok(allOperators, "Complete value expr should only suggest operator tiles");
  assert.ok(result.exact.size() > 0, "Should suggest at least some infix operators");

  const hasNot = listFind(result.exact, (s) => s.tileDef.tileId.includes("not")) !== undefined;
  const hasNegate = listFind(result.exact, (s) => s.tileDef.tileId.includes("neg")) !== undefined;
  assert.ok(!hasNot, "Should NOT include prefix-only 'not' operator");
  assert.ok(!hasNegate, "Should NOT include prefix-only 'negate' operator");

  const hasAdd = listFind(result.exact, (s) => s.tileDef.tileId.includes("add")) !== undefined;
  assert.ok(hasAdd, "Should include infix 'add' operator");

  assert.equal(result.withConversion.size(), 0, "No conversion results for infix operators");
});

// ---- Test 8: Complete actuator -> nothing ----

test("Test 8: Complete actuator (all slots filled) -> nothing", () => {
  const switchPageTileId = mkActuatorTileId(CoreActuatorId.SwitchPage);
  const switchPageTile = services.tiles.get(switchPageTileId) as BrainTileActuatorDef;

  if (switchPageTile) {
    const callDef = switchPageTile.fnEntry.callDef;
    const filledAnons = List.empty<SlotExpr>();
    const filledParams = List.empty<SlotExpr>();
    const filledMods = List.empty<SlotExpr>();
    for (let i = 0; i < callDef.argSlots.size(); i++) {
      const slot = callDef.argSlots.get(i);
      const fakeSlot: SlotExpr = { slotId: slot.slotId, expr: { nodeId: 100 + i, kind: "empty" } };
      if (slot.argSpec.anonymous) {
        filledAnons.push(fakeSlot);
      } else {
        filledParams.push(fakeSlot);
      }
    }

    const expr: ActuatorExpr = {
      nodeId: 0,
      kind: "actuator",
      tileDef: switchPageTile,
      anons: filledAnons,
      parameters: filledParams,
      modifiers: filledMods,
      span: { from: 0, to: 0 },
    };
    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
    const result = suggestTiles(ctx, catalogList());

    assert.equal(result.exact.size(), 0, "Complete actuator should suggest nothing (exact)");
    assert.equal(result.withConversion.size(), 0, "Complete actuator should suggest nothing (conversion)");
  }
});

// ---- Test 9: Parameter needing value (errorExpr) -> value tiles ----

test("Test 9: Actuator with parameter needing value (errorExpr) -> value tiles", () => {
  const restartPageTileId = mkActuatorTileId(CoreActuatorId.RestartPage);
  const restartPageTile = services.tiles.get(restartPageTileId) as BrainTileActuatorDef;

  if (restartPageTile) {
    const priorityParamDef = new BrainTileParameterDef("test.priority", CoreTypeIds.Number, {
      visual: { label: "priority" },
    });
    const paramExpr: ParameterExpr = {
      nodeId: 10,
      kind: "parameter",
      tileDef: priorityParamDef,
      value: { nodeId: 11, kind: "errorExpr", message: "Expected expression" },
      span: { from: 0, to: 0 },
    };
    const paramSlot: SlotExpr = { slotId: 999, expr: paramExpr };

    const expr: ActuatorExpr = {
      nodeId: 0,
      kind: "actuator",
      tileDef: restartPageTile,
      anons: List.empty<SlotExpr>(),
      parameters: List.from<SlotExpr>([paramSlot]),
      modifiers: List.empty<SlotExpr>(),
      span: { from: 0, to: 0 },
    };
    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
    const result = suggestTiles(ctx, catalogList());

    const hasNumberMatch =
      listFind(result.exact, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Number) !== undefined;
    assert.ok(hasNumberMatch, "Should suggest Number-typed tiles for parameter needing value");

    const hasActuator = listFind(result.exact, (s) => s.tileDef.kind === "actuator") !== undefined;
    assert.ok(!hasActuator, "Should NOT suggest actuators for parameter value");

    const hasPrefixOp =
      listFind(
        result.exact,
        (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "prefix"
      ) !== undefined;
    assert.ok(hasPrefixOp, "Should suggest prefix operators for parameter value");

    const hasInfixOp =
      listFind(
        result.exact,
        (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "infix"
      ) !== undefined;
    assert.ok(!hasInfixOp, "Should NOT suggest infix operators for parameter value");

    const boolConversion = listFind(result.withConversion, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Boolean);
    assert.ok(boolConversion !== undefined, "Boolean tiles should be in withConversion for Number parameter");
  }
});

// ---- Test 10: Integration -- parse [actuator, parameter] -> suggest values ----

test("Test 10: Integration -- parse [actuator, priority] -> suggest value tiles", () => {
  const testParamId = "test.priority.10";
  const testParamDef = new BrainTileParameterDef(testParamId, CoreTypeIds.Number, { visual: { label: "priority" } });
  services.tiles.registerTileDef(testParamDef);

  const testCallDef = mkCallDef(bag(optional(param(testParamId))));
  const testFnEntry = services.functions.register("test-move-10", false, { exec: () => VOID_VALUE }, testCallDef);
  const testActuatorDef = new BrainTileActuatorDef("test-move-10", testFnEntry, { visual: { label: "move" } });
  services.tiles.registerTileDef(testActuatorDef);

  const tileSequence = List.from([testActuatorDef as IBrainTileDef, testParamDef as IBrainTileDef]);
  const expr = parseTilesForSuggestions(tileSequence);

  assert.equal(expr.kind, "actuator", "Parsed expr should be an ActuatorExpr");
  if (expr.kind === "actuator") {
    assert.equal(expr.parameters.size(), 1, "Should have 1 filled parameter slot");
    const paramSlotExpr = expr.parameters.get(0).expr;
    assert.equal(paramSlotExpr.kind, "parameter", "Parameter slot should contain a ParameterExpr");
    if (paramSlotExpr.kind === "parameter") {
      assert.ok(
        paramSlotExpr.value.kind === "errorExpr" || paramSlotExpr.value.kind === "empty",
        "Parameter value should be errorExpr or empty"
      );
    }

    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
    const result = suggestTiles(ctx, catalogList());

    const hasNumberMatch =
      listFind(result.exact, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Number) !== undefined;
    assert.ok(hasNumberMatch, "Integration: should suggest Number tiles after [move] [priority]");

    const hasActuator = listFind(result.exact, (s) => s.tileDef.kind === "actuator") !== undefined;
    assert.ok(!hasActuator, "Integration: should NOT suggest actuators for parameter value");

    const hasBoolConv =
      listFind(result.withConversion, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Boolean) !== undefined;
    assert.ok(hasBoolConv, "Integration: Boolean should be in withConversion for Number parameter");
  }
});

// ---- Test 11-17: Replace operand tests ----

describe("Replace operand/operator in binary expression", () => {
  test("Test 11: Replace left operand in [lit] [+] [lit] -> value tiles", () => {
    const litTileDef = services.tiles
      .getAll()
      .toArray()
      .find((t) => t.kind === "literal") as BrainTileLiteralDef;
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;

    const leftLit: LiteralExpr = { nodeId: 1, kind: "literal", tileDef: litTileDef, span: { from: 0, to: 1 } };
    const rightLit: LiteralExpr = { nodeId: 2, kind: "literal", tileDef: litTileDef, span: { from: 2, to: 3 } };
    const binaryExpr: BinaryOpExpr = {
      nodeId: 0,
      kind: "binaryOp",
      operator: addOpDef,
      left: leftLit,
      right: rightLit,
      span: { from: 0, to: 3 },
    };

    const ctx: InsertionContext = { ruleSide: RuleSide.Either, expr: binaryExpr, replaceTileIndex: 0 };
    const result = suggestTiles(ctx, catalogList());

    const hasLiteral = listFind(result.exact, (s) => s.tileDef.kind === "literal") !== undefined;
    assert.ok(hasLiteral, "Replace left operand should include literal tiles");

    const hasOperator = listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined;
    assert.ok(hasOperator, "Replace value operand should include operators (prefix ops start expressions)");

    const hasParam = listFind(result.exact, (s) => s.tileDef.kind === "parameter") !== undefined;
    assert.ok(!hasParam, "Replace left operand should NOT include parameter tiles");
  });

  test("Test 12: Replace operator in [lit] [+] [lit] -> infix operators only", () => {
    const litTileDef = new BrainTileLiteralDef(CoreTypeIds.Number, 42);
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;

    const leftLit: LiteralExpr = { nodeId: 1, kind: "literal", tileDef: litTileDef, span: { from: 0, to: 1 } };
    const rightLit: LiteralExpr = { nodeId: 2, kind: "literal", tileDef: litTileDef, span: { from: 2, to: 3 } };
    const binaryExpr: BinaryOpExpr = {
      nodeId: 0,
      kind: "binaryOp",
      operator: addOpDef,
      left: leftLit,
      right: rightLit,
      span: { from: 0, to: 3 },
    };

    const ctx: InsertionContext = { ruleSide: RuleSide.Either, expr: binaryExpr, replaceTileIndex: 1 };
    const result = suggestTiles(ctx, catalogList());

    const allOperators = listEvery(result.exact, (s) => s.tileDef.kind === "operator");
    assert.ok(allOperators, "Replace operator position should only suggest operators");
    assert.ok(result.exact.size() > 0, "Should suggest at least some infix operators");

    const hasSub =
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Subtract)) !== undefined;
    assert.ok(hasSub, "Should include subtract operator");

    const hasNot = listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Not)) !== undefined;
    const hasNegate =
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Negate)) !== undefined;
    assert.ok(!hasNot, "Should NOT include prefix-only 'not' in infix position");
    assert.ok(!hasNegate, "Should NOT include prefix-only 'negate' in infix position");

    assert.equal(result.withConversion.size(), 0, "No conversion results for infix operator position");
  });

  test("Test 13: Replace prefix operator in [not] [lit] -> prefix operators only", () => {
    const litTileDef = services.tiles
      .getAll()
      .toArray()
      .find((t) => t.kind === "literal") as BrainTileLiteralDef;
    const notOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Not)) as BrainTileOperatorDef;

    const operandLit: LiteralExpr = { nodeId: 1, kind: "literal", tileDef: litTileDef, span: { from: 1, to: 2 } };
    const unaryExpr: UnaryOpExpr = {
      nodeId: 0,
      kind: "unaryOp",
      operator: notOpDef,
      operand: operandLit,
      span: { from: 0, to: 2 },
    };

    const ctx: InsertionContext = { ruleSide: RuleSide.Either, expr: unaryExpr, replaceTileIndex: 0 };
    const result = suggestTiles(ctx, catalogList());

    const allOperators = listEvery(result.exact, (s) => s.tileDef.kind === "operator");
    assert.ok(allOperators, "Replace prefix position should only suggest operators");
    assert.ok(result.exact.size() > 0, "Should suggest at least some prefix operators");

    const hasNot = listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Not)) !== undefined;
    const hasNegate =
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Negate)) !== undefined;
    assert.ok(hasNot, "Should include 'not' as prefix operator");
    assert.ok(hasNegate, "Should include 'negate' as prefix operator");

    const hasAdd = listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Add)) !== undefined;
    assert.ok(!hasAdd, "Should NOT include infix 'add' in prefix position");
  });

  test("Test 14: Replace operand in [not] [lit] -> value tiles", () => {
    const litTileDef = services.tiles
      .getAll()
      .toArray()
      .find((t) => t.kind === "literal") as BrainTileLiteralDef;
    const notOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Not)) as BrainTileOperatorDef;

    const operandLit: LiteralExpr = { nodeId: 1, kind: "literal", tileDef: litTileDef, span: { from: 1, to: 2 } };
    const unaryExpr: UnaryOpExpr = {
      nodeId: 0,
      kind: "unaryOp",
      operator: notOpDef,
      operand: operandLit,
      span: { from: 0, to: 2 },
    };

    const ctx: InsertionContext = { ruleSide: RuleSide.Either, expr: unaryExpr, replaceTileIndex: 1 };
    const result = suggestTiles(ctx, catalogList());

    const hasLiteral = listFind(result.exact, (s) => s.tileDef.kind === "literal") !== undefined;
    assert.ok(hasLiteral, "Replace operand should include literal tiles");

    const hasOperator = listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined;
    assert.ok(hasOperator, "Replace value operand should include operators (prefix ops start expressions)");
  });

  test("Test 15: Replace parameter value in [test-move] [priority] [42] -> Number", () => {
    const testParamId = "test.priority.15";
    const testParamDef = new BrainTileParameterDef(testParamId, CoreTypeIds.Number, { visual: { label: "priority" } });
    services.tiles.registerTileDef(testParamDef);
    const testCallDef = mkCallDef(bag(optional(param(testParamId))));
    const testFnEntry = services.functions.register("test-move-15", false, { exec: () => VOID_VALUE }, testCallDef);
    const testActuatorDef = new BrainTileActuatorDef("test-move-15", testFnEntry, { visual: { label: "move" } });
    services.tiles.registerTileDef(testActuatorDef);

    const litTileDef = services.tiles
      .getAll()
      .toArray()
      .find((t) => t.kind === "literal") as BrainTileLiteralDef;
    const valueLit: LiteralExpr = { nodeId: 3, kind: "literal", tileDef: litTileDef, span: { from: 2, to: 3 } };
    const paramExpr: ParameterExpr = {
      nodeId: 2,
      kind: "parameter",
      tileDef: testParamDef,
      value: valueLit,
      span: { from: 1, to: 3 },
    };
    const paramSlot: SlotExpr = { slotId: 0, expr: paramExpr };
    const actuatorExpr: ActuatorExpr = {
      nodeId: 1,
      kind: "actuator",
      tileDef: testActuatorDef,
      anons: List.empty<SlotExpr>(),
      parameters: List.from<SlotExpr>([paramSlot]),
      modifiers: List.empty<SlotExpr>(),
      span: { from: 0, to: 3 },
    };

    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr: actuatorExpr, replaceTileIndex: 2 };
    const result = suggestTiles(ctx, catalogList());

    const hasNumberMatch =
      listFind(result.exact, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Number) !== undefined;
    assert.ok(hasNumberMatch, "Replace param value should suggest Number tiles");

    const hasActuator = listFind(result.exact, (s) => s.tileDef.kind === "actuator") !== undefined;
    assert.ok(!hasActuator, "Replace param value should NOT include actuators");

    const boolConv =
      listFind(result.withConversion, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Boolean) !== undefined;
    assert.ok(boolConv, "Boolean should be in withConversion for Number parameter value");
  });

  test("Test 16: Replace action tile itself -> expression tiles", () => {
    const testActuatorDef = services.tiles.get(mkActuatorTileId("test-move-15")) as BrainTileActuatorDef;
    const testParamDef = services.tiles.get(mkParameterTileId("test.priority.15")) as BrainTileParameterDef;

    if (testActuatorDef && testParamDef) {
      const paramExpr: ParameterExpr = {
        nodeId: 2,
        kind: "parameter",
        tileDef: testParamDef,
        value: { nodeId: 3, kind: "empty" },
        span: { from: 1, to: 2 },
      };
      const paramSlot: SlotExpr = { slotId: 0, expr: paramExpr };
      const actuatorExpr: ActuatorExpr = {
        nodeId: 1,
        kind: "actuator",
        tileDef: testActuatorDef,
        anons: List.empty<SlotExpr>(),
        parameters: List.from<SlotExpr>([paramSlot]),
        modifiers: List.empty<SlotExpr>(),
        span: { from: 0, to: 2 },
      };

      const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr: actuatorExpr, replaceTileIndex: 0 };
      const result = suggestTiles(ctx, catalogList());

      const hasActuator = listFind(result.exact, (s) => s.tileDef.kind === "actuator") !== undefined;
      assert.ok(hasActuator, "Replace action tile should include other actuators");

      const hasParam = listFind(result.exact, (s) => s.tileDef.kind === "parameter") !== undefined;
      const hasMod = listFind(result.exact, (s) => s.tileDef.kind === "modifier") !== undefined;
      assert.ok(!hasParam, "Replace action tile should NOT include parameter tiles");
      assert.ok(!hasMod, "Replace action tile should NOT include modifier tiles");
    }
  });

  test("Test 17: Replace parameter tile in action call -> other arg tiles", () => {
    const testActuatorDef = services.tiles.get(mkActuatorTileId("test-move-15")) as BrainTileActuatorDef;
    const testParamDef = services.tiles.get(mkParameterTileId("test.priority.15")) as BrainTileParameterDef;

    if (testActuatorDef && testParamDef) {
      const paramExpr: ParameterExpr = {
        nodeId: 2,
        kind: "parameter",
        tileDef: testParamDef,
        value: { nodeId: 3, kind: "errorExpr", message: "Expected expression" },
        span: { from: 1, to: 2 },
      };
      const paramSlot: SlotExpr = { slotId: 0, expr: paramExpr };
      const actuatorExpr: ActuatorExpr = {
        nodeId: 1,
        kind: "actuator",
        tileDef: testActuatorDef,
        anons: List.empty<SlotExpr>(),
        parameters: List.from<SlotExpr>([paramSlot]),
        modifiers: List.empty<SlotExpr>(),
        span: { from: 0, to: 2 },
      };

      const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr: actuatorExpr, replaceTileIndex: 1 };
      const result = suggestTiles(ctx, catalogList());

      const hasOperator = listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined;
      assert.ok(!hasOperator, "Replace param tile in action call should NOT include operators");
    }
  });
});

// ---- Test 18-23: Parameter value expression tests ----

describe("Parameter value expression chains", () => {
  let testActuatorDef: BrainTileActuatorDef;
  let testParamDef: BrainTileParameterDef;
  let numLitDef: BrainTileLiteralDef;

  before(() => {
    const id = "test.priority.18";
    testParamDef = new BrainTileParameterDef(id, CoreTypeIds.Number, { visual: { label: "priority" } });
    services.tiles.registerTileDef(testParamDef);
    const callDef = mkCallDef(bag(optional(param(id))));
    const fnEntry = services.functions.register("test-move-18", false, { exec: () => VOID_VALUE }, callDef);
    testActuatorDef = new BrainTileActuatorDef("test-move-18", fnEntry, { visual: { label: "move" } });
    services.tiles.registerTileDef(testActuatorDef);

    numLitDef = new BrainTileLiteralDef(CoreTypeIds.Number, "1", { visual: { label: "1" } });
    services.tiles.registerTileDef(numLitDef);
  });

  test("Test 18: [move] [priority] [1] -> infix operators", () => {
    const tiles = List.from<IBrainTileDef>([testActuatorDef, testParamDef, numLitDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "actuator");
    if (expr.kind === "actuator") {
      const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
      const result = suggestTiles(ctx, catalogList());

      const hasOperator = listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined;
      assert.ok(hasOperator, "[move] [priority] [1] should offer infix operators");

      const hasLiteral = listFind(result.exact, (s) => s.tileDef.kind === "literal") !== undefined;
      assert.ok(!hasLiteral, "[move] [priority] [1] should NOT offer literal tiles");
    }
  });

  test("Test 19: [move] [priority] [1] [+] -> value tiles", () => {
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;
    const tiles = List.from<IBrainTileDef>([testActuatorDef, testParamDef, numLitDef, addOpDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "actuator");
    if (expr.kind === "actuator") {
      const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
      const result = suggestTiles(ctx, catalogList());

      const hasNumberValue =
        listFind(result.exact, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Number) !== undefined;
      assert.ok(hasNumberValue, "[move] [priority] [1] [+] should offer Number value tiles");

      const hasPrefixOp =
        listFind(
          result.exact,
          (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "prefix"
        ) !== undefined;
      assert.ok(hasPrefixOp, "[move] [priority] [1] [+] should offer prefix operators");

      const hasInfixOp =
        listFind(
          result.exact,
          (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "infix"
        ) !== undefined;
      assert.ok(!hasInfixOp, "[move] [priority] [1] [+] should NOT offer infix operators");
    }
  });

  test("Test 20: [move] [priority] [1] [+] [1] -> infix operators", () => {
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;
    const tiles = List.from<IBrainTileDef>([testActuatorDef, testParamDef, numLitDef, addOpDef, numLitDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "actuator");
    if (expr.kind === "actuator") {
      const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
      const result = suggestTiles(ctx, catalogList());

      const hasOperator = listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined;
      assert.ok(hasOperator, "[move] [priority] [1] [+] [1] should offer infix operators");

      const hasLiteral = listFind(result.exact, (s) => s.tileDef.kind === "literal") !== undefined;
      assert.ok(!hasLiteral, "[move] [priority] [1] [+] [1] should NOT offer literal tiles");
    }
  });

  test("Test 21: Top-level [1] [+] -> value tiles, not operators", () => {
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;
    const localNumLit = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;

    const tiles = List.from<IBrainTileDef>([localNumLit, addOpDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "binaryOp");
    if (expr.kind === "binaryOp") {
      assert.equal(expr.right.kind, "errorExpr");
    }

    const ctx: InsertionContext = { ruleSide: RuleSide.Either, expr };
    const result = suggestTiles(ctx, catalogList());

    const hasValueTile =
      listFind(
        result.exact,
        (s) => s.tileDef.kind === "literal" || s.tileDef.kind === "sensor" || s.tileDef.kind === "factory"
      ) !== undefined;
    assert.ok(hasValueTile, "Top-level [1] [+] should offer value tiles");

    const hasPrefixOp =
      listFind(
        result.exact,
        (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "prefix"
      ) !== undefined;
    assert.ok(hasPrefixOp, "Top-level [1] [+] should offer prefix operators");

    const hasInfixOp =
      listFind(
        result.exact,
        (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "infix"
      ) !== undefined;
    assert.ok(!hasInfixOp, "Top-level [1] [+] should NOT offer infix operators");
  });

  test("Test 22: [move] [priority] -> includes prefix operators", () => {
    const tiles = List.from<IBrainTileDef>([testActuatorDef, testParamDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "actuator");
    if (expr.kind === "actuator") {
      const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
      const result = suggestTiles(ctx, catalogList());

      const hasNumberValue =
        listFind(result.exact, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Number) !== undefined;
      assert.ok(hasNumberValue, "[move] [priority] should offer Number value tiles");

      const hasPrefixOp =
        listFind(
          result.exact,
          (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "prefix"
        ) !== undefined;
      assert.ok(hasPrefixOp, "[move] [priority] should offer prefix operators");

      const hasInfixOp =
        listFind(
          result.exact,
          (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "infix"
        ) !== undefined;
      assert.ok(!hasInfixOp, "[move] [priority] should NOT offer infix operators");
    }
  });

  test("Test 23: [move] [priority] [negative] [1] -> infix operators", () => {
    const negOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Negate)) as BrainTileOperatorDef;
    const tiles = List.from<IBrainTileDef>([testActuatorDef, testParamDef, negOpDef, numLitDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "actuator");
    if (expr.kind === "actuator") {
      const paramExpr = expr.parameters.get(0).expr;
      assert.equal(paramExpr.kind, "parameter");
      if (paramExpr.kind === "parameter") {
        assert.equal(paramExpr.value.kind, "unaryOp");
      }

      const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
      const result = suggestTiles(ctx, catalogList());

      const hasInfixOp =
        listFind(
          result.exact,
          (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "infix"
        ) !== undefined;
      assert.ok(hasInfixOp, "[move] [priority] [negative] [1] should offer infix operators");

      const hasLiteral = listFind(result.exact, (s) => s.tileDef.kind === "literal") !== undefined;
      assert.ok(!hasLiteral, "[move] [priority] [negative] [1] should NOT offer literal tiles");
    }
  });
});

// ---- Test 24-29: Call spec constraint tests ----

describe("Call spec constraints (choice, repeat, conditional)", () => {
  let richActuatorDef: BrainTileActuatorDef;
  let richCallDef: ReturnType<typeof mkCallDef>;
  let modADef: BrainTileModifierDef;
  let modBDef: BrainTileModifierDef;
  let modCDef: BrainTileModifierDef;
  let modFastDef: BrainTileModifierDef;
  let modSlowDef: BrainTileModifierDef;
  let slotFast: number;

  function getSlotIdForTile(tileId: string): number {
    for (let i = 0; i < richCallDef.argSlots.size(); i++) {
      if (richCallDef.argSlots.get(i).argSpec.tileId === tileId) return richCallDef.argSlots.get(i).slotId;
    }
    return -1;
  }

  function buildRichExpr(
    mods: { slotId: number; tileDef: BrainTileModifierDef }[],
    params: { slotId: number; tileDef: BrainTileParameterDef; value: Expr }[]
  ): ActuatorExpr {
    const modSlots = List.empty<SlotExpr>();
    for (const m of mods) {
      modSlots.push({
        slotId: m.slotId,
        expr: { nodeId: 100 + m.slotId, kind: "modifier", tileDef: m.tileDef, span: { from: 0, to: 0 } },
      });
    }
    const paramSlots = List.empty<SlotExpr>();
    for (const p of params) {
      paramSlots.push({
        slotId: p.slotId,
        expr: {
          nodeId: 200 + p.slotId,
          kind: "parameter",
          tileDef: p.tileDef,
          value: p.value,
          span: { from: 0, to: 0 },
        },
      });
    }
    return {
      nodeId: 0,
      kind: "actuator",
      tileDef: richActuatorDef,
      anons: List.empty<SlotExpr>(),
      parameters: paramSlots,
      modifiers: modSlots,
      span: { from: 0, to: 0 },
    };
  }

  before(() => {
    modADef = new BrainTileModifierDef("test.modA", { visual: { label: "A" } });
    modBDef = new BrainTileModifierDef("test.modB", { visual: { label: "B" } });
    modCDef = new BrainTileModifierDef("test.modC", { visual: { label: "C" } });
    modFastDef = new BrainTileModifierDef("test.fast", { visual: { label: "fast" } });
    modSlowDef = new BrainTileModifierDef("test.slow", { visual: { label: "slow" } });
    services.tiles.registerTileDef(modADef);
    services.tiles.registerTileDef(modBDef);
    services.tiles.registerTileDef(modCDef);
    services.tiles.registerTileDef(modFastDef);
    services.tiles.registerTileDef(modSlowDef);

    const priorityId = "test.priority.24";
    const priorityDef = new BrainTileParameterDef(priorityId, CoreTypeIds.Number, { visual: { label: "priority" } });
    services.tiles.registerTileDef(priorityDef);

    richCallDef = mkCallDef(
      bag(
        choice(mod("test.modA"), mod("test.modB"), mod("test.modC")),
        choice(repeated(mod("test.fast"), { max: 2 }), repeated(mod("test.slow"), { max: 2 })),
        optional(param(priorityId))
      )
    );
    const richFnEntry = services.functions.register("test-rich", false, { exec: () => VOID_VALUE }, richCallDef);
    richActuatorDef = new BrainTileActuatorDef("test-rich", richFnEntry, { visual: { label: "rich" } });
    services.tiles.registerTileDef(richActuatorDef);

    slotFast = getSlotIdForTile(mkModifierTileId("test.fast"));
  });

  test("Test 24: Choice -- no selection -> all options available", () => {
    const expr = buildRichExpr([], []);
    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
    const result = suggestTiles(ctx, catalogList());

    assert.ok(resultContains(result, modADef.tileId), "modA should be available");
    assert.ok(resultContains(result, modBDef.tileId), "modB should be available");
    assert.ok(resultContains(result, modCDef.tileId), "modC should be available");
    assert.ok(resultContains(result, modFastDef.tileId), "modFast should be available");
    assert.ok(resultContains(result, modSlowDef.tileId), "modSlow should be available");
  });

  test("Test 25: Choice -- modA selected -> modB/modC excluded", () => {
    const slotA = getSlotIdForTile(mkModifierTileId("test.modA"));
    const expr = buildRichExpr([{ slotId: slotA, tileDef: modADef }], []);
    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
    const result = suggestTiles(ctx, catalogList());

    assert.ok(!resultContains(result, modADef.tileId), "modA should NOT be available (already placed)");
    assert.ok(!resultContains(result, modBDef.tileId), "modB should NOT be available (excluded by choice)");
    assert.ok(!resultContains(result, modCDef.tileId), "modC should NOT be available (excluded by choice)");
    assert.ok(resultContains(result, modFastDef.tileId), "modFast should still be available");
    assert.ok(resultContains(result, modSlowDef.tileId), "modSlow should still be available");
  });

  test("Test 26: Choice+Repeat -- modFast x1 -> modSlow excluded, modFast available", () => {
    const expr = buildRichExpr([{ slotId: slotFast, tileDef: modFastDef }], []);
    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
    const result = suggestTiles(ctx, catalogList());

    assert.ok(resultContains(result, modFastDef.tileId), "modFast should still be available (max 2, placed 1)");
    assert.ok(!resultContains(result, modSlowDef.tileId), "modSlow should NOT be available (excluded by choice)");
  });

  test("Test 27: Repeat max -- modFast x2 -> modFast exhausted", () => {
    const modSlots = List.empty<SlotExpr>();
    modSlots.push({
      slotId: slotFast,
      expr: { nodeId: 101, kind: "modifier", tileDef: modFastDef, span: { from: 0, to: 1 } },
    });
    modSlots.push({
      slotId: slotFast,
      expr: { nodeId: 102, kind: "modifier", tileDef: modFastDef, span: { from: 1, to: 2 } },
    });

    const expr: ActuatorExpr = {
      nodeId: 0,
      kind: "actuator",
      tileDef: richActuatorDef,
      anons: List.empty<SlotExpr>(),
      parameters: List.empty<SlotExpr>(),
      modifiers: modSlots,
      span: { from: 0, to: 2 },
    };
    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
    const result = suggestTiles(ctx, catalogList());

    assert.ok(!resultContains(result, modFastDef.tileId), "modFast should NOT be available (max 2, placed 2)");
    assert.ok(!resultContains(result, modSlowDef.tileId), "modSlow should NOT be available (excluded by choice)");
  });

  test("Test 28: Optional parameter -- not placed -> available; placed -> not available", () => {
    const priorityTileId = mkParameterTileId("test.priority.24");

    // Not placed
    const expr1 = buildRichExpr([], []);
    const result1 = suggestTiles({ ruleSide: RuleSide.Do, expr: expr1 }, catalogList());
    assert.ok(resultContains(result1, priorityTileId), "optional priority param should be available when not placed");

    // Placed
    const slotPriority = getSlotIdForTile(priorityTileId);
    const priorityParamDef = services.tiles.get(priorityTileId) as BrainTileParameterDef;
    const litDef = services.tiles
      .getAll()
      .toArray()
      .find((t) => t.kind === "literal") as BrainTileLiteralDef;
    const expr2 = buildRichExpr(
      [],
      [
        {
          slotId: slotPriority,
          tileDef: priorityParamDef,
          value: { nodeId: 300, kind: "literal", tileDef: litDef, span: { from: 0, to: 0 } },
        },
      ]
    );
    const result2 = suggestTiles({ ruleSide: RuleSide.Do, expr: expr2 }, catalogList());
    assert.ok(!resultContains(result2, priorityTileId), "optional priority param should NOT be available when placed");
  });

  test("Test 29: Conditional -- args available only when condition met", () => {
    const modXDef = new BrainTileModifierDef("test.modX", { visual: { label: "X" } });
    const modYDef = new BrainTileModifierDef("test.modY", { visual: { label: "Y" } });
    services.tiles.registerTileDef(modXDef);
    services.tiles.registerTileDef(modYDef);

    const testCondParamId = "test.condValue";
    const testCondParamDef = new BrainTileParameterDef(testCondParamId, CoreTypeIds.Number, {
      visual: { label: "val" },
    });
    services.tiles.registerTileDef(testCondParamDef);

    const condCallDef = mkCallDef(
      bag(
        param(testCondParamId, { name: "theValue", required: true, anonymous: true }),
        conditional("theValue", optional(choice(mod("test.modX"), mod("test.modY"))))
      )
    );
    const condFnEntry = services.functions.register("test-cond", false, { exec: () => VOID_VALUE }, condCallDef);
    const condActuatorDef = new BrainTileActuatorDef("test-cond", condFnEntry, { visual: { label: "cond" } });
    services.tiles.registerTileDef(condActuatorDef);

    // No value -> condition not met
    {
      const expr: ActuatorExpr = {
        nodeId: 0,
        kind: "actuator",
        tileDef: condActuatorDef,
        anons: List.empty<SlotExpr>(),
        parameters: List.empty<SlotExpr>(),
        modifiers: List.empty<SlotExpr>(),
        span: { from: 0, to: 0 },
      };
      const result = suggestTiles({ ruleSide: RuleSide.Do, expr }, catalogList());
      assert.ok(!resultContains(result, modXDef.tileId), "modX should NOT be available when condition not met");
      assert.ok(!resultContains(result, modYDef.tileId), "modY should NOT be available when condition not met");
    }

    // Value placed -> condition met
    {
      const anonSlotId = condCallDef.argSlots.get(0).slotId;
      const litDef = services.tiles
        .getAll()
        .toArray()
        .find((t) => t.kind === "literal") as BrainTileLiteralDef;
      const anonSlots = List.empty<SlotExpr>();
      anonSlots.push({
        slotId: anonSlotId,
        expr: { nodeId: 50, kind: "literal", tileDef: litDef, span: { from: 0, to: 1 } },
      });

      const expr: ActuatorExpr = {
        nodeId: 0,
        kind: "actuator",
        tileDef: condActuatorDef,
        anons: anonSlots,
        parameters: List.empty<SlotExpr>(),
        modifiers: List.empty<SlotExpr>(),
        span: { from: 0, to: 1 },
      };
      const result = suggestTiles({ ruleSide: RuleSide.Do, expr }, catalogList());
      assert.ok(resultContains(result, modXDef.tileId), "modX should be available when condition met");
      assert.ok(resultContains(result, modYDef.tileId), "modY should be available when condition met");
    }

    // Value placed + modX -> modY excluded by choice
    {
      const anonSlotId = condCallDef.argSlots.get(0).slotId;
      const modXSlotId = condCallDef.argSlots
        .toArray()
        .find((s) => s.argSpec.tileId === mkModifierTileId("test.modX"))!.slotId;
      const litDef = services.tiles
        .getAll()
        .toArray()
        .find((t) => t.kind === "literal") as BrainTileLiteralDef;

      const anonSlots = List.empty<SlotExpr>();
      anonSlots.push({
        slotId: anonSlotId,
        expr: { nodeId: 50, kind: "literal", tileDef: litDef, span: { from: 0, to: 1 } },
      });
      const modSlots = List.empty<SlotExpr>();
      modSlots.push({
        slotId: modXSlotId,
        expr: { nodeId: 60, kind: "modifier", tileDef: modXDef, span: { from: 1, to: 2 } },
      });

      const expr: ActuatorExpr = {
        nodeId: 0,
        kind: "actuator",
        tileDef: condActuatorDef,
        anons: anonSlots,
        parameters: List.empty<SlotExpr>(),
        modifiers: modSlots,
        span: { from: 0, to: 2 },
      };
      const result = suggestTiles({ ruleSide: RuleSide.Do, expr }, catalogList());
      assert.ok(!resultContains(result, modXDef.tileId), "modX should NOT be available (already placed)");
      assert.ok(!resultContains(result, modYDef.tileId), "modY should NOT be available (excluded by choice)");
    }
  });
});

// ---- Test 30: Non-inline sensor tests ----

describe("Non-inline sensor operator suggestions", () => {
  test("Test 30: Non-inline sensor with satisfied choice -> no infix operators", () => {
    const modPDef = new BrainTileModifierDef("test.modP", { visual: { label: "P" } });
    const modQDef = new BrainTileModifierDef("test.modQ", { visual: { label: "Q" } });
    services.tiles.registerTileDef(modPDef);
    services.tiles.registerTileDef(modQDef);

    const sensorCallDef = mkCallDef(choice(mod("test.modP"), mod("test.modQ")));
    const sensorFnEntry = services.functions.register("test-sense", false, { exec: () => VOID_VALUE }, sensorCallDef);
    const testSensorDef = new BrainTileSensorDef("test-sense", sensorFnEntry, CoreTypeIds.Number, {
      visual: { label: "sense" },
    });
    services.tiles.registerTileDef(testSensorDef);

    const modPSlotId = sensorCallDef.argSlots
      .toArray()
      .find((s) => s.argSpec.tileId === mkModifierTileId("test.modP"))!.slotId;
    const modSlots = List.empty<SlotExpr>();
    modSlots.push({
      slotId: modPSlotId,
      expr: { nodeId: 70, kind: "modifier", tileDef: modPDef, span: { from: 0, to: 1 } },
    });

    const expr = {
      nodeId: 0,
      kind: "sensor" as const,
      tileDef: testSensorDef,
      anons: List.empty<SlotExpr>(),
      parameters: List.empty<SlotExpr>(),
      modifiers: modSlots,
      span: { from: 0, to: 1 },
    };
    const result = suggestTiles({ ruleSide: RuleSide.When, expr }, catalogList());

    const hasInfixOp = listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined;
    assert.ok(!hasInfixOp, "Non-inline sensor with satisfied choice should NOT offer infix operators");
    assert.ok(!resultContains(result, modQDef.tileId), "modQ should NOT be available (excluded by choice)");
    assert.equal(result.exact.size(), 0, "Completed non-inline sensor should suggest nothing");
  });

  test("Test 30b: Inline sensor (no args) -> infix operators offered", () => {
    const randomSensorDef = services.tiles
      .getAll()
      .toArray()
      .find((t) => t.kind === "sensor") as BrainTileSensorDef;
    if (randomSensorDef) {
      const sensorExpr: SensorExpr = {
        nodeId: 0,
        kind: "sensor",
        tileDef: randomSensorDef,
        anons: List.empty<SlotExpr>(),
        parameters: List.empty<SlotExpr>(),
        modifiers: List.empty<SlotExpr>(),
        span: { from: 0, to: 0 },
      };
      const result = suggestTiles({ ruleSide: RuleSide.When, expr: sensorExpr }, catalogList());
      const hasInfixOp = listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined;
      assert.ok(hasInfixOp, "Inline sensor (no args) should offer infix operators");
    }
  });

  test("Test 30c: Non-inline sensor at max capacity -> no operators", () => {
    const modRDef = new BrainTileModifierDef("test.modR", { visual: { label: "R" } });
    const modSDef = new BrainTileModifierDef("test.modS", { visual: { label: "S" } });
    const modNrDef = new BrainTileModifierDef("test.modNr", { visual: { label: "Near" } });
    const modFrDef = new BrainTileModifierDef("test.modFr", { visual: { label: "Far" } });
    services.tiles.registerTileDef(modRDef);
    services.tiles.registerTileDef(modSDef);
    services.tiles.registerTileDef(modNrDef);
    services.tiles.registerTileDef(modFrDef);

    const senseCallDef = mkCallDef(
      bag(
        choice(mod("test.modR"), mod("test.modS")),
        choice(repeated(mod("test.modNr"), { max: 3 }), repeated(mod("test.modFr"), { max: 3 }))
      )
    );
    const senseFnEntry = services.functions.register("test-sense2", false, { exec: () => VOID_VALUE }, senseCallDef);
    const senseDef = new BrainTileSensorDef("test-sense2", senseFnEntry, CoreTypeIds.Boolean, {
      visual: { label: "sense2" },
    });
    services.tiles.registerTileDef(senseDef);

    const modRSlotId = senseCallDef.argSlots
      .toArray()
      .find((s) => s.argSpec.tileId === mkModifierTileId("test.modR"))!.slotId;
    const modNrSlotId = senseCallDef.argSlots
      .toArray()
      .find((s) => s.argSpec.tileId === mkModifierTileId("test.modNr"))!.slotId;

    const mods = List.empty<SlotExpr>();
    mods.push({
      slotId: modRSlotId,
      expr: { nodeId: 80, kind: "modifier", tileDef: modRDef, span: { from: 1, to: 2 } },
    });
    mods.push({
      slotId: modNrSlotId,
      expr: { nodeId: 81, kind: "modifier", tileDef: modNrDef, span: { from: 2, to: 3 } },
    });
    mods.push({
      slotId: modNrSlotId,
      expr: { nodeId: 82, kind: "modifier", tileDef: modNrDef, span: { from: 3, to: 4 } },
    });
    mods.push({
      slotId: modNrSlotId,
      expr: { nodeId: 83, kind: "modifier", tileDef: modNrDef, span: { from: 4, to: 5 } },
    });

    const senseExpr = {
      nodeId: 0,
      kind: "sensor" as const,
      tileDef: senseDef,
      anons: List.empty<SlotExpr>(),
      parameters: List.empty<SlotExpr>(),
      modifiers: mods,
      span: { from: 0, to: 5 },
    };
    const result = suggestTiles({ ruleSide: RuleSide.When, expr: senseExpr }, catalogList());

    assert.ok(
      !listFind(result.exact, (s) => s.tileDef.kind === "operator"),
      "Fully filled non-inline sensor should NOT suggest any operators"
    );
    assert.equal(result.exact.size(), 0, "Fully filled non-inline sensor should suggest nothing");
    assert.equal(
      result.withConversion.size(),
      0,
      "Fully filled non-inline sensor should have no conversion suggestions"
    );
  });
});

// ---- Test 31-34: Operator overload filtering ----

describe("Operator overload filtering", () => {
  test("Test 31: Number LHS -> operators filtered by overload", () => {
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;

    const expr: LiteralExpr = { nodeId: 0, kind: "literal", tileDef: numLitDef, span: { from: 0, to: 0 } };
    const result = suggestTiles({ ruleSide: RuleSide.Either, expr }, catalogList());

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Add)) !== undefined,
      "add should be in exact"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Subtract)) !== undefined,
      "sub should be in exact"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.EqualTo)) !== undefined,
      "eq should be in exact"
    );

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Assign)) === undefined,
      "assign should NOT be in exact (literal is not l-value)"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.And)) === undefined,
      "and should NOT be suggested for Number LHS"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Or)) === undefined,
      "or should NOT be suggested for Number LHS"
    );
    assert.ok(
      listFind(result.withConversion, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.And)) === undefined,
      "and should NOT be in withConversion"
    );
    assert.ok(
      listFind(result.withConversion, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Or)) === undefined,
      "or should NOT be in withConversion"
    );
  });

  test("Test 32: Boolean LHS -> operators filtered by overload", () => {
    const boolLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Boolean
      ) as BrainTileLiteralDef;

    const expr: LiteralExpr = { nodeId: 0, kind: "literal", tileDef: boolLitDef, span: { from: 0, to: 0 } };
    const result = suggestTiles({ ruleSide: RuleSide.Either, expr }, catalogList());

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.And)) !== undefined,
      "and should be in exact"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Or)) !== undefined,
      "or should be in exact"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.EqualTo)) !== undefined,
      "eq should be in exact"
    );

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Assign)) === undefined,
      "assign should NOT be in exact"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Add)) === undefined,
      "add should NOT be suggested for Boolean LHS"
    );
    assert.ok(
      listFind(result.withConversion, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Add)) === undefined,
      "add should NOT be in withConversion"
    );
  });

  test("Test 34: Replace operator with LHS type awareness", () => {
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;

    const leftLit: LiteralExpr = { nodeId: 1, kind: "literal", tileDef: numLitDef, span: { from: 0, to: 0 } };
    const rightLit: LiteralExpr = { nodeId: 2, kind: "literal", tileDef: numLitDef, span: { from: 2, to: 2 } };
    const binaryExpr: BinaryOpExpr = {
      nodeId: 3,
      kind: "binaryOp",
      operator: addOpDef,
      left: leftLit,
      right: rightLit,
      span: { from: 0, to: 2 },
    };

    const result = suggestTiles({ ruleSide: RuleSide.Either, expr: binaryExpr, replaceTileIndex: 1 }, catalogList());

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Multiply)) !== undefined,
      "mul should be in exact"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.And)) === undefined,
      "and should NOT be suggested"
    );
    assert.ok(
      listFind(result.withConversion, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.And)) === undefined,
      "and should NOT be in withConversion"
    );
  });
});

// ---- Test 35-37: Incomplete expressions and type-constrained suggestions ----

describe("Incomplete expression type constraints", () => {
  test("Test 35: [say] ['hi'] [+] -> suggests string-producing value tiles", () => {
    const anonStringSpec = param(CoreParameterId.AnonymousString, { name: "anonStr", required: true, anonymous: true });
    const sayCallDef = mkCallDef(bag(anonStringSpec));
    const sayFnEntry = services.functions.register("test-say", false, { exec: () => VOID_VALUE }, sayCallDef);
    const sayDef = new BrainTileActuatorDef("test-say", sayFnEntry, { visual: { label: "say" } });
    services.tiles.registerTileDef(sayDef);

    const strLitDef = new BrainTileLiteralDef(CoreTypeIds.String, "hi", { visual: { label: "hi" } });
    services.tiles.registerTileDef(strLitDef);
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;

    const tiles = List.from<IBrainTileDef>([sayDef, strLitDef, addOpDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "actuator");
    if (expr.kind === "actuator") {
      const result = suggestTiles({ ruleSide: RuleSide.Do, expr }, catalogList());

      const hasStringLit = listFind(
        result.exact,
        (s) => s.tileDef.kind === "literal" && getTileOutputType(s.tileDef) === CoreTypeIds.String
      );
      assert.ok(hasStringLit !== undefined, "Should suggest String literal as exact match");

      const numInConv = listFind(result.withConversion, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Number);
      assert.ok(numInConv !== undefined, "Number tiles should be in withConversion for String");

      const hasPrefixOp = listFind(
        result.exact,
        (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "prefix"
      );
      assert.ok(hasPrefixOp === undefined, "Should NOT include prefix operators (none produce String)");

      const hasInfixOp = listFind(
        result.exact,
        (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "infix"
      );
      assert.ok(hasInfixOp === undefined, "Should NOT suggest infix operators when value is needed");
    }
  });

  test("Test 36: Variable LHS -> assign suggested; literal LHS -> assign excluded", () => {
    const numVarDef = new BrainTileVariableDef("test.numVar", "score", CoreTypeIds.Number, "var-score-1");
    services.tiles.registerTileDef(numVarDef);

    const assignTileId = mkOperatorTileId(CoreOpId.Assign);

    // Variable LHS
    const varExpr: VariableExpr = { nodeId: 0, kind: "variable", tileDef: numVarDef, span: { from: 0, to: 0 } };
    const varResult = suggestTiles({ ruleSide: RuleSide.Do, expr: varExpr }, catalogList());
    assert.ok(
      listFind(varResult.exact, (s) => s.tileDef.tileId === assignTileId) !== undefined,
      "assign should be in exact for variable LHS"
    );

    // Literal LHS
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;
    const litExpr: LiteralExpr = { nodeId: 1, kind: "literal", tileDef: numLitDef, span: { from: 0, to: 0 } };
    const litResult = suggestTiles({ ruleSide: RuleSide.Do, expr: litExpr }, catalogList());
    assert.ok(
      listFind(litResult.exact, (s) => s.tileDef.tileId === assignTileId) === undefined,
      "assign should NOT be in exact for literal LHS"
    );

    // Sensor LHS
    const randomSensorDef = services.tiles
      .getAll()
      .toArray()
      .find((t) => t.kind === "sensor") as BrainTileSensorDef;
    if (randomSensorDef) {
      const sensorExpr: SensorExpr = {
        nodeId: 2,
        kind: "sensor",
        tileDef: randomSensorDef,
        anons: List.empty<SlotExpr>(),
        parameters: List.empty<SlotExpr>(),
        modifiers: List.empty<SlotExpr>(),
        span: { from: 0, to: 0 },
      };
      const sensorResult = suggestTiles({ ruleSide: RuleSide.When, expr: sensorExpr }, catalogList());
      assert.ok(
        listFind(sensorResult.exact, (s) => s.tileDef.tileId === assignTileId) === undefined,
        "assign should NOT be in exact for sensor LHS"
      );
    }

    // BinaryOp LHS
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;
    const binaryExpr: BinaryOpExpr = {
      nodeId: 3,
      kind: "binaryOp",
      operator: addOpDef,
      left: { nodeId: 4, kind: "literal", tileDef: numLitDef, span: { from: 0, to: 0 } },
      right: { nodeId: 5, kind: "literal", tileDef: numLitDef, span: { from: 2, to: 2 } },
      span: { from: 0, to: 2 },
    };
    const binResult = suggestTiles({ ruleSide: RuleSide.Do, expr: binaryExpr }, catalogList());
    assert.ok(
      listFind(binResult.exact, (s) => s.tileDef.tileId === assignTileId) === undefined,
      "assign should NOT be in exact for binaryOp LHS"
    );
  });

  test("Test 37: Number expected -> negate suggested", () => {
    const anonNumSpec = param(CoreParameterId.AnonymousNumber, { name: "anonNum", required: true, anonymous: true });
    const numActCallDef = mkCallDef(bag(anonNumSpec));
    const numActFnEntry = services.functions.register("test-numact", false, { exec: () => VOID_VALUE }, numActCallDef);
    const numActDef = new BrainTileActuatorDef("test-numact", numActFnEntry, { visual: { label: "numact" } });
    services.tiles.registerTileDef(numActDef);

    const numLitDef = services.tiles.get(
      services.tiles
        .getAll()
        .toArray()
        .find((t) => t.kind === "literal" && getTileOutputType(t) === CoreTypeIds.Number)!.tileId
    )!;
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;
    const negateTileId = mkOperatorTileId(CoreOpId.Negate);

    const numTiles = List.from<IBrainTileDef>([numActDef, numLitDef, addOpDef]);
    const numExpr = parseTilesForSuggestions(numTiles);
    assert.equal(numExpr.kind, "actuator");
    if (numExpr.kind === "actuator") {
      const result = suggestTiles({ ruleSide: RuleSide.Do, expr: numExpr }, catalogList());
      const negateInExact = listFind(result.exact, (s) => s.tileDef.tileId === negateTileId);
      assert.ok(negateInExact !== undefined, "negate should be suggested when Number is expected");
    }
  });
});

// ---- Test 38-46: Accessor / struct field tests ----

describe("Accessor / struct field suggestions", () => {
  let posStructTypeId: string;
  let accessorXDef: BrainTileAccessorDef;
  let accessorYDef: BrainTileAccessorDef;
  let accessorMagDef: BrainTileAccessorDef;
  let posVarDef: BrainTileVariableDef;

  before(() => {
    posStructTypeId = services.types.addStructType("Position", {
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number },
        { name: "y", typeId: CoreTypeIds.Number },
        { name: "mag", typeId: CoreTypeIds.Number },
      ]),
    });
    accessorXDef = new BrainTileAccessorDef(posStructTypeId, "x", CoreTypeIds.Number, { visual: { label: "x" } });
    accessorYDef = new BrainTileAccessorDef(posStructTypeId, "y", CoreTypeIds.Number, { visual: { label: "y" } });
    accessorMagDef = new BrainTileAccessorDef(posStructTypeId, "mag", CoreTypeIds.Number, {
      visual: { label: "mag" },
      readOnly: true,
    });
    services.tiles.registerTileDef(accessorXDef);
    services.tiles.registerTileDef(accessorYDef);
    services.tiles.registerTileDef(accessorMagDef);

    posVarDef = new BrainTileVariableDef("test.posVar", "my_position", posStructTypeId, "var-pos-1");
    services.tiles.registerTileDef(posVarDef);

    services.operatorOverloads.binary(
      CoreOpId.Assign,
      posStructTypeId,
      posStructTypeId,
      posStructTypeId,
      { exec: (_ctx: ExecutionContext, _args: MapValue) => NIL_VALUE },
      false
    );
  });

  test("Test 38: Struct variable -> accessor tiles suggested", () => {
    const varExpr: VariableExpr = { nodeId: 0, kind: "variable", tileDef: posVarDef, span: { from: 0, to: 1 } };
    const result = suggestTiles({ ruleSide: RuleSide.Either, expr: varExpr }, catalogList());

    assert.ok(resultContains(result, accessorXDef.tileId), "accessor 'x' should be suggested");
    assert.ok(resultContains(result, accessorYDef.tileId), "accessor 'y' should be suggested");

    const hasOperator = listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined;
    assert.ok(hasOperator, "Infix operators should also be suggested");
  });

  test("Test 39: Number variable -> accessor tiles NOT suggested", () => {
    const numVarDef2 = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "variable" && (t as BrainTileVariableDef).varType === CoreTypeIds.Number
      ) as BrainTileVariableDef;

    if (numVarDef2) {
      const varExpr: VariableExpr = { nodeId: 0, kind: "variable", tileDef: numVarDef2, span: { from: 0, to: 1 } };
      const result = suggestTiles({ ruleSide: RuleSide.Either, expr: varExpr }, catalogList());
      const hasAccessor = listFind(result.exact, (s) => s.tileDef.kind === "accessor") !== undefined;
      assert.ok(!hasAccessor, "Accessor tiles should NOT be suggested after Number variable");
    }
  });

  test("Test 40: Empty expression -> accessor tiles NOT suggested", () => {
    const result = suggestTiles({ ruleSide: RuleSide.Either }, catalogList());
    const hasAccessor = listFind(result.exact, (s) => s.tileDef.kind === "accessor") !== undefined;
    assert.ok(!hasAccessor, "Accessor tiles should NOT be suggested in empty expression position");
  });

  test("Test 41: [$pos] [x] -> assignment operator suggested (l-value)", () => {
    const fieldAccessExpr: FieldAccessExpr = {
      nodeId: 0,
      kind: "fieldAccess",
      object: { nodeId: 1, kind: "variable", tileDef: posVarDef, span: { from: 0, to: 1 } },
      accessor: accessorXDef,
      span: { from: 0, to: 2 },
    };
    const result = suggestTiles({ ruleSide: RuleSide.Do, expr: fieldAccessExpr }, catalogList());

    const assignTileId = mkOperatorTileId(CoreOpId.Assign);
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === assignTileId) !== undefined,
      "assign should be suggested after field access"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Add)) !== undefined,
      "add should be suggested after field access"
    );
  });

  test("Test 42: parseTilesForSuggestions [$pos] [x] -> fieldAccess expr", () => {
    const tiles = List.from<IBrainTileDef>([posVarDef, accessorXDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "fieldAccess");
    if (expr.kind === "fieldAccess") {
      assert.equal(expr.object.kind, "variable");
      assert.equal(expr.accessor.fieldName, "x");

      const result = suggestTiles({ ruleSide: RuleSide.Either, expr }, catalogList());
      const hasInfixOp = listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined;
      assert.ok(hasInfixOp, "[$pos] [x] should offer infix operators");

      const doResult = suggestTiles({ ruleSide: RuleSide.Do, expr }, catalogList());
      assert.ok(
        listFind(doResult.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Assign)) !== undefined,
        "[$pos] [x] on DO side should offer assign"
      );
    }
  });

  test("Test 43: [$pos] [x] [=] -> value tiles for assignment RHS", () => {
    const assignOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Assign)) as BrainTileOperatorDef;
    const tiles = List.from<IBrainTileDef>([posVarDef, accessorXDef, assignOpDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "assignment");
    if (expr.kind === "assignment") {
      assert.equal(expr.target.kind, "fieldAccess");
      assert.equal(expr.value.kind, "errorExpr");

      const result = suggestTiles({ ruleSide: RuleSide.Do, expr }, catalogList());

      const hasValueTile =
        listFind(
          result.exact,
          (s) => s.tileDef.kind === "literal" || s.tileDef.kind === "variable" || s.tileDef.kind === "factory"
        ) !== undefined;
      assert.ok(hasValueTile, "[$pos] [x] [=] should offer value tiles for RHS");

      const hasInfixOp =
        listFind(
          result.exact,
          (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "infix"
        ) !== undefined;
      assert.ok(!hasInfixOp, "[$pos] [x] [=] should NOT offer infix operators");
    }
  });

  test("Test 44: [$pos] [x] [=] [1] -> infix ops to extend value", () => {
    const assignOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Assign)) as BrainTileOperatorDef;
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;

    const tiles = List.from<IBrainTileDef>([posVarDef, accessorXDef, assignOpDef, numLitDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "assignment");
    if (expr.kind === "assignment") {
      const result = suggestTiles({ ruleSide: RuleSide.Do, expr }, catalogList());

      const hasInfixOp = listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined;
      assert.ok(hasInfixOp, "[$pos] [x] [=] [1] should offer infix operators");

      const hasLiteral = listFind(result.exact, (s) => s.tileDef.kind === "literal") !== undefined;
      assert.ok(!hasLiteral, "[$pos] [x] [=] [1] should NOT offer literal tiles");
    }
  });

  test("Test 45: Replace accessor tile -> other accessors for same struct", () => {
    const fieldAccessExpr: FieldAccessExpr = {
      nodeId: 0,
      kind: "fieldAccess",
      object: { nodeId: 1, kind: "variable", tileDef: posVarDef, span: { from: 0, to: 1 } },
      accessor: accessorXDef,
      span: { from: 0, to: 2 },
    };

    const result = suggestTiles(
      { ruleSide: RuleSide.Either, expr: fieldAccessExpr, replaceTileIndex: 1 },
      catalogList()
    );

    assert.ok(resultContains(result, accessorXDef.tileId), "Replace accessor should suggest Position.x");
    assert.ok(resultContains(result, accessorYDef.tileId), "Replace accessor should suggest Position.y");

    const hasValueTile =
      listFind(result.exact, (s) => s.tileDef.kind === "literal" || s.tileDef.kind === "variable") !== undefined;
    assert.ok(!hasValueTile, "Replace accessor should NOT suggest value tiles");

    const hasOperator = listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined;
    assert.ok(!hasOperator, "Replace accessor should NOT suggest operators");
  });

  test("Test 46: Different struct type -> only matching accessors suggested", () => {
    const velStructTypeId = services.types.addStructType("Velocity", {
      fields: List.from([
        { name: "dx", typeId: CoreTypeIds.Number },
        { name: "dy", typeId: CoreTypeIds.Number },
      ]),
    });
    const accessorDxDef = new BrainTileAccessorDef(velStructTypeId, "dx", CoreTypeIds.Number, {
      visual: { label: "dx" },
    });
    const accessorDyDef = new BrainTileAccessorDef(velStructTypeId, "dy", CoreTypeIds.Number, {
      visual: { label: "dy" },
    });
    services.tiles.registerTileDef(accessorDxDef);
    services.tiles.registerTileDef(accessorDyDef);

    const velVarDef = new BrainTileVariableDef("test.velVar", "my_velocity", velStructTypeId, "var-vel-1");
    services.tiles.registerTileDef(velVarDef);

    // Position variable -> Position accessors only
    {
      const varExpr: VariableExpr = { nodeId: 0, kind: "variable", tileDef: posVarDef, span: { from: 0, to: 1 } };
      const result = suggestTiles({ ruleSide: RuleSide.Either, expr: varExpr }, catalogList());
      assert.ok(resultContains(result, accessorXDef.tileId), "Position var should suggest Position.x");
      assert.ok(resultContains(result, accessorYDef.tileId), "Position var should suggest Position.y");
      assert.ok(!resultContains(result, accessorDxDef.tileId), "Position var should NOT suggest Velocity.dx");
      assert.ok(!resultContains(result, accessorDyDef.tileId), "Position var should NOT suggest Velocity.dy");
    }

    // Velocity variable -> Velocity accessors only
    {
      const varExpr: VariableExpr = { nodeId: 0, kind: "variable", tileDef: velVarDef, span: { from: 0, to: 1 } };
      const result = suggestTiles({ ruleSide: RuleSide.Either, expr: varExpr }, catalogList());
      assert.ok(!resultContains(result, accessorXDef.tileId), "Velocity var should NOT suggest Position.x");
      assert.ok(resultContains(result, accessorDxDef.tileId), "Velocity var should suggest Velocity.dx");
      assert.ok(resultContains(result, accessorDyDef.tileId), "Velocity var should suggest Velocity.dy");
    }
  });

  test("Test 77: [$pos] [=] [$pos2] -> accessors filtered by assignment target type", () => {
    // When the assignment is complete and the RHS type matches the target type,
    // adding an accessor would change the RHS to an incompatible type.
    // No Position accessors should be suggested since they all produce Number,
    // which does not match the Position target type.
    const posVarDef2 = new BrainTileVariableDef("test.posVar2", "other_position", posStructTypeId, "var-pos-2");
    services.tiles.registerTileDef(posVarDef2);

    const assignOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Assign)) as BrainTileOperatorDef;
    const tiles = List.from<IBrainTileDef>([posVarDef, assignOpDef, posVarDef2]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "assignment");
    const result = suggestTiles({ ruleSide: RuleSide.Do, expr }, catalogList());

    // All Position accessors produce Number, which is not Position -- all filtered out
    const hasAccessor = listFind(result.exact, (s) => s.tileDef.kind === "accessor") !== undefined;
    assert.ok(!hasAccessor, "[$pos] [=] [$pos2] should NOT suggest accessors (field types incompatible with target)");
  });

  test("Test 78: [$numVar] [=] [$pos] -> accessors filtered to Number fields only", () => {
    // When the assignment target is Number and the RHS is a struct,
    // accessors producing Number should be suggested.
    const numVarDef = new BrainTileVariableDef("test.numVar78", "my_number", CoreTypeIds.Number, "var-num-78");
    services.tiles.registerTileDef(numVarDef);

    const assignOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Assign)) as BrainTileOperatorDef;
    const tiles = List.from<IBrainTileDef>([numVarDef, assignOpDef, posVarDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "assignment");
    const result = suggestTiles({ ruleSide: RuleSide.Do, expr }, catalogList());

    // Position.x and Position.y produce Number -> should be suggested
    assert.ok(resultContains(result, accessorXDef.tileId), "x accessor should be suggested (Number matches target)");
    assert.ok(resultContains(result, accessorYDef.tileId), "y accessor should be suggested (Number matches target)");
  });

  test("Test 79: [$pos] standalone -> all accessors still suggested (no enclosing constraint)", () => {
    // A standalone struct variable with no enclosing assignment or operator
    // should still suggest all accessors for that struct type.
    const varExpr: VariableExpr = { nodeId: 0, kind: "variable", tileDef: posVarDef, span: { from: 0, to: 1 } };
    const result = suggestTiles({ ruleSide: RuleSide.Either, expr: varExpr }, catalogList());

    assert.ok(resultContains(result, accessorXDef.tileId), "standalone [$pos] should suggest Position.x");
    assert.ok(resultContains(result, accessorYDef.tileId), "standalone [$pos] should suggest Position.y");
    assert.ok(resultContains(result, accessorMagDef.tileId), "standalone [$pos] should suggest Position.mag");
  });
});

// ---- Test 47-58: Sub-expression filtering, prefix ops, non-inline sensors ----

describe("Sub-expression filtering", () => {
  test("Test 47: ['hello'] [!=] _ -> type-constrained String, no non-inline sensors", () => {
    const strLitDef = new BrainTileLiteralDef(CoreTypeIds.String, "hello", {
      persist: false,
      visual: { label: "hello" },
    });
    services.tiles.registerTileDef(strLitDef);
    const neOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.NotEqualTo)) as BrainTileOperatorDef;

    const tiles = List.from<IBrainTileDef>([strLitDef, neOpDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "binaryOp");
    const result = suggestTiles({ ruleSide: RuleSide.When, expr }, catalogList());

    const hasStringValue =
      listFind(result.exact, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.String) !== undefined;
    assert.ok(hasStringValue, "Should offer String value tiles as exact");

    const hasNonInlineSensor =
      listFind(
        result.exact,
        (s) => s.tileDef.kind === "sensor" && (s.tileDef.placement === undefined || (s.tileDef.placement! & 16) === 0)
      ) !== undefined;
    assert.ok(!hasNonInlineSensor, "Should NOT include non-inline sensors in sub-expression position");

    const hasNegate =
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Negate)) !== undefined;
    assert.ok(!hasNegate, "Should NOT include [negate] when expected type is String");

    const numConversion = listFind(result.withConversion, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Number);
    assert.ok(numConversion !== undefined, "Number tiles should be in withConversion for String");

    const boolConversion = listFind(result.withConversion, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Boolean);
    assert.ok(boolConversion !== undefined, "Boolean tiles should be in withConversion for String");
  });

  test("Test 48: Top-level empty expr still includes non-inline sensors", () => {
    const result = suggestTiles({ ruleSide: RuleSide.When }, catalogList());
    const hasNonInlineSensor =
      listFind(
        result.exact,
        (s) => s.tileDef.kind === "sensor" && (s.tileDef.placement === undefined || (s.tileDef.placement! & 16) === 0)
      ) !== undefined;
    assert.ok(hasNonInlineSensor, "Top-level should include non-inline sensors");
  });

  test("Test 49: [1] [+] _ without overloads -- prefix ops still offered", () => {
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;

    const tiles = List.from<IBrainTileDef>([numLitDef, addOpDef]);
    const expr = parseTilesForSuggestions(tiles);

    const result = suggestTiles({ ruleSide: RuleSide.Either, expr }, catalogList());

    const hasPrefixOp =
      listFind(
        result.exact,
        (s) => s.tileDef.kind === "operator" && (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "prefix"
      ) !== undefined;
    assert.ok(hasPrefixOp, "[1] [+] _ without overloads should still offer prefix operators");

    const hasNonInlineSensor =
      listFind(
        result.exact,
        (s) => s.tileDef.kind === "sensor" && (s.tileDef.placement === undefined || (s.tileDef.placement! & 16) === 0)
      ) !== undefined;
    assert.ok(!hasNonInlineSensor, "[1] [+] _ should NOT include non-inline sensors");
  });

  test("Test 50: [1] [+] _ with overloads -> [negate] offered, [not] excluded", () => {
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;

    const tiles = List.from<IBrainTileDef>([numLitDef, addOpDef]);
    const expr = parseTilesForSuggestions(tiles);

    const result = suggestTiles({ ruleSide: RuleSide.Either, expr }, catalogList());

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Negate)) !== undefined,
      "[negate] should be offered (Number result matches)"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Not)) === undefined,
      "[not] should NOT be offered (Boolean result doesn't match Number)"
    );
  });

  test("Test 51: [not] [on-page-entered] -> UnaryOp(NOT, SensorExpr)", () => {
    const notOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Not)) as BrainTileOperatorDef;
    const sensorDef = services.tiles.get(mkSensorTileId(CoreSensorId.OnPageEntered)) as BrainTileSensorDef;

    const tiles = List.from<IBrainTileDef>([notOpDef, sensorDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "unaryOp");
    if (expr.kind === "unaryOp") {
      assert.equal(expr.operator.op.id, CoreOpId.Not);
      assert.equal(expr.operand.kind, "sensor");
      if (expr.operand.kind === "sensor") {
        assert.equal(expr.operand.tileDef.sensorId, CoreSensorId.OnPageEntered);
      }
    }
  });

  test("Test 52: Incomplete [not] -> non-inline sensors suggested", () => {
    const notOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Not)) as BrainTileOperatorDef;
    const tiles = List.from<IBrainTileDef>([notOpDef]);
    const expr = parseTilesForSuggestions(tiles);

    const result = suggestTiles({ ruleSide: RuleSide.When, expr }, catalogList());

    const sensorTileId = mkSensorTileId(CoreSensorId.OnPageEntered);
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === sensorTileId) !== undefined,
      "[not] _ should include non-inline sensors"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.kind === "sensor") !== undefined,
      "[not] _ should include inline sensors"
    );
    assert.ok(!listFind(result.exact, (s) => s.tileDef.kind === "actuator"), "[not] _ should NOT include actuators");
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.kind === "literal") !== undefined,
      "[not] _ should include literals"
    );
  });

  test("Test 53: Complete [not] [on-page-entered] -> Boolean infix operators", () => {
    const notOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Not)) as BrainTileOperatorDef;
    const sensorDef = services.tiles.get(mkSensorTileId(CoreSensorId.OnPageEntered)) as BrainTileSensorDef;

    const tiles = List.from<IBrainTileDef>([notOpDef, sensorDef]);
    const expr = parseTilesForSuggestions(tiles);

    const result = suggestTiles({ ruleSide: RuleSide.When, expr }, catalogList());

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.And)) !== undefined,
      "Should offer [and]"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Or)) !== undefined,
      "Should offer [or]"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.EqualTo)) !== undefined,
      "Should offer [==]"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Add)) === undefined,
      "Should NOT offer [+]"
    );
  });

  test("Test 54: [not] [sensor-with-args] -> call spec tiles suggested", () => {
    const modNearDef = new BrainTileModifierDef("test.near54", { visual: { label: "near" } });
    const modFarDef = new BrainTileModifierDef("test.far54", { visual: { label: "far" } });
    services.tiles.registerTileDef(modNearDef);
    services.tiles.registerTileDef(modFarDef);

    const callDef54 = mkCallDef(bag(choice(mod("test.near54"), mod("test.far54"))));
    const fnEntry54 = services.functions.register("test-see54", false, { exec: () => TRUE_VALUE }, callDef54);
    const seeDef = new BrainTileSensorDef("test-see54", fnEntry54, CoreTypeIds.Boolean, {
      placement: TilePlacement.WhenSide,
      visual: { label: "see" },
    });
    services.tiles.registerTileDef(seeDef);

    const notOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Not)) as BrainTileOperatorDef;
    const tiles = List.from<IBrainTileDef>([notOpDef, seeDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "unaryOp");
    const result = suggestTiles({ ruleSide: RuleSide.When, expr }, catalogList());

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === modNearDef.tileId) !== undefined,
      "Should offer [near] modifier"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === modFarDef.tileId) !== undefined,
      "Should offer [far] modifier"
    );
  });

  test("Test 55: [not] [sensor] [near] -> [far] excluded, no infix ops", () => {
    const notOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Not)) as BrainTileOperatorDef;
    const seeDef = services.tiles.get(mkSensorTileId("test-see54")) as BrainTileSensorDef;
    const modNearDef = services.tiles.get(mkModifierTileId("test.near54")) as BrainTileModifierDef;

    const tiles = List.from<IBrainTileDef>([notOpDef, seeDef, modNearDef]);
    const expr = parseTilesForSuggestions(tiles);

    const result = suggestTiles({ ruleSide: RuleSide.When, expr }, catalogList());

    const modFarDef = services.tiles.get(mkModifierTileId("test.far54")) as BrainTileModifierDef;
    assert.ok(
      !listFind(result.exact, (s) => s.tileDef.tileId === modFarDef.tileId),
      "[far] should be excluded by choice"
    );

    const hasInfix =
      listFind(result.exact, (s) => {
        if (s.tileDef.kind !== "operator") return false;
        return (s.tileDef as BrainTileOperatorDef).op.parse.fixity === "infix";
      }) !== undefined;
    assert.ok(!hasInfix, "Should NOT offer infix operators after modifier");
  });

  test("Test 56: Replace operand in [not] [sensor] -> expression tiles including sensors", () => {
    const notOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Not)) as BrainTileOperatorDef;
    const sensorDef = services.tiles.get(mkSensorTileId(CoreSensorId.OnPageEntered)) as BrainTileSensorDef;

    const tiles = List.from<IBrainTileDef>([notOpDef, sensorDef]);
    const expr = parseTilesForSuggestions(tiles);

    const result = suggestTiles({ ruleSide: RuleSide.When, expr, replaceTileIndex: 1 }, catalogList());

    assert.ok(listFind(result.exact, (s) => s.tileDef.kind === "literal") !== undefined, "Should include literals");
    assert.ok(listFind(result.exact, (s) => s.tileDef.kind === "sensor") !== undefined, "Should include sensors");
  });

  test("Test 57: Replace modifier inside [not] [sensor] [mod] -> action call arg tiles", () => {
    const notOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Not)) as BrainTileOperatorDef;
    const seeDef = services.tiles.get(mkSensorTileId("test-see54")) as BrainTileSensorDef;
    const modNearDef = services.tiles.get(mkModifierTileId("test.near54")) as BrainTileModifierDef;

    const tiles = List.from<IBrainTileDef>([notOpDef, seeDef, modNearDef]);
    const expr = parseTilesForSuggestions(tiles);

    const result = suggestTiles({ ruleSide: RuleSide.When, expr, replaceTileIndex: 2 }, catalogList());

    const modFarDef = services.tiles.get(mkModifierTileId("test.far54")) as BrainTileModifierDef;
    assert.ok(listFind(result.exact, (s) => s.tileDef.tileId === modFarDef.tileId) !== undefined, "Should offer [far]");
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === modNearDef.tileId) !== undefined,
      "Should offer [near]"
    );
  });

  test("Test 58: [1] [+] _ still excludes non-inline sensors", () => {
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as BrainTileOperatorDef;

    const tiles = List.from<IBrainTileDef>([numLitDef, addOpDef]);
    const expr = parseTilesForSuggestions(tiles);

    const result = suggestTiles({ ruleSide: RuleSide.When, expr }, catalogList());

    const sensorTileId = mkSensorTileId(CoreSensorId.OnPageEntered);
    const hasNonInlineSensor =
      listFind(result.exact, (s) => s.tileDef.tileId === sensorTileId) !== undefined ||
      listFind(result.withConversion, (s) => s.tileDef.tileId === sensorTileId) !== undefined;
    assert.ok(!hasNonInlineSensor, "[1] [+] _ should still NOT include non-inline sensors");
  });
});

// ---- Test 59-61: Capability requirements ----

describe("Capability requirements filtering", () => {
  test("Test 59: Tile with requirements excluded when capabilities not satisfied", () => {
    const requireBit = 5;
    const reqBitSet = new BitSet().set(requireBit);
    const reqLitDef = new BrainTileLiteralDef(
      CoreTypeIds.Number,
      { t: 3, v: 99 },
      {
        visual: { label: "guarded-99" },
        persist: false,
        valueLabel: "guarded-99",
        requirements: reqBitSet,
      }
    );
    services.tiles.registerTileDef(reqLitDef);

    // Undefined capabilities -> included (no filtering)
    const result1 = suggestTiles({ ruleSide: RuleSide.When }, catalogList());
    assert.ok(
      listFind(result1.exact, (s) => s.tileDef.tileId === reqLitDef.tileId) !== undefined,
      "Should be included when no filtering"
    );

    // Empty capabilities -> excluded
    const result2 = suggestTiles({ ruleSide: RuleSide.When, availableCapabilities: new BitSet() }, catalogList());
    assert.ok(
      listFind(result2.exact, (s) => s.tileDef.tileId === reqLitDef.tileId) === undefined,
      "Should be excluded when empty capabilities"
    );

    // Matching capabilities -> included
    const capBitSet = new BitSet().set(requireBit);
    const result3 = suggestTiles({ ruleSide: RuleSide.When, availableCapabilities: capBitSet }, catalogList());
    assert.ok(
      listFind(result3.exact, (s) => s.tileDef.tileId === reqLitDef.tileId) !== undefined,
      "Should be included when matching"
    );

    // Non-matching capabilities -> excluded
    const wrongCapBitSet = new BitSet().set(requireBit + 1);
    const result4 = suggestTiles({ ruleSide: RuleSide.When, availableCapabilities: wrongCapBitSet }, catalogList());
    assert.ok(
      listFind(result4.exact, (s) => s.tileDef.tileId === reqLitDef.tileId) === undefined,
      "Should be excluded when wrong bits"
    );

    services.tiles.delete(reqLitDef.tileId);
  });

  test("Test 61: Multi-bit requirements need all bits present", () => {
    const reqMulti = new BitSet().set(2).set(4);
    const multiLitDef = new BrainTileLiteralDef(
      CoreTypeIds.Number,
      { t: 3, v: 55 },
      {
        visual: { label: "multi-req" },
        persist: false,
        valueLabel: "multi-req",
        requirements: reqMulti,
      }
    );
    services.tiles.registerTileDef(multiLitDef);

    // Partial
    const result1 = suggestTiles(
      { ruleSide: RuleSide.When, availableCapabilities: new BitSet().set(2) },
      catalogList()
    );
    assert.ok(
      listFind(result1.exact, (s) => s.tileDef.tileId === multiLitDef.tileId) === undefined,
      "Partial capabilities should exclude"
    );

    // Full
    const result2 = suggestTiles(
      { ruleSide: RuleSide.When, availableCapabilities: new BitSet().set(2).set(4) },
      catalogList()
    );
    assert.ok(
      listFind(result2.exact, (s) => s.tileDef.tileId === multiLitDef.tileId) !== undefined,
      "Full capabilities should include"
    );

    // Superset
    const result3 = suggestTiles(
      { ruleSide: RuleSide.When, availableCapabilities: new BitSet().set(2).set(3).set(4) },
      catalogList()
    );
    assert.ok(
      listFind(result3.exact, (s) => s.tileDef.tileId === multiLitDef.tileId) !== undefined,
      "Superset should include"
    );

    services.tiles.delete(multiLitDef.tileId);
  });
});

// ---- Test 62-65: Struct-specific operator and accessor tests ----

describe("Struct-specific operator and accessor behavior", () => {
  let posStructTypeId: string;
  let accessorXDef: BrainTileAccessorDef;
  let accessorYDef: BrainTileAccessorDef;
  let accessorMagDef: BrainTileAccessorDef;
  let posVarDef: BrainTileVariableDef;

  before(() => {
    posStructTypeId = services.types.addStructType("Position62", {
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number },
        { name: "y", typeId: CoreTypeIds.Number },
        { name: "mag", typeId: CoreTypeIds.Number },
      ]),
    });
    accessorXDef = new BrainTileAccessorDef(posStructTypeId, "x", CoreTypeIds.Number, { visual: { label: "x" } });
    accessorYDef = new BrainTileAccessorDef(posStructTypeId, "y", CoreTypeIds.Number, { visual: { label: "y" } });
    accessorMagDef = new BrainTileAccessorDef(posStructTypeId, "mag", CoreTypeIds.Number, {
      visual: { label: "mag" },
      readOnly: true,
    });
    services.tiles.registerTileDef(accessorXDef);
    services.tiles.registerTileDef(accessorYDef);
    services.tiles.registerTileDef(accessorMagDef);

    posVarDef = new BrainTileVariableDef("test.posVar62", "my_position", posStructTypeId, "var-pos-62");
    services.tiles.registerTileDef(posVarDef);

    services.operatorOverloads.binary(
      CoreOpId.Assign,
      posStructTypeId,
      posStructTypeId,
      posStructTypeId,
      { exec: (_ctx: ExecutionContext, _args: MapValue) => NIL_VALUE },
      false
    );
  });

  test("Test 62: Struct variable with operatorOverloads -> assign + accessors", () => {
    const varExpr: VariableExpr = { nodeId: 0, kind: "variable", tileDef: posVarDef, span: { from: 0, to: 0 } };
    const result = suggestTiles({ ruleSide: RuleSide.Do, expr: varExpr }, catalogList());

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Assign)) !== undefined,
      "assign should be suggested"
    );
    assert.ok(resultContains(result, accessorXDef.tileId), "accessor 'x' should be suggested");
    assert.ok(resultContains(result, accessorYDef.tileId), "accessor 'y' should be suggested");
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Add)) === undefined,
      "add should NOT be suggested for struct"
    );
  });

  test("Test 64: Read-only accessor -> assignment NOT suggested", () => {
    const fieldAccessExpr: FieldAccessExpr = {
      nodeId: 0,
      kind: "fieldAccess",
      object: { nodeId: 1, kind: "variable", tileDef: posVarDef, span: { from: 0, to: 1 } },
      accessor: accessorMagDef,
      span: { from: 0, to: 2 },
    };
    const result = suggestTiles({ ruleSide: RuleSide.Do, expr: fieldAccessExpr }, catalogList());

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Assign)) === undefined,
      "assign should NOT be suggested after read-only field"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Add)) !== undefined,
      "add should still be suggested"
    );
  });

  test("Test 65: parseTilesForSuggestions [$pos] [mag] -> assign excluded (read-only)", () => {
    const tiles = List.from<IBrainTileDef>([posVarDef, accessorMagDef]);
    const expr = parseTilesForSuggestions(tiles);

    assert.equal(expr.kind, "fieldAccess");
    if (expr.kind === "fieldAccess") {
      assert.ok(expr.accessor.readOnly === true, "Accessor should be read-only");

      const result = suggestTiles({ ruleSide: RuleSide.Do, expr }, catalogList());
      assert.ok(
        listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Assign)) === undefined,
        "assign should NOT be suggested after read-only [mag]"
      );

      // Non-readOnly accessor on same struct should still allow assign
      const tiles2 = List.from<IBrainTileDef>([posVarDef, accessorXDef]);
      const expr2 = parseTilesForSuggestions(tiles2);
      const result2 = suggestTiles({ ruleSide: RuleSide.Do, expr: expr2 }, catalogList());
      assert.ok(
        listFind(result2.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Assign)) !== undefined,
        "assign should be suggested after non-readOnly [x]"
      );
    }
  });
});

// ---- Test 66-73: Parentheses / countUnclosedParens ----

describe("Parentheses (countUnclosedParens and close-paren suggestions)", () => {
  test("Test 66: countUnclosedParens utility", () => {
    const openParen = services.tiles.get(mkControlFlowTileId(CoreControlFlowId.OpenParen))!;
    const closeParen = services.tiles.get(mkControlFlowTileId(CoreControlFlowId.CloseParen))!;
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as IBrainTileDef;

    assert.equal(countUnclosedParens(List.empty<IBrainTileDef>()), 0, "empty list -> 0");
    assert.equal(countUnclosedParens(List.from([openParen])), 1, "[(] -> 1");
    assert.equal(countUnclosedParens(List.from([openParen, numLitDef, closeParen])), 0, "[(] [2] [)] -> 0");
    assert.equal(countUnclosedParens(List.from<IBrainTileDef>([openParen, numLitDef])), 1, "[(] [2] -> 1");
    assert.equal(
      countUnclosedParens(List.from<IBrainTileDef>([openParen, openParen, numLitDef])),
      2,
      "[(] [(] [2] -> 2"
    );
    assert.equal(
      countUnclosedParens(List.from<IBrainTileDef>([openParen, openParen, numLitDef, closeParen])),
      1,
      "[(] [(] [2] [)] -> 1"
    );
    assert.equal(
      countUnclosedParens(
        List.from<IBrainTileDef>([openParen, openParen, numLitDef, closeParen, addOpDef, numLitDef, closeParen])
      ),
      0,
      "fully balanced nested -> 0"
    );
  });

  test("Test 67: [(] [2] _ -> close paren suggested, actuators excluded", () => {
    const openParen = services.tiles.get(mkControlFlowTileId(CoreControlFlowId.OpenParen))!;
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;

    const tiles = List.from<IBrainTileDef>([openParen, numLitDef]);
    const expr = parseTilesForSuggestions(tiles);
    const depth = countUnclosedParens(tiles);

    assert.equal(depth, 1);
    const result = suggestTiles({ ruleSide: RuleSide.Either, expr, unclosedParenDepth: depth }, catalogList());

    const closeParenId = mkControlFlowTileId(CoreControlFlowId.CloseParen);
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === closeParenId) !== undefined,
      "Close paren should be suggested"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkOperatorTileId(CoreOpId.Add)) !== undefined,
      "Infix operators should be available"
    );
    assert.ok(
      !listFind(result.exact, (s) => s.tileDef.kind === "actuator"),
      "Actuators should NOT be suggested inside parens"
    );
  });

  test("Test 68: [(] _ (empty) -> no actuators, no non-inline sensors", () => {
    const openParen = services.tiles.get(mkControlFlowTileId(CoreControlFlowId.OpenParen))!;
    const tiles = List.from<IBrainTileDef>([openParen]);
    const expr = parseTilesForSuggestions(tiles);
    const depth = countUnclosedParens(tiles);

    assert.equal(depth, 1);
    const result = suggestTiles({ ruleSide: RuleSide.Either, expr, unclosedParenDepth: depth }, catalogList());

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.kind === "literal") !== undefined,
      "Literals should be suggested"
    );
    assert.ok(
      !listFind(result.exact, (s) => s.tileDef.kind === "actuator"),
      "Actuators should NOT be suggested inside parens"
    );
    assert.ok(
      !listFind(
        result.exact,
        (s) => s.tileDef.kind === "sensor" && (s.tileDef.placement === undefined || (s.tileDef.placement! & 16) === 0)
      ),
      "Non-inline sensors should NOT be suggested inside parens"
    );
  });

  test("Test 69: Balanced parens (depth=0) -> no close paren", () => {
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;

    const litExpr: LiteralExpr = { nodeId: 0, kind: "literal", tileDef: numLitDef, span: { from: 0, to: 1 } };
    const result = suggestTiles({ ruleSide: RuleSide.Do, expr: litExpr, unclosedParenDepth: 0 }, catalogList());

    const closeParenId = mkControlFlowTileId(CoreControlFlowId.CloseParen);
    assert.ok(
      !listFind(result.exact, (s) => s.tileDef.tileId === closeParenId),
      "Close paren should NOT be suggested when depth 0"
    );
  });

  test("Test 70: [(] [2] [+] _ -> incomplete inside parens, actuators excluded", () => {
    const openParen = services.tiles.get(mkControlFlowTileId(CoreControlFlowId.OpenParen))!;
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;
    const addOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Add)) as IBrainTileDef;

    const tiles = List.from<IBrainTileDef>([openParen, numLitDef, addOpDef]);
    const expr = parseTilesForSuggestions(tiles);
    const depth = countUnclosedParens(tiles);

    assert.equal(depth, 1);
    const result = suggestTiles({ ruleSide: RuleSide.Either, expr, unclosedParenDepth: depth }, catalogList());

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.kind === "literal") !== undefined,
      "Literals should be suggested"
    );
    assert.ok(!listFind(result.exact, (s) => s.tileDef.kind === "actuator"), "Actuators should NOT be suggested");
    assert.ok(
      !listFind(result.exact, (s) => s.tileDef.tileId === mkControlFlowTileId(CoreControlFlowId.CloseParen)),
      "Close paren should NOT be suggested when expression incomplete"
    );
  });

  test("Test 71: countUnclosedParens with excludeIndex", () => {
    const openParen = services.tiles.get(mkControlFlowTileId(CoreControlFlowId.OpenParen))!;
    const closeParen = services.tiles.get(mkControlFlowTileId(CoreControlFlowId.CloseParen))!;
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;

    const tiles = List.from<IBrainTileDef>([openParen, numLitDef, closeParen]);
    assert.equal(countUnclosedParens(tiles, 2), 1, "excluding close paren -> 1");
    assert.equal(countUnclosedParens(tiles, 0), 0, "excluding open paren -> 0");
    assert.equal(countUnclosedParens(tiles), 0, "no exclude -> 0");
  });

  test("Test 72: Replace close paren in [(] [2] [)] -> infix ops + close paren", () => {
    const openParen = services.tiles.get(mkControlFlowTileId(CoreControlFlowId.OpenParen))!;
    const closeParen = services.tiles.get(mkControlFlowTileId(CoreControlFlowId.CloseParen))!;
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;

    const tiles = List.from<IBrainTileDef>([openParen, numLitDef, closeParen]);
    const expr = parseTilesForSuggestions(tiles);
    const depth = countUnclosedParens(tiles, 2);

    assert.equal(depth, 1);
    const result = suggestTiles(
      {
        ruleSide: RuleSide.Either,
        expr,
        replaceTileIndex: 2,
        unclosedParenDepth: depth,
      },
      catalogList()
    );

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined,
      "Infix operators should be suggested"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkControlFlowTileId(CoreControlFlowId.CloseParen)) !==
        undefined,
      "Close paren should be suggested"
    );
    assert.ok(
      !listFind(result.exact, (s) => s.tileDef.kind === "actuator"),
      "Actuators should NOT be suggested inside parens"
    );
  });

  test("Test 73: Replace [divided by] in [(] [2] [divided by] -> close paren suggested", () => {
    const openParen = services.tiles.get(mkControlFlowTileId(CoreControlFlowId.OpenParen))!;
    const numLitDef = services.tiles
      .getAll()
      .toArray()
      .find(
        (t) => t.kind === "literal" && (t as BrainTileLiteralDef).valueType === CoreTypeIds.Number
      ) as BrainTileLiteralDef;
    const divOpDef = services.tiles.get(mkOperatorTileId(CoreOpId.Divide)) as IBrainTileDef;

    const tiles = List.from<IBrainTileDef>([openParen, numLitDef, divOpDef]);
    const expr = parseTilesForSuggestions(tiles);
    const depth = countUnclosedParens(tiles, 2);

    assert.equal(depth, 1);
    const result = suggestTiles(
      {
        ruleSide: RuleSide.Either,
        expr,
        replaceTileIndex: 2,
        unclosedParenDepth: depth,
      },
      catalogList()
    );

    assert.ok(
      listFind(result.exact, (s) => s.tileDef.kind === "operator") !== undefined,
      "Infix operators should be suggested"
    );
    assert.ok(
      listFind(result.exact, (s) => s.tileDef.tileId === mkControlFlowTileId(CoreControlFlowId.CloseParen)) !==
        undefined,
      "Close paren should be suggested when replacing operator inside unclosed parens"
    );
  });
});

// ---- Test 74-76: Replace repeated modifier, anon slot value ----

describe("Replace repeated modifier and anonymous slot value", () => {
  let richActuatorDef: BrainTileActuatorDef;
  let richCallDef: ReturnType<typeof mkCallDef>;
  let modFastDef: BrainTileModifierDef;
  let modSlowDef: BrainTileModifierDef;
  let slotFast: number;

  before(() => {
    modFastDef = services.tiles.get(mkModifierTileId("test.fast")) as BrainTileModifierDef;
    modSlowDef = services.tiles.get(mkModifierTileId("test.slow")) as BrainTileModifierDef;
    richActuatorDef = services.tiles.get(mkActuatorTileId("test-rich")) as BrainTileActuatorDef;
    richCallDef = richActuatorDef.fnEntry.callDef;
    slotFast = richCallDef.argSlots.toArray().find((s) => s.argSpec.tileId === mkModifierTileId("test.fast"))!.slotId;
  });

  test("Test 74: Replace repeated modifier preserves choice exclusion", () => {
    const modSlots74 = List.empty<SlotExpr>();
    modSlots74.push({
      slotId: slotFast,
      expr: { nodeId: 101, kind: "modifier", tileDef: modFastDef, span: { from: 1, to: 2 } },
    });
    modSlots74.push({
      slotId: slotFast,
      expr: { nodeId: 102, kind: "modifier", tileDef: modFastDef, span: { from: 2, to: 3 } },
    });
    const expr74: ActuatorExpr = {
      nodeId: 0,
      kind: "actuator",
      tileDef: richActuatorDef,
      anons: List.empty<SlotExpr>(),
      parameters: List.empty<SlotExpr>(),
      modifiers: modSlots74,
      span: { from: 0, to: 3 },
    };

    const result74 = suggestTiles({ ruleSide: RuleSide.Do, expr: expr74, replaceTileIndex: 2 }, catalogList());
    assert.ok(
      resultContains(result74, modFastDef.tileId),
      "modFast should be available when replacing one of two (max 2)"
    );
    assert.ok(
      !resultContains(result74, modSlowDef.tileId),
      "modSlow should NOT be available -- other [fast] still fills the choice"
    );
  });

  test("Test 75: Replace value in anonymous slot -> actuators excluded", () => {
    const anonNumParamId = "test.anonNum75";
    const anonNumParamDef = new BrainTileParameterDef(anonNumParamId, CoreTypeIds.Number, { visual: { label: "amt" } });
    services.tiles.registerTileDef(anonNumParamDef);

    const callDef75 = mkCallDef(bag(param(anonNumParamId, { anonymous: true })));
    const fnEntry75 = services.functions.register("test-anon75", false, { exec: () => VOID_VALUE }, callDef75);
    const actuatorDef75 = new BrainTileActuatorDef("test-anon75", fnEntry75, { visual: { label: "anon75" } });
    services.tiles.registerTileDef(actuatorDef75);

    const litDef = services.tiles
      .getAll()
      .toArray()
      .find((t) => t.kind === "literal" && getTileOutputType(t) === CoreTypeIds.Number) as BrainTileLiteralDef;
    const anonSlotId = callDef75.argSlots.get(0).slotId;
    const anonSlots75 = List.empty<SlotExpr>();
    anonSlots75.push({
      slotId: anonSlotId,
      expr: { nodeId: 50, kind: "literal", tileDef: litDef, span: { from: 1, to: 2 } },
    });

    const expr75: ActuatorExpr = {
      nodeId: 0,
      kind: "actuator",
      tileDef: actuatorDef75,
      anons: anonSlots75,
      parameters: List.empty<SlotExpr>(),
      modifiers: List.empty<SlotExpr>(),
      span: { from: 0, to: 2 },
    };

    const result75 = suggestTiles({ ruleSide: RuleSide.Do, expr: expr75, replaceTileIndex: 1 }, catalogList());

    assert.ok(
      listFind(result75.exact, (s) => getTileOutputType(s.tileDef) === CoreTypeIds.Number) !== undefined,
      "Should suggest Number tiles"
    );
    assert.ok(!listFind(result75.exact, (s) => s.tileDef.kind === "actuator"), "Actuators should NOT appear in exact");
    assert.ok(
      !listFind(result75.withConversion, (s) => s.tileDef.kind === "actuator"),
      "Actuators should NOT appear in withConversion"
    );
  });

  test("Test 76: Replace page tile in choice(AnonNumber, AnonString) -> page is exact match", () => {
    // The switch-page actuator has choice(AnonNumber, AnonString). A page tile
    // outputs String. The parser greedily assigns the page to AnonNumber (first
    // choice). When replacing, the system should still recognize String as an
    // exact match (via the AnonString sibling), not a conversion.
    const switchPageTileId = mkActuatorTileId(CoreActuatorId.SwitchPage);
    const switchPageTile = services.tiles.get(switchPageTileId) as BrainTileActuatorDef;
    assert.ok(switchPageTile, "switch-page actuator must exist");

    const pageDef = new BrainTilePageDef("test-page-76", "My Page");
    services.tiles.registerTileDef(pageDef);

    // Find the AnonNumber slot (first choice option) -- this is what the parser
    // would greedily assign a page tile to.
    const callDef = switchPageTile.fnEntry.callDef;
    const anonNumberSlot = callDef.argSlots.toArray().find((s) => s.argSpec.anonymous);
    assert.ok(anonNumberSlot, "switch-page should have an anonymous slot");

    // Build the AST: [switch page] [My Page]
    // The page tile is in the anon slot with AnonNumber's slotId (parser greediness).
    const anonSlots = List.empty<SlotExpr>();
    anonSlots.push({
      slotId: anonNumberSlot.slotId,
      expr: {
        nodeId: 50,
        kind: "literal",
        tileDef: pageDef as unknown as BrainTileLiteralDef,
        span: { from: 1, to: 2 },
      },
    });

    const expr76: ActuatorExpr = {
      nodeId: 0,
      kind: "actuator",
      tileDef: switchPageTile,
      anons: anonSlots,
      parameters: List.empty<SlotExpr>(),
      modifiers: List.empty<SlotExpr>(),
      span: { from: 0, to: 2 },
    };

    const result76 = suggestTiles({ ruleSide: RuleSide.Do, expr: expr76, replaceTileIndex: 1 }, catalogList());

    // Page tiles produce String, which should be an exact match for AnonString
    const pageInExact = listFind(result76.exact, (s) => s.tileDef.tileId === pageDef.tileId);
    assert.ok(pageInExact !== undefined, "Page tile should appear in exact suggestions");
    assert.equal(
      pageInExact?.compatibility,
      TileCompatibility.Exact,
      "Page tile should have Exact compatibility, not Conversion"
    );

    // String tiles in general should also be exact
    const stringInExact = listFind(
      result76.exact,
      (s) => s.tileDef.kind === "literal" && getTileOutputType(s.tileDef) === CoreTypeIds.String
    );
    assert.ok(stringInExact !== undefined, "String literals should be in exact");

    // Number tiles should also be exact (via AnonNumber sibling)
    const numberInExact = listFind(
      result76.exact,
      (s) => s.tileDef.kind === "literal" && getTileOutputType(s.tileDef) === CoreTypeIds.Number
    );
    assert.ok(numberInExact !== undefined, "Number literals should also be in exact");

    // Page tile should NOT appear in withConversion
    const pageInConversion = listFind(result76.withConversion, (s) => s.tileDef.tileId === pageDef.tileId);
    assert.ok(pageInConversion === undefined, "Page tile should NOT appear in withConversion");
  });
});
