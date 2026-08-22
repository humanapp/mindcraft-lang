import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, runtime } from "@wendoo-lang/core";
import type { BrainServices } from "@wendoo-lang/core/brain";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import type { ExecutionContext, Scheduler } from "@wendoo-lang/core/runtime";
import {
  HandleTable,
  mkBufferValueFromHex,
  mkNumberValue,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type Value,
  VmStatus,
} from "@wendoo-lang/core/runtime";
import { __test__createPlatformServices } from "@wendoo-lang/core/runtime/__test__";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { expectDiagnostic } from "../testsupport/diag-coverage.js";
import { compileUserTile } from "./compile.js";
import { LoweringDiagCode } from "./diag-codes.js";

let services: BrainServices;

function toVmServices(b: BrainServices) {
  return __test__createPlatformServices({ runtime: { functions: b.runtime.functions, types: b.runtime.types } })
    .runtime;
}

function mkCtx(): ExecutionContext {
  return {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  };
}

function mkScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

/** A sensor with one optional anonymous buffer arg whose onExecute body is `body`. */
function optionalBufferSensor(body: string): string {
  return `
import { Sensor, type Context, optional, param } from "wendoo";

export default Sensor({
  name: "presence-probe",
  args: [optional(param("packet", { type: "buffer", anonymous: true }))],
  onExecute(ctx: Context, args: { packet?: Buffer }): number | undefined {
    const b = args.packet;
    ${body}
  },
});
`;
}

/** A sensor with one optional anonymous arg of a primitive type. */
function optionalPrimitiveSensor(typeName: string, tsType: string, body: string): string {
  return `
import { Sensor, type Context, optional, param } from "wendoo";

export default Sensor({
  name: "presence-probe",
  args: [optional(param("v", { type: "${typeName}", anonymous: true }))],
  onExecute(ctx: Context, args: { v?: ${tsType} }): number | undefined {
    const n = args.v;
    ${body}
  },
});
`;
}

/** Compiles `source` (asserting zero diagnostics) and runs onExecute with one arg. */
function compileAndRunWithArg(source: string, arg: Value): Value {
  const result = compileUserTile(source, { projectNamespace: TEST_PROJECT_NAMESPACE, services });
  assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program, "expected program");

  const handles = new HandleTable(100);
  const vm = new runtime.VM(result.program!, toVmServices(services), { handles });
  const fiber = vm.spawnFiber(1, 0, List.from([arg]), mkCtx());
  fiber.instrBudget = 1000;

  const runResult = vm.runFiber(fiber, mkScheduler());
  assert.equal(runResult.status, VmStatus.DONE);
  assert.ok(runResult.result, "expected a return value");
  return runResult.result!;
}

function expectNumber(value: Value, expected: number): void {
  assert.equal(value.t, NativeType.Number, `expected a number, got ${JSON.stringify(value)}`);
  assert.equal((value as NumberValue).v, expected);
}

function expectNil(value: Value): void {
  assert.equal(value.t, NativeType.Nil, `expected nil, got ${JSON.stringify(value)}`);
}

/** Runs `body` against an absent arg, a present empty buffer, and bytes [42, 7, 9]. */
function runBufferMatrix(body: string): { absent: Value; empty: Value; packet: Value } {
  const source = optionalBufferSensor(body);
  return {
    absent: compileAndRunWithArg(source, NIL_VALUE),
    empty: compileAndRunWithArg(source, mkBufferValueFromHex("")),
    packet: compileAndRunWithArg(source, mkBufferValueFromHex("2a0709")),
  };
}

describe("optional-arg presence guards on a buffer arg", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("`if (!b) return;` guards absence; a present empty buffer passes", () => {
    const r = runBufferMatrix("if (!b) { return undefined; } return b.length() + 100;");
    expectNil(r.absent);
    expectNumber(r.empty, 100);
    expectNumber(r.packet, 103);
  });

  test("the defensive decoder guard: `if (!b || b.length() < 3 || b.get(0) !== MAGIC)`", () => {
    const source = `
import { Sensor, type Context, optional, param } from "wendoo";

export default Sensor({
  name: "presence-probe",
  args: [optional(param("packet", { type: "buffer", anonymous: true }))],
  onExecute(ctx: Context, args: { packet?: Buffer }): number | undefined {
    const PACKET_MAGIC = 42;
    const b = args.packet;
    if (!b || b.length() < 3 || b.get(0) !== PACKET_MAGIC) {
      return undefined;
    }
    return b.get(1) * 256 + b.get(2);
  },
});
`;
    expectNil(compileAndRunWithArg(source, NIL_VALUE));
    expectNil(compileAndRunWithArg(source, mkBufferValueFromHex("")));
    expectNumber(compileAndRunWithArg(source, mkBufferValueFromHex("2a0709")), 7 * 256 + 9);
  });

  test("`if (b)` is a presence test: a present empty buffer is truthy", () => {
    const r = runBufferMatrix("if (b) { return b.length() + 100; } return undefined;");
    expectNil(r.absent);
    expectNumber(r.empty, 100);
    expectNumber(r.packet, 103);
  });

  test("`b === undefined` lowers as a nil test on the optional buffer", () => {
    const r = runBufferMatrix("if (b === undefined) { return undefined; } return b.length() + 100;");
    expectNil(r.absent);
    expectNumber(r.empty, 100);
    expectNumber(r.packet, 103);
  });

  test("`b !== undefined` lowers as a negated nil test", () => {
    const r = runBufferMatrix("if (b !== undefined) { return b.length() + 100; } return undefined;");
    expectNil(r.absent);
    expectNumber(r.empty, 100);
    expectNumber(r.packet, 103);
  });

  test("ternary condition tests presence", () => {
    const r = runBufferMatrix("return b ? b.length() + 100 : undefined;");
    expectNil(r.absent);
    expectNumber(r.empty, 100);
    expectNumber(r.packet, 103);
  });

  test("`while (b)` tests presence", () => {
    const r = runBufferMatrix("while (b) { return b.length() + 100; } return undefined;");
    expectNil(r.absent);
    expectNumber(r.empty, 100);
    expectNumber(r.packet, 103);
  });

  test("`b && expr` short-circuits on absence, not on emptiness", () => {
    const r = runBufferMatrix("if (b && b.get(0) === 42) { return b.get(1); } return undefined;");
    expectNil(r.absent);
    expectNil(r.empty);
    expectNumber(r.packet, 7);
  });

  test("`b || fallback` keeps a present empty buffer", () => {
    const r = runBufferMatrix("const c = b || Buffer.from([9]); return c.length() + 100;");
    expectNumber(r.absent, 101);
    expectNumber(r.empty, 100);
    expectNumber(r.packet, 103);
  });

  test("guarding `args.packet` directly narrows later `args.packet` uses", () => {
    const r = runBufferMatrix("if (!args.packet) { return undefined; } return args.packet.length() + 100;");
    expectNil(r.absent);
    expectNumber(r.empty, 100);
    expectNumber(r.packet, 103);
  });

  test("a guarded buffer narrows as a call argument", () => {
    const r = runBufferMatrix("if (!b || b.length() < 1) { return undefined; } return Math.abs(b.get(0) - 50);");
    expectNil(r.absent);
    expectNil(r.empty);
    expectNumber(r.packet, 8);
  });
});

describe("optional-arg truthiness on primitive args", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("`if (n)` on an optional number keeps TypeScript truthiness (absent and 0 are falsy)", () => {
    const source = optionalPrimitiveSensor("number", "number", "if (n) { return n + 1; } return undefined;");
    expectNil(compileAndRunWithArg(source, NIL_VALUE));
    expectNil(compileAndRunWithArg(source, mkNumberValue(0)));
    expectNumber(compileAndRunWithArg(source, mkNumberValue(5)), 6);
  });

  test("`n === undefined` on an optional number distinguishes absence from 0", () => {
    const source = optionalPrimitiveSensor(
      "number",
      "number",
      "if (n === undefined) { return undefined; } return n + 1;"
    );
    expectNil(compileAndRunWithArg(source, NIL_VALUE));
    expectNumber(compileAndRunWithArg(source, mkNumberValue(0)), 1);
    expectNumber(compileAndRunWithArg(source, mkNumberValue(5)), 6);
  });

  test("`!n` on an optional number is diagnosed", () => {
    const source = optionalPrimitiveSensor("number", "number", "if (!n) { return undefined; } return n + 1;");
    const result = compileUserTile(source, { projectNamespace: TEST_PROJECT_NAMESPACE, services });
    assert.equal(result.diagnostics.length, 1);
    expectDiagnostic(result.diagnostics, LoweringDiagCode.NotOnNullablePrimitive);
  });

  test("`!s` on an optional string is diagnosed", () => {
    const source = optionalPrimitiveSensor("string", "string", "if (!n) { return undefined; } return 1;");
    const result = compileUserTile(source, { projectNamespace: TEST_PROJECT_NAMESPACE, services });
    assert.equal(result.diagnostics.length, 1);
    expectDiagnostic(result.diagnostics, LoweringDiagCode.NotOnNullablePrimitive);
  });

  test("`!flag` on an optional boolean is diagnosed", () => {
    const source = optionalPrimitiveSensor("boolean", "boolean", "if (!n) { return undefined; } return 1;");
    const result = compileUserTile(source, { projectNamespace: TEST_PROJECT_NAMESPACE, services });
    assert.equal(result.diagnostics.length, 1);
    expectDiagnostic(result.diagnostics, LoweringDiagCode.NotOnNullablePrimitive);
  });
});
