/**
 * User-declared struct types: a module-level `StructType({...})` registers a
 * program-local struct keyed by its exported symbol identity, the binding is
 * both a TypeRef and a callable factory, `accessors: true` derives accessor
 * tiles, and `variables: true` derives a variable-factory tile. Every golden
 * drives REAL compiled tiles and brains; the synthetic type is a `position`
 * struct `{x, y}`.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  type BrainServices,
  type IBrainTileDef,
  type ITileCatalog,
  mkAccessorTileId,
  mkOperatorTileId,
  mkVariableFactoryTileId,
  mkVariableTileId,
  RuleSide,
  TilePlacement,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { Expr } from "@mindcraft-lang/core/brain/compiler";
import {
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
  type TileSuggestionResult,
} from "@mindcraft-lang/core/brain/language-service";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  type BrainTileFactoryDef,
  BrainTileLiteralDef,
  BrainTileOperatorDef,
  BrainTileVariableDef,
  getCatalogFallbackLabel,
  TileCatalog,
} from "@mindcraft-lang/core/brain/tiles";
import {
  CoreOpId,
  CoreTypeIds,
  extractNumberValue,
  type IBrain,
  NativeType,
  type StructTypeDef,
  type TypeId,
  type Value,
} from "@mindcraft-lang/core/runtime";
import ts from "typescript";
import { buildCompiledActionBundle } from "../runtime/action-bundle.js";
import { registerUserTile } from "../runtime/registration-bridge.js";
import { buildUserTileMetadata } from "../runtime/user-tile-metadata.js";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { expectDiagnostic } from "../testsupport/diag-coverage.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { collectParams } from "./arg-spec-utils.js";
import { CompileDiagCode, LoweringDiagCode } from "./diag-codes.js";
import { extractStructTypeConfig } from "./lowering.js";
import { type CompileResult, type ProjectCompileResult, UserTileProject } from "./project.js";
import { qualifiedClassName } from "./symbol-keys.js";
import { structTypeConfigObject } from "./type-ref.js";
import type { UserAuthoredProgram } from "./types.js";
import { createVirtualCompilerHost } from "./virtual-host.js";

const POSITION_IDENTITY = qualifiedClassName(TEST_PROJECT_NAMESPACE, "/position.ts", "Position");

/** The declared type under test: ref-form and string-form field types together. */
const POSITION_SOURCE = `import { NumberType, StructType, type StructOf } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: "number" },
  accessors: true,
  variables: true,
});
export type Position = StructOf<typeof Position>;
`;

/** Sensor returning the declared type through the returnType config reference. */
const STICK_SOURCE = `import { Sensor, type Context } from "mindcraft";
import { Position } from "./position";

export default Sensor({
  name: "stick position", inline: true,
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 3, y: 4 });
  },
});
`;

/** A second importer of the same declared type. */
const SECOND_SOURCE = `import { Sensor, type Context } from "mindcraft";
import { Position } from "./position";

export default Sensor({
  name: "target position",
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 7, y: 9 });
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

function positionTypeId(services: BrainServices): TypeId {
  const typeId = services.runtime.types.resolveByName(POSITION_IDENTITY);
  assert.ok(typeId, "expected the position struct to be registered");
  return typeId;
}

/** Manufactures a struct variable tile from the registered variable factory. */
function manufactureVariable(services: BrainServices, typeId: TypeId, name: string): BrainTileVariableDef {
  const factory = services.edit.tiles.get(mkVariableFactoryTileId(typeId)) as BrainTileFactoryDef | undefined;
  assert.ok(factory, "expected the variable factory tile to be registered");
  assert.equal(factory.kind, "factory");
  assert.equal(factory.producedDataType, typeId);
  const varTile = factory.manufacture(factory, { name });
  assert.ok(varTile, "expected the factory to manufacture a variable tile");
  return varTile as BrainTileVariableDef;
}

function accessorTile(services: BrainServices, typeId: TypeId, fieldName: string): IBrainTileDef {
  const tile = services.edit.tiles.get(mkAccessorTileId(typeId, fieldName));
  assert.ok(tile, `expected the '${fieldName}' accessor tile to be registered`);
  return tile;
}

/**
 * Widens a compiled sensor tile to either rule side. The user-code sensor
 * surface has no placement control, and an argument-taking sensor cannot be
 * inline, so a DO-side read of one is only reachable with a widened tile.
 */
function widenToEitherSide(tile: IBrainTileDef): IBrainTileDef {
  tile.placement = TilePlacement.EitherSide;
  return tile;
}

function mkNumVar(name: string): BrainTileVariableDef {
  const uniqueId = `struct-${name}`;
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
    rule.do().appendTile(tile as never);
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

describe("StructType declarations: registration and identity", () => {
  test("a declaration registers one program-local struct with declared field order", () => {
    const services = __test__createBrainServices();
    const result = compileProject(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE });
    const program = compiledProgram(result, "stick.ts");

    assert.ok(program.structTypes);
    assert.equal(program.structTypes.length, 1);
    const info = program.structTypes[0];
    assert.equal(info.identity, POSITION_IDENTITY);
    assert.equal(info.name, "position");
    assert.equal(info.accessors, true);
    assert.equal(info.variables, true);
    assert.deepEqual(
      info.fields,
      [
        { name: "x", typeId: CoreTypeIds.Number },
        { name: "y", typeId: CoreTypeIds.Number },
      ],
      "ref-form and string-form field types resolve identically"
    );

    const typeId = positionTypeId(services);
    assert.equal(info.typeId, typeId);
    const typeDef = services.runtime.types.get(typeId);
    assert.ok(typeDef);
    assert.equal(typeDef.coreType, NativeType.Struct);
    const structDef = typeDef as StructTypeDef;
    assert.equal(structDef.fields.size(), 2);
    assert.equal(structDef.fields.get(0)!.name, "x");
    assert.equal(structDef.fields.get(0)!.fieldIndex, 0);
    assert.equal(structDef.fields.get(1)!.name, "y");
    assert.equal(structDef.fields.get(1)!.fieldIndex, 1);
    assert.equal(structDef.atomId, undefined, "a user struct is program-local (no atom id)");

    // The sensor's return type resolved through the binding reference.
    assert.equal(program.outputType, typeId);
  });

  test("the variable-factory tile reads with the struct display name, not the raw type id", () => {
    const services = __test__createBrainServices();
    const result = compileProject(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE });
    const stick = compiledProgram(result, "stick.ts");
    registerUserTile(stick, services);

    const typeId = positionTypeId(services);
    const factory = services.edit.tiles.get(mkVariableFactoryTileId(typeId));
    assert.ok(factory, "expected the variable factory tile to be registered");
    assert.equal(
      factory.metadata?.label,
      stick.structTypes![0].name,
      "the factory reads with the struct's display name"
    );
    assert.notEqual(
      factory.metadata?.label,
      getCatalogFallbackLabel(factory),
      "the label must not collapse to the mangled type-id fallback"
    );
  });

  test("two importing modules resolve to one type, one accessor tile set, one variable factory", () => {
    const services = __test__createBrainServices();
    const result = compileProject(services, {
      "position.ts": POSITION_SOURCE,
      "stick.ts": STICK_SOURCE,
      "target.ts": SECOND_SOURCE,
    });
    const stick = compiledProgram(result, "stick.ts");
    const target = compiledProgram(result, "target.ts");

    assert.equal(stick.structTypes![0].typeId, target.structTypes![0].typeId, "both importers share one type");
    assert.equal(stick.outputType, target.outputType);

    registerUserTile(stick, services);
    registerUserTile(target, services);

    const typeId = positionTypeId(services);
    accessorTile(services, typeId, "x");
    accessorTile(services, typeId, "y");
    manufactureVariable(services, typeId, "shared-check");

    // The bundle carries each derived tile exactly once.
    const bundle = buildCompiledActionBundle(result, { services });
    assert.ok(bundle);
    for (const tileId of [
      mkAccessorTileId(typeId, "x"),
      mkAccessorTileId(typeId, "y"),
      mkVariableFactoryTileId(typeId),
    ]) {
      assert.equal(
        bundle.tiles.filter((tile) => tile.tileId === tileId).length,
        1,
        `expected exactly one bundle tile ${tileId}`
      );
    }
  });
});

describe("StructType declarations: execution", () => {
  test("a struct-returning tile reads through accessor tiles in a running brain", () => {
    const services = __test__createBrainServices();
    const [stick] = compileAndRegister(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE }, [
      "stick.ts",
    ]);
    const stickTile = actionTileFor(services, stick);
    const typeId = positionTypeId(services);
    const opAssign = new BrainTileOperatorDef("assign", {}, services);

    const { brainDef, page, rule } = newBrain(services);
    const xVar = mkNumVar("stick-x");
    appendTiles(rule, [xVar, opAssign, stickTile, accessorTile(services, typeId, "x")]);
    const yVar = mkNumVar("stick-y");
    appendTiles(page.appendNewRule(), [yVar, opAssign, stickTile, accessorTile(services, typeId, "y")]);

    const brain = runBrain(brainDef, 1);
    assert.equal(num(brain, xVar.varName), 3);
    assert.equal(num(brain, yVar.varName), 4);
  });

  test("struct variables hold deep copies and read back through accessors", () => {
    const services = __test__createBrainServices();
    const [stick] = compileAndRegister(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE }, [
      "stick.ts",
    ]);
    const stickTile = actionTileFor(services, stick);
    const typeId = positionTypeId(services);
    const accX = accessorTile(services, typeId, "x");
    const opAssign = new BrainTileOperatorDef("assign", {}, services);

    const posA = manufactureVariable(services, typeId, "pos-a");
    const posB = manufactureVariable(services, typeId, "pos-b");
    assert.equal(posA.varType, typeId, "the factory manufactures variables of the declared type");

    const { brainDef, page, rule } = newBrain(services);
    brainDef.catalog().registerTileDef(posA);
    brainDef.catalog().registerTileDef(posB);

    // r1: posA := stick position    (struct into variable)
    appendTiles(rule, [posA, opAssign, stickTile]);
    // r2: posB := posA              (variable into variable: a deep copy)
    appendTiles(page.appendNewRule(), [posB, opAssign, posA]);
    // r3: posA.x := 99              (mutate the source after the copy)
    appendTiles(page.appendNewRule(), [posA, accX, opAssign, mkNumberLiteral(services, 99)]);
    // r4/r5: read both back
    const mutated = mkNumVar("mutated-x");
    appendTiles(page.appendNewRule(), [mutated, opAssign, posA, accX]);
    const copied = mkNumVar("copied-x");
    appendTiles(page.appendNewRule(), [copied, opAssign, posB, accX]);

    const brain = runBrain(brainDef, 1);
    assert.equal(num(brain, mutated.varName), 99, "the field write reached the source variable");
    assert.equal(num(brain, copied.varName), 3, "the stored copy is unaffected by the later mutation");
  });

  test("a fresh struct variable holds no value until first written", () => {
    const services = __test__createBrainServices();
    compileAndRegister(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE }, ["stick.ts"]);
    const typeId = positionTypeId(services);
    const posVar = manufactureVariable(services, typeId, "unwritten-pos");

    const { brainDef, rule } = newBrain(services);
    brainDef.catalog().registerTileDef(posVar);
    // The brain never writes the variable; a number rule keeps the page non-empty.
    const n = mkNumVar("noise");
    appendTiles(rule, [n, new BrainTileOperatorDef("assign", {}, services), mkNumberLiteral(services, 1)]);

    const brain = runBrain(brainDef, 1);
    assert.equal(brain.getVariable(posVar.varName), undefined, "an unwritten struct variable reads as absent");
  });

  test("a struct-typed anonymous param carries the value across the action boundary", () => {
    const services = __test__createBrainServices();
    const readerSource = `import { type Context, param, Sensor } from "mindcraft";
import { Position } from "./position";

export default Sensor({
  name: "read x",
  args: [param("pos", { type: Position, anonymous: true })],
  onExecute(ctx: Context, args: { pos: Position }): number {
    return args.pos.x;
  },
});
`;
    const [stick, reader] = compileAndRegister(
      services,
      { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE, "reader.ts": readerSource },
      ["stick.ts", "reader.ts"]
    );
    const typeId = positionTypeId(services);
    const opAssign = new BrainTileOperatorDef("assign", {}, services);
    const posVar = manufactureVariable(services, typeId, "param-pos");

    const { brainDef, page, rule } = newBrain(services);
    brainDef.catalog().registerTileDef(posVar);
    appendTiles(rule, [posVar, opAssign, actionTileFor(services, stick)]);
    const readVar = mkNumVar("param-x");
    appendTiles(page.appendNewRule(), [readVar, opAssign, widenToEitherSide(actionTileFor(services, reader)), posVar]);

    const brain = runBrain(brainDef, 1);
    assert.equal(num(brain, readVar.varName), 3, "the struct value crossed the anonymous param slot");
  });

  test("a struct-typed param and output leave no live AST node on the compiled program", () => {
    const services = __test__createBrainServices();
    const readerSource = `import { type Context, param, Sensor } from "mindcraft";
import { Position } from "./position";

export default Sensor({
  name: "read x",
  args: [param("pos", { type: Position, anonymous: true })],
  onExecute(ctx: Context, args: { pos: Position }): number {
    return args.pos.x;
  },
});
`;
    const outputSource = `import { Sensor, setOutput, type Context } from "mindcraft";
import { Position } from "./position";

export default Sensor({
  name: "position out",
  outputs: [{ name: "pos", type: Position }],
  onExecute(ctx: Context): number {
    setOutput(ctx, "pos", Position({ x: 5, y: 6 }));
    return 1;
  },
});
`;
    const [reader, output] = compileAndRegister(
      services,
      { "position.ts": POSITION_SOURCE, "reader.ts": readerSource, "out.ts": outputSource },
      ["reader.ts", "out.ts"]
    );

    const param = collectParams(reader.args)[0];
    assert.equal(param?.type, POSITION_IDENTITY, "the param type resolved to the struct identity");
    assert.equal(param?.typeNode, undefined, "the transient param typeNode is dropped after resolution");
    assert.equal(output.outputs?.[0]?.type, POSITION_IDENTITY, "the output type resolved to the struct identity");
    assert.equal(output.outputs?.[0]?.typeNode, undefined, "the transient output typeNode is dropped after resolution");

    // The metadata cache persists args and outputs via JSON.stringify; a retained
    // AST node makes that throw on its cyclic `parent` chain.
    assert.doesNotThrow(() => JSON.stringify({ args: reader.args, outputs: output.outputs }));
  });

  test("a struct value converts through a user conversion whose from-type is the declared struct", () => {
    const services = __test__createBrainServices();
    const conversionSource = `import { BufferType, Conversion } from "mindcraft";
import { Position } from "./position";

export default Conversion({
  id: "convposbuf000001",
  from: Position,
  to: BufferType,
  cost: 2,
  convert(pos: Position): Buffer {
    return Buffer.from([9, pos.x, pos.y]);
  },
});
`;
    const decoderSource = `import { type Context, param, Sensor } from "mindcraft";

export default Sensor({
  name: "decode packet",
  args: [param("packet", { type: "buffer", anonymous: true })],
  onExecute(ctx: Context, args: { packet: Buffer }): number {
    const b = args.packet;
    if (b.length() !== 3) return -2;
    return b.get(0) * 10000 + b.get(1) * 100 + b.get(2);
  },
});
`;
    const [stick, conversion, decoder] = compileAndRegister(
      services,
      {
        "position.ts": POSITION_SOURCE,
        "stick.ts": STICK_SOURCE,
        "pos-to-buffer.ts": conversionSource,
        "decoder.ts": decoderSource,
      },
      ["stick.ts", "pos-to-buffer.ts", "decoder.ts"]
    );
    const typeId = positionTypeId(services);
    assert.ok(conversion.conversion);
    assert.equal(conversion.conversion.fromType, typeId, "the conversion's from-type is the declared struct");

    const stickTile = actionTileFor(services, stick);
    const decoderTile = widenToEitherSide(actionTileFor(services, decoder));
    const opAssign = new BrainTileOperatorDef("assign", {}, services);
    const posVar = manufactureVariable(services, typeId, "packet-pos");

    const { brainDef, page, rule } = newBrain(services);
    brainDef.catalog().registerTileDef(posVar);
    appendTiles(rule, [posVar, opAssign, stickTile]);
    const decoded = mkNumVar("decoded");
    appendTiles(page.appendNewRule(), [decoded, opAssign, decoderTile, posVar]);

    const brain = runBrain(brainDef, 1);
    // Byte recipe [9, x, y] with {x: 3, y: 4} -> 9*10000 + 3*100 + 4.
    assert.equal(num(brain, decoded.varName), 90304, "the struct converted to the exact packet bytes");
  });
});

describe("StructType declarations: outputs and picker", () => {
  test("a struct-typed output tile carries the declared type and offers its accessors", () => {
    const services = __test__createBrainServices();
    const outputSource = `import { Sensor, setOutput, type Context } from "mindcraft";
import { Position } from "./position";

export default Sensor({
  name: "position out",
  outputs: [{ name: "pos", type: Position }],
  onExecute(ctx: Context): number {
    setOutput(ctx, "pos", Position({ x: 5, y: 6 }));
    return 1;
  },
});
`;
    const [outputSensor] = compileAndRegister(services, { "position.ts": POSITION_SOURCE, "out.ts": outputSource }, [
      "out.ts",
    ]);
    const typeId = positionTypeId(services);

    const metadata = buildUserTileMetadata(outputSensor, (name) => services.runtime.types.resolveByName(name));
    assert.ok(metadata);
    assert.equal(metadata.outputTiles.length, 1);
    assert.equal(metadata.outputTiles[0].outputType, typeId, "the output tile carries the declared struct type");

    const suggested = allSuggestedIds(suggestFor(services, [metadata.outputTiles[0]]));
    assert.ok(suggested.has(mkAccessorTileId(typeId, "x")), "the x accessor is offered on the output tile");
    assert.ok(suggested.has(mkAccessorTileId(typeId, "y")), "the y accessor is offered on the output tile");
  });

  test("the picker offers the assignment operator after a struct variable with no Assign overload", () => {
    const services = __test__createBrainServices();
    compileAndRegister(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE }, ["stick.ts"]);
    const typeId = positionTypeId(services);
    assert.equal(
      services.edit.operatorOverloads.resolve(CoreOpId.Assign, [typeId, typeId]),
      undefined,
      "no Assign overload is registered for the struct"
    );
    const posVar = manufactureVariable(services, typeId, "assign-pos");

    const expr: Expr = parseTilesForSuggestions(List.from<IBrainTileDef>([posVar]));
    const result = suggestTiles(
      { ruleSide: RuleSide.Do, expr },
      List.from<ITileCatalog>([services.edit.tiles]),
      services
    );
    assert.ok(
      allSuggestedIds(result).has(mkOperatorTileId(CoreOpId.Assign)),
      "the assignment operator is offered after a struct variable"
    );
  });

  test("the picker still offers the assignment operator after a second compile against a warm registry", () => {
    const services = __test__createBrainServices();
    compileAndRegister(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE }, ["stick.ts"]);
    // A second compile through the same warm services must not error.
    compileAndRegister(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE }, ["stick.ts"]);
    const typeId = positionTypeId(services);

    const posVar = manufactureVariable(services, typeId, "warm-assign-pos");
    const expr: Expr = parseTilesForSuggestions(List.from<IBrainTileDef>([posVar]));
    const result = suggestTiles(
      { ruleSide: RuleSide.Do, expr },
      List.from<ITileCatalog>([services.edit.tiles]),
      services
    );
    assert.ok(
      allSuggestedIds(result).has(mkOperatorTileId(CoreOpId.Assign)),
      "the assignment operator is still offered after a warm re-compile"
    );
  });

  test("deleting a struct from source removes its type, and re-adding restores the same id", () => {
    const services = __test__createBrainServices();
    compileAndRegister(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE }, ["stick.ts"]);
    const typeId = positionTypeId(services);

    // Recompile a project that no longer declares the struct: the compile pass
    // tears down the `::`-keyed user type.
    const bareSensor = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "bare sensor",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    compileProject(services, { "bare.ts": bareSensor });
    assert.equal(
      services.runtime.types.resolveByName(POSITION_IDENTITY),
      undefined,
      "the deleted struct type is gone from the registry"
    );

    // Re-adding the struct restores a working assignment target: the type
    // resolves to the same deterministic id and the picker offers `[=]` again.
    compileAndRegister(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE }, ["stick.ts"]);
    const reAddedTypeId = positionTypeId(services);
    assert.equal(reAddedTypeId, typeId, "the re-added struct resolves to the same deterministic type id");
    const posVar = manufactureVariable(services, reAddedTypeId, "readd-pos");
    const expr: Expr = parseTilesForSuggestions(List.from<IBrainTileDef>([posVar]));
    const result = suggestTiles(
      { ruleSide: RuleSide.Do, expr },
      List.from<ITileCatalog>([services.edit.tiles]),
      services
    );
    assert.ok(
      allSuggestedIds(result).has(mkOperatorTileId(CoreOpId.Assign)),
      "the re-added struct offers the assignment operator again"
    );
  });

  test("the picker offers accessors after a struct-returning sensor in a number-expected position", () => {
    const services = __test__createBrainServices();
    const [stick] = compileAndRegister(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE }, [
      "stick.ts",
    ]);
    const typeId = positionTypeId(services);
    const numVar = mkNumVar("dot-x");
    const opAssign = new BrainTileOperatorDef("assign", {}, services);
    const suggested = allSuggestedIds(
      suggestFor(services, [numVar, opAssign, actionTileFor(services, stick)], [numVar])
    );
    assert.ok(suggested.has(mkAccessorTileId(typeId, "x")), "the x accessor is offered to refine the struct value");
    assert.ok(suggested.has(mkAccessorTileId(typeId, "y")), "the y accessor is offered to refine the struct value");
  });
});

describe("StructType declarations: brain document round-trip", () => {
  function buildDocBrain(services: BrainServices): {
    json: ReturnType<BrainDef["toJson"]>;
    varName: string;
    readName: string;
  } {
    const [stick] = compileAndRegister(services, { "position.ts": POSITION_SOURCE, "stick.ts": STICK_SOURCE }, [
      "stick.ts",
    ]);
    const stickTile = actionTileFor(services, stick);
    const typeId = positionTypeId(services);
    const opAssign = new BrainTileOperatorDef("assign", {}, services);
    const posVar = manufactureVariable(services, typeId, "doc-pos");

    const { brainDef, page, rule } = newBrain(services);
    brainDef.catalog().registerTileDef(posVar);
    appendTiles(rule, [posVar, opAssign, stickTile]);
    const read = mkNumVar("doc-x");
    brainDef.catalog().registerTileDef(read);
    appendTiles(page.appendNewRule(), [read, opAssign, posVar, accessorTile(services, typeId, "x")]);

    return { json: brainDef.toJson(), varName: posVar.varName, readName: read.varName };
  }

  test("a document with a struct variable persists its type and reloads runnable", () => {
    const services = __test__createBrainServices();
    const { json, varName, readName } = buildDocBrain(services);
    const typeId = positionTypeId(services);

    const varEntry = json.catalog.find(
      (tile) => tile.kind === "variable" && (tile as { varName?: string }).varName === varName
    );
    assert.ok(varEntry, "the struct variable persists in the document catalog");
    assert.equal((varEntry as { varType?: string }).varType, typeId, "the document serializes the variable's type");

    const restored = BrainDef.fromJson(json, services);
    const brain = runBrain(restored as BrainDef, 1);
    assert.equal(num(brain, readName), 3, "the reloaded document compiles and runs identically");
  });

  test("reloading with the defining module removed degrades to missing tiles, never a crash", () => {
    const authoring = __test__createBrainServices();
    const { json } = buildDocBrain(authoring);

    // A fresh environment that never compiled the struct module: the type,
    // the sensor tile, and the accessor tiles are all unregistered.
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
    assert.ok(kinds.includes("variable"), "the struct variable itself still deserializes");

    // The degraded document stays loadable end to end: the affected read
    // evaluates to nil.
    const brain = runBrain(restored as BrainDef, 1);
    assert.deepEqual(brain.getVariable("doc-x"), { t: NativeType.Nil }, "the degraded read evaluates to nil");
  });
});

describe("StructType declarations: shorthand and module-private bindings", () => {
  test("shorthand config members resolve to their declared values", () => {
    const services = __test__createBrainServices();
    const positionSource = `import { NumberType, StructType, type StructOf } from "mindcraft";

const name = "position";
const accessors = true;
const variables = true;
const x = NumberType;

export const Position = StructType({
  name,
  fields: { x, y: "number" },
  accessors,
  variables,
});
export type Position = StructOf<typeof Position>;
`;
    const result = compileProject(services, { "position.ts": positionSource, "stick.ts": STICK_SOURCE });
    const program = compiledProgram(result, "stick.ts");

    const info = program.structTypes![0];
    assert.equal(info.name, "position");
    assert.equal(info.accessors, true);
    assert.equal(info.variables, true);
    assert.deepEqual(info.fields, [
      { name: "x", typeId: CoreTypeIds.Number },
      { name: "y", typeId: CoreTypeIds.Number },
    ]);

    registerUserTile(program, services);
    const typeId = positionTypeId(services);
    accessorTile(services, typeId, "x");
    manufactureVariable(services, typeId, "shorthand-check");
  });

  test("a module-private binding works through the module's exported helper", () => {
    const services = __test__createBrainServices();
    const positionSource = `import { StructType, type StructOf } from "mindcraft";

const Position = StructType({
  name: "position",
  fields: { x: "number", y: "number" },
});
type Position = StructOf<typeof Position>;

export function mkOrigin(): Position {
  return Position({ x: 12, y: 7 });
}
export type { Position };
`;
    const stickSource = `import { Sensor, type Context } from "mindcraft";
import { mkOrigin } from "./position";

export default Sensor({
  name: "origin x", inline: true,
  onExecute(ctx: Context): number {
    return mkOrigin().x;
  },
});
`;
    const [origin] = compileAndRegister(services, { "position.ts": positionSource, "stick.ts": stickSource }, [
      "stick.ts",
    ]);
    assert.ok(positionTypeId(services), "the private binding's type registers");

    const opAssign = new BrainTileOperatorDef("assign", {}, services);
    const { brainDef, rule } = newBrain(services);
    const v = mkNumVar("origin-x");
    appendTiles(rule, [v, opAssign, actionTileFor(services, origin)]);
    const brain = runBrain(brainDef, 1);
    assert.equal(num(brain, v.varName), 12, "the helper constructs the private struct type");
  });
});

describe("StructType declarations: diagnostics", () => {
  function structDiag(services: BrainServices, positionSource: string): CompileResult["diagnostics"] {
    const result = compileProject(services, { "position.ts": positionSource, "stick.ts": STICK_SOURCE });
    return entryDiagnostics(result, "stick.ts");
  }

  test("a duplicate field name is reported by the extractor", () => {
    const source = `const Position = StructType({
  name: "position",
  fields: { x: "number", x: "number" },
});
`;
    const host = createVirtualCompilerHost(new Map([["/dup.ts", source]]), { noLib: true, skipLibCheck: true });
    const program = ts.createProgram(["/dup.ts"], { noLib: true, skipLibCheck: true }, host);
    const sourceFile = program.getSourceFile("/dup.ts");
    assert.ok(sourceFile);
    const statement = sourceFile.statements[0];
    assert.ok(ts.isVariableStatement(statement));
    const config = structTypeConfigObject(statement.declarationList.declarations[0].initializer);
    assert.ok(config, "expected the StructType config object");

    const diagnostics: CompileResult["diagnostics"] = [];
    const parts = extractStructTypeConfig(config, program.getTypeChecker(), TEST_PROJECT_NAMESPACE, diagnostics);
    assert.equal(parts, undefined);
    expectDiagnostic(diagnostics, LoweringDiagCode.StructTypeDuplicateField);
  });

  test("a non-literal name is reported", () => {
    const services = __test__createBrainServices();
    const diags = structDiag(
      services,
      `import { StructType, type StructOf } from "mindcraft";

export const Position = StructType({
  name: 42 as any,
  fields: { x: "number", y: "number" },
});
export type Position = StructOf<typeof Position>;
`
    );
    expectDiagnostic(diags, LoweringDiagCode.StructTypeNameNotStringLiteral);
  });

  test("malformed and empty fields are reported", () => {
    const services = __test__createBrainServices();
    const notObject = structDiag(
      services,
      `import { StructType, type StructOf } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: 42 as any,
});
export type Position = StructOf<typeof Position>;
`
    );
    expectDiagnostic(notObject, LoweringDiagCode.StructTypeMemberInvalid);

    const empty = structDiag(
      services,
      `import { StructType, type StructOf } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: {},
});
export type Position = StructOf<typeof Position>;
`
    );
    expectDiagnostic(
      empty,
      LoweringDiagCode.StructTypeMemberInvalid,
      "expected StructTypeMemberInvalid for empty fields"
    );
  });

  test("a non-literal config argument is reported", () => {
    const services = __test__createBrainServices();
    const positionSource = `import { StructType, type StructOf } from "mindcraft";

const config = {
  name: "position",
  fields: { x: "number", y: "number" },
} as const;

export const Position = StructType(config);
export type Position = StructOf<typeof Position>;
`;
    // An entry using only the annotation reaches collection, which reports the
    // config shape precisely.
    const annotationStick = `import { Sensor, type Context } from "mindcraft";
import { Position } from "./position";

export default Sensor({
  name: "stick position", inline: true,
  onExecute(ctx: Context): Position {
    return Position({ x: 3, y: 4 });
  },
});
`;
    const result = compileProject(services, { "position.ts": positionSource, "stick.ts": annotationStick });
    expectDiagnostic(entryDiagnostics(result, "stick.ts"), LoweringDiagCode.StructTypeConfigNotObjectLiteral);

    // An entry naming the binding as a returnType ref reports the same root
    // cause at the reference site.
    const refResult = compileProject(services, { "position.ts": positionSource, "stick.ts": STICK_SOURCE });
    const refDiags = entryDiagnostics(refResult, "stick.ts");
    const refDiag = refDiags.find((d) => d.code === CompileDiagCode.UnresolvedTypeReference);
    assert.ok(refDiag, `expected UnresolvedTypeReference, got ${JSON.stringify(refDiags)}`);
    assert.match(refDiag.message, /config is not a single inline object literal/);
  });

  test("a spread config member and an unresolvable shorthand value are reported", () => {
    const services = __test__createBrainServices();
    const spread = structDiag(
      services,
      `import { StructType, type StructOf } from "mindcraft";

const base = { accessors: true };

export const Position = StructType({
  name: "position",
  fields: { x: "number", y: "number" },
  ...base,
});
export type Position = StructOf<typeof Position>;
`
    );
    expectDiagnostic(spread, LoweringDiagCode.StructTypeMemberInvalid, "expected StructTypeMemberInvalid for spread");

    const nonLiteralShorthand = structDiag(
      services,
      `import { StructType, type StructOf } from "mindcraft";

const accessors = 1 < 2;

export const Position = StructType({
  name: "position",
  fields: { x: "number", y: "number" },
  accessors,
});
export type Position = StructOf<typeof Position>;
`
    );
    expectDiagnostic(
      nonLiteralShorthand,
      LoweringDiagCode.StructTypeMemberInvalid,
      "expected StructTypeMemberInvalid for a non-literal shorthand value"
    );
  });

  test("a non-literal accessors member is reported", () => {
    const services = __test__createBrainServices();
    const diags = structDiag(
      services,
      `import { StructType, type StructOf } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: { x: "number", y: "number" },
  accessors: 1 < 2,
});
export type Position = StructOf<typeof Position>;
`
    );
    expectDiagnostic(diags, LoweringDiagCode.StructTypeMemberInvalid);
  });

  test("an unresolvable field type is reported", () => {
    const services = __test__createBrainServices();
    const diags = structDiag(
      services,
      `import { StructType, type StructOf } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: { x: "bogusType", y: "number" },
});
export type Position = StructOf<typeof Position>;
`
    );
    expectDiagnostic(diags, LoweringDiagCode.StructTypeFieldTypeUnresolvable);
  });

  test("an unresolvable returnType reference is reported", () => {
    const services = __test__createBrainServices();
    const source = `import { Sensor, type Context, type TypeRef } from "mindcraft";

const NotAType = null as unknown as TypeRef<number>;

export default Sensor({
  name: "bad return",
  returnType: NotAType,
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const result = compileProject(services, { "bad.ts": source });
    const diags = entryDiagnostics(result, "bad.ts");
    assert.ok(
      diags.some((d) => d.code === CompileDiagCode.UnresolvedTypeReference),
      `expected UnresolvedTypeReference, got ${JSON.stringify(diags)}`
    );
  });
});
