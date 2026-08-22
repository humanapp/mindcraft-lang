/**
 * Conversion tests -- verifies that the parser/type-checker correctly applies
 * implicit type conversions when tile argument types don't match their slots.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@wendoo/core";
import { type BrainServices, type IBrainTileDef, mkOperatorTileId } from "@wendoo/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { parseRule, runBrainLinkPipeline, TypeDiagCode } from "@wendoo/core/brain/compiler";
import { BrainDef } from "@wendoo/core/brain/model";
import {
  BrainTileAccessorDef,
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileParameterDef,
  BrainTileVariableDef,
} from "@wendoo/core/brain/tiles";
import {
  bag,
  type Conversion,
  CoreFuncId,
  CoreOpId,
  CoreParameterId,
  CoreTypeIds,
  choice,
  conversionFnName,
  type EnumSymbolDef,
  type EnumValue,
  type ExecutionContext,
  getSlotId,
  isBytecodeConversion,
  mkActionDescriptor,
  mkCallDef,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  Op,
  optional,
  param,
  type StringValue,
  TARGET_ACTION_ID_BASE,
  type TypeId,
  type Value,
  VOID_VALUE,
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";

let nextTestFnId = 2000;

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

let nextTypeAtomId = 20000;

function mkTestAtomId(): number {
  return nextTypeAtomId++;
}

function ensureEnumType(name: string, symbols: List<EnumSymbolDef>, defaultKey?: string): string {
  const registry = services.runtime.types;
  const existing = registry.resolveByName(name);
  if (existing) {
    return existing;
  }
  return registry.addEnumType(name, { atomId: mkTestAtomId(), symbols, defaultKey });
}

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    services: __test__createPlatformServices({ runtime: { types: services.runtime.types } }),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
    ...overrides,
  };
}

function execEnumConversion(fromType: string, toType: string, input: EnumValue) {
  const conversion = services.shared.conversions.get(fromType, toType);
  assert.ok(conversion, `Expected conversion ${fromType} -> ${toType}`);
  assert.ok(!isBytecodeConversion(conversion), `Expected a host-fn conversion ${fromType} -> ${toType}`);

  const fnEntry = services.runtime.functions.getSyncById(conversion.id);
  assert.ok(fnEntry, `Expected a registered host function for conversion ${fromType} -> ${toType}`);
  return fnEntry.fn.exec(mkCtx(), List.from([input as Value]));
}

function testConversion(
  label: string,
  actuatorCallDef: ReturnType<typeof mkCallDef>,
  literalType: string,
  literalValue: unknown,
  expectConversion: boolean,
  expectedToType?: string
): void {
  test(label, () => {
    const actuatorId = `test.conv.${Date.now()}.${Math.random()}`;
    const fnEntry = services.runtime.functions.register(
      nextTestFnId++,
      actuatorId,
      false,
      { exec: () => VOID_VALUE },
      actuatorCallDef
    );

    const sayTile = new BrainTileActuatorDef(actuatorId, mkActionDescriptor("actuator", fnEntry), {});
    const literal = new BrainTileLiteralDef(literalType, literalValue, {}, services);

    const tiles = List.from([sayTile as unknown, literal as unknown]) as List<never>;
    const emptyTiles = List.empty<never>();
    const catalogs = List.from([services.edit.tiles]);

    const result = parseRule(
      tiles,
      emptyTiles,
      catalogs,
      services.shared.conversions,
      services.runtime.types,
      services.app.localizer
    );
    const expr = result.parseResult.exprs.get(0);

    assert.equal(expr.kind, "actuator", "Expected actuator expression");
    if (expr.kind !== "actuator") return;

    assert.ok(expr.anons.size() > 0, "Expected anonymous slot");
    if (expr.anons.size() === 0) return;

    const anon = expr.anons.get(0);
    const typeInfo = result.typeInfo.typeEnv.get(anon.expr.nodeId);

    assert.ok(typeInfo !== undefined, "No TypeInfo found for anonymous slot expression");
    if (!typeInfo) return;

    const hasConversion = typeInfo.conversion !== undefined;

    if (expectConversion) {
      assert.ok(hasConversion, "Expected conversion but none applied");
      if (hasConversion && expectedToType) {
        assert.equal(
          typeInfo.conversion!.toType,
          expectedToType,
          `Expected conversion target ${expectedToType}, got ${typeInfo.conversion!.toType}`
        );
      }
    } else {
      assert.ok(
        !hasConversion,
        `Expected no conversion but got: ${typeInfo.conversion?.fromType} -> ${typeInfo.conversion?.toType}`
      );
    }
  });
}

describe("Conversion: action call arguments", () => {
  const AnonString = param(CoreParameterId.AnonymousString, { anonymous: true });
  const stringCallDef = mkCallDef(AnonString);

  testConversion(
    "Number literal -> AnonString slot (should convert Number->String)",
    stringCallDef,
    CoreTypeIds.Number,
    42,
    true,
    CoreTypeIds.String
  );

  testConversion(
    "String literal -> AnonString slot (no conversion needed)",
    stringCallDef,
    CoreTypeIds.String,
    "hello",
    false
  );

  testConversion(
    "Boolean literal -> AnonString slot (should convert Boolean->String)",
    stringCallDef,
    CoreTypeIds.Boolean,
    true,
    true,
    CoreTypeIds.String
  );

  const AnonNumber = param(CoreParameterId.AnonymousNumber, { anonymous: true });
  const numberCallDef = mkCallDef(AnonNumber);

  testConversion(
    "String literal -> AnonNumber slot (should convert String->Number)",
    numberCallDef,
    CoreTypeIds.String,
    "99",
    true,
    CoreTypeIds.Number
  );

  testConversion(
    "Boolean literal -> AnonNumber slot (should convert Boolean->Number)",
    numberCallDef,
    CoreTypeIds.Boolean,
    true,
    true,
    CoreTypeIds.Number
  );
});

describe("Conversion: bytecode-backed registrations", () => {
  const fromType = mkTypeId(NativeType.Struct, "ConversionSpecFakeFrom");
  const toType = mkTypeId(NativeType.Struct, "ConversionSpecFakeTo");

  function mkBytecodeConversion(): Conversion {
    return {
      binding: "bytecode",
      fromType,
      toType,
      cost: 2,
      descriptor: {
        key: "user.conversion.convspec00000001",
        kind: "conversion",
        callDef: mkCallDef(param("anon.number", { anonymous: true })),
        isAsync: false,
        outputType: toType,
      },
    };
  }

  test("registers and resolves by pair without a host-function registration", () => {
    const conv = services.shared.conversions.register(mkBytecodeConversion());
    try {
      assert.ok(isBytecodeConversion(conv));

      const found = services.shared.conversions.get(fromType, toType);
      assert.ok(found);
      assert.ok(isBytecodeConversion(found));
      assert.equal(found.descriptor.key, "user.conversion.convspec00000001");

      assert.equal(
        services.runtime.functions.get(conversionFnName(fromType, toType)),
        undefined,
        "a bytecode conversion registers no host function"
      );

      const path = services.shared.conversions.findBestPath(fromType, toType, 1);
      assert.ok(path);
      assert.equal(path.size(), 1);
    } finally {
      services.shared.conversions.remove(fromType, toType);
    }
  });

  test("a second registration of an already-held pair throws", () => {
    services.shared.conversions.register(mkBytecodeConversion());
    try {
      assert.throws(() => services.shared.conversions.register(mkBytecodeConversion()), /already exists/);
    } finally {
      services.shared.conversions.remove(fromType, toType);
    }
  });

  test("remove drops the pair and forEach no longer visits it", () => {
    services.shared.conversions.register(mkBytecodeConversion());
    let visits = 0;
    services.shared.conversions.forEach((conv) => {
      if (conv.fromType === fromType && conv.toType === toType) visits++;
    });
    assert.equal(visits, 1);

    assert.equal(services.shared.conversions.remove(fromType, toType), true);
    assert.equal(services.shared.conversions.get(fromType, toType), undefined);

    visits = 0;
    services.shared.conversions.forEach((conv) => {
      if (conv.fromType === fromType && conv.toType === toType) visits++;
    });
    assert.equal(visits, 0);
  });
});

describe("Conversion: assignment values", () => {
  let vecTypeId: TypeId;
  let accX: BrainTileAccessorDef;
  let numVar: BrainTileVariableDef;
  let vecVar: BrainTileVariableDef;
  let phantomVar: BrainTileVariableDef;
  let phantomAccX: BrainTileAccessorDef;
  let boolLit: BrainTileLiteralDef;

  before(() => {
    vecTypeId = services.runtime.types.addStructType("ConvAssignVec", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
    });
    accX = new BrainTileAccessorDef(vecTypeId, "x", CoreTypeIds.Number, { metadata: { label: "x" } });
    numVar = new BrainTileVariableDef("conv.assign.numVar", "conv_n", CoreTypeIds.Number, "conv-assign-num");
    vecVar = new BrainTileVariableDef("conv.assign.vecVar", "conv_vec", vecTypeId, "conv-assign-vec");
    // A struct type that is never registered in the type registry: its field
    // ids cannot be resolved, so a field store on it takes the name-keyed path.
    const phantomTypeId = mkTypeId(NativeType.Struct, "ConvAssignPhantom");
    phantomVar = new BrainTileVariableDef("conv.assign.phantomVar", "conv_p", phantomTypeId, "conv-assign-phantom");
    phantomAccX = new BrainTileAccessorDef(phantomTypeId, "x", CoreTypeIds.Number, { metadata: { label: "x" } });
    boolLit = new BrainTileLiteralDef(CoreTypeIds.Boolean, true, {}, services);
    for (const def of [accX, numVar, vecVar, phantomVar, phantomAccX, boolLit]) {
      services.edit.tiles.registerTileDef(def);
    }
  });

  function assignTile() {
    return services.edit.tiles.get(mkOperatorTileId(CoreOpId.Assign))!;
  }

  function typecheckDo(tiles: IBrainTileDef[]) {
    return parseRule(
      List.empty<IBrainTileDef>(),
      List.from(tiles),
      List.from([services.edit.tiles]),
      services.shared.conversions,
      services.runtime.types,
      services.app.localizer
    );
  }

  function diagCodes(result: ReturnType<typeof typecheckDo>): number[] {
    const codes: number[] = [];
    for (let i = 0; i < result.typeInfo.diags.size(); i++) {
      codes.push(result.typeInfo.diags.get(i).code as number);
    }
    return codes;
  }

  test("variable target: Boolean value converts to the variable's Number type", () => {
    const result = typecheckDo([numVar, assignTile(), boolLit]);
    assert.deepEqual(result.parseResult.diags.toArray(), []);
    assert.deepEqual(diagCodes(result), [TypeDiagCode.DataTypeConverted]);

    const expr = result.doParseResult.exprs.get(0);
    assert.equal(expr.kind, "assignment");
    if (expr.kind !== "assignment") return;
    const valueTypeInfo = result.typeInfo.typeEnv.get(expr.value.nodeId);
    assert.equal(valueTypeInfo?.conversion?.toType, CoreTypeIds.Number);
    assert.equal(result.typeInfo.typeEnv.get(expr.nodeId)?.inferred, CoreTypeIds.Number);
  });

  test("field target: Boolean value converts to the field's Number type", () => {
    const result = typecheckDo([vecVar, accX, assignTile(), boolLit]);
    assert.deepEqual(result.parseResult.diags.toArray(), []);
    assert.deepEqual(diagCodes(result), [TypeDiagCode.DataTypeConverted]);

    const expr = result.doParseResult.exprs.get(0);
    assert.equal(expr.kind, "assignment");
    if (expr.kind !== "assignment") return;
    const valueTypeInfo = result.typeInfo.typeEnv.get(expr.value.nodeId);
    assert.equal(valueTypeInfo?.conversion?.toType, CoreTypeIds.Number);
  });

  test("no conversion path still rejects with DataTypeMismatch", () => {
    const result = typecheckDo([numVar, assignTile(), vecVar]);
    assert.deepEqual(diagCodes(result), [TypeDiagCode.DataTypeMismatch]);

    const expr = result.doParseResult.exprs.get(0);
    assert.equal(expr.kind, "assignment");
    if (expr.kind !== "assignment") return;
    assert.equal(result.typeInfo.typeEnv.get(expr.value.nodeId)?.conversion, undefined);
  });

  test("assignment conversions are emitted for variable, id-field, and name-keyed field targets", () => {
    const brainDef = BrainDef.emptyBrainDef(services, "assignment conversion brain");
    const page = brainDef.pages().get(0)!;

    // Rule 1: [conv_n] [=] [true] -- variable store.
    const rule1 = page.children().get(0)!;
    __test__appendTile(rule1.do(), numVar);
    __test__appendTile(rule1.do(), assignTile());
    __test__appendTile(rule1.do(), boolLit);

    // Rule 2: [conv_vec] [x] [=] [true] -- id-based field store (concrete struct).
    const rule2 = page.appendNewRule()!;
    __test__appendTile(rule2.do(), vecVar);
    __test__appendTile(rule2.do(), accX);
    __test__appendTile(rule2.do(), assignTile());
    __test__appendTile(rule2.do(), boolLit);

    // Rule 3: [conv_p] [x] [=] [true] -- name-keyed field store (the base's
    // struct type is not in the registry, so no field id resolves and the
    // emitter takes the SET_FIELD fallback).
    const rule3 = page.appendNewRule()!;
    __test__appendTile(rule3.do(), phantomVar);
    __test__appendTile(rule3.do(), phantomAccX);
    __test__appendTile(rule3.do(), assignTile());
    __test__appendTile(rule3.do(), boolLit);

    const result = runBrainLinkPipeline(
      brainDef,
      {
        catalogs: List.from([services.edit.tiles]),
        actionResolver: services.runtime.actions,
        typeRegistry: services.runtime.types,
      },
      services.shared.conversions
    );
    assert.ok(result.program, "expected the brain to compile and link");

    let conversionCalls = 0;
    let idFieldStores = 0;
    let namedFieldStores = 0;
    const functions = result.program!.program.functions;
    for (let i = 0; i < functions.size(); i++) {
      const code = functions.get(i).code;
      for (let j = 0; j < code.size(); j++) {
        const instr = code.get(j);
        if (instr.op === Op.HOST_CALL && instr.a === CoreFuncId.ConvBooleanToNumber) conversionCalls++;
        if (instr.op === Op.STRUCT_SET_FIELD) idFieldStores++;
        if (instr.op === Op.SET_FIELD) namedFieldStores++;
      }
    }
    assert.equal(conversionCalls, 3, "each assignment target shape emits its conversion call");
    assert.equal(idFieldStores, 1, "the concrete-struct target stores by field id");
    assert.equal(namedFieldStores, 1, "the non-struct base target stores by field name");
  });
});

describe("Conversion: unary operator operands", () => {
  let uVecTypeId: TypeId;
  let uVecVar: BrainTileVariableDef;
  let uBoolLit: BrainTileLiteralDef;

  before(() => {
    uVecTypeId = services.runtime.types.addStructType("ConvUnaryVec", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
    });
    uVecVar = new BrainTileVariableDef("conv.unary.vecVar", "conv_uvec", uVecTypeId, "conv-unary-vec");
    uBoolLit = new BrainTileLiteralDef(CoreTypeIds.Boolean, true, {}, services);
    for (const def of [uVecVar, uBoolLit]) {
      services.edit.tiles.registerTileDef(def);
    }
  });

  function typecheckDo(tiles: IBrainTileDef[]) {
    return parseRule(
      List.empty<IBrainTileDef>(),
      List.from(tiles),
      List.from([services.edit.tiles]),
      services.shared.conversions,
      services.runtime.types,
      services.app.localizer
    );
  }

  test("[neg] [true]: the Boolean operand converts to Number", () => {
    const negTile = services.edit.tiles.get(mkOperatorTileId(CoreOpId.Negate))!;
    const result = typecheckDo([negTile, uBoolLit]);
    assert.deepEqual(result.parseResult.diags.toArray(), []);
    assert.equal(result.typeInfo.diags.size(), 1);
    assert.equal(result.typeInfo.diags.get(0).code, TypeDiagCode.DataTypeConverted);

    const expr = result.doParseResult.exprs.get(0);
    assert.equal(expr.kind, "unaryOp");
    if (expr.kind !== "unaryOp") return;
    const operandTypeInfo = result.typeInfo.typeEnv.get(expr.operand.nodeId);
    assert.equal(operandTypeInfo?.conversion?.toType, CoreTypeIds.Number);
    assert.equal(result.typeInfo.typeEnv.get(expr.nodeId)?.inferred, CoreTypeIds.Number);
  });

  test("unary operand with no conversion path still rejects", () => {
    const negTile = services.edit.tiles.get(mkOperatorTileId(CoreOpId.Negate))!;
    const result = typecheckDo([negTile, uVecVar]);
    assert.equal(result.typeInfo.diags.size(), 1);
    assert.equal(result.typeInfo.diags.get(0).code, TypeDiagCode.NoOverloadForUnaryOp);
  });
});

describe("Conversion: choice slots", () => {
  let posTypeId: TypeId;
  let deadTypeId: TypeId;
  let posVar: BrainTileVariableDef;
  let deadVar: BrainTileVariableDef;
  let chStrLit: BrainTileLiteralDef;
  let chBoolLit: BrainTileLiteralDef;
  let sendTile: BrainTileActuatorDef;
  let numFirstTile: BrainTileActuatorDef;
  let strFirstTile: BrainTileActuatorDef;
  let sendNumberSlot: number;
  let sendStringSlot: number;
  let sendBufferSlot: number;

  before(() => {
    posTypeId = services.runtime.types.addStructType("ConvChoicePos", {
      atomId: mkTestAtomId(),
      fields: List.from([
        { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
        { name: "y", typeId: CoreTypeIds.Number, fieldIndex: 1 },
      ]),
    });
    deadTypeId = services.runtime.types.addStructType("ConvChoiceDead", {
      atomId: mkTestAtomId(),
      fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
    });

    // Bytecode-backed struct -> Buffer conversion, the shape a user-code
    // Conversion registers.
    services.shared.conversions.register({
      binding: "bytecode",
      fromType: posTypeId,
      toType: CoreTypeIds.Buffer,
      cost: 2,
      descriptor: {
        key: "user.conversion.convchoice0001",
        kind: "conversion",
        callDef: mkCallDef(param(CoreParameterId.AnonymousNumber, { anonymous: true })),
        isAsync: false,
        outputType: CoreTypeIds.Buffer,
      },
    });

    const bufferParam = new BrainTileParameterDef("conv.choice.buffer", CoreTypeIds.Buffer, { hidden: true });
    services.edit.tiles.registerTileDef(bufferParam);

    const AnonNumber = param(CoreParameterId.AnonymousNumber, { anonymous: true });
    const AnonString = param(CoreParameterId.AnonymousString, { anonymous: true });
    const AnonBoolean = param(CoreParameterId.AnonymousBoolean, { anonymous: true });
    const AnonBuffer = param("conv.choice.buffer", { anonymous: true });

    // The radio-send shape: one optional value slot over a four-type choice.
    const sendCallDef = mkCallDef(bag(optional(choice(AnonNumber, AnonString, AnonBoolean, AnonBuffer))));
    sendNumberSlot = getSlotId(sendCallDef, AnonNumber);
    sendStringSlot = getSlotId(sendCallDef, AnonString);
    sendBufferSlot = getSlotId(sendCallDef, AnonBuffer);
    const sendFn = services.runtime.functions.register(
      nextTestFnId++,
      "conv-choice-send",
      false,
      { exec: () => VOID_VALUE },
      sendCallDef
    );
    sendTile = new BrainTileActuatorDef("conv-choice-send", mkActionDescriptor("actuator", sendFn), {
      metadata: { label: "choice send" },
    });

    const numFirstFn = services.runtime.functions.register(
      nextTestFnId++,
      "conv-choice-num-first",
      false,
      { exec: () => VOID_VALUE },
      mkCallDef(choice(param(CoreParameterId.AnonymousNumber, { anonymous: true }), AnonString))
    );
    numFirstTile = new BrainTileActuatorDef("conv-choice-num-first", mkActionDescriptor("actuator", numFirstFn), {
      metadata: { label: "num first" },
    });

    const strFirstFn = services.runtime.functions.register(
      nextTestFnId++,
      "conv-choice-str-first",
      false,
      { exec: () => VOID_VALUE },
      mkCallDef(choice(param(CoreParameterId.AnonymousString, { anonymous: true }), AnonNumber))
    );
    strFirstTile = new BrainTileActuatorDef("conv-choice-str-first", mkActionDescriptor("actuator", strFirstFn), {
      metadata: { label: "str first" },
    });

    posVar = new BrainTileVariableDef("conv.choice.posVar", "conv_pos", posTypeId, "conv-choice-pos");
    deadVar = new BrainTileVariableDef("conv.choice.deadVar", "conv_dead", deadTypeId, "conv-choice-dead");
    chStrLit = new BrainTileLiteralDef(CoreTypeIds.String, "hi", {}, services);
    chBoolLit = new BrainTileLiteralDef(CoreTypeIds.Boolean, true, {}, services);
    for (const def of [sendTile, numFirstTile, strFirstTile, posVar, deadVar, chStrLit, chBoolLit]) {
      services.edit.tiles.registerTileDef(def);
    }
  });

  function typecheckDo(tiles: IBrainTileDef[]) {
    return parseRule(
      List.empty<IBrainTileDef>(),
      List.from(tiles),
      List.from([services.edit.tiles]),
      services.shared.conversions,
      services.runtime.types,
      services.app.localizer
    );
  }

  function diagCodes(result: ReturnType<typeof typecheckDo>): number[] {
    const codes: number[] = [];
    for (let i = 0; i < result.typeInfo.diags.size(); i++) {
      codes.push(result.typeInfo.diags.get(i).code as number);
    }
    return codes;
  }

  /** The actuator's single anonymous slot entry and the value's TypeInfo. */
  function soleAnon(result: ReturnType<typeof typecheckDo>) {
    assert.deepEqual(result.parseResult.diags.toArray(), []);
    const expr = result.doParseResult.exprs.get(0);
    assert.equal(expr.kind, "actuator");
    if (expr.kind !== "actuator") throw new Error("unreachable");
    assert.equal(expr.anons.size(), 1, "the value fills exactly one slot");
    const anon = expr.anons.get(0);
    const typeInfo = result.typeInfo.typeEnv.get(anon.expr.nodeId);
    assert.ok(typeInfo, "the slot value has TypeInfo");
    return { anon, typeInfo: typeInfo! };
  }

  test("a struct value converts into the choice's Buffer option", () => {
    const result = typecheckDo([sendTile, posVar]);
    const { anon, typeInfo } = soleAnon(result);
    assert.deepEqual(diagCodes(result), [TypeDiagCode.DataTypeConverted]);
    assert.equal(typeInfo.conversion?.toType, CoreTypeIds.Buffer);
    assert.equal(anon.slotId, sendBufferSlot, "the value fills the Buffer option's slot");
  });

  test("an exact option match wins without a conversion", () => {
    // Number is declared first and String -> Number converts, but the exact
    // String option takes the value untouched.
    const result = typecheckDo([sendTile, chStrLit]);
    const { anon, typeInfo } = soleAnon(result);
    assert.deepEqual(diagCodes(result), []);
    assert.equal(typeInfo.conversion, undefined);
    assert.equal(anon.slotId, sendStringSlot);
  });

  test("a value convertible to two options takes the first-declared option", () => {
    // Boolean converts to Number and to String; declaration order decides.
    const numFirst = typecheckDo([numFirstTile, chBoolLit]);
    assert.deepEqual(diagCodes(numFirst), [TypeDiagCode.DataTypeConverted]);
    assert.equal(soleAnon(numFirst).typeInfo.conversion?.toType, CoreTypeIds.Number);

    const strFirst = typecheckDo([strFirstTile, chBoolLit]);
    assert.deepEqual(diagCodes(strFirst), [TypeDiagCode.DataTypeConverted]);
    assert.equal(soleAnon(strFirst).typeInfo.conversion?.toType, CoreTypeIds.String);
  });

  test("a value matching no option exactly or via conversion is a type mismatch", () => {
    const result = typecheckDo([sendTile, deadVar]);
    const { typeInfo } = soleAnon(result);
    assert.deepEqual(diagCodes(result), [TypeDiagCode.DataTypeMismatch]);
    assert.equal(typeInfo.conversion, undefined);
  });

  test("a parse-typed expression settles on its inferred type's exact option", () => {
    // [str] [+] [str] is untyped at parse time and lands in the first option's
    // slot; inference types it String and moves it to the String option.
    const add = services.edit.tiles.get(mkOperatorTileId(CoreOpId.Add))!;
    const result = typecheckDo([sendTile, chStrLit, add, chStrLit]);
    const { anon, typeInfo } = soleAnon(result);
    assert.deepEqual(diagCodes(result), []);
    assert.equal(typeInfo.conversion, undefined);
    assert.equal(anon.slotId, sendStringSlot, "the String-typed expression moves to the String option's slot");
  });

  test("the choice conversion is emitted as the conversion call", () => {
    services.runtime.actions.register({
      binding: "host",
      id: TARGET_ACTION_ID_BASE + 950,
      descriptor: numFirstTile.action,
      execSync: () => VOID_VALUE,
    });
    const brainDef = BrainDef.emptyBrainDef(services, "choice conversion brain");
    const rule = brainDef.pages().get(0)!.children().get(0)!;
    __test__appendTile(rule.do(), numFirstTile);
    __test__appendTile(rule.do(), chBoolLit);

    const result = runBrainLinkPipeline(
      brainDef,
      {
        catalogs: List.from([services.edit.tiles]),
        actionResolver: services.runtime.actions,
        typeRegistry: services.runtime.types,
      },
      services.shared.conversions
    );
    assert.ok(result.program, "expected the brain to compile and link");

    let conversionCalls = 0;
    const functions = result.program!.program.functions;
    for (let i = 0; i < functions.size(); i++) {
      const code = functions.get(i).code;
      for (let j = 0; j < code.size(); j++) {
        const instr = code.get(j);
        if (instr.op === Op.HOST_CALL && instr.a === CoreFuncId.ConvBooleanToNumber) conversionCalls++;
      }
    }
    assert.equal(conversionCalls, 1, "the choice slot fill emits its conversion call");
  });
});

describe("Conversion: enum values", () => {
  test("string enum registers a direct enum-to-string conversion", () => {
    const typeId = ensureEnumType(
      "ConversionSpecStringEnum",
      List.from([
        { key: "On", label: "On", value: "on" },
        { key: "Off", label: "Off", value: "off" },
      ]),
      "On"
    );

    const path = services.shared.conversions.findBestPath(typeId, CoreTypeIds.String, 1);
    assert.ok(path);
    assert.equal(path.size(), 1);

    const result = execEnumConversion(typeId, CoreTypeIds.String, {
      t: NativeType.Enum,
      typeId,
      v: "On",
    });

    assert.equal(result.t, NativeType.String);
    assert.equal((result as StringValue).v, "on");
  });

  test("numeric enum registers direct enum-to-number and enum-to-string conversions", () => {
    const typeId = ensureEnumType(
      "ConversionSpecNumericEnum",
      List.from([
        { key: "Up", label: "Up", value: 0 },
        { key: "Down", label: "Down", value: 1 },
      ]),
      "Up"
    );

    const numberPath = services.shared.conversions.findBestPath(typeId, CoreTypeIds.Number, 1);
    assert.ok(numberPath);
    assert.equal(numberPath.size(), 1);

    const stringPath = services.shared.conversions.findBestPath(typeId, CoreTypeIds.String, 1);
    assert.ok(stringPath);
    assert.equal(stringPath.size(), 1);

    const numberResult = execEnumConversion(typeId, CoreTypeIds.Number, {
      t: NativeType.Enum,
      typeId,
      v: "Up",
    });
    assert.equal(numberResult.t, NativeType.Number);
    assert.equal((numberResult as NumberValue).v, 0);

    const stringResult = execEnumConversion(typeId, CoreTypeIds.String, {
      t: NativeType.Enum,
      typeId,
      v: "Down",
    });
    assert.equal(stringResult.t, NativeType.String);
    assert.equal((stringResult as StringValue).v, "1");
  });

  test("string enum does not expose enum-to-number conversion", () => {
    const typeId = ensureEnumType(
      "ConversionSpecNoNumericEnum",
      List.from([
        { key: "North", label: "North", value: "north" },
        { key: "South", label: "South", value: "south" },
      ]),
      "North"
    );

    const path = services.shared.conversions.findBestPath(typeId, CoreTypeIds.Number, 1);
    assert.equal(path, undefined);
  });

  test("empty enums do not expose enum conversions", () => {
    const typeId = ensureEnumType("ConversionSpecEmptyEnum", List.empty<EnumSymbolDef>());

    const stringPath = services.shared.conversions.findBestPath(typeId, CoreTypeIds.String, 1);
    const numberPath = services.shared.conversions.findBestPath(typeId, CoreTypeIds.Number, 1);

    assert.equal(stringPath, undefined);
    assert.equal(numberPath, undefined);
  });
});
