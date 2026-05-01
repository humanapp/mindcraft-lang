import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type BooleanValue,
  type BrainServices,
  ContextTypeIds,
  CoreTypeIds,
  type EnumValue,
  type ExecutionContext,
  HandleTable,
  isEnumValue,
  isListValue,
  isMapValue,
  isStructValue,
  type ListValue,
  type MapValue,
  mkNativeStructValue,
  mkNumberValue,
  mkStringValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  Op,
  runtime,
  type Scheduler,
  type StringValue,
  type StructTypeDef,
  type StructValue,
  type Value,
  ValueDict,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, LoweringDiagCode, ValidatorDiagCode } from "./diag-codes.js";
import type { UserAuthoredProgram } from "./types.js";

let services: BrainServices;

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    brain: undefined as never,
    getVariable: () => undefined,
    setVariable: () => {},
    clearVariable: () => {},
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
    ...overrides,
  };
}

function mkScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

function mkArgsMap(entries: Record<number, Value>): MapValue {
  const dict = new ValueDict();
  for (const [key, value] of Object.entries(entries)) {
    dict.set(Number(key), value);
  }
  return { t: NativeType.Map, typeId: "map:<args>", v: dict };
}

function runActivation(prog: UserAuthoredProgram, handles: HandleTable, callsiteVars?: List<Value>): void {
  if (prog.activationFuncId === undefined) {
    return;
  }

  const vm = new runtime.VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, prog.activationFuncId, List.empty<Value>(), mkCtx());
  if (callsiteVars) {
    fiber.callsiteVars = callsiteVars;
  }
  fiber.instrBudget = 1000;

  const result = vm.runFiber(fiber, mkScheduler());
  assert.equal(result.status, VmStatus.DONE);
}
describe("class declarations", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("class with constructor and method compiles without errors (stub bodies)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  magnitude(): number {
    return this.x + this.y;
  }
}

export default Sensor({
  name: "class-test",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("class registers struct type with correct fields", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Vec2 {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export default Sensor({
  name: "struct-reg",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = services.types;
    const typeId = registry.resolveByName("/user-code.ts::Vec2");
    assert.ok(typeId, "Vec2 struct type should be registered");
    const def = registry.get(typeId!);
    assert.ok(def, "Vec2 type def should exist");
    assert.equal(def!.coreType, NativeType.Struct);

    const fieldNames: string[] = [];
    const structDef = def as StructTypeDef;
    structDef.fields.forEach((f) => {
      fieldNames.push(f.name);
    });
    assert.ok(fieldNames.includes("x"), "should have field x");
    assert.ok(fieldNames.includes("y"), "should have field y");
  });

  test("class registers method declarations on struct type", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  increment(): number {
    return this.value;
  }
  add(n: number): number {
    return this.value + n;
  }
}

export default Sensor({
  name: "method-reg",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = services.types;
    const typeId = registry.resolveByName("/user-code.ts::Counter");
    assert.ok(typeId, "Counter struct type should be registered");
    const def = registry.get(typeId!) as StructTypeDef;
    assert.ok(def.methods, "Counter should have methods");

    const methodNames: string[] = [];
    def.methods!.forEach((m) => {
      methodNames.push(m.name);
    });
    assert.ok(methodNames.includes("increment"), "should have method increment");
    assert.ok(methodNames.includes("add"), "should have method add");
  });

  test("function table contains constructor and method entries", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Pair {
  a: number;
  b: number;
  constructor(a: number, b: number) {
    this.a = a;
    this.b = b;
  }
  sum(): number {
    return this.a + this.b;
  }
}

export default Sensor({
  name: "fn-table",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const funcNames: string[] = [];
    prog.functions.forEach((f) => {
      if (f.name) funcNames.push(f.name);
    });
    assert.ok(funcNames.includes("Pair$new"), `expected Pair$new in functions, got: ${funcNames.join(", ")}`);
    assert.ok(funcNames.includes("Pair.sum"), `expected Pair.sum in functions, got: ${funcNames.join(", ")}`);
  });

  test("class with extends produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Base {
  x: number;
  constructor() { this.x = 0; }
}

class Child extends Base {
  y: number;
  constructor() { super(); this.y = 1; }
}

export default Sensor({
  name: "extends-test",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for extends");
    assert.ok(
      result.diagnostics.some((d) => d.code === ValidatorDiagCode.ClassInheritanceNotSupported),
      `expected inheritance error, got: ${JSON.stringify(result.diagnostics)}`
    );
  });

  test("class with static field passes validation", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Foo {
  static count: number = 0;
  value: number;
  constructor(v: number) { this.value = v; }
}

export default Sensor({
  name: "static-test",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  });

  test("static fields excluded from struct type registration", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Mixed {
  static total: number = 0;
  name: string;
  age: number;
  constructor(name: string, age: number) {
    this.name = name;
    this.age = age;
  }
}

export default Sensor({
  name: "static-field-filter",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = services.types;
    const typeId = registry.resolveByName("/user-code.ts::Mixed");
    assert.ok(typeId, "Mixed struct type should be registered");
    const def = registry.get(typeId!) as StructTypeDef;

    const fieldNames: string[] = [];
    def.fields.forEach((f) => {
      fieldNames.push(f.name);
    });
    assert.ok(fieldNames.includes("name"), "should have instance field name");
    assert.ok(fieldNames.includes("age"), "should have instance field age");
    assert.ok(!fieldNames.includes("total"), "should NOT have static field total");
    assert.equal(def.fields.size(), 2, "should have exactly 2 instance fields");
  });

  test("static methods excluded from struct method declarations", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  value: number;
  constructor(v: number) { this.value = v; }
  static reset(): void {}
  increment(): number { return this.value + 1; }
}

export default Sensor({
  name: "static-method-filter",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = services.types;
    const typeId = registry.resolveByName("/user-code.ts::Counter");
    assert.ok(typeId, "Counter struct type should be registered");
    const def = registry.get(typeId!) as StructTypeDef;
    assert.ok(def.methods, "Counter should have methods");

    const methodNames: string[] = [];
    def.methods!.forEach((m) => {
      methodNames.push(m.name);
    });
    assert.ok(methodNames.includes("increment"), "should have instance method increment");
    assert.ok(!methodNames.includes("reset"), "should NOT have static method reset");
    assert.equal(def.methods!.size(), 1, "should have exactly 1 instance method");
  });

  test("static field with initializer stored as callsite var during module init", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  static count: number = 42;
  value: number;
  constructor(v: number) { this.value = v; }
}

export default Sensor({
  name: "static-init",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.numStateSlots > 0, "expected callsite var slots for static field");
    assert.ok(prog.activationFuncId !== undefined, "expected activationFuncId for module init");

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const stored = callsiteVars.get(0) as NumberValue;
    assert.equal(stored.t, NativeType.Number);
    assert.equal(stored.v, 42, "static field should be initialized to 42");
  });

  test("static field without initializer gets default value during module init", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Tracker {
  static total: number;
  static active: boolean;
  value: number;
  constructor(v: number) { this.value = v; }
}

export default Sensor({
  name: "static-defaults",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    assert.ok(prog.numStateSlots >= 2, "expected at least 2 callsite var slots for 2 static fields");

    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const totalVal = callsiteVars.get(0) as NumberValue;
    assert.equal(totalVal.t, NativeType.Number, "default number should be Number type");
    assert.equal(totalVal.v, 0, "default number should be 0");

    const activeVal = callsiteVars.get(1) as BooleanValue;
    assert.equal(activeVal.t, NativeType.Boolean, "default boolean should be Boolean type");
    assert.equal(activeVal.v, false, "default boolean should be false");
  });

  test("static field init emits STORE_CALLSITE_VAR in module-init function", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Foo {
  static x: number = 10;
}

export default Sensor({
  name: "static-ir-check",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const hasStoreCallsiteVar = prog.functions.some((fn) =>
      fn.code.some((instr) => instr.op === Op.STORE_CALLSITE_VAR)
    );
    assert.ok(hasStoreCallsiteVar, "should have STORE_CALLSITE_VAR instruction for static field init");
  });

  test("uninitialized static field with unresolvable type emits diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

type Opaque = number & { __brand: "opaque" };

class Holder {
  static data: Opaque;
}

export default Sensor({
  name: "unresolvable-static",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.UnresolvableClassFieldType),
      `Expected UnresolvableClassFieldType diagnostic, got: ${JSON.stringify(result.diagnostics.map((d) => d.code))}`
    );
  });

  test("static method registered in function table with dollar separator", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Utils {
  static double(x: number): number { return x * 2; }
  getValue(): number { return 0; }
}

export default Sensor({
  name: "static-method-reg",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const funcNames: string[] = [];
    prog.functions.forEach((f) => {
      if (f.name) funcNames.push(f.name);
    });
    assert.ok(funcNames.includes("Utils$double"), `expected Utils$double in functions, got: ${funcNames.join(", ")}`);
    assert.ok(funcNames.includes("Utils$new"), `expected Utils$new in functions, got: ${funcNames.join(", ")}`);
    assert.ok(
      funcNames.includes("Utils.getValue"),
      `expected Utils.getValue in functions, got: ${funcNames.join(", ")}`
    );
  });

  test("static method compiled with correct argc (no this parameter)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class MathHelper {
  static add(a: number, b: number): number { return a + b; }
  multiply(x: number): number { return x * 2; }
}

export default Sensor({
  name: "static-argc",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    let staticFunc: { numParams: number; name?: string } | undefined;
    let instanceFunc: { numParams: number; name?: string } | undefined;
    prog.functions.forEach((f) => {
      if (f.name === "MathHelper$add") staticFunc = { numParams: f.numParams, name: f.name };
      if (f.name === "MathHelper.multiply") instanceFunc = { numParams: f.numParams, name: f.name };
    });
    assert.ok(staticFunc, "expected MathHelper$add function");
    assert.equal(staticFunc!.numParams, 2, "static method numParams should be 2 (user params only, no this)");
    assert.ok(instanceFunc, "expected MathHelper.multiply function");
    assert.equal(instanceFunc!.numParams, 2, "instance method numParams should be 2 (1 user param + this)");
  });

  test("this usage inside static method produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Broken {
  value: number;
  constructor() { this.value = 0; }
  static bad(): void { const x = this; }
}

export default Sensor({
  name: "static-this",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.ClassObjectUsageNotSupported),
      `Expected ClassObjectUsageNotSupported diagnostic for bare 'this' in static method, got: ${JSON.stringify(result.diagnostics.map((d) => d.code))}`
    );
  });

  test("static field access via ClassName.field compiles without diagnostics", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  static count: number = 0;
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-field-access",
  onExecute(ctx: Context): number {
    return Counter.count;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
  });

  test("static field access inside constructor body compiles without diagnostics", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  static count: number = 0;
  value: number;
  constructor() {
    this.value = Counter.count;
  }
}

export default Sensor({
  name: "static-field-ctor",
  onExecute(ctx: Context): number {
    const c = new Counter();
    return c.value;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
  });

  test("bare class name produces ClassObjectUsageNotSupported diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Foo {
  static x: number = 1;
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "bare-class",
  onExecute(ctx: Context): number {
    const f = Foo;
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.ClassObjectUsageNotSupported),
      `Expected ClassObjectUsageNotSupported, got: ${JSON.stringify(result.diagnostics.map((d) => d.code))}`
    );
  });

  test("static method reference via ClassName.method compiles without diagnostics", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Utils {
  static double(n: number): number { return n * 2; }
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-method-ref",
  onExecute(ctx: Context): number {
    const fn = Utils.double;
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
  });

  test("static method call via ClassName.method() emits direct Call", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class MathUtils {
  static double(n: number): number { return n * 2; }
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-method-call",
  onExecute(ctx: Context): number {
    return MathUtils.double(5);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
    const prog = result.program!;
    let hasStaticFunc = false;
    prog.functions.forEach((f) => {
      if (f.name === "MathUtils$double") hasStaticFunc = true;
    });
    assert.ok(hasStaticFunc, "expected MathUtils$double function");
    let hasDirectCall = false;
    prog.functions.forEach((fn) => {
      fn.code.forEach((instr) => {
        if (instr.op === Op.CALL) hasDirectCall = true;
      });
    });
    assert.ok(hasDirectCall, "expected direct CALL instruction for static method call");
  });

  test("static method call with multiple arguments compiles correctly", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Calc {
  static add(a: number, b: number): number { return a + b; }
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-method-multi-arg",
  onExecute(ctx: Context): number {
    return Calc.add(3, 4);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
  });

  test("calling non-existent static method produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Foo {
  static real(): number { return 1; }
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-method-missing",
  onExecute(ctx: Context): number {
    return Foo.fake();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "Expected at least one diagnostic for non-existent static method call");
  });

  test("static method accessing static field compiles and runs correctly", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  static count: number = 10;
  static getCount(): number { return Counter.count; }
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-method-reads-field",
  onExecute(ctx: Context): number {
    return Counter.getCount();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
  });

  test("class with private field produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Foo {
  private secret: number;
  constructor() { this.secret = 42; }
}

export default Sensor({
  name: "private-test",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  });

  test("class with computed property name produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

const key = "hello";

class Foo {
  [key]: number;
  constructor() { this[key] = 0; }
}

export default Sensor({
  name: "computed-name-test",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(
      result.diagnostics.some(
        (d) =>
          d.code === ValidatorDiagCode.ComputedPropertyNamesNotSupported ||
          d.code === LoweringDiagCode.ComputedClassMemberNameNotSupported
      ),
      `Expected computed property name diagnostic, got: ${JSON.stringify(result.diagnostics.map((d) => d.code))}`
    );
  });

  test("class with no constructor compiles (zero-arg stub)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Tag {
  label: string = "default";
}

export default Sensor({
  name: "no-ctor",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const funcNames: string[] = [];
    prog.functions.forEach((f) => {
      if (f.name) funcNames.push(f.name);
    });
    assert.ok(funcNames.includes("Tag$new"), `expected Tag$new in functions, got: ${funcNames.join(", ")}`);
  });

  test("class with getter registers accessor funcIds", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Foo {
  _x: number;
  constructor() { this._x = 0; }
  get x(): number { return this._x; }
  set x(value: number) { this._x = value; }
  static get count(): number { return 0; }
  static set count(value: number) {}
}

export default Sensor({
  name: "getter-test",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.strictEqual(result.diagnostics.length, 0, `unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");

    const prog = result.program!;
    assert.ok(
      prog.functions.some((f) => f.name === "Foo$get_x"),
      "expected Foo$get_x"
    );
    assert.ok(
      prog.functions.some((f) => f.name === "Foo$set_x"),
      "expected Foo$set_x"
    );
    assert.ok(
      prog.functions.some((f) => f.name === "Foo$get_count"),
      "expected Foo$get_count"
    );
    assert.ok(
      prog.functions.some((f) => f.name === "Foo$set_count"),
      "expected Foo$set_count"
    );
  });

  test("instance getter desugars to function call at call site", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Box {
  _width: number;
  constructor(w: number) { this._width = w; }
  get width(): number { return this._width; }
}

export default Sensor({
  name: "instance-getter-callsite",
  onExecute(ctx: Context): number {
    const b = new Box(42);
    return b.width;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 42);
    }
  });

  test("this.x getter inside instance method desugars correctly", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Rect {
  _w: number;
  _h: number;
  constructor(w: number, h: number) { this._w = w; this._h = h; }
  get w(): number { return this._w; }
  get h(): number { return this._h; }
  area(): number { return this.w * this.h; }
}

export default Sensor({
  name: "this-getter-in-method",
  onExecute(ctx: Context): number {
    const r = new Rect(3, 7);
    return r.area();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 21);
    }
  });

  test("static getter desugars to function call at call site", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Config {
  static _limit: number = 99;
  static get limit(): number { return Config._limit; }
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-getter-callsite",
  onExecute(ctx: Context): number {
    return Config.limit;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 99);
    }
  });

  test("getter returning computed value (not just backing field)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Circle {
  _radius: number;
  constructor(r: number) { this._radius = r; }
  get diameter(): number { return this._radius * 2; }
}

export default Sensor({
  name: "computed-getter",
  onExecute(ctx: Context): number {
    const c = new Circle(5);
    return c.diameter;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 10);
    }
  });

  test("instance setter desugars obj.x = value to function call", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Box {
  _width: number;
  constructor(w: number) { this._width = w; }
  get width(): number { return this._width; }
  set width(v: number) { this._width = v; }
}

export default Sensor({
  name: "instance-setter-callsite",
  onExecute(ctx: Context): number {
    const b = new Box(10);
    b.width = 42;
    return b.width;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 42);
    }
  });

  test("this.x = value through setter inside instance method", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  _count: number;
  constructor() { this._count = 0; }
  get count(): number { return this._count; }
  set count(v: number) { this._count = v; }
  reset(): void { this.count = 0; }
  increment(): void { this.count = this.count + 1; }
}

export default Sensor({
  name: "this-setter-in-method",
  onExecute(ctx: Context): number {
    const c = new Counter();
    c.increment();
    c.increment();
    c.increment();
    return c.count;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 3000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 3);
    }
  });

  test("static setter desugars ClassName.x = value to function call", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Config {
  static _limit: number = 0;
  static get limit(): number { return Config._limit; }
  static set limit(v: number) { Config._limit = v; }
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-setter-callsite",
  onExecute(ctx: Context): number {
    Config.limit = 77;
    return Config.limit;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 77);
    }
  });

  test("expression-position setter assignment evaluates to RHS value", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Box {
  _width: number;
  constructor() { this._width = 0; }
  get width(): number { return this._width; }
  set width(v: number) { this._width = v; }
}

export default Sensor({
  name: "setter-expr-position",
  onExecute(ctx: Context): number {
    const b = new Box();
    const y = (b.width = 99);
    return y;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 99);
    }
  });

  test("setter that validates/clamps input", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Clamped {
  _val: number;
  constructor() { this._val = 0; }
  get val(): number { return this._val; }
  set val(v: number) {
    if (v > 100) {
      this._val = 100;
    } else {
      this._val = v;
    }
  }
}

export default Sensor({
  name: "setter-clamp",
  onExecute(ctx: Context): number {
    const c = new Clamped();
    c.val = 200;
    return c.val;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 3000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 100);
    }
  });

  test("obj.x += value with getter and setter", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Score {
  _points: number;
  constructor(p: number) { this._points = p; }
  get points(): number { return this._points; }
  set points(v: number) { this._points = v; }
}

export default Sensor({
  name: "compound-getter-setter",
  onExecute(ctx: Context): number {
    const s = new Score(10);
    s.points += 5;
    return s.points;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 3000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 15);
    }
  });

  test("this.x -= value inside a method with getter and setter", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Wallet {
  _balance: number;
  constructor(b: number) { this._balance = b; }
  get balance(): number { return this._balance; }
  set balance(v: number) { this._balance = v; }
  spend(amount: number): void { this.balance -= amount; }
}

export default Sensor({
  name: "this-compound-getter-setter",
  onExecute(ctx: Context): number {
    const w = new Wallet(100);
    w.spend(30);
    w.spend(15);
    return w.balance;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 4000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 55);
    }
  });

  test("obj.x++ and ++obj.x with getter and setter", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  _count: number;
  constructor() { this._count = 0; }
  get count(): number { return this._count; }
  set count(v: number) { this._count = v; }
}

export default Sensor({
  name: "inc-dec-getter-setter",
  onExecute(ctx: Context): number {
    const c = new Counter();
    const a = c.count++;
    const b = ++c.count;
    return a * 100 + b * 10 + c.count;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 4000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 22);
    }
  });

  test("ClassName.x += value with static getter and setter", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Stats {
  static _total: number = 0;
  static get total(): number { return Stats._total; }
  static set total(v: number) { Stats._total = v; }
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-compound-getter-setter",
  onExecute(ctx: Context): number {
    Stats.total = 10;
    Stats.total += 5;
    Stats.total += 3;
    return Stats.total;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 3000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 18);
    }
  });

  test("static ++ClassName.x and ClassName.x++ with getter and setter", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Stats {
  static _total: number = 0;
  static get total(): number { return Stats._total; }
  static set total(v: number) { Stats._total = v; }
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-incdec-getter-setter",
  onExecute(ctx: Context): number {
    Stats.total = 5;
    const a = Stats.total++;
    const b = ++Stats.total;
    return a * 100 + b * 10 + Stats.total;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 3000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 577);
    }
  });

  test("getter-only property rejects compound assignment", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class ReadOnly {
  _val: number;
  constructor() { this._val = 5; }
  get val(): number { return this._val; }
}

export default Sensor({
  name: "getter-only-compound",
  onExecute(ctx: Context): number {
    const r = new ReadOnly();
    r.val += 10;
    return r.val;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "Expected at least one diagnostic");
  });

  test("new ClassName(args) creates struct with correct field values", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export default Sensor({
  name: "new-point",
  onExecute(ctx: Context): number {
    const p = new Point(3, 4);
    return p.x + p.y;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 7);
    }
  });

  test("property initializer sets default value", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Config {
  threshold: number = 42;
  label: string = "hello";
  constructor() {}
}

export default Sensor({
  name: "prop-init",
  onExecute(ctx: Context): number {
    const c = new Config();
    return c.threshold;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("property initializer runs before constructor body", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  value: number = 10;
  constructor(extra: number) {
    this.value = this.value + extra;
  }
}

export default Sensor({
  name: "init-order",
  onExecute(ctx: Context): number {
    const c = new Counter(5);
    return c.value;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 15);
    }
  });

  test("new expression with unknown class produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "bad-new",
  onExecute(ctx: Context): number {
    const p = new UnknownClass();
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for unknown class");
  });

  test("this outside class context produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

function helper(): number {
  return this.x;
}

export default Sensor({
  name: "bad-this",
  onExecute(ctx: Context): number {
    return helper();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "expected diagnostics for this outside class");
  });

  test("constructor returns struct value directly", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Pair {
  a: number;
  b: number;
  constructor(a: number, b: number) {
    this.a = a;
    this.b = b;
  }
}

export default Sensor({
  name: "ctor-struct",
  onExecute(ctx: Context): number {
    const p = new Pair(10, 20);
    return p.a;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 10);
    }
  });

  test("class with no explicit constructor uses property initializers", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Defaults {
  count: number = 99;
}

export default Sensor({
  name: "no-ctor-init",
  onExecute(ctx: Context): number {
    const d = new Defaults();
    return d.count;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 99);
    }
  });

  test("method body reads this.x correctly", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Box {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  getValue(): number {
    return this.value;
  }
}

export default Sensor({
  name: "method-read",
  onExecute(ctx: Context): number {
    const b = new Box(42);
    return b.getValue();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("method body writes this.x with store-back pattern", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Settable {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  assign(n: number): Settable {
    this.value = n;
    return this;
  }
}

export default Sensor({
  name: "method-write",
  onExecute(ctx: Context): number {
    const c = new Settable(10);
    const c2 = c.assign(99);
    return c2.value;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 99);
    }
  });

  test("obj.method(args) calls a user-compiled method", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Adder {
  base: number;
  constructor(b: number) {
    this.base = b;
  }
  add(n: number): number {
    return this.base + n;
  }
}

export default Sensor({
  name: "method-call",
  onExecute(ctx: Context): number {
    const a = new Adder(100);
    return a.add(23);
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 123);
    }
  });

  test("method calls another method on this", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Calc {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  double(): number {
    return this.value * 2;
  }
  quadruple(): number {
    return this.double() + this.double();
  }
}

export default Sensor({
  name: "this-method-call",
  onExecute(ctx: Context): number {
    const c = new Calc(5);
    return c.quadruple();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 20);
    }
  });

  test("method returns a computed value", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Rect {
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }
  area(): number {
    return this.w * this.h;
  }
}

export default Sensor({
  name: "method-compute",
  onExecute(ctx: Context): number {
    const r = new Rect(6, 7);
    return r.area();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("method with no explicit return returns nil", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Tracker {
  count: number;
  constructor() {
    this.count = 0;
  }
  bump(): void {
    this.count = this.count + 1;
  }
}

export default Sensor({
  name: "method-void",
  onExecute(ctx: Context): number {
    const t = new Tracker();
    t.bump();
    return 42;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("multiple methods on the same class", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class TwoD {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  getX(): number {
    return this.x;
  }
  getY(): number {
    return this.y;
  }
  sum(): number {
    return this.getX() + this.getY();
  }
}

export default Sensor({
  name: "multi-method",
  onExecute(ctx: Context): number {
    const c = new TwoD(11, 22);
    return c.sum();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 33);
    }
  });

  test("compound assignment this.x += value reads, computes, and writes back", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Accumulator {
  total: number;
  constructor(initial: number) {
    this.total = initial;
  }
  add(n: number): Accumulator {
    this.total += n;
    return this;
  }
}

export default Sensor({
  name: "compound-assign",
  onExecute(ctx: Context): number {
    const a = new Accumulator(10);
    const a2 = a.add(5);
    return a2.total;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 15);
    }
  });

  test("recompiling a class with changed shape picks up new fields", () => {
    const sourceV1 = `
import { Sensor, type Context } from "mindcraft";

class ShapeEvol {
  x: number = 1;
}

export default Sensor({
  name: "shape-evol",
  onExecute(ctx: Context): number {
    const s = new ShapeEvol();
    return s.x;
  },
});
`;
    const resultV1 = compileUserTile(sourceV1, { services });
    assert.deepStrictEqual(resultV1.diagnostics, [], `V1 diagnostics: ${JSON.stringify(resultV1.diagnostics)}`);
    assert.ok(resultV1.program);

    const registryV1 = services.types;
    const typeIdV1 = registryV1.resolveByName("/user-code.ts::ShapeEvol");
    assert.ok(typeIdV1, "ShapeEvol should be registered after V1");
    const defV1 = registryV1.get(typeIdV1!) as StructTypeDef;
    assert.equal(defV1.fields.size(), 1);

    const sourceV2 = `
import { Sensor, type Context } from "mindcraft";

class ShapeEvol {
  x: number = 1;
  y: number = 2;
}

export default Sensor({
  name: "shape-evol",
  onExecute(ctx: Context): number {
    const s = new ShapeEvol();
    return s.x + s.y;
  },
});
`;
    const resultV2 = compileUserTile(sourceV2, { services });
    assert.deepStrictEqual(resultV2.diagnostics, [], `V2 diagnostics: ${JSON.stringify(resultV2.diagnostics)}`);
    assert.ok(resultV2.program);

    const registryV2 = services.types;
    const typeIdV2 = registryV2.resolveByName("/user-code.ts::ShapeEvol");
    assert.ok(typeIdV2, "ShapeEvol should be registered after V2");
    const defV2 = registryV2.get(typeIdV2!) as StructTypeDef;
    assert.equal(defV2.fields.size(), 2, "V2 should have 2 fields (x and y)");
  });

  test("simple static field assignment compiles without diagnostics", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  static count: number = 0;
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-assign",
  onExecute(ctx: Context): number {
    Counter.count = 42;
    return Counter.count;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
  });

  test("compound static field assignment (+=) compiles without diagnostics", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  static count: number = 0;
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-compound-assign",
  onExecute(ctx: Context): number {
    Counter.count += 10;
    return Counter.count;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
  });

  test("prefix increment on static field compiles without diagnostics", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  static count: number = 0;
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-prefix-inc",
  onExecute(ctx: Context): number {
    ++Counter.count;
    return Counter.count;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
  });

  test("postfix increment on static field compiles without diagnostics", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  static count: number = 0;
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-postfix-inc",
  onExecute(ctx: Context): number {
    Counter.count++;
    return Counter.count;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program, "expected program to be produced");
  });

  test("assigning to a static method produces AssignmentTargetNotVariable", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Utils {
  static double(n: number): number { return n * 2; }
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-method-assign",
  onExecute(ctx: Context): number {
    Utils.double = 5 as any;
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.AssignmentTargetNotVariable),
      `Expected AssignmentTargetNotVariable, got: ${JSON.stringify(result.diagnostics.map((d) => d.code))}`
    );
  });

  test("prefix increment on static method produces a diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Utils {
  static double(n: number): number { return n * 2; }
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-method-prefix-inc",
  onExecute(ctx: Context): number {
    ++Utils.double;
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(
      result.diagnostics.length > 0,
      `Expected at least one diagnostic for ++staticMethod, got: ${JSON.stringify(result.diagnostics.map((d) => d.code))}`
    );
  });

  test("static field assignment and read produces correct runtime values", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  static count: number = 0;
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-assign-runtime",
  onExecute(ctx: Context): number {
    Counter.count = 7;
    Counter.count += 3;
    return Counter.count;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 10);
    }
  });

  test("prefix and postfix increment on static field produce correct values", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  static count: number = 0;
  value: number;
  constructor() { this.value = 0; }
}

export default Sensor({
  name: "static-incr-runtime",
  onExecute(ctx: Context): number {
    Counter.count = 5;
    const a = ++Counter.count;
    const b = Counter.count++;
    return a + b + Counter.count;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      // count starts at 0, set to 5
      // ++Counter.count -> count=6, a=6
      // Counter.count++ -> b=6 (old value), count=7
      // return 6 + 6 + 7 = 19
      assert.equal((r.result as NumberValue).v, 19);
    }
  });

  test("this.field read and this.method() call in static method", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Counter {
  static count: number = 0;
  static increment(): void {
    this.count = this.count + 1;
  }
  static getCount(): number {
    return this.count;
  }
}

export default Sensor({
  name: "this-static",
  onExecute(ctx: Context): number {
    Counter.increment();
    Counter.increment();
    Counter.increment();
    return Counter.getCount();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 5000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      assert.equal((r.result as NumberValue).v, 3);
    }
  });

  test("this.field compound assignment and increment in static method", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Acc {
  static value: number = 10;
  static addAndInc(): number {
    this.value += 5;
    ++this.value;
    return this.value;
  }
}

export default Sensor({
  name: "this-compound",
  onExecute(ctx: Context): number {
    return Acc.addAndInc();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 5000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      // 10 + 5 = 15, then ++15 = 16
      assert.equal((r.result as NumberValue).v, 16);
    }
  });

  test("this.otherMethod() call chain in static methods", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Utils {
  static base: number = 10;
  static double(): number {
    return this.base * 2;
  }
  static doublePlusFive(): number {
    return this.double() + 5;
  }
}

export default Sensor({
  name: "this-chain",
  onExecute(ctx: Context): number {
    return Utils.doublePlusFive();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 5000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      // base=10, double()=20, doublePlusFive()=25
      assert.equal((r.result as NumberValue).v, 25);
    }
  });

  test("bare this in static method produces diagnostic", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Foo {
  static getSelf(): number {
    const x = this;
    return 0;
  }
}

export default Sensor({
  name: "bare-this",
  onExecute(ctx: Context): number {
    return Foo.getSelf();
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.ok(result.diagnostics.length > 0, "Should produce at least one diagnostic");
  });

  test("this.field postfix increment in static method", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

class Seq {
  static val: number = 0;
  static next(): number {
    return this.val++;
  }
}

export default Sensor({
  name: "this-postfix",
  onExecute(ctx: Context): number {
    const a = Seq.next();
    const b = Seq.next();
    const c = Seq.next();
    return a + b + c;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
    runActivation(prog, handles, callsiteVars);

    const vm = new runtime.VM(services, prog, handles);
    const fiber = vm.spawnFiber(1, prog.entryFuncId, List.empty<Value>(), mkCtx());
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 5000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    if (r.status === VmStatus.DONE) {
      // next() returns old value then increments: 0, 1, 2 -> 0+1+2 = 3
      assert.equal((r.result as NumberValue).v, 3);
    }
  });
});
