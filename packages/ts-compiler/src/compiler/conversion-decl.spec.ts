/**
 * User-code implicit conversions: a module-level `Conversion({...})` compiles
 * its `convert` function as a user artifact, registers into the shared
 * conversion registry keyed by `(fromType, toType)`, and brain call sites that
 * need the conversion emit a bytecode action call bound to the artifact at
 * link. Every golden drives REAL compiled programs and brains; the synthetic
 * consumer converts number -> buffer with the byte recipe [7, n, n+1].
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Dict, List } from "@mindcraft-lang/core";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  type BrainServices,
  type IBrainTileDef,
  type ITileCatalog,
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
  BrainTileLiteralDef,
  BrainTileOperatorDef,
  BrainTileVariableDef,
  TileCatalog,
} from "@mindcraft-lang/core/brain/tiles";
import {
  CoreTypeIds,
  extractNumberValue,
  type IBrain,
  isBytecodeConversion,
  mkParameterTileId,
  type Value,
} from "@mindcraft-lang/core/runtime";
import ts from "typescript";
import { registerUserTile } from "../runtime/registration-bridge.js";
import { buildUserTileMetadata } from "../runtime/user-tile-metadata.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { extractDescriptor } from "./descriptor.js";
import { CompileDiagCode, DescriptorDiagCode, LoweringDiagCode } from "./diag-codes.js";
import { type CompileResult, type ProjectCompileResult, UserTileProject } from "./project.js";
import type { UserAuthoredProgram } from "./types.js";
import { createVirtualCompilerHost } from "./virtual-host.js";

const NUM_TO_BUF_ID = "convnumbuf000001";

/** Ref-form declaration of the synthetic number -> buffer conversion. */
const REF_CONVERSION_SOURCE = `import { BufferType, Conversion, NumberType } from "mindcraft";

export default Conversion({
  id: ${JSON.stringify(NUM_TO_BUF_ID)},
  from: NumberType,
  to: BufferType,
  cost: 2,
  convert(value: number): Buffer {
    return Buffer.from([7, value, value + 1]);
  },
});
`;

/** String-form declaration of the same conversion (dual-acceptance equivalence). */
const STRING_CONVERSION_SOURCE = `import { Conversion } from "mindcraft";

export default Conversion({
  id: ${JSON.stringify(NUM_TO_BUF_ID)},
  from: "number",
  to: "buffer",
  cost: 2,
  convert(value: number): Buffer {
    return Buffer.from([7, value, value + 1]);
  },
});
`;

/** Sensor with an anonymous buffer slot; folds the packet bytes into one number. */
const DECODER_SOURCE = `import { type Context, param, Sensor } from "mindcraft";

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

/** Number-producing sensor for picker suggestions. */
const SEVEN_SOURCE = `import { type Context, Sensor } from "mindcraft";

export default Sensor({
  name: "seven", inline: true,
  onExecute(ctx: Context): number {
    return 7;
  },
});
`;

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

function entryDiagnostics(result: ProjectCompileResult, path: string): CompileResult["diagnostics"] {
  assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
  const entry = result.results.get(path);
  assert.ok(entry, `expected a result for ${path}`);
  return entry.diagnostics;
}

/** Compile `files`, register every default-export program, and return each entry path's program. */
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

function mkVar(services: BrainServices, name: string): BrainTileVariableDef {
  const uniqueId = `conv-${name}`;
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

/**
 * Widens a compiled sensor tile to either rule side. The user-code sensor
 * surface has no placement control, and an argument-taking sensor cannot be
 * inline, so a DO-side read of one is only reachable with a widened tile.
 */
function widenToEitherSide(tile: IBrainTileDef): IBrainTileDef {
  tile.placement = TilePlacement.EitherSide;
  return tile;
}

/** Appends `DO [<name> := decode packet(<literal>)]` to `rule`. */
function appendDecodeAssignment(
  services: BrainServices,
  rule: BrainRuleDef,
  varName: string,
  decoderTile: IBrainTileDef,
  literal: number
): BrainTileVariableDef {
  const v = mkVar(services, varName);
  const opAssign = new BrainTileOperatorDef("assign", {}, services);
  rule.do().appendTile(v as never);
  rule.do().appendTile(opAssign as never);
  rule.do().appendTile(widenToEitherSide(decoderTile) as never);
  rule.do().appendTile(mkNumberLiteral(services, literal) as never);
  return v;
}

/** Keys of the bytecode actions inlined into `brain`'s linked program. */
function linkedActionKeys(brain: IBrain): string[] {
  const program = brain.getProgram();
  assert.ok(program);
  const keys: string[] = [];
  const actions = program.actions ?? List.empty();
  for (let i = 0; i < actions.size(); i++) {
    keys.push(actions.get(i)!.descriptor.key);
  }
  return keys;
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

function tileIds(entries: TileSuggestionResult["exact"]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < entries.size(); i++) {
    ids.add(entries.get(i).tileDef.tileId);
  }
  return ids;
}

function extractFromSource(source: string) {
  const host = createVirtualCompilerHost(new Map([["/conversion.ts", source]]), { noLib: true, skipLibCheck: true });
  const program = ts.createProgram(["/conversion.ts"], { noLib: true, skipLibCheck: true }, host);
  const sourceFile = program.getSourceFile("/conversion.ts");
  assert.ok(sourceFile);
  return extractDescriptor(sourceFile, program.getTypeChecker());
}

describe("Conversion declarations: compilation and registration", () => {
  test("a ref-form declaration compiles to a conversion artifact with resolved pair metadata", () => {
    const services = __test__createBrainServices();
    const result = compileProject(services, { "conv.ts": REF_CONVERSION_SOURCE });
    const program = compiledProgram(result, "conv.ts");

    assert.equal(program.kind, "conversion");
    assert.equal(program.key, `user.conversion.${NUM_TO_BUF_ID}`);
    assert.equal(program.outputType, CoreTypeIds.Buffer);
    assert.ok(program.conversion);
    assert.equal(program.conversion.fromType, CoreTypeIds.Number);
    assert.equal(program.conversion.toType, CoreTypeIds.Buffer);
    assert.equal(program.conversion.cost, 2);
    assert.equal(program.isAsync, false);

    // The single anonymous slot keys off the canonical source-type name.
    assert.equal(program.callDef.argSlots.size(), 1);
    assert.equal(program.callDef.argSlots.get(0)!.argSpec.tileId, mkParameterTileId("anon.number"));
    assert.equal(program.callDef.argSlots.get(0)!.argSpec.anonymous, true);

    // The entry function is the convert body: one positional param, no injected context.
    const entryFn = program.functions.get(program.entryFuncId)!;
    assert.equal(entryFn.numParams, 1);
    assert.equal(entryFn.injectCtxTypeIdx, undefined);
  });

  test("string and ref forms produce the identical registration", () => {
    const refServices = __test__createBrainServices();
    const refProgram = compiledProgram(compileProject(refServices, { "conv.ts": REF_CONVERSION_SOURCE }), "conv.ts");

    const strServices = __test__createBrainServices();
    const strProgram = compiledProgram(compileProject(strServices, { "conv.ts": STRING_CONVERSION_SOURCE }), "conv.ts");

    // Every name-keyed derivation is identical across the two spellings.
    assert.equal(strProgram.key, refProgram.key);
    assert.equal(strProgram.name, refProgram.name);
    assert.equal(strProgram.kind, refProgram.kind);
    assert.equal(strProgram.isAsync, refProgram.isAsync);
    assert.equal(strProgram.outputType, refProgram.outputType);
    assert.deepEqual(strProgram.conversion, refProgram.conversion);
    assert.deepEqual(strProgram.args, refProgram.args);
    assert.deepEqual(strProgram.callDef, refProgram.callDef);
    assert.equal(strProgram.callDef.argSlots.get(0)!.argSpec.tileId, mkParameterTileId("anon.number"));

    // The compiled artifact tables match: same entry, bytecode, constants, and types.
    assert.equal(strProgram.entryFuncId, refProgram.entryFuncId);
    assert.equal(strProgram.numStateSlots, refProgram.numStateSlots);
    assert.deepEqual(strProgram.functions, refProgram.functions);
    assert.deepEqual(strProgram.constantPools, refProgram.constantPools);
    assert.deepEqual(strProgram.types, refProgram.types);

    // The registry entries the two forms register are identical.
    registerUserTile(refProgram, refServices);
    registerUserTile(strProgram, strServices);
    const refEntry = refServices.shared.conversions.get(CoreTypeIds.Number, CoreTypeIds.Buffer);
    const strEntry = strServices.shared.conversions.get(CoreTypeIds.Number, CoreTypeIds.Buffer);
    assert.ok(refEntry);
    assert.deepEqual(strEntry, refEntry);
  });

  test("registration stores a bytecode conversion the registry resolves by pair", () => {
    const services = __test__createBrainServices();
    const [program] = compileAndRegister(services, { "conv.ts": REF_CONVERSION_SOURCE }, ["conv.ts"]);

    const registered = services.shared.conversions.get(CoreTypeIds.Number, CoreTypeIds.Buffer);
    assert.ok(registered, "expected the pair to be registered");
    assert.ok(isBytecodeConversion(registered));
    assert.equal(registered.descriptor.key, program.key);
    assert.equal(registered.cost, 2);

    // The action binding backing the conversion resolves by descriptor.
    const resolved = services.runtime.actions.resolveAction(registered.descriptor);
    assert.ok(resolved);
    assert.equal(resolved.binding, "bytecode");

    // A conversion artifact carries no tile surface.
    assert.throws(
      () => buildUserTileMetadata(program, (name) => services.runtime.types.resolveByName(name)),
      /no tile metadata/
    );
  });

  test("a declaration without an id gets one minted and written back", () => {
    const services = __test__createBrainServices();
    const withoutId = REF_CONVERSION_SOURCE.replace(`  id: ${JSON.stringify(NUM_TO_BUF_ID)},\n`, "");
    const result = compileProject(services, { "conv.ts": withoutId });
    const program = compiledProgram(result, "conv.ts");

    const rewritten = result.sourceRewrites.get("conv.ts");
    assert.ok(rewritten, "expected an id write-back for the id-less declaration");
    assert.ok(rewritten.includes(`id: ${JSON.stringify(program.id)}`));
    assert.equal(program.key, `user.conversion.${program.id}`);
  });

  test("findBestPath composes the user conversion with a host conversion", () => {
    const services = __test__createBrainServices();
    compileAndRegister(services, { "conv.ts": REF_CONVERSION_SOURCE }, ["conv.ts"]);

    // string -> number is a core host conversion (cost 2); number -> buffer is
    // the user conversion (cost 2). The composed path reaches buffer at cost 4.
    const path = services.shared.conversions.findBestPath(CoreTypeIds.String, CoreTypeIds.Buffer);
    assert.ok(path, "expected a composed conversion path");
    assert.equal(path.size(), 2);
    let cost = 0;
    for (let i = 0; i < path.size(); i++) {
      cost += path.get(i)!.cost;
    }
    assert.equal(cost, 4);
  });
});

describe("Conversion declarations: emission, link, and execution", () => {
  test("a number literal in a buffer slot runs the conversion and produces the exact bytes", () => {
    const services = __test__createBrainServices();
    const [, decoder] = compileAndRegister(
      services,
      { "conv.ts": REF_CONVERSION_SOURCE, "decoder.ts": DECODER_SOURCE },
      ["conv.ts", "decoder.ts"]
    );
    const decoderTile = actionTileFor(services, decoder);

    const { brainDef, rule } = newBrain(services);
    const v = appendDecodeAssignment(services, rule, "packet-value", decoderTile, 42);
    const brain = runBrain(brainDef, 1);

    // Byte recipe [7, n, n+1] with n=42: bytes [7, 42, 43] -> 7*10000 + 42*100 + 43.
    assert.equal(num(brain, v.varName), 70000 + 4200 + 43, "the converted bytes reach the decoder exactly");
  });

  test("a convert body reads module-scope consts and calls an imported helper", () => {
    const services = __test__createBrainServices();
    const protocolSource = `export const PACKET_MAGIC = 9;

export function checksum(value: number): number {
  return (value * 2) % 100;
}
`;
    const magicConversionSource = `import { BufferType, Conversion, NumberType } from "mindcraft";
import { checksum, PACKET_MAGIC } from "./protocol";

const HEADER = PACKET_MAGIC + 1;

export default Conversion({
  id: "convmagic0000001",
  from: NumberType,
  to: BufferType,
  cost: 2,
  convert(value: number): Buffer {
    return Buffer.from([HEADER, value, checksum(value)]);
  },
});
`;
    const [, decoder] = compileAndRegister(
      services,
      { "protocol.ts": protocolSource, "magic-conv.ts": magicConversionSource, "decoder.ts": DECODER_SOURCE },
      ["magic-conv.ts", "decoder.ts"]
    );
    const decoderTile = actionTileFor(services, decoder);

    const { brainDef, rule } = newBrain(services);
    const v = appendDecodeAssignment(services, rule, "magic-packet", decoderTile, 42);
    const brain = runBrain(brainDef, 1);

    // HEADER = PACKET_MAGIC + 1 = 10 (imported const through a module-local
    // const, written by the per-callsite module initializer); checksum(42) = 84
    // (imported helper): bytes [10, 42, 84].
    assert.equal(num(brain, v.varName), 100000 + 4200 + 84, "the module-scope reads reach the convert body");
  });

  test("two consumers in one brain share one linked conversion artifact", () => {
    const services = __test__createBrainServices();
    const [conversion, decoder] = compileAndRegister(
      services,
      { "conv.ts": REF_CONVERSION_SOURCE, "decoder.ts": DECODER_SOURCE },
      ["conv.ts", "decoder.ts"]
    );
    const decoderTile = actionTileFor(services, decoder);

    const { brainDef, page, rule } = newBrain(services);
    const first = appendDecodeAssignment(services, rule, "first-packet", decoderTile, 42);
    const secondRule = page.appendNewRule();
    const second = appendDecodeAssignment(services, secondRule, "second-packet", decoderTile, 5);

    const brain = runBrain(brainDef, 1);
    assert.equal(num(brain, first.varName), 70000 + 4200 + 43);
    assert.equal(num(brain, second.varName), 70000 + 500 + 6);

    const conversionActions = linkedActionKeys(brain).filter((key) => key === conversion.key);
    assert.equal(conversionActions.length, 1, "both call sites bind one shared conversion action");
  });

  test("a brain that never converts links without the conversion artifact", () => {
    const services = __test__createBrainServices();
    const [conversion, seven] = compileAndRegister(
      services,
      { "conv.ts": REF_CONVERSION_SOURCE, "seven.ts": SEVEN_SOURCE },
      ["conv.ts", "seven.ts"]
    );

    // The brain reads a number into a number variable: no slot needs the
    // conversion, so no conversion call site is emitted.
    const sevenTile = actionTileFor(services, seven);
    const { brainDef, rule } = newBrain(services);
    const v = mkVar(services, "plain-number");
    const opAssign = new BrainTileOperatorDef("assign", {}, services);
    rule.do().appendTile(v as never);
    rule.do().appendTile(opAssign as never);
    rule.do().appendTile(sevenTile as never);

    const brain = runBrain(brainDef, 1);
    assert.equal(num(brain, v.varName), 7);
    const keys = linkedActionKeys(brain);
    assert.ok(!keys.includes(conversion.key), "the conversion artifact is absent from this brain's program");
    assert.ok(keys.includes(seven.key), "the sensor artifact is linked");
  });
});

describe("Conversion declarations: picker offers", () => {
  test("with the conversion registered, a number-producing tile is offered in the buffer slot as a conversion match", () => {
    const services = __test__createBrainServices();
    const [, decoder] = compileAndRegister(
      services,
      { "conv.ts": REF_CONVERSION_SOURCE, "decoder.ts": DECODER_SOURCE },
      ["conv.ts", "decoder.ts"]
    );
    const decoderTile = actionTileFor(services, decoder);
    const numberVar = mkVar(services, "steering");

    const result = suggestFor(services, [decoderTile], [numberVar]);
    assert.ok(!tileIds(result.exact).has(numberVar.tileId), "a number tile is not an exact buffer match");
    assert.ok(tileIds(result.withConversion).has(numberVar.tileId), "the number tile is offered as a conversion match");
  });

  test("without the conversion, the number-producing tile is not offered in the buffer slot", () => {
    const services = __test__createBrainServices();
    const [decoder] = compileAndRegister(services, { "decoder.ts": DECODER_SOURCE }, ["decoder.ts"]);
    const decoderTile = actionTileFor(services, decoder);
    const numberVar = mkVar(services, "steering");

    const result = suggestFor(services, [decoderTile], [numberVar]);
    assert.ok(!tileIds(result.exact).has(numberVar.tileId));
    assert.ok(!tileIds(result.withConversion).has(numberVar.tileId), "no path from number to buffer exists");
  });
});

describe("Conversion declarations: pair conflicts", () => {
  test("two project declarations of the same pair report a conflict on the key-later file", () => {
    const services = __test__createBrainServices();
    const second = STRING_CONVERSION_SOURCE.replace(NUM_TO_BUF_ID, "convnumbuf000002");
    const result = compileProject(services, { "a.ts": REF_CONVERSION_SOURCE, "b.ts": second });

    assert.deepEqual(entryDiagnostics(result, "a.ts"), [], "the key-first declaration compiles clean");
    const bDiags = entryDiagnostics(result, "b.ts");
    assert.ok(
      bDiags.some((d) => d.code === CompileDiagCode.DuplicateConversionPair),
      `expected DuplicateConversionPair, got ${JSON.stringify(bDiags)}`
    );
  });

  test("a declaration duplicating a registered host conversion pair reports a conflict", () => {
    const services = __test__createBrainServices();
    const source = `import { Conversion, NumberType, StringType } from "mindcraft";

export default Conversion({
  id: "convnumstr000001",
  from: NumberType,
  to: StringType,
  cost: 1,
  convert(value: number): string {
    return "n";
  },
});
`;
    const result = compileProject(services, { "conv.ts": source });
    const diags = entryDiagnostics(result, "conv.ts");
    assert.ok(
      diags.some((d) => d.code === CompileDiagCode.DuplicateConversionPair),
      `expected DuplicateConversionPair, got ${JSON.stringify(diags)}`
    );
  });

  test("recompiling the same declaration re-registers without a conflict", () => {
    const services = __test__createBrainServices();
    compileAndRegister(services, { "conv.ts": REF_CONVERSION_SOURCE }, ["conv.ts"]);

    // The registry now holds the pair under this declaration's own key; a
    // recompile of the same declaration is not a conflict.
    const result = compileProject(services, { "conv.ts": REF_CONVERSION_SOURCE });
    assert.deepEqual(entryDiagnostics(result, "conv.ts"), []);
  });
});

describe("Conversion declarations: diagnostics", () => {
  test("an unresolvable string type name is reported", () => {
    const services = __test__createBrainServices();
    const source = `import { Conversion } from "mindcraft";

export default Conversion({
  from: "bogusType",
  to: "buffer",
  cost: 1,
  convert(value: number): Buffer {
    return Buffer.from([value]);
  },
});
`;
    const result = compileProject(services, { "conv.ts": source });
    const diags = entryDiagnostics(result, "conv.ts");
    assert.ok(
      diags.some((d) => d.code === CompileDiagCode.ConversionTypeUnresolved),
      `expected ConversionTypeUnresolved, got ${JSON.stringify(diags)}`
    );
  });

  test("a reference that is not a mindcraft type token is reported", () => {
    const services = __test__createBrainServices();
    const source = `import { Conversion, type TypeRef } from "mindcraft";

const NotAToken = null as unknown as TypeRef<number>;

export default Conversion({
  from: NotAToken,
  to: "buffer",
  cost: 1,
  convert(value: number): Buffer {
    return Buffer.from([value]);
  },
});
`;
    const result = compileProject(services, { "conv.ts": source });
    const diags = entryDiagnostics(result, "conv.ts");
    assert.ok(
      diags.some((d) => d.code === CompileDiagCode.ConversionTypeUnresolved),
      `expected ConversionTypeUnresolved, got ${JSON.stringify(diags)}`
    );
  });

  test("a type-naming expression that is neither a name nor a token reference is reported", () => {
    const services = __test__createBrainServices();
    const source = `import { Conversion, type TypeRef } from "mindcraft";

export default Conversion({
  from: {} as TypeRef<number>,
  to: "buffer",
  cost: 1,
  convert(value: number): Buffer {
    return Buffer.from([value]);
  },
});
`;
    const result = compileProject(services, { "conv.ts": source });
    const diags = entryDiagnostics(result, "conv.ts");
    assert.ok(
      diags.some((d) => d.code === CompileDiagCode.ConversionTypeUnresolved),
      `expected ConversionTypeUnresolved, got ${JSON.stringify(diags)}`
    );
  });

  test("a zero-parameter convert function is rejected", () => {
    const services = __test__createBrainServices();
    const source = `import { Conversion } from "mindcraft";

export default Conversion({
  from: "number",
  to: "buffer",
  cost: 1,
  convert(): Buffer {
    return Buffer.from([1]);
  },
});
`;
    const result = compileProject(services, { "conv.ts": source });
    const entry = result.results.get("conv.ts");
    assert.ok(entry);
    assert.ok(
      entry.diagnostics.some((d) => d.code === DescriptorDiagCode.ConversionConvertParamCount),
      `expected ConversionConvertParamCount, got ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("an async convert function is rejected", () => {
    const services = __test__createBrainServices();
    const source = `import { Conversion } from "mindcraft";

export default Conversion({
  from: "number",
  to: "buffer",
  cost: 1,
  async convert(value: number): Promise<Buffer> {
    return Buffer.from([value]);
  },
});
`;
    const result = compileProject(services, { "conv.ts": source });
    const entry = result.results.get("conv.ts");
    assert.ok(entry);
    assert.ok(
      entry.diagnostics.some((d) => d.code === DescriptorDiagCode.ConversionConvertMustBeSync),
      `expected ConversionConvertMustBeSync, got ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("an expression-bodied convert arrow is rejected at lowering", () => {
    const services = __test__createBrainServices();
    const source = `import { Conversion } from "mindcraft";

export default Conversion({
  from: "number",
  to: "buffer",
  cost: 1,
  convert: (value: number): Buffer => Buffer.from([value]),
});
`;
    const result = compileProject(services, { "conv.ts": source });
    const entry = result.results.get("conv.ts");
    assert.ok(entry);
    assert.ok(
      entry.diagnostics.some((d) => d.code === LoweringDiagCode.OnExecuteHasNoBody),
      `expected OnExecuteHasNoBody, got ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("user-code expressions cannot reach a bytecode conversion", () => {
    const services = __test__createBrainServices();
    compileAndRegister(services, { "conv.ts": REF_CONVERSION_SOURCE }, ["conv.ts"]);

    // The setOutput value boundary needs number -> buffer here; only the
    // bytecode conversion holds that pair, and it lives in another artifact,
    // so the boundary reports a type mismatch.
    const source = `import { type Context, Sensor, setOutput } from "mindcraft";

export default Sensor({
  name: "packet out",
  outputs: [{ name: "packet", type: "buffer" }],
  onExecute(ctx: Context): number {
    setOutput(ctx, "packet", 42);
    return 1;
  },
});
`;
    const result = compileProject(services, { "tile.ts": source });
    const entry = result.results.get("tile.ts");
    assert.ok(entry);
    assert.ok(
      entry.diagnostics.some((d) => d.code === LoweringDiagCode.SetOutputValueTypeMismatch),
      `expected SetOutputValueTypeMismatch, got ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("a destructured convert parameter is rejected at lowering", () => {
    const services = __test__createBrainServices();
    const source = `import { Conversion } from "mindcraft";

export default Conversion({
  from: "number",
  to: "buffer",
  cost: 1,
  convert([n]: number[]): Buffer {
    return Buffer.from([n]);
  },
});
`;
    const result = compileProject(services, { "conv.ts": source });
    const entry = result.results.get("conv.ts");
    assert.ok(entry);
    assert.ok(
      entry.diagnostics.some((d) => d.code === LoweringDiagCode.DestructuringInOnExecuteNotSupported),
      `expected DestructuringInOnExecuteNotSupported, got ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("missing members are each reported by the extractor", () => {
    const missingFrom = extractFromSource(`export default Conversion({
  to: "buffer",
  cost: 1,
  convert(value: number): Buffer { return Buffer.from([value]); },
});
`);
    assert.ok(missingFrom.diagnostics.some((d) => d.code === DescriptorDiagCode.ConversionTypeRequired));

    const missingTo = extractFromSource(`export default Conversion({
  from: "number",
  cost: 1,
  convert(value: number): Buffer { return Buffer.from([value]); },
});
`);
    assert.ok(missingTo.diagnostics.some((d) => d.code === DescriptorDiagCode.ConversionTypeRequired));

    const missingCost = extractFromSource(`export default Conversion({
  from: "number",
  to: "buffer",
  convert(value: number): Buffer { return Buffer.from([value]); },
});
`);
    assert.ok(missingCost.diagnostics.some((d) => d.code === DescriptorDiagCode.ConversionCostMustBePositiveNumber));

    const missingConvert = extractFromSource(`export default Conversion({
  from: "number",
  to: "buffer",
  cost: 1,
});
`);
    assert.ok(missingConvert.diagnostics.some((d) => d.code === DescriptorDiagCode.ConversionConvertRequired));
  });

  test("a non-positive cost and a non-function convert are each reported by the extractor", () => {
    const zeroCost = extractFromSource(`export default Conversion({
  from: "number",
  to: "buffer",
  cost: 0,
  convert(value: number): Buffer { return Buffer.from([value]); },
});
`);
    assert.ok(zeroCost.diagnostics.some((d) => d.code === DescriptorDiagCode.ConversionCostMustBePositiveNumber));

    const badConvert = extractFromSource(`export default Conversion({
  from: "number",
  to: "buffer",
  cost: 1,
  convert: 42,
});
`);
    assert.ok(badConvert.diagnostics.some((d) => d.code === DescriptorDiagCode.ConversionConvertMustBeFunction));
  });
});

describe("config member forms: shorthand, spread, and stable ids", () => {
  test("a conversion declared entirely through shorthand members compiles with its declared id", () => {
    const services = __test__createBrainServices();
    const source = `import { BufferType, Conversion, NumberType } from "mindcraft";

const id = "convnumbuf000009";
const from = NumberType;
const to = BufferType;
const cost = 2;
const convert = (value: number): Buffer => {
  return Buffer.from([7, value, value + 1]);
};

export default Conversion({ id, from, to, cost, convert });
`;
    const result = compileProject(services, { "conv.ts": source });
    const program = compiledProgram(result, "conv.ts");
    assert.equal(program.id, "convnumbuf000009", "the shorthand id is honored");
    assert.equal(result.sourceRewrites.has("conv.ts"), false, "no id is minted or written back");
    assert.ok(program.conversion);
    assert.equal(program.conversion.fromType, CoreTypeIds.Number);
    assert.equal(program.conversion.toType, CoreTypeIds.Buffer);
    assert.equal(program.conversion.cost, 2);
  });

  test("sensor config members resolve through shorthand, including nested type refs", () => {
    const services = __test__createBrainServices();
    const source = `import { NumberType, Sensor, setOutput, type Context } from "mindcraft";

const name = "seven up";
const returnType = NumberType;
const type = "string";

export default Sensor({
  name,
  returnType,
  outputs: [{ name: "value", type }],
  onExecute(ctx: Context): number {
    setOutput(ctx, "value", "hi");
    return 7;
  },
});
`;
    const result = compileProject(services, { "sensor.ts": source });
    const program = compiledProgram(result, "sensor.ts");
    assert.equal(program.name, "seven up");
    assert.equal(program.outputType, CoreTypeIds.Number, "the shorthand returnType ref resolved");
    assert.equal(program.outputs?.[0]?.type, "string", "the shorthand output type ref resolved");
  });

  test("a spread config member is rejected", () => {
    const services = __test__createBrainServices();
    const source = `import { BufferType, Conversion, NumberType } from "mindcraft";

const base = { cost: 2 };

export default Conversion({
  id: "convnumbuf000010",
  from: NumberType,
  to: BufferType,
  ...base,
  convert(value: number): Buffer {
    return Buffer.from([value]);
  },
});
`;
    const result = compileProject(services, { "conv.ts": source });
    const diags = entryDiagnostics(result, "conv.ts");
    assert.ok(
      diags.some((d) => d.code === DescriptorDiagCode.ConfigMemberNotInline),
      `expected ConfigMemberNotInline, got ${JSON.stringify(diags)}`
    );
  });

  test("a shorthand member that resolves to no declared value is rejected", () => {
    const extraction = extractFromSource(`import { cost } from "./missing-module";

export default Conversion({
  id: "convnumbuf000011",
  from: "number",
  to: "buffer",
  cost,
  convert(value: number): Buffer {
    return Buffer.from([value]);
  },
});
`);
    assert.ok(
      extraction.diagnostics.some((d) => d.code === DescriptorDiagCode.ShorthandMemberUnresolvable),
      `expected ShorthandMemberUnresolvable, got ${JSON.stringify(extraction.diagnostics)}`
    );
  });

  test("a conversion whose from and to name the same type is rejected", () => {
    const services = __test__createBrainServices();
    const source = `import { Conversion, NumberType } from "mindcraft";

export default Conversion({
  id: "convnumnum000001",
  from: NumberType,
  to: "number",
  cost: 1,
  convert(value: number): number {
    return value + 1;
  },
});
`;
    const result = compileProject(services, { "conv.ts": source });
    const diags = entryDiagnostics(result, "conv.ts");
    assert.ok(
      diags.some((d) => d.code === CompileDiagCode.ConversionSameType),
      `expected ConversionSameType, got ${JSON.stringify(diags)}`
    );
  });

  test("two declarations sharing a stable id are rejected on the later file", () => {
    const services = __test__createBrainServices();
    const sensor = (name: string) => `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "copypasted0000id",
  name: ${JSON.stringify(name)},
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const result = compileProject(services, { "a.ts": sensor("first"), "b.ts": sensor("second") });
    assert.deepEqual(entryDiagnostics(result, "a.ts"), [], "the first claimant compiles clean");
    const bDiags = entryDiagnostics(result, "b.ts");
    assert.ok(
      bDiags.some((d) => d.code === CompileDiagCode.DuplicateActionId),
      `expected DuplicateActionId, got ${JSON.stringify(bDiags)}`
    );
  });
});

describe("Conversion declarations: environment bundle lifecycle", () => {
  test("applying a bundle registers the conversion; replacing the bundle removes it", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const services = environment.brainServices;

    const result = compileProject(services, { "conv.ts": REF_CONVERSION_SOURCE, "decoder.ts": DECODER_SOURCE });
    const conversionProgram = compiledProgram(result, "conv.ts");
    compiledProgram(result, "decoder.ts");

    const actions = new Dict<string, UserAuthoredProgram>();
    for (const [, entry] of result.results) {
      if (entry.program) {
        actions.set(entry.program.key, entry.program);
      }
    }
    environment.replaceActionBundle({ revision: "conv-1", tiles: [], actions });

    const registered = services.shared.conversions.get(CoreTypeIds.Number, CoreTypeIds.Buffer);
    assert.ok(registered, "the bundle apply registers the conversion");
    assert.ok(isBytecodeConversion(registered));
    assert.equal(registered.descriptor.key, conversionProgram.key);

    environment.replaceActionBundle({ revision: "conv-2", tiles: [], actions: new Dict() });
    assert.equal(
      services.shared.conversions.get(CoreTypeIds.Number, CoreTypeIds.Buffer),
      undefined,
      "replacing the bundle without the conversion unregisters the pair"
    );
  });
});
