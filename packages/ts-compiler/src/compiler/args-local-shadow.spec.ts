import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, type ReadonlyList, runtime } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/runtime";
import {
  ContextTypeIds,
  CoreTypeIds,
  HandleTable,
  mkBooleanValue,
  mkNumberValue,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile } from "./compile.js";

let services: BrainServices;

/** The last value passed to `ctx.record(...)` by an actuator body under test. */
let recorded: Value | undefined;

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

function compile(source: string) {
  const ambientSource = buildAmbientDeclarations(services.runtime.types);
  return compileUserTile(source, {
    ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
    services,
  });
}

/** Compiles `source` (asserting zero diagnostics), runs onExecute with the given arg values, and returns the result. */
function runReturningValues(source: string, argValues: Value[]): Value {
  const result = compile(source);
  assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program, "expected program");

  const handles = new HandleTable(100);
  const vm = new runtime.VM(result.program!, toVmServices(services), { handles });
  const fiber = vm.spawnFiber(1, 0, List.from(argValues), mkCtx());
  fiber.instrBudget = 1000;

  const runResult = vm.runFiber(fiber, mkScheduler());
  assert.equal(runResult.status, VmStatus.DONE);
  assert.ok(runResult.result, "expected a return value");
  return runResult.result!;
}

/** Compiles `source` (asserting zero diagnostics), runs onExecute with number args, and returns the fiber result. */
function runReturning(source: string, args: number[]): Value {
  return runReturningValues(
    source,
    args.map((n) => mkNumberValue(n))
  );
}

/** Compiles and runs an actuator whose body calls `ctx.record(...)`, returning the recorded value. */
function runActuator(source: string, args: number[]): Value | undefined {
  recorded = undefined;
  const result = compile(source);
  assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program, "expected program");

  const handles = new HandleTable(100);
  const vm = new runtime.VM(result.program!, toVmServices(services), { handles });
  const fiber = vm.spawnFiber(1, 0, List.from(args.map((n) => mkNumberValue(n))), mkCtx());
  fiber.instrBudget = 1000;

  const runResult = vm.runFiber(fiber, mkScheduler());
  assert.equal(runResult.status, VmStatus.DONE);
  return recorded;
}

function expectNumber(value: Value | undefined, expected: number): void {
  assert.ok(value, "expected a value");
  assert.equal(value!.t, NativeType.Number, `expected a number, got ${JSON.stringify(value)}`);
  assert.equal((value as NumberValue).v, expected);
}

/** A sensor with two number args `a` and `b`, whose onExecute body is `body`. */
function twoArgSensor(body: string): string {
  return `
import { Sensor, type Context, param } from "mindcraft";

export default Sensor({
  name: "shadow-probe",
  args: [param("a", { type: "number" }), param("b", { type: "number" })],
  onExecute(ctx: Context, args: { a: number; b: number }): number {
    ${body}
  },
});
`;
}

/** An actuator with two number args `a` and `b`, whose onExecute body is `body`. */
function twoArgActuator(body: string): string {
  return `
import { Actuator, type Context, param } from "mindcraft";

export default Actuator({
  name: "shadow-actuator",
  args: [param("a", { type: "number" }), param("b", { type: "number" })],
  onExecute(ctx: Context, args: { a: number; b: number }): void {
    ${body}
  },
});
`;
}

describe("a local shadowing an arg name resolves independently of the arg (sensor)", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("a bare `a` reads the local; `args.a` still reads the argument", () => {
    // With args a=3, b=5 and local a=7: a bare `a` must be the local (7), and
    // `args.a`/`args.b` must be the arguments. Correct: 3*100 + 5*10 + 7 = 357.
    const value = runReturning(twoArgSensor("const a = 7;\n    return args.a * 100 + args.b * 10 + a;"), [3, 5]);
    expectNumber(value, 357);
  });

  test("a local shadowing `a` used before `args.a` still keeps them distinct", () => {
    const value = runReturning(twoArgSensor("const a = 7;\n    const both = a + args.a;\n    return both;"), [3, 5]);
    expectNumber(value, 10);
  });

  test("reassigning the shadowing local does not touch the argument", () => {
    const value = runReturning(
      twoArgSensor("let a = 7;\n    a = a + 1;\n    return args.a * 100 + args.b * 10 + a;"),
      [3, 5]
    );
    expectNumber(value, 358);
  });

  test("a nested function captures the shadowing local, not the arg", () => {
    const value = runReturning(
      twoArgSensor(
        "const a = 7;\n    function readA(): number { return a; }\n    return args.a * 100 + args.b * 10 + readA();"
      ),
      [3, 5]
    );
    expectNumber(value, 357);
  });

  test("a non-shadowing local and both args all resolve (no regression)", () => {
    const value = runReturning(twoArgSensor("const held = 7;\n    return args.a * 100 + args.b * 10 + held;"), [3, 5]);
    expectNumber(value, 357);
  });

  test("pure args with no local resolve correctly (baseline)", () => {
    const value = runReturning(twoArgSensor("return args.a * 100 + args.b * 10;"), [3, 5]);
    expectNumber(value, 350);
  });

  test("a modifier arg and a same-named local stay distinct (the button-tile origin case)", () => {
    // Mirrors the gamepad `button` tile: `args.green` is whether the color word
    // is placed; the bare local `green` is the physical button-held state. With
    // the word placed (args.green true) but the button not held (local false),
    // `args.green` and a bare `green` must resolve independently.
    const source = `
import { Sensor, type Context, modifier } from "mindcraft";

export default Sensor({
  name: "modifier-shadow",
  args: [modifier("modifier.color.green", { label: "green" })],
  onExecute(ctx: Context, args: { green: boolean }): number {
    const green = false;
    let total = 0;
    if (args.green) total += 1000;
    if (green) total += 100;
    if (args.green && green) total += 10;
    return total;
  },
});
`;
    const value = runReturningValues(source, [mkBooleanValue(true)]);
    expectNumber(value, 1000);
  });
});

describe("a local shadowing an arg name resolves independently of the arg (actuator)", () => {
  before(() => {
    services = __test__createBrainServices();

    const { types, functions } = services.runtime;

    const hasRecord = (() => {
      const def = types.get(ContextTypeIds.Context);
      const methods = def && "methods" in def ? (def as { methods?: List<{ name: string }> }).methods : undefined;
      return methods?.some((m) => m.name === "record") ?? false;
    })();
    if (!hasRecord) {
      types.addStructMethods(
        ContextTypeIds.Context,
        List.from([
          {
            name: "record",
            params: List.from([{ name: "v", typeId: CoreTypeIds.Number }]),
            returnTypeId: CoreTypeIds.Void,
            isAsync: false,
          },
        ])
      );
    }

    if (!functions.get("Context.record")) {
      functions.register(
        6301,
        "Context.record",
        false,
        {
          exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
            // Host struct-method calls place the receiver at arg slot 0; the
            // first declared method parameter is at slot 1.
            recorded = args.get(1);
            return NIL_VALUE;
          },
        },
        { callSpec: { type: "bag", items: [] }, argSlots: List.empty<never>() }
      );
    }
  });

  test("a bare `a` reads the local; `args.a` still reads the argument", () => {
    const value = runActuator(twoArgActuator("const a = 7;\n    ctx.record(args.a * 100 + args.b * 10 + a);"), [3, 5]);
    expectNumber(value, 357);
  });

  test("a non-shadowing local and both args all resolve (no regression)", () => {
    const value = runActuator(
      twoArgActuator("const held = 7;\n    ctx.record(args.a * 100 + args.b * 10 + held);"),
      [3, 5]
    );
    expectNumber(value, 357);
  });
});
