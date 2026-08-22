/**
 * Optional struct fields on the TypeScript surface. A field declared optional
 * may be omitted when constructing a value via object literal, reads as nil
 * when absent, and appears as `name?: T` in the generated ambient. Two
 * declaration sources are covered: a host `addStructType` field with
 * `optional: true`, and a user TypeScript struct written with `field?: T`
 * (interface, type alias, object-literal type, intersection, and class).
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, runtime } from "@wendoo-lang/core";
import type { BrainServices } from "@wendoo-lang/core/brain";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import type { ExecutionContext, Scheduler } from "@wendoo-lang/core/runtime";
import {
  CoreTypeIds,
  HandleTable,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type StructTypeDef,
  type Value,
  VmStatus,
} from "@wendoo-lang/core/runtime";
import { __test__createPlatformServices } from "@wendoo-lang/core/runtime/__test__";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile } from "./compile.js";
import { UserTileProject } from "./project.js";

let services: BrainServices;
let nextAtomId = 7000;

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
  return { onHandleCompleted: () => {}, enqueueRunnable: () => {}, getFiber: () => undefined };
}

/** Compiles `source` against `ambient`, asserts zero diagnostics, runs func 1, returns the numeric result. */
function runReturningNumber(source: string, ambient?: string): number {
  const result = compileUserTile(source, {
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: ambient ? [{ path: "ambient.d.ts", content: ambient }] : undefined,
    services,
  });
  assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program, "expected a compiled program");
  const handles = new HandleTable(100);
  const vm = new runtime.VM(result.program!, toVmServices(services), { handles });
  const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
  fiber.instrBudget = 2000;
  const r = vm.runFiber(fiber, mkScheduler());
  assert.equal(r.status, VmStatus.DONE);
  assert.ok(r.result, "expected a return value");
  assert.equal(r.result!.t, NativeType.Number, `expected a number, got ${JSON.stringify(r.result)}`);
  return (r.result as NumberValue).v;
}

/** Finds the registered struct def named `simpleName`, with or without a module namespace prefix. */
function findUserStruct(simpleName: string): StructTypeDef {
  for (const [, def] of services.runtime.types.entries()) {
    if (def.coreType === NativeType.Struct && (def.name === simpleName || def.name.endsWith(`::${simpleName}`))) {
      return def as StructTypeDef;
    }
  }
  assert.fail(`no registered user struct named ${simpleName}`);
}

function fieldOf(def: StructTypeDef, name: string) {
  for (let i = 0; i < def.fields.size(); i++) {
    const f = def.fields.get(i)!;
    if (f.name === name) return f;
  }
  assert.fail(`struct ${def.name} has no field ${name}`);
}

/** Slices the emitted `interface <name> { ... }` block out of an ambient source. */
function interfaceBlock(ambient: string, name: string): string {
  const start = ambient.indexOf(`interface ${name}`);
  assert.ok(start >= 0, `ambient has no interface ${name}`);
  const close = ambient.indexOf("}", start);
  return ambient.slice(start, close + 1);
}

describe("optional struct fields: host addStructType declaration", () => {
  let ambient: string;

  before(() => {
    services = __test__createBrainServices();
    const types = services.runtime.types;
    const optsId = mkTypeId(NativeType.Struct, "Opts");
    if (!types.get(optsId)) {
      const nullableString = types.addNullableType(CoreTypeIds.String);
      types.addStructType("Opts", {
        atomId: nextAtomId++,
        fields: List.from([
          { name: "label", typeId: CoreTypeIds.String, fieldIndex: 0 },
          { name: "count", typeId: CoreTypeIds.Number, fieldIndex: 1, optional: true },
          { name: "note", typeId: nullableString, fieldIndex: 2 },
          { name: "tag", typeId: CoreTypeIds.String, fieldIndex: 3, readOnly: true, optional: true },
        ]),
      });
    }
    ambient = buildAmbientDeclarations(types);
  });

  test("the ambient emits an optional field as `name?: T` and a required field without `?`", () => {
    const block = interfaceBlock(ambient, "Opts");
    assert.match(block, /\blabel: string;/, "a plain required field has no `?`");
    assert.match(block, /\bcount\?: number;/, "the optional field is emitted with `?`");
    assert.match(block, /\bnote: string \| null;/, "a nullable-but-required field stays required");
    assert.match(block, /\breadonly tag\?: string;/, "a readonly optional field keeps both markers");
    assert.doesNotMatch(block, /\bcount: number;/, "the optional field is not also emitted as required");
  });

  test("an object literal may omit the optional field, and it reads as nil", () => {
    const source = `
import { Sensor, type Context, type Opts } from "wendoo";
export default Sensor({
  name: "omit-opt",
  onExecute(ctx: Context): number {
    const o: Opts = { label: "x", note: null };
    return o.count === undefined ? -1 : o.count;
  },
});
`;
    assert.equal(runReturningNumber(source, ambient), -1, "the omitted optional field reads as nil");
  });

  test("a present optional field carries its value", () => {
    const source = `
import { Sensor, type Context, type Opts } from "wendoo";
export default Sensor({
  name: "present-opt",
  onExecute(ctx: Context): number {
    const o: Opts = { label: "x", note: null, count: 42 };
    return o.count === undefined ? -1 : o.count;
  },
});
`;
    assert.equal(runReturningNumber(source, ambient), 42, "the supplied optional field carries its value");
  });

  test("an optional field explicitly set to undefined reads as nil", () => {
    const source = `
import { Sensor, type Context, type Opts } from "wendoo";
export default Sensor({
  name: "undef-opt",
  onExecute(ctx: Context): number {
    const o: Opts = { label: "x", note: null, count: undefined };
    return o.count === undefined ? -1 : o.count;
  },
});
`;
    assert.equal(runReturningNumber(source, ambient), -1, "count set to undefined reads as nil");
  });

  test("omitting a required field still fails tsc; omitting the optional field does not", () => {
    const project = new UserTileProject({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambient }],
      services,
    });
    project.setFiles(
      new Map([
        [
          "bad.ts",
          `import { Sensor, type Context, type Opts } from "wendoo";
export default Sensor({
  name: "bad",
  onExecute(ctx: Context): number { const o: Opts = { count: 1 }; return 0; },
});
`,
        ],
        [
          "ok.ts",
          `import { Sensor, type Context, type Opts } from "wendoo";
export default Sensor({
  name: "ok",
  onExecute(ctx: Context): number { const o: Opts = { label: "x", note: null }; return 0; },
});
`,
        ],
      ])
    );
    const result = project.compileAll();
    const badErrors = [...result.tsErrors].find(([path]) => path === "bad.ts");
    assert.ok(badErrors, "omitting the required `label`/`note` fields is a tsc error");
    assert.equal(
      [...result.tsErrors].find(([path]) => path === "ok.ts"),
      undefined,
      "omitting only the optional field is not a tsc error"
    );
  });
});

describe("optional struct fields: user TypeScript declarations", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("an interface `field?: T` registers the field as optional with a nullable value type", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
interface Cfg { a: number; b?: number; }
export default Sensor({
  name: "iface",
  onExecute(ctx: Context): number {
    const c: Cfg = { a: 5 };
    return c.b === undefined ? -1 : c.b;
  },
});
`;
    assert.equal(runReturningNumber(source), -1, "the omitted optional field reads as nil");
    const def = findUserStruct("Cfg");
    assert.equal(fieldOf(def, "a").optional, undefined, "the required field is not optional");
    assert.equal(fieldOf(def, "b").optional, true, "the `?` field is registered optional");
    assert.equal(
      services.runtime.types.get(fieldOf(def, "b").typeId)!.nullable,
      true,
      "back-compat: the optional field value type is nullable-widened"
    );
  });

  test("a supplied interface optional field carries its value", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
interface Cfg2 { a: number; b?: number; }
export default Sensor({
  name: "iface2",
  onExecute(ctx: Context): number {
    const c: Cfg2 = { a: 5, b: 9 };
    return c.b === undefined ? -1 : c.b;
  },
});
`;
    assert.equal(runReturningNumber(source), 9);
    assert.equal(fieldOf(findUserStruct("Cfg2"), "b").optional, true);
  });

  test("a type alias `field?: T` registers the field as optional", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
type Cfg3 = { a: number; b?: number; };
export default Sensor({
  name: "alias",
  onExecute(ctx: Context): number {
    const c: Cfg3 = { a: 5 };
    return c.b === undefined ? -1 : c.b;
  },
});
`;
    assert.equal(runReturningNumber(source), -1);
    assert.equal(fieldOf(findUserStruct("Cfg3"), "b").optional, true);
  });

  test("a named intersection type carries the optional flag and reads nil when omitted", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
type Cfg5 = { a: number } & { b?: number };
export default Sensor({
  name: "inter",
  onExecute(ctx: Context): number {
    const c: Cfg5 = { a: 5 };
    return c.b === undefined ? -1 : c.b;
  },
});
`;
    assert.equal(runReturningNumber(source), -1, "the omitted optional member reads as nil");
    assert.equal(fieldOf(findUserStruct("Cfg5"), "b").optional, true, "the intersection's `b?` member is optional");
  });

  test("a class `field?: T` registers the field as optional", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
class Cfg6 { a: number = 0; b?: number; }
export default Sensor({
  name: "cls",
  onExecute(ctx: Context): number { const c = new Cfg6(); return c.a; },
});
`;
    const result = compileUserTile(source, { projectNamespace: TEST_PROJECT_NAMESPACE, services });
    assert.deepStrictEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
    const def = findUserStruct("Cfg6");
    assert.equal(fieldOf(def, "a").optional, undefined);
    assert.equal(fieldOf(def, "b").optional, true, "the class `b?` field registered optional");
  });

  test("a non-optional field with a nullable value type is not marked optional", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
interface Cfg7 { a: number; b: number | null; }
export default Sensor({
  name: "nullable-required",
  onExecute(ctx: Context): number {
    const c: Cfg7 = { a: 5, b: null };
    return c.b === null ? -1 : c.b;
  },
});
`;
    assert.equal(runReturningNumber(source), -1);
    const def = findUserStruct("Cfg7");
    assert.equal(fieldOf(def, "b").optional, undefined, "a required nullable field is not optional");
  });

  test("a nested struct optional field reads nil when omitted", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
interface Inner { x: number; }
interface Outer { a: number; inner?: Inner; }
export default Sensor({
  name: "nested",
  onExecute(ctx: Context): number {
    const o: Outer = { a: 5 };
    return o.inner === undefined ? -1 : o.inner.x;
  },
});
`;
    assert.equal(runReturningNumber(source), -1, "the omitted optional struct field reads as nil");
    assert.equal(fieldOf(findUserStruct("Outer"), "inner").optional, true);
  });
});

describe("optional struct fields: generic instantiation", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("a generic interface instantiation carries the optional flag on its optional field", () => {
    const ambient = buildAmbientDeclarations(services.runtime.types);
    const source = `
import { Sensor, type Context } from "wendoo";
interface Box<T> { value: T; extra?: T; }
export default Sensor({
  name: "box",
  onExecute(ctx: Context): number {
    const b: Box<number> = { value: 5 };
    return b.extra === undefined ? -1 : b.extra;
  },
});
`;
    assert.equal(
      runReturningNumber(source, ambient),
      -1,
      "the omitted optional field of a generic struct reads as nil"
    );
    let found = false;
    for (const [, def] of services.runtime.types.entries()) {
      if (def.coreType === NativeType.Struct && def.name.startsWith("Box<")) {
        const sd = def as StructTypeDef;
        if (fieldOf(sd, "extra").optional === true && fieldOf(sd, "value").optional === undefined) found = true;
      }
    }
    assert.ok(found, "the instantiated generic struct's `extra?` field is optional");
  });
});

describe("optional struct fields: cross-module", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("an optional field on an imported interface reads nil when omitted", () => {
    const project = new UserTileProject({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: buildAmbientDeclarations(services.runtime.types) }],
      services,
    });
    project.setFiles(
      new Map([
        ["shared.ts", `export interface Shared { a: number; b?: number; }\n`],
        [
          "use.ts",
          `import { Sensor, type Context } from "wendoo";
import type { Shared } from "./shared";
export default Sensor({
  name: "use",
  onExecute(ctx: Context): number {
    const s: Shared = { a: 5 };
    return s.b === undefined ? -1 : s.b;
  },
});
`,
        ],
      ])
    );
    const result = project.compileAll();
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("use.ts");
    assert.ok(entry?.program, "expected a compiled program for use.ts");
    assert.deepEqual(entry.diagnostics, [], JSON.stringify(entry.diagnostics));
    const def = findUserStruct("Shared");
    assert.equal(fieldOf(def, "b").optional, true, "the imported interface's optional field is registered optional");

    const handles = new HandleTable(100);
    const vm = new runtime.VM(entry.program!, toVmServices(services), { handles });
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE);
    assert.equal((r.result as NumberValue).v, -1, "the omitted optional field reads as nil across modules");
  });
});
