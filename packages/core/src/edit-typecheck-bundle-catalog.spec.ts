import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type CompiledActionArtifact,
  type CompiledActionBundle,
  coreModule,
  createWendooEnvironment,
  Dict,
  List,
  type WendooEnvironment,
  type WendooModule,
} from "@wendoo/core";
import { type BrainServices, type IBrainRuleDef, TilePlacement } from "@wendoo/core/brain";
import type { TypecheckResult } from "@wendoo/core/brain/compiler";
import { TypeDiagCode } from "@wendoo/core/brain/compiler";
import { BrainDef } from "@wendoo/core/brain/model";
import { BrainTileActuatorDef, BrainTileParameterDef, BrainTileSensorDef } from "@wendoo/core/brain/tiles";
import {
  type BrainActionCallDef,
  BYTECODE_VERSION,
  bag,
  CoreParameterId,
  CoreTypeIds,
  mkCallDef,
  mkParameterTileId,
  mkTypeId,
  NativeType,
  Op,
  param,
  type StructTypeDef,
  type TypeId,
} from "@wendoo/core/runtime";

const noopCodec = {
  encode(): void {},
  decode(): undefined {
    return undefined;
  },
  stringify(): string {
    return "noop";
  },
};

const kSteerPositionTypeId = mkTypeId(NativeType.Struct, "SteerPosition");

function getEnvironmentServices(environment: WendooEnvironment): BrainServices {
  return (environment as unknown as { brainServices: BrainServices }).brainServices;
}

function ruleDiags(rule: IBrainRuleDef): readonly { code: unknown }[] {
  const tileSet = rule.do() as unknown as { typecheckResult(): TypecheckResult | undefined };
  const result = tileSet.typecheckResult();
  assert.ok(result, "expected the rule's DO side to hold a typecheck result");
  return result.typeInfo.diags.toArray();
}

function hasDiag(rule: IBrainRuleDef, code: TypeDiagCode): boolean {
  return ruleDiags(rule).some((d) => d.code === code);
}

/** A struct type module so the environment's type registry knows SteerPosition. */
function structTypeModule(): WendooModule {
  return {
    id: "steer-position-module",
    install(api): void {
      const def: StructTypeDef = {
        coreType: NativeType.Struct,
        typeId: kSteerPositionTypeId,
        codec: noopCodec,
        name: "SteerPosition",
        atomId: 1500,
        fields: List.empty(),
        fieldIndexByName: new Dict<string, number>(),
      };
      api.defineType(def);
    },
  };
}

function bytecodeBody(numParams: number, name: string) {
  return {
    code: List.from([{ op: Op.RET }]),
    numParams,
    name,
  };
}

/** A bundle actuator artifact whose callDef takes a single anonymous arg. */
function actuatorArtifact(key: string, callDef: BrainActionCallDef): CompiledActionArtifact {
  return {
    version: BYTECODE_VERSION,
    functions: List.from([bytecodeBody(1, "entry")]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.empty(),
    },
    variableNames: List.empty(),
    entryPoint: 0,
    key,
    kind: "actuator",
    callDef,
    isAsync: false,
    numStateSlots: 0,
    entryFuncId: 0,
    revisionId: `${key}.rev1`,
  };
}

/** A bundle sensor artifact returning a value of `outputType`. */
function sensorArtifact(key: string, outputType: TypeId): CompiledActionArtifact {
  return {
    version: BYTECODE_VERSION,
    functions: List.from([bytecodeBody(0, "entry")]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.empty(),
    },
    variableNames: List.empty(),
    entryPoint: 0,
    key,
    kind: "sensor",
    callDef: mkCallDef({ type: "bag", items: [] }),
    outputType,
    isAsync: false,
    numStateSlots: 0,
    entryFuncId: 0,
    revisionId: `${key}.rev1`,
  };
}

function sensorTile(key: string, outputType: TypeId): BrainTileSensorDef {
  return new BrainTileSensorDef(
    key,
    {
      key,
      kind: "sensor",
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
      outputType,
    },
    { placement: TilePlacement.EitherSide | TilePlacement.Inline }
  );
}

function actuatorTile(key: string, callDef: BrainActionCallDef): BrainTileActuatorDef {
  return new BrainTileActuatorDef(key, { key, kind: "actuator", callDef, isAsync: false });
}

function bundle(
  revision: string,
  entries: readonly { artifact: CompiledActionArtifact; tile: BrainTileActuatorDef | BrainTileSensorDef }[]
): CompiledActionBundle {
  const actions = new Dict<string, CompiledActionArtifact>();
  const tiles: (BrainTileActuatorDef | BrainTileSensorDef)[] = [];
  for (const entry of entries) {
    actions.set(entry.artifact.key, entry.artifact);
    tiles.push(entry.tile);
  }
  return { revision, actions, tiles };
}

/**
 * Build a rule that places `actuator` in its DO side with `value` filling the
 * actuator's anonymous slot, then round-trip through the environment so the
 * deserialized brain carries the environment's bundle catalog. Returns the
 * restored rule and brain.
 */
function restoredRuleWith(
  environment: WendooEnvironment,
  actuator: BrainTileActuatorDef,
  value: BrainTileSensorDef
): { rule: IBrainRuleDef; brain: BrainDef } {
  const services = getEnvironmentServices(environment);
  const brainDef = BrainDef.emptyBrainDef(services, "Steer Brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.do().appendTile(actuator);
  rule.do().appendTile(value);

  const restored = environment.deserializeBrainJson(brainDef.toJson()) as BrainDef;
  return { rule: restored.pages().get(0)!.children().get(0)!, brain: restored };
}

describe("edit-time typecheck resolves against the bundle catalog", () => {
  test("a user struct-typed anonymous parameter slot resolves without TileNotFound", () => {
    const environment = createWendooEnvironment({ modules: [coreModule(), structTypeModule()] });

    const steerCallDef = mkCallDef(bag(param("steer.position", { anonymous: true })));
    const steer = actuatorTile("steer", steerCallDef);
    const positionParam = new BrainTileParameterDef("steer.position", kSteerPositionTypeId, { hidden: true });
    const position = sensorTile("steer.decodedPosition", kSteerPositionTypeId);

    // The struct-typed parameter tile lives ONLY in the bundle catalog; it is
    // never registered into edit.tiles.
    const b = bundle("steer.bundle.rev1", [
      { artifact: actuatorArtifact("steer", steerCallDef), tile: steer },
      { artifact: sensorArtifact("steer.decodedPosition", kSteerPositionTypeId), tile: position },
    ]);
    environment.replaceActionBundle({ ...b, tiles: [...b.tiles, positionParam] });

    const { rule, brain } = restoredRuleWith(environment, steer, position);
    rule.typecheck();

    assert.ok(
      !hasDiag(rule, TypeDiagCode.TileNotFound),
      "the struct-typed anonymous param must resolve against the bundle catalog at edit time"
    );

    // Edit-vs-link parity: the same brain links clean.
    const link = environment.linkBrain(brain);
    const errors = link.diagnostics.toArray().filter((d) => d.severity === "error");
    assert.deepEqual(errors, [], "the same brain must link without errors");
    assert.ok(link.program, "the same brain must produce a linked program");
  });

  test("a built-in anonymous parameter slot still resolves (no regression)", () => {
    const environment = createWendooEnvironment({ modules: [coreModule()] });

    const callDef = mkCallDef(bag(param(CoreParameterId.AnonymousNumber, { anonymous: true })));
    const nudge = actuatorTile("nudge", callDef);
    const count = sensorTile("count", CoreTypeIds.Number);

    environment.replaceActionBundle(
      bundle("builtin.bundle.rev1", [
        { artifact: actuatorArtifact("nudge", callDef), tile: nudge },
        { artifact: sensorArtifact("count", CoreTypeIds.Number), tile: count },
      ])
    );

    const { rule } = restoredRuleWith(environment, nudge, count);
    rule.typecheck();

    assert.ok(
      !hasDiag(rule, TypeDiagCode.TileNotFound),
      "the built-in anonymous number param must resolve from edit.tiles"
    );
  });

  test("a genuinely-unknown parameter tile id still reports TileNotFound", () => {
    const environment = createWendooEnvironment({ modules: [coreModule(), structTypeModule()] });

    // The actuator's anonymous slot references a parameter tile id that is
    // registered in no catalog at all.
    const missingParamId = "steer.nowhere";
    const callDef = mkCallDef(bag(param(missingParamId, { anonymous: true })));
    const stray = actuatorTile("stray", callDef);
    const position = sensorTile("stray.decodedPosition", kSteerPositionTypeId);

    environment.replaceActionBundle(
      bundle("stray.bundle.rev1", [
        { artifact: actuatorArtifact("stray", callDef), tile: stray },
        { artifact: sensorArtifact("stray.decodedPosition", kSteerPositionTypeId), tile: position },
      ])
    );

    const { rule } = restoredRuleWith(environment, stray, position);
    rule.typecheck();

    const diags = ruleDiags(rule);
    assert.ok(
      diags.some((d) => d.code === TypeDiagCode.TileNotFound),
      "an anonymous param whose tile id is in no catalog must still report TileNotFound"
    );
    // Guard the exact missing tile id so the widened catalog set cannot mask it.
    assert.ok(
      environment.tileCatalogs().every((c) => c.get(mkParameterTileId(missingParamId)) === undefined),
      "the missing param tile must be absent from every environment catalog"
    );
  });
});
