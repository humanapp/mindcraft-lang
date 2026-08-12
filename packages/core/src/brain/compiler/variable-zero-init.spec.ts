/**
 * Starting values for brain variables: which types have one, how the compiler
 * ships it with the program, and what the runtime does with it.
 *
 * Each slot's starting value is resolved from the slot type's `TypeDef.zero`,
 * interned into the program's residual constant pool, and recorded as a pool
 * index in `Program.variableInitValues`.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import { type BrainServices, mkVariableTileId } from "@mindcraft-lang/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { type BrainBuildDiagnostic, CompilationDiagCode, compileBrain } from "@mindcraft-lang/core/brain/compiler";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef, BrainTileOperatorDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import {
  CoreTypeIds,
  extractBooleanValue,
  extractNumberValue,
  extractStringValue,
  type IBrain,
  linkedBrainProgramFromBytes,
  linkedBrainProgramFromJson,
  linkedBrainProgramToBytes,
  linkedBrainProgramToJson,
  mkNumberValue,
  NativeType,
  NO_VARIABLE_INIT,
  type Program,
  type TypeId,
  type Value,
  variableInitAt,
} from "@mindcraft-lang/core/runtime";

let services: BrainServices;
let opAssign: BrainTileOperatorDef;

before(() => {
  services = __test__createBrainServices();
  opAssign = new BrainTileOperatorDef("assign", {}, services);
});

function mkVar(name: string, typeId: TypeId): BrainTileVariableDef {
  const uniqueId = `zero-init-${name}`;
  return new BrainTileVariableDef(mkVariableTileId(uniqueId), name, typeId, uniqueId);
}

function mkLiteral(value: number): BrainTileLiteralDef {
  return new BrainTileLiteralDef(CoreTypeIds.Number, value, {}, services);
}

/** Build a one-rule brain with the given WHEN and DO tiles. */
function buildBrain(whenTiles: readonly unknown[], doTiles: readonly unknown[]): BrainDef {
  const brainDef = new BrainDef(services);
  const pageResult = brainDef.appendNewPage();
  assert.ok(pageResult.success);
  const rule = pageResult.value!.page.children().get(0)!;
  for (const tile of whenTiles) {
    __test__appendTile(rule.when(), tile as never);
  }
  for (const tile of doTiles) {
    __test__appendTile(rule.do(), tile as never);
  }
  return brainDef;
}

/** Compile `brainDef` and return the brain plus its linked program. */
function compileToProgram(brainDef: BrainDef): { brain: IBrain; program: Program } {
  const brain = brainDef.compile();
  brain.initialize();
  const program = brain.getProgram();
  assert.ok(program, "compiled brain has a linked program");
  return { brain, program };
}

/** Resolved starting value of the slot named `varName`, or undefined when it has none. */
function startingValueOf(program: Program, varName: string): Value | undefined {
  for (let i = 0; i < program.variableNames.size(); i++) {
    if (program.variableNames.get(i) !== varName) continue;
    const initIdx = variableInitAt(program, i);
    return initIdx === NO_VARIABLE_INIT ? undefined : program.constantPools.values.get(initIdx);
  }
  assert.fail(`no slot for variable '${varName}'`);
}

// ---- The per-type table ----

describe("variable starting values -- per-type table", () => {
  test("a Number variable starts at 0", () => {
    const v = mkVar("count", CoreTypeIds.Number);
    const { brain, program } = compileToProgram(buildBrain([], [v, opAssign, mkLiteral(1)]));

    assert.equal(startingValueOf(program, v.varName)?.t, NativeType.Number);
    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 0);
  });

  test("a Boolean variable starts at false", () => {
    const flag = mkVar("flag", CoreTypeIds.Boolean);
    const target = mkVar("target", CoreTypeIds.Boolean);
    const { brain, program } = compileToProgram(buildBrain([], [target, opAssign, flag]));

    assert.equal(startingValueOf(program, flag.varName)?.t, NativeType.Boolean);
    assert.equal(extractBooleanValue(brain.getVariable(flag.varName)), false);
  });

  test("a String variable starts at the empty string", () => {
    const label = mkVar("label", CoreTypeIds.String);
    const target = mkVar("copy", CoreTypeIds.String);
    const { brain, program } = compileToProgram(buildBrain([], [target, opAssign, label]));

    assert.equal(startingValueOf(program, label.varName)?.t, NativeType.String);
    assert.equal(extractStringValue(brain.getVariable(label.varName)), "");
  });

  test("a type with no declared starting value leaves its slot holding no value", () => {
    const v = mkVar("anything", CoreTypeIds.Any);
    const { brain, program } = compileToProgram(buildBrain([], [v, opAssign, mkLiteral(1)]));

    assert.equal(startingValueOf(program, v.varName), undefined);
    assert.equal(brain.getVariable(v.varName), undefined);
    assert.equal(program.variableInitValues, undefined, "a program with no starting value carries no list");
  });
});

// ---- Explicit writes are unaffected ----

describe("variable starting values -- explicit writes", () => {
  test("a rule that assigns the variable produces the assigned value, not the starting value", () => {
    const v = mkVar("explicit", CoreTypeIds.Number);
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(42)]);
    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();
    brain.think(16);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 42);
  });

  test("a host write before startup survives the starting value", () => {
    const v = mkVar("preset", CoreTypeIds.Number);
    const { brain } = compileToProgram(buildBrain([], [v, opAssign, mkLiteral(1)]));

    brain.setVariable(v.varName, mkNumberValue(7));
    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 7);
  });
});

// ---- Name reuse at two types ----

describe("variable starting values -- one name at two types", () => {
  /** Compile a brain whose DO assigns a String-typed `level` from a Number-typed `level`. */
  function buildConflictingBrain(): BrainDef {
    const asString = mkVar("level", CoreTypeIds.String);
    const asNumber = mkVar("level", CoreTypeIds.Number);
    return buildBrain([], [asString, opAssign, asNumber]);
  }

  function diagnosticsOf(brainDef: BrainDef): readonly BrainBuildDiagnostic[] {
    const result = compileBrain(
      brainDef,
      List.from([services.edit.tiles, brainDef.catalog()]),
      services.shared.conversions,
      services.runtime.actions,
      services.runtime.types
    );
    const diags: BrainBuildDiagnostic[] = [];
    for (let i = 0; i < result.diagnostics.size(); i++) {
      diags.push(result.diagnostics.get(i)!);
    }
    return diags;
  }

  test("reports VariableTypeConflict", () => {
    const conflicts = diagnosticsOf(buildConflictingBrain()).filter(
      (d) => d.code === CompilationDiagCode.VariableTypeConflict
    );

    assert.equal(conflicts.length, 1, "the conflicting name/type pair reports once");
    assert.equal(conflicts[0]!.severity, "warning");
    assert.equal(conflicts[0]!.params?.varName, "level");
  });

  test("the shared slot takes the first occurrence's starting value", () => {
    const { program } = compileToProgram(buildConflictingBrain());

    const slots: string[] = [];
    for (let i = 0; i < program.variableNames.size(); i++) {
      slots.push(program.variableNames.get(i));
    }
    assert.deepEqual(slots, ["level"], "both tiles share one slot");
    assert.equal(startingValueOf(program, "level")?.t, NativeType.String, "the first occurrence is the String tile");
  });

  test("one name at one type reports nothing", () => {
    const first = mkVar("steady", CoreTypeIds.Number);
    const second = mkVar("steady", CoreTypeIds.Number);
    const conflicts = diagnosticsOf(buildBrain([], [first, opAssign, second])).filter(
      (d) => d.code === CompilationDiagCode.VariableTypeConflict
    );

    assert.equal(conflicts.length, 0);
  });
});

// ---- The value travels with the program ----

describe("variable starting values -- serialization", () => {
  test("the starting value survives a JSON round-trip", () => {
    const v = mkVar("json-count", CoreTypeIds.Number);
    const { program } = compileToProgram(buildBrain([], [v, opAssign, mkLiteral(1)]));

    const roundTripped = linkedBrainProgramFromJson(
      linkedBrainProgramToJson({ program, ruleIndex: new Map() as never, pages: List.empty() })
    ).program;

    assert.equal(extractNumberValue(startingValueOf(roundTripped, v.varName)), 0);
  });

  test("the starting value survives a binary round-trip", () => {
    const v = mkVar("bin-count", CoreTypeIds.Number);
    const { program } = compileToProgram(buildBrain([], [v, opAssign, mkLiteral(1)]));

    const bytes = linkedBrainProgramToBytes(
      { program, ruleIndex: new Map() as never, pages: List.empty() },
      { profileId: 0, precision: "f32", typeRegistry: services.runtime.types }
    );
    const decoded = linkedBrainProgramFromBytes(bytes, {
      precision: "f32",
      typeRegistry: services.runtime.types,
    }).program.program;

    assert.equal(extractNumberValue(startingValueOf(decoded, v.varName)), 0);
  });
});
