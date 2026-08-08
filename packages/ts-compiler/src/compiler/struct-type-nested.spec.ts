/**
 * Nested struct fields: a `StructType({...})` field may name another declared
 * StructType. The compile outcome never depends on declaration order or
 * import-visit order, recursive containment fails with a precise cycle
 * diagnostic, and nested values work end to end: factory construction through
 * the struct-literal path, chained accessor tiles, deep-copy on store at both
 * nesting levels, and brain-document round-trips.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type BrainServices,
  type IBrainTileDef,
  type ITileCatalog,
  mkAccessorTileId,
  mkVariableFactoryTileId,
  mkVariableTileId,
  RuleSide,
} from "@mindcraft-lang/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { Expr } from "@mindcraft-lang/core/brain/compiler";
import {
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
  type TileSuggestionResult,
} from "@mindcraft-lang/core/brain/language-service";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  type BrainTileAccessorDef,
  type BrainTileFactoryDef,
  BrainTileLiteralDef,
  BrainTileOperatorDef,
  BrainTileVariableDef,
  TileCatalog,
} from "@mindcraft-lang/core/brain/tiles";
import {
  CoreTypeIds,
  extractNumberValue,
  type IBrain,
  NativeType,
  type TypeId,
  type Value,
} from "@mindcraft-lang/core/runtime";
import { registerUserTile } from "../runtime/registration-bridge.js";
import { buildUserTileMetadata } from "../runtime/user-tile-metadata.js";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { expectDiagnostic } from "../testsupport/diag-coverage.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { LoweringDiagCode } from "./diag-codes.js";
import { type CompileResult, type ProjectCompileResult, UserTileProject } from "./project.js";
import { qualifiedClassName } from "./symbol-keys.js";
import type { ArtifactStructTypeInfo, UserAuthoredProgram } from "./types.js";

const POSITION_IDENTITY = qualifiedClassName(TEST_PROJECT_NAMESPACE, "/position.ts", "Position");
const SPRITE_IDENTITY = qualifiedClassName(TEST_PROJECT_NAMESPACE, "/sprite.ts", "Sprite");

/** The inner struct: a plain record of numbers. */
const POSITION_SOURCE = `import { NumberType, StructType, type StructOf } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: "number" },
  accessors: true,
  variables: true,
});
export type Position = StructOf<typeof Position>;
`;

/** The outer struct: one field is the inner struct, one is a number. */
const SPRITE_SOURCE = `import { NumberType, StructType, type StructOf } from "mindcraft";
import { Position } from "./position";

export const Sprite = StructType({
  name: "sprite",
  fields: { pos: Position, hp: NumberType },
  accessors: true,
  variables: true,
});
export type Sprite = StructOf<typeof Sprite>;
`;

/** Sensor constructing a nested value through the callable factories. */
const SPAWN_SOURCE = `import { Sensor, type Context } from "mindcraft";
import { Position } from "./position";
import { Sprite } from "./sprite";

export default Sensor({
  name: "spawn sprite", inline: true,
  returnType: Sprite,
  onExecute(ctx: Context): Sprite {
    return Sprite({ pos: Position({ x: 3, y: 4 }), hp: 7 });
  },
});
`;

function compileProject(services: BrainServices, files: Record<string, string>): ProjectCompileResult {
  const ambientSource = buildAmbientDeclarations(services.runtime.types);
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
    services,
  });
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

function entryDiagnostics(result: ProjectCompileResult, path: string): CompileResult["diagnostics"] {
  assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
  const entry = result.results.get(path);
  assert.ok(entry, `expected a result for ${path}`);
  return entry.diagnostics;
}

function compileAndRegister(
  services: BrainServices,
  files: Record<string, string>,
  entryPaths: string[]
): UserAuthoredProgram[] {
  const result = compileProject(services, files);
  return entryPaths.map((path) => {
    const program = compiledProgram(result, path);
    registerUserTile(program, services);
    return program;
  });
}

function actionTileFor(services: BrainServices, program: UserAuthoredProgram): IBrainTileDef {
  const metadata = buildUserTileMetadata(program, (name) => services.runtime.types.resolveByName(name));
  assert.ok(metadata, `expected tile metadata for ${program.key}`);
  return metadata.actionTile;
}

function registeredTypeId(services: BrainServices, identity: string): TypeId {
  const typeId = services.runtime.types.resolveByName(identity);
  assert.ok(typeId, `expected ${identity} to be registered`);
  return typeId;
}

/** Manufactures a struct variable tile from the registered variable factory. */
function manufactureVariable(services: BrainServices, typeId: TypeId, name: string): BrainTileVariableDef {
  const factory = services.edit.tiles.get(mkVariableFactoryTileId(typeId)) as BrainTileFactoryDef | undefined;
  assert.ok(factory, "expected the variable factory tile to be registered");
  const varTile = factory.manufacture(factory, { name });
  assert.ok(varTile, "expected the factory to manufacture a variable tile");
  return varTile as BrainTileVariableDef;
}

function accessorTile(services: BrainServices, typeId: TypeId, fieldName: string): IBrainTileDef {
  const tile = services.edit.tiles.get(mkAccessorTileId(typeId, fieldName));
  assert.ok(tile, `expected the '${fieldName}' accessor tile to be registered`);
  return tile;
}

function mkNumVar(name: string): BrainTileVariableDef {
  const uniqueId = `nested-${name}`;
  return new BrainTileVariableDef(mkVariableTileId(uniqueId), name, CoreTypeIds.Number, uniqueId);
}

function mkNumberLiteral(services: BrainServices, n: number): BrainTileLiteralDef {
  return new BrainTileLiteralDef(CoreTypeIds.Number, n, {}, services);
}

function newBrain(services: BrainServices): { brainDef: BrainDef; page: BrainPageDef; rule: BrainRuleDef } {
  const brainDef = new BrainDef(services);
  const pageResult = brainDef.appendNewPage();
  assert.ok(pageResult.success);
  const page = pageResult.value!.page as BrainPageDef;
  return { brainDef, page, rule: page.children().get(0)! as BrainRuleDef };
}

function runBrain(brainDef: BrainDef, ticks: number): IBrain {
  const brain = brainDef.compile();
  brain.initialize();
  brain.startup();
  for (let i = 0; i < ticks; i++) {
    brain.think((i + 1) * 16);
  }
  return brain;
}

function num(brain: IBrain, name: string): number | undefined {
  const v: Value | undefined = brain.getVariable(name);
  return v === undefined ? undefined : extractNumberValue(v);
}

function appendTiles(rule: BrainRuleDef, tiles: readonly IBrainTileDef[]): void {
  for (const tile of tiles) {
    __test__appendTile(rule.do(), tile as never);
  }
}

function suggestFor(
  services: BrainServices,
  placed: readonly IBrainTileDef[],
  extraTiles: readonly IBrainTileDef[] = []
): TileSuggestionResult {
  const extraCatalog = new TileCatalog();
  for (const tile of extraTiles) {
    extraCatalog.registerTileDef(tile);
  }
  const expr: Expr = parseTilesForSuggestions(List.from(placed));
  const ctx: InsertionContext = { ruleSide: RuleSide.When, expr };
  return suggestTiles(ctx, List.from<ITileCatalog>([services.edit.tiles, extraCatalog]), services);
}

function allSuggestedIds(result: TileSuggestionResult): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < result.exact.size(); i++) ids.add(result.exact.get(i).tileDef.tileId);
  for (let i = 0; i < result.withConversion.size(); i++) ids.add(result.withConversion.get(i).tileDef.tileId);
  return ids;
}

function structInfo(program: UserAuthoredProgram, identity: string): ArtifactStructTypeInfo {
  const info = program.structTypes?.find((s) => s.identity === identity);
  assert.ok(info, `expected a collected struct type ${identity}`);
  return info;
}

/** Asserts the outer struct's first field carries the inner struct's type id. */
function assertNestedShape(
  program: UserAuthoredProgram,
  innerIdentity: string,
  outerIdentity: string
): { inner: ArtifactStructTypeInfo; outer: ArtifactStructTypeInfo } {
  const inner = structInfo(program, innerIdentity);
  const outer = structInfo(program, outerIdentity);
  assert.equal(outer.fields[0].typeId, inner.typeId, "the struct-typed field carries the inner struct's type");
  assert.equal(outer.fields[1].typeId, CoreTypeIds.Number);
  return { inner, outer };
}

describe("nested StructType fields: declaration-order independence", () => {
  const defsEntry = `import { Sensor, type Context } from "mindcraft";
import { Position, Sprite } from "./defs";

export default Sensor({
  name: "spawn sprite", inline: true,
  returnType: Sprite,
  onExecute(ctx: Context): Sprite {
    return Sprite({ pos: Position({ x: 3, y: 4 }), hp: 7 });
  },
});
`;
  const positionBlock = `export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: "number" },
});
export type Position = StructOf<typeof Position>;
`;
  const spriteBlock = `export const Sprite = StructType({
  name: "sprite",
  fields: { pos: Position, hp: NumberType },
});
export type Sprite = StructOf<typeof Sprite>;
`;
  const header = `import { NumberType, StructType, type StructOf } from "mindcraft";\n\n`;

  test("one module declaring inner above outer compiles", () => {
    const services = __test__createBrainServices();
    const result = compileProject(services, {
      "defs.ts": `${header}${positionBlock}\n${spriteBlock}`,
      "stick.ts": defsEntry,
    });
    const program = compiledProgram(result, "stick.ts");
    assertNestedShape(
      program,
      qualifiedClassName(TEST_PROJECT_NAMESPACE, "/defs.ts", "Position"),
      qualifiedClassName(TEST_PROJECT_NAMESPACE, "/defs.ts", "Sprite")
    );
  });

  test("one module declaring inner below outer fails with TypeScript's own use-before-declaration error", () => {
    // Referencing a `const` binding above its declaration is a TypeScript
    // error (and a temporal-dead-zone throw at runtime), so this layout fails
    // exactly as it would under tsc -- deterministically, before lowering.
    const services = __test__createBrainServices();
    const result = compileProject(services, {
      "defs.ts": `${header}${spriteBlock}\n${positionBlock}`,
      "stick.ts": defsEntry,
    });
    const defsErrors = result.tsErrors.get("defs.ts");
    assert.ok(defsErrors && defsErrors.length > 0, "TypeScript rejects the use-before-declaration field reference");
    assert.ok(
      defsErrors.some((d) => /used before its declaration/.test(d.message)),
      `expected a use-before-declaration error, got ${JSON.stringify(defsErrors)}`
    );
  });

  test("the outer struct's module imports the inner struct's module", () => {
    const services = __test__createBrainServices();
    const result = compileProject(services, {
      "position.ts": POSITION_SOURCE,
      "sprite.ts": SPRITE_SOURCE,
      "spawn.ts": SPAWN_SOURCE,
    });
    const program = compiledProgram(result, "spawn.ts");
    assertNestedShape(program, POSITION_IDENTITY, SPRITE_IDENTITY);
  });

  test("the entry module itself declares the outer struct over an imported inner", () => {
    const services = __test__createBrainServices();
    const entryDeclaredOuter = `import { NumberType, Sensor, StructType, type Context, type StructOf } from "mindcraft";
import { Position } from "./position";

const Sprite = StructType({
  name: "sprite",
  fields: { pos: Position, hp: NumberType },
});
type Sprite = StructOf<typeof Sprite>;

export default Sensor({
  name: "spawn sprite", inline: true,
  returnType: Sprite,
  onExecute(ctx: Context): Sprite {
    return Sprite({ pos: Position({ x: 3, y: 4 }), hp: 7 });
  },
});
`;
    const result = compileProject(services, { "position.ts": POSITION_SOURCE, "spawn.ts": entryDeclaredOuter });
    const program = compiledProgram(result, "spawn.ts");
    assertNestedShape(program, POSITION_IDENTITY, qualifiedClassName(TEST_PROJECT_NAMESPACE, "/spawn.ts", "Sprite"));
  });

  test("a third module composes structs from two sibling modules, either import order", () => {
    const healthSource = `import { NumberType, StructType, type StructOf } from "mindcraft";

export const Health = StructType({
  name: "health",
  fields: { amount: NumberType },
});
export type Health = StructOf<typeof Health>;
`;
    const particleSource = (
      firstImport: string,
      secondImport: string
    ) => `import { StructType, type StructOf } from "mindcraft";
${firstImport}
${secondImport}

export const Particle = StructType({
  name: "particle",
  fields: { pos: Position, health: Health },
});
export type Particle = StructOf<typeof Particle>;
`;
    const particleEntry = `import { Sensor, type Context } from "mindcraft";
import { Health } from "./health";
import { Particle } from "./particle";
import { Position } from "./position";

export default Sensor({
  name: "spawn particle",
  returnType: Particle,
  onExecute(ctx: Context): Particle {
    return Particle({ pos: Position({ x: 1, y: 2 }), health: Health({ amount: 5 }) });
  },
});
`;
    const importPosition = `import { Position } from "./position";`;
    const importHealth = `import { Health } from "./health";`;

    for (const [first, second] of [
      [importPosition, importHealth],
      [importHealth, importPosition],
    ]) {
      const services = __test__createBrainServices();
      const result = compileProject(services, {
        "position.ts": POSITION_SOURCE,
        "health.ts": healthSource,
        "particle.ts": particleSource(first, second),
        "spawn.ts": particleEntry,
      });
      const program = compiledProgram(result, "spawn.ts");
      const particle = structInfo(program, qualifiedClassName(TEST_PROJECT_NAMESPACE, "/particle.ts", "Particle"));
      assert.equal(particle.fields[0].typeId, structInfo(program, POSITION_IDENTITY).typeId);
      assert.equal(
        particle.fields[1].typeId,
        structInfo(program, qualifiedClassName(TEST_PROJECT_NAMESPACE, "/health.ts", "Health")).typeId
      );
    }
  });
});

describe("nested StructType fields: recursive containment", () => {
  test("a struct containing itself through an alias module reports the cycle", () => {
    const services = __test__createBrainServices();
    const nodeSource = `import { StructType, type StructTypeBinding } from "mindcraft";
import { NodeRef } from "./node-ref";

type NodeValue = { next: NodeValue };
export const Node: StructTypeBinding<NodeValue> = StructType({
  name: "node",
  fields: { next: NodeRef },
});
export function nodeDepth(): number {
  return 1;
}
`;
    const nodeRefSource = `export { Node as NodeRef } from "./node";
`;
    const entrySource = `import { Sensor, type Context } from "mindcraft";
import { nodeDepth } from "./node";

export default Sensor({
  name: "node depth",
  onExecute(ctx: Context): number {
    return nodeDepth();
  },
});
`;
    const result = compileProject(services, {
      "node.ts": nodeSource,
      "node-ref.ts": nodeRefSource,
      "stick.ts": entrySource,
    });
    const diags = entryDiagnostics(result, "stick.ts");
    expectDiagnostic(diags, LoweringDiagCode.StructTypeRecursiveField);
    const diag = diags.find((d) => d.code === LoweringDiagCode.StructTypeRecursiveField);
    assert.ok(diag);
    assert.match(diag.message, /Node -> Node/, "the diagnostic names the self-containment cycle");
  });

  test("mutually recursive structs across modules report the cycle, not an unknown type", () => {
    const services = __test__createBrainServices();
    const aSource = `import { StructType, type StructTypeBinding } from "mindcraft";
import { B } from "./b";

type AValue = { b: BValue };
type BValue = { a: AValue };
export const A: StructTypeBinding<AValue> = StructType({
  name: "a",
  fields: { b: B },
});
export function useA(): number {
  return 1;
}
`;
    const bSource = `import { StructType, type StructTypeBinding } from "mindcraft";
import { A } from "./a";

type AValue = { b: BValue };
type BValue = { a: AValue };
export const B: StructTypeBinding<BValue> = StructType({
  name: "b",
  fields: { a: A },
});
`;
    const entrySource = `import { Sensor, type Context } from "mindcraft";
import { useA } from "./a";

export default Sensor({
  name: "use a",
  onExecute(ctx: Context): number {
    return useA();
  },
});
`;
    const result = compileProject(services, { "a.ts": aSource, "b.ts": bSource, "stick.ts": entrySource });
    const diags = entryDiagnostics(result, "stick.ts");
    expectDiagnostic(diags, LoweringDiagCode.StructTypeRecursiveField);
    const cycleDiags = diags.filter((d) => d.code === LoweringDiagCode.StructTypeRecursiveField);
    assert.equal(cycleDiags.length, 1, `expected one cycle diagnostic, got ${JSON.stringify(diags)}`);
    assert.match(cycleDiags[0].message, /(A -> B -> A|B -> A -> B)/, "the diagnostic names the full cycle");
    assert.equal(
      diags.filter((d) => d.code === LoweringDiagCode.StructTypeFieldTypeUnresolvable).length,
      0,
      "cycle members are not misreported as unknown types"
    );
  });

  test("a struct composing a recursive pair fails without a second misleading diagnostic", () => {
    const services = __test__createBrainServices();
    const aSource = `import { StructType, type StructTypeBinding } from "mindcraft";
import { B } from "./b";

type AValue = { b: BValue };
type BValue = { a: AValue };
export const A: StructTypeBinding<AValue> = StructType({
  name: "a",
  fields: { b: B },
});
`;
    const bSource = `import { StructType, type StructTypeBinding } from "mindcraft";
import { A } from "./a";

type AValue = { b: BValue };
type BValue = { a: AValue };
export const B: StructTypeBinding<BValue> = StructType({
  name: "b",
  fields: { a: A },
});
`;
    const wrapperSource = `import { NumberType, StructType } from "mindcraft";
import { A } from "./a";

export const Wrapper = StructType({
  name: "wrapper",
  fields: { a: A, tag: NumberType },
});
export function useWrapper(): number {
  return 2;
}
`;
    const entrySource = `import { Sensor, type Context } from "mindcraft";
import { useWrapper } from "./wrapper";

export default Sensor({
  name: "use wrapper",
  onExecute(ctx: Context): number {
    return useWrapper();
  },
});
`;
    const result = compileProject(services, {
      "a.ts": aSource,
      "b.ts": bSource,
      "wrapper.ts": wrapperSource,
      "stick.ts": entrySource,
    });
    const diags = entryDiagnostics(result, "stick.ts");
    expectDiagnostic(diags, LoweringDiagCode.StructTypeRecursiveField);
    assert.equal(
      diags.filter((d) => d.code === LoweringDiagCode.StructTypeFieldTypeUnresolvable).length,
      0,
      "the dependent struct is not misreported as naming an unknown type"
    );
  });
});

describe("nested StructType fields: end to end", () => {
  function registerNested(services: BrainServices): {
    spawn: UserAuthoredProgram;
    spriteTypeId: TypeId;
    positionTypeId: TypeId;
  } {
    const [spawn] = compileAndRegister(
      services,
      { "position.ts": POSITION_SOURCE, "sprite.ts": SPRITE_SOURCE, "spawn.ts": SPAWN_SOURCE },
      ["spawn.ts"]
    );
    return {
      spawn,
      spriteTypeId: registeredTypeId(services, SPRITE_IDENTITY),
      positionTypeId: registeredTypeId(services, POSITION_IDENTITY),
    };
  }

  test("the struct-typed field's accessor tile outputs the nested struct type", () => {
    const services = __test__createBrainServices();
    const { spriteTypeId, positionTypeId } = registerNested(services);
    const accPos = accessorTile(services, spriteTypeId, "pos") as BrainTileAccessorDef;
    assert.equal(accPos.fieldTypeId, positionTypeId, "the pos accessor outputs the position struct type");
    const accHp = accessorTile(services, spriteTypeId, "hp") as BrainTileAccessorDef;
    assert.equal(accHp.fieldTypeId, CoreTypeIds.Number);
  });

  test("a nested factory value reads back through chained accessor tiles", () => {
    const services = __test__createBrainServices();
    const { spawn, spriteTypeId, positionTypeId } = registerNested(services);
    const spawnTile = actionTileFor(services, spawn);
    const opAssign = new BrainTileOperatorDef("assign", {}, services);

    const { brainDef, page, rule } = newBrain(services);
    const xVar = mkNumVar("spawn-x");
    appendTiles(rule, [
      xVar,
      opAssign,
      spawnTile,
      accessorTile(services, spriteTypeId, "pos"),
      accessorTile(services, positionTypeId, "x"),
    ]);
    const hpVar = mkNumVar("spawn-hp");
    appendTiles(page.appendNewRule(), [hpVar, opAssign, spawnTile, accessorTile(services, spriteTypeId, "hp")]);

    const brain = runBrain(brainDef, 1);
    assert.equal(num(brain, xVar.varName), 3, "the chained accessor reads the nested field");
    assert.equal(num(brain, hpVar.varName), 7, "the flat accessor reads the top-level field");
  });

  test("the picker offers the nested struct's accessors after the struct-typed accessor", () => {
    const services = __test__createBrainServices();
    const { spawn, spriteTypeId, positionTypeId } = registerNested(services);
    const spawnTile = actionTileFor(services, spawn);
    const numVar = mkNumVar("dot-nested-x");
    const opAssign = new BrainTileOperatorDef("assign", {}, services);
    const suggested = allSuggestedIds(
      suggestFor(services, [numVar, opAssign, spawnTile, accessorTile(services, spriteTypeId, "pos")], [numVar])
    );
    assert.ok(suggested.has(mkAccessorTileId(positionTypeId, "x")), "the nested x accessor composes after pos");
    assert.ok(suggested.has(mkAccessorTileId(positionTypeId, "y")), "the nested y accessor composes after pos");
  });

  test("brain-variable store deep-copies at both nesting levels", () => {
    const services = __test__createBrainServices();
    const { spawn, spriteTypeId, positionTypeId } = registerNested(services);
    const spawnTile = actionTileFor(services, spawn);
    const opAssign = new BrainTileOperatorDef("assign", {}, services);
    const accPos = accessorTile(services, spriteTypeId, "pos");
    const accHp = accessorTile(services, spriteTypeId, "hp");
    const accX = accessorTile(services, positionTypeId, "x");

    const spriteA = manufactureVariable(services, spriteTypeId, "sprite-a");
    const spriteB = manufactureVariable(services, spriteTypeId, "sprite-b");

    const { brainDef, page, rule } = newBrain(services);
    brainDef.catalog().registerTileDef(spriteA);
    brainDef.catalog().registerTileDef(spriteB);

    // r1: spriteA := spawn sprite
    appendTiles(rule, [spriteA, opAssign, spawnTile]);
    // r2: spriteB := spriteA      (variable into variable: a deep copy)
    appendTiles(page.appendNewRule(), [spriteB, opAssign, spriteA]);
    // r3: spriteA.hp := 90        (mutate the source at the top level)
    appendTiles(page.appendNewRule(), [spriteA, accHp, opAssign, mkNumberLiteral(services, 90)]);
    // r4: spriteA.pos.x := 99     (mutate the source at the nested level)
    appendTiles(page.appendNewRule(), [spriteA, accPos, accX, opAssign, mkNumberLiteral(services, 99)]);
    // r5..r8: read back both variables at both levels
    const aHp = mkNumVar("a-hp");
    appendTiles(page.appendNewRule(), [aHp, opAssign, spriteA, accHp]);
    const bHp = mkNumVar("b-hp");
    appendTiles(page.appendNewRule(), [bHp, opAssign, spriteB, accHp]);
    const aX = mkNumVar("a-x");
    appendTiles(page.appendNewRule(), [aX, opAssign, spriteA, accPos, accX]);
    const bX = mkNumVar("b-x");
    appendTiles(page.appendNewRule(), [bX, opAssign, spriteB, accPos, accX]);

    const brain = runBrain(brainDef, 1);
    assert.equal(num(brain, aHp.varName), 90, "the top-level mutation reached the source variable");
    assert.equal(num(brain, aX.varName), 99, "the nested mutation reached the source variable");
    assert.equal(num(brain, bHp.varName), 7, "the copy's top-level field is unaffected");
    assert.equal(num(brain, bX.varName), 3, "the copy's nested field is unaffected");
  });

  function buildDocBrain(services: BrainServices): {
    json: ReturnType<BrainDef["toJson"]>;
    varName: string;
    readName: string;
    spriteTypeId: TypeId;
  } {
    const { spawn, spriteTypeId, positionTypeId } = registerNested(services);
    const spawnTile = actionTileFor(services, spawn);
    const opAssign = new BrainTileOperatorDef("assign", {}, services);
    const spriteVar = manufactureVariable(services, spriteTypeId, "doc-sprite");

    const { brainDef, page, rule } = newBrain(services);
    brainDef.catalog().registerTileDef(spriteVar);
    appendTiles(rule, [spriteVar, opAssign, spawnTile]);
    const read = mkNumVar("doc-nested-x");
    brainDef.catalog().registerTileDef(read);
    appendTiles(page.appendNewRule(), [
      read,
      opAssign,
      spriteVar,
      accessorTile(services, spriteTypeId, "pos"),
      accessorTile(services, positionTypeId, "x"),
    ]);

    return { json: brainDef.toJson(), varName: spriteVar.varName, readName: read.varName, spriteTypeId };
  }

  test("a document with a nested-type variable persists its type and reloads runnable", () => {
    const services = __test__createBrainServices();
    const { json, varName, readName, spriteTypeId } = buildDocBrain(services);

    const varEntry = json.catalog.find(
      (tile) => tile.kind === "variable" && (tile as { varName?: string }).varName === varName
    );
    assert.ok(varEntry, "the nested-type variable persists in the document catalog");
    assert.equal(
      (varEntry as { varType?: string }).varType,
      spriteTypeId,
      "the document serializes the variable's type"
    );

    const restored = BrainDef.fromJson(json, services);
    const brain = runBrain(restored as BrainDef, 1);
    assert.equal(num(brain, readName), 3, "the reloaded document compiles and runs identically");
  });

  test("reloading with the defining modules removed degrades to missing tiles, never a crash", () => {
    const authoring = __test__createBrainServices();
    const { json } = buildDocBrain(authoring);

    const fresh = __test__createBrainServices();
    const restored = BrainDef.fromJson(json, fresh);

    const kinds: string[] = [];
    const pages = restored.pages();
    for (let p = 0; p < pages.size(); p++) {
      const rules = pages.get(p)!.children();
      for (let r = 0; r < rules.size(); r++) {
        const tiles = rules.get(r)!.do().tiles();
        for (let t = 0; t < tiles.size(); t++) {
          kinds.push(tiles.get(t)!.kind);
        }
      }
    }
    assert.ok(kinds.includes("missing"), "unresolvable tiles degrade to missing-tile placeholders");

    const brain = runBrain(restored as BrainDef, 1);
    assert.deepEqual(brain.getVariable("doc-nested-x"), { t: NativeType.Nil }, "the degraded read evaluates to nil");
  });
});
