import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { List } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import {
  CoreFuncId,
  createF32ProfileNumerics,
  type ExecutionContext,
  FALSE_VALUE,
  mkNumberValue,
  mkStringValue,
  NIL_VALUE,
  type NumberValue,
  type StringValue,
  type Value,
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";

const f32Services = __test__createBrainServices({ numerics: createF32ProfileNumerics() });
const f64Services = __test__createBrainServices();

const ctx: ExecutionContext = {
  services: __test__createPlatformServices(),
  getVariableBySlot: () => NIL_VALUE,
  setVariableBySlot: () => {},
  getSystemVarBySlot: () => NIL_VALUE,
  setSystemVarBySlot: () => {},
  time: 0,
  dt: 0,
  currentTick: 0,
};

function callNumeric(services: BrainServices, fnId: number, ...args: number[]): Value {
  const entry = services.runtime.functions.getSyncById(fnId);
  assert.ok(entry, `no sync host function registered for id ${fnId}`);
  return entry.fn.exec(ctx, List.from(args.map((n) => mkNumberValue(n) as Value)));
}

function callWith(services: BrainServices, fnId: number, args: Value[]): Value {
  const entry = services.runtime.functions.getSyncById(fnId);
  assert.ok(entry, `no sync host function registered for id ${fnId}`);
  return entry.fn.exec(ctx, List.from(args));
}

/** Asserts the result is a NumberValue whose bits match `expected` exactly. */
function assertNumberIs(result: Value, expected: number): void {
  const v = (result as NumberValue).v;
  assert.ok(Object.is(v, expected), `expected ${expected}, got ${v}`);
}

describe("f32 profile numerics -- operator results round to binary32", () => {
  const f = Math.fround;

  test("add result is the correctly-rounded f32 sum", () => {
    const a = f(0.1);
    const b = f(0.2);
    const result = callNumeric(f32Services, CoreFuncId.OpAddNumber, a, b);
    assertNumberIs(result, f(a + b));
    assert.notEqual((result as NumberValue).v, a + b);
  });

  test("subtract result is the correctly-rounded f32 difference", () => {
    const a = f(1 / 3);
    const b = f(1e-8);
    assertNumberIs(callNumeric(f32Services, CoreFuncId.OpSubtractNumber, a, b), f(a - b));
  });

  test("multiply result is the correctly-rounded f32 product", () => {
    const a = f(1 / 3);
    const result = callNumeric(f32Services, CoreFuncId.OpMultiplyNumber, a, a);
    assertNumberIs(result, f(a * a));
    assert.notEqual((result as NumberValue).v, a * a);
  });

  test("divide result is the correctly-rounded f32 quotient", () => {
    const result = callNumeric(f32Services, CoreFuncId.OpDivideNumber, 1, 3);
    assertNumberIs(result, f(1 / 3));
    assert.notEqual((result as NumberValue).v, 1 / 3);
  });

  test("modulo result rounds to f32", () => {
    const a = f(10.1);
    const b = f(3);
    assertNumberIs(callNumeric(f32Services, CoreFuncId.OpModuloNumber, a, b), f(a % b));
  });

  test("integer power is exact and the result is a binary32 value", () => {
    assertNumberIs(callNumeric(f32Services, CoreFuncId.OpPowerNumber, 2, 10), 1024);
    assertNumberIs(callNumeric(f32Services, CoreFuncId.OpPowerNumber, 10, 2), 100);
    const root = (callNumeric(f32Services, CoreFuncId.OpPowerNumber, 2, 0.5) as NumberValue).v;
    assert.ok(Object.is(root, f(root)), "result is a binary32 value");
    assert.ok(Math.abs(root - Math.SQRT2) < 1e-6, `expected near sqrt(2), got ${root}`);
  });

  test("negate result rounds to f32", () => {
    const a = f(0.1);
    assertNumberIs(callNumeric(f32Services, CoreFuncId.OpNegateNumber, a), f(-a));
  });

  test("f32 overflow rounds to Infinity instead of a finite f64", () => {
    const big = f(3.4e38);
    const result = callNumeric(f32Services, CoreFuncId.OpAddNumber, big, big);
    assertNumberIs(result, Number.POSITIVE_INFINITY);
  });

  test("bitwise result is stored at f32 precision", () => {
    // 2^26 - 1 needs 26 mantissa bits; binary32 has 24.
    const wide = 0x3ffffff;
    const result = callNumeric(f32Services, CoreFuncId.OpBitwiseOrNumber, wide, 0);
    assertNumberIs(result, f(wide));
    assert.notEqual((result as NumberValue).v, wide);
  });

  test("division by zero produces nil", () => {
    assert.equal(callNumeric(f32Services, CoreFuncId.OpDivideNumber, 1, 0), NIL_VALUE);
    assert.equal(callNumeric(f32Services, CoreFuncId.OpDivideNumber, 0, 0), NIL_VALUE);
  });

  test("modulo by zero produces nil", () => {
    assert.equal(callNumeric(f32Services, CoreFuncId.OpModuloNumber, 5, 0), NIL_VALUE);
  });

  test("NaN operands produce nil for arithmetic and false for comparison", () => {
    assert.equal(callNumeric(f32Services, CoreFuncId.OpAddNumber, Number.NaN, 1), NIL_VALUE);
    assert.equal(callNumeric(f32Services, CoreFuncId.OpLessThanNumber, Number.NaN, 1), FALSE_VALUE);
  });
});

describe("f32 profile numerics -- builtins and conversions", () => {
  const f = Math.fround;

  test("sqrt builtin is the correctly-rounded f32 square root", () => {
    const result = callNumeric(f32Services, CoreFuncId.MathSqrt, 2);
    assertNumberIs(result, f(Math.sqrt(2)));
    assert.notEqual((result as NumberValue).v, Math.sqrt(2));
  });

  test("string-to-number conversion parses at f32 precision with NaN -> 0", () => {
    const parsed = callWith(f32Services, CoreFuncId.ConvStringToNumber, [mkStringValue("0.1")]);
    assertNumberIs(parsed, f(0.1));
    const unparseable = callWith(f32Services, CoreFuncId.ConvStringToNumber, [mkStringValue("abc")]);
    assertNumberIs(unparseable, 0);
  });

  test("number-to-string conversion formats the f32 value", () => {
    const formatted = callWith(f32Services, CoreFuncId.ConvNumberToString, [mkNumberValue(f(0.25))]);
    assert.equal((formatted as StringValue).v, "0.25");
  });
});

describe("f64 profile numerics -- native double semantics unchanged", () => {
  test("arithmetic results keep full f64 precision", () => {
    assertNumberIs(callNumeric(f64Services, CoreFuncId.OpAddNumber, 0.1, 0.2), 0.1 + 0.2);
    assertNumberIs(callNumeric(f64Services, CoreFuncId.OpDivideNumber, 1, 3), 1 / 3);
    assertNumberIs(callNumeric(f64Services, CoreFuncId.OpMultiplyNumber, 1 / 3, 1 / 3), (1 / 3) * (1 / 3));
  });

  test("bitwise results keep the exact i32 value", () => {
    assertNumberIs(callNumeric(f64Services, CoreFuncId.OpBitwiseOrNumber, 0x3ffffff, 0), 0x3ffffff);
  });

  test("nil and NaN conventions are unchanged", () => {
    assert.equal(callNumeric(f64Services, CoreFuncId.OpDivideNumber, 1, 0), NIL_VALUE);
    assert.equal(callNumeric(f64Services, CoreFuncId.OpAddNumber, Number.NaN, 1), NIL_VALUE);
  });
});
