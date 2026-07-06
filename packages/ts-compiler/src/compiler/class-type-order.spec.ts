/**
 * Class struct types: a class field may name another user class or a user
 * interface, and the compile outcome never depends on declaration order or
 * import-visit order. Field types resolve to the qualified registered type
 * (never a bare-name shadow registration), a self-referential optional field
 * registers as a nullable reference to the class's own type, and composed
 * values read back end to end through a running brain.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type BrainServices, type IBrainTileDef, mkVariableTileId } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileOperatorDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import {
  CoreTypeIds,
  extractNumberValue,
  type IBrain,
  NativeType,
  type NullableTypeDef,
  type StructTypeDef,
  type TypeId,
  type Value,
} from "@mindcraft-lang/core/runtime";
import { registerUserTile } from "../runtime/registration-bridge.js";
import { buildUserTileMetadata } from "../runtime/user-tile-metadata.js";
import { expectDiagnostic } from "../testsupport/diag-coverage.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { LoweringDiagCode } from "./diag-codes.js";
import { type ProjectCompileResult, UserTileProject } from "./project.js";
import type { UserAuthoredProgram } from "./types.js";

function compileProject(services: BrainServices, files: Record<string, string>): ProjectCompileResult {
  const ambientSource = buildAmbientDeclarations(services.runtime.types);
  const project = new UserTileProject({ ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }], services });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

function compiledProgram(result: ProjectCompileResult, path: string): UserAuthoredProgram {
  assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
  const entry = result.results.get(path);
  assert.ok(entry, `expected a result for ${path}`);
  assert.deepEqual(entry.diagnostics, [], `Diagnostics for ${path}: ${JSON.stringify(entry.diagnostics)}`);
  assert.ok(entry.program, `expected a compiled program for ${path}`);
  return entry.program;
}

function compileAndRegister(
  services: BrainServices,
  files: Record<string, string>,
  entryPath: string
): UserAuthoredProgram {
  const result = compileProject(services, files);
  const program = compiledProgram(result, entryPath);
  registerUserTile(program, services);
  return program;
}

function actionTileFor(services: BrainServices, program: UserAuthoredProgram): IBrainTileDef {
  const metadata = buildUserTileMetadata(program, (name) => services.runtime.types.resolveByName(name));
  assert.ok(metadata, `expected tile metadata for ${program.key}`);
  return metadata.actionTile;
}

function classStructDef(services: BrainServices, identity: string): { typeId: TypeId; def: StructTypeDef } {
  const typeId = services.runtime.types.resolveByName(identity);
  assert.ok(typeId, `expected ${identity} to be registered`);
  const def = services.runtime.types.get(typeId);
  assert.ok(def);
  assert.equal(def.coreType, NativeType.Struct);
  return { typeId, def: def as StructTypeDef };
}

function fieldTypeId(def: StructTypeDef, fieldName: string): TypeId {
  const index = def.fieldIndexByName.get(fieldName);
  assert.ok(index !== undefined, `expected field '${fieldName}' on ${def.name}`);
  return def.fields.get(index)!.typeId;
}

function mkNumVar(name: string): BrainTileVariableDef {
  const uniqueId = `class-order-${name}`;
  return new BrainTileVariableDef(mkVariableTileId(uniqueId), name, CoreTypeIds.Number, uniqueId);
}

function runSensorToNumber(services: BrainServices, program: UserAuthoredProgram, varName: string): number | undefined {
  const brainDef = new BrainDef(services);
  const pageResult = brainDef.appendNewPage();
  assert.ok(pageResult.success);
  const page = pageResult.value!.page as BrainPageDef;
  const rule = page.children().get(0)! as BrainRuleDef;
  const numVar = mkNumVar(varName);
  for (const tile of [numVar, new BrainTileOperatorDef("assign", {}, services), actionTileFor(services, program)]) {
    rule.do().appendTile(tile as never);
  }
  const brain: IBrain = brainDef.compile();
  brain.initialize();
  brain.startup();
  brain.think(16);
  const v: Value | undefined = brain.getVariable(numVar.varName);
  return v === undefined ? undefined : extractNumberValue(v);
}

const INNER_BLOCK = `export class Inner {
  x: number;
  constructor() {
    this.x = 3;
  }
  double(): number {
    return this.x * 2;
  }
}
`;

const OUTER_BLOCK = `export class Outer {
  inner: Inner;
  tag: number;
  constructor() {
    this.inner = new Inner();
    this.tag = 7;
  }
}
`;

const OUTER_ENTRY = `import { Sensor, type Context } from "mindcraft";
import { Outer } from "./defs";

export default Sensor({
  name: "outer probe", inline: true,
  onExecute(ctx: Context): number {
    const o = new Outer();
    return o.inner.x + o.tag;
  },
});
`;

function assertComposedShape(services: BrainServices, innerIdentity: string, outerIdentity: string): void {
  const inner = classStructDef(services, innerIdentity);
  const outer = classStructDef(services, outerIdentity);
  assert.equal(fieldTypeId(outer.def, "inner"), inner.typeId, "the class-typed field carries the qualified class type");
  assert.equal(fieldTypeId(outer.def, "tag"), CoreTypeIds.Number);
}

describe("class struct types: declaration-order independence", () => {
  test("one module declaring the field's class above the referencing class", () => {
    const services = __test__createBrainServices();
    const program = compileAndRegister(
      services,
      { "defs.ts": `${INNER_BLOCK}\n${OUTER_BLOCK}`, "stick.ts": OUTER_ENTRY },
      "stick.ts"
    );
    assertComposedShape(services, "/defs.ts::Inner", "/defs.ts::Outer");
    const inner = classStructDef(services, "/defs.ts::Inner");
    assert.ok(
      inner.def.methods?.find((m) => m.name === "double"),
      "the class's method declarations register on the struct type"
    );
    assert.equal(runSensorToNumber(services, program, "above"), 10, "the composed value reads back end to end");
  });

  test("one module declaring the field's class below the referencing class compiles identically", () => {
    const services = __test__createBrainServices();
    const program = compileAndRegister(
      services,
      { "defs.ts": `${OUTER_BLOCK}\n${INNER_BLOCK}`, "stick.ts": OUTER_ENTRY },
      "stick.ts"
    );
    assertComposedShape(services, "/defs.ts::Inner", "/defs.ts::Outer");
    assert.equal(runSensorToNumber(services, program, "below"), 10, "the composed value reads back end to end");
  });

  test("the entry module's class composes an imported class", () => {
    const services = __test__createBrainServices();
    const entrySource = `import { Sensor, type Context } from "mindcraft";
import { Inner } from "./inner";

class Outer {
  inner: Inner;
  tag: number;
  constructor() {
    this.inner = new Inner();
    this.tag = 7;
  }
}

export default Sensor({
  name: "outer probe", inline: true,
  onExecute(ctx: Context): number {
    const o = new Outer();
    return o.inner.x + o.tag;
  },
});
`;
    const program = compileAndRegister(services, { "inner.ts": INNER_BLOCK, "stick.ts": entrySource }, "stick.ts");
    assertComposedShape(services, "/inner.ts::Inner", "/stick.ts::Outer");
    assert.equal(runSensorToNumber(services, program, "entry"), 10, "the composed value reads back end to end");
  });

  test("a methodless class referenced before its declaration resolves to its qualified type only", () => {
    const services = __test__createBrainServices();
    const methodlessInner = `export class Inner {
  x: number;
  constructor() {
    this.x = 3;
  }
}
`;
    const program = compileAndRegister(
      services,
      { "defs.ts": `${OUTER_BLOCK}\n${methodlessInner}`, "stick.ts": OUTER_ENTRY },
      "stick.ts"
    );
    assertComposedShape(services, "/defs.ts::Inner", "/defs.ts::Outer");
    assert.equal(
      services.runtime.types.resolveByName("Inner"),
      undefined,
      "no bare-name shadow type registers for the class"
    );
    assert.equal(runSensorToNumber(services, program, "methodless"), 10, "the composed value reads back end to end");
  });

  test("a class field typed by a same-module interface registers against the interface's qualified type", () => {
    const services = __test__createBrainServices();
    const entrySource = `import { Sensor, type Context } from "mindcraft";

interface Settings {
  speed: number;
}

class Rover {
  cfg: Settings;
  constructor() {
    this.cfg = { speed: 2 };
  }
}

export default Sensor({
  name: "rover probe", inline: true,
  onExecute(ctx: Context): number {
    const r = new Rover();
    return r.cfg.speed;
  },
});
`;
    const result = compileProject(services, { "stick.ts": entrySource });
    const entry = result.results.get("stick.ts");
    assert.ok(entry);
    assert.equal(
      entry.diagnostics.filter((d) => d.code === LoweringDiagCode.InterfaceCollidesWithAmbientType).length,
      0,
      "the interface must not be reported as colliding with its own fallback registration"
    );
    const program = compiledProgram(result, "stick.ts");
    registerUserTile(program, services);
    const settings = classStructDef(services, "/stick.ts::Settings");
    const rover = classStructDef(services, "/stick.ts::Rover");
    assert.equal(fieldTypeId(rover.def, "cfg"), settings.typeId, "the field carries the interface's qualified type");
    assert.equal(runSensorToNumber(services, program, "rover"), 2, "the composed value reads back end to end");
  });

  test("a self-referential optional field registers as a nullable reference to the class's own type", () => {
    const services = __test__createBrainServices();
    const entrySource = `import { Sensor, type Context } from "mindcraft";

class Node {
  x: number;
  next?: Node;
  constructor() {
    this.x = 1;
  }
}

export default Sensor({
  name: "chain probe", inline: true,
  onExecute(ctx: Context): number {
    const a = new Node();
    const b = new Node();
    b.x = 5;
    a.next = b;
    if (a.next === undefined) {
      return -1;
    }
    return a.next.x;
  },
});
`;
    const program = compileAndRegister(services, { "stick.ts": entrySource }, "stick.ts");
    const node = classStructDef(services, "/stick.ts::Node");
    const nextTypeId = fieldTypeId(node.def, "next");
    const nextDef = services.runtime.types.get(nextTypeId);
    assert.ok(nextDef);
    assert.equal(nextDef.nullable, true, "the optional self reference is nullable");
    assert.equal(
      (nextDef as NullableTypeDef).baseTypeId,
      node.typeId,
      "the nullable base is the class's own registered type"
    );
    assert.equal(runSensorToNumber(services, program, "chain"), 5, "the linked value reads back end to end");
  });

  test("an unresolvable instance field type is reported at the field", () => {
    const services = __test__createBrainServices();
    const entrySource = `import { Sensor, type Context } from "mindcraft";

type Opaque = number & { __brand: "opaque" };

class Holder {
  data?: Opaque;
}

export default Sensor({
  name: "holder probe",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileProject(services, { "stick.ts": entrySource });
    const entry = result.results.get("stick.ts");
    assert.ok(entry);
    expectDiagnostic(entry.diagnostics, LoweringDiagCode.UnresolvableClassFieldType);
  });
});
