/**
 * Definition-presence contribution: a ts-code tile whose definition exists is
 * contributed to the language surface even when its file carries diagnostics.
 * Execution is separate: a contributed tile keeps its last successfully
 * compiled program when one exists; a never-compiled tile is placeable and
 * typechecks, and a brain using it reports a link failure until the tile
 * compiles. Withholding is reserved for definitions that cannot be extracted
 * or whose declared surface types do not resolve.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { coreModule, createWendooEnvironment, type WendooEnvironment } from "@wendoo-lang/core";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import { CoreTypeIds, mkActuatorTileId, mkParameterTileId } from "@wendoo-lang/core/runtime";
import { buildCompiledActionBundle } from "../runtime/action-bundle.js";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { CompileDiagCode } from "./diag-codes.js";
import { UserTileProject } from "./project.js";

function resolveCoreTypeId(typeName: string): string | undefined {
  switch (typeName) {
    case "boolean":
      return CoreTypeIds.Boolean;
    case "number":
      return CoreTypeIds.Number;
    case "string":
      return CoreTypeIds.String;
    default:
      return undefined;
  }
}

const BEEP_KEY = `${TEST_PROJECT_NAMESPACE}:user.actuator.acbeep0000000001`;
const BEEP_TILE_ID = mkActuatorTileId(BEEP_KEY);
const BEEP_PARAM_TILE_ID = mkParameterTileId(`${TEST_PROJECT_NAMESPACE}:user.acbeep0000000001.level`);

/** The tile with a resolvable declared surface and a type error in its body. */
const BEEP_TYPE_ERROR = `import { Actuator, param, type Context } from "wendoo";

export default Actuator({
  id: "acbeep0000000001",
  name: "beep",
  args: [param("level", { type: "number" })],
  onExecute(ctx: Context, args: { level: number }): void {
    const wrong: string = args.level;
  },
});
`;

const BEEP_CLEAN = `import { Actuator, param, type Context } from "wendoo";

export default Actuator({
  id: "acbeep0000000001",
  name: "beep",
  args: [param("level", { type: "number" })],
  onExecute(ctx: Context, args: { level: number }): void {
  },
});
`;

function newProject(env: WendooEnvironment): UserTileProject {
  return new UserTileProject({ projectNamespace: TEST_PROJECT_NAMESPACE, services: env.brainServices });
}

/** Deserialize a one-rule brain holding `tileId` in its do-slot and report the instance kind plus link outcome. */
function placeAndLink(
  env: WendooEnvironment,
  bundle: NonNullable<ReturnType<typeof buildCompiledActionBundle>>,
  tileId: string
): { instanceKind: string; linked: boolean; linkMentionsKey: boolean } {
  env.hydrateTileMetadata({ revision: bundle.revision, tiles: bundle.tiles });
  env.replaceActionBundle(bundle);
  const tile = bundle.tiles.find((candidate) => candidate.tileId === tileId);
  assert.ok(tile, `tile ${tileId} is in the bundle`);
  const brainDef = BrainDef.emptyBrainDef(env.brainServices, "Definition Brain");
  brainDef.pages().get(0)!.children().get(0)!.do().appendTile(tile);
  const restored = env.deserializeBrainJson(brainDef.toJson());
  const instance = restored.pages().get(0)!.children().get(0)!.do().tiles().get(0)!;
  const linkResult = env.linkBrain(restored);
  return {
    instanceKind: instance.kind,
    linked: linkResult.program !== undefined,
    linkMentionsKey: linkResult.diagnostics.toArray().some((diag) => diag.message.includes(BEEP_KEY)),
  };
}

describe("definition-presence contribution", () => {
  test("a type-error file contributes its tile definition; the brain typechecks and flash is link-gated", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const project = newProject(env);
    project.setFiles(new Map([["beep.ts", BEEP_TYPE_ERROR]]));
    const result = project.compileAll();

    assert.ok((result.tsErrors.get("beep.ts") ?? []).some((diag) => diag.severity === "error"));
    const entry = result.results.get("beep.ts");
    assert.ok(entry, "the failing file still has a compile result");
    assert.equal(entry.program, undefined, "no program compiled");
    assert.ok(entry.definition, "the tile definition is contributed");
    assert.equal(entry.definition.key, BEEP_KEY);

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services: env.brainServices });
    assert.ok(bundle, "the definition carries a bundle");
    const tileIds = bundle.tiles.map((tile) => tile.tileId);
    assert.ok(tileIds.includes(BEEP_TILE_ID), "the tile is on the language surface");
    assert.ok(tileIds.includes(BEEP_PARAM_TILE_ID), "its parameter tile is on the language surface");
    assert.equal(bundle.actions.get(BEEP_KEY), undefined, "no executable action is offered");

    const placed = placeAndLink(env, bundle, BEEP_TILE_ID);
    assert.equal(placed.instanceKind, "actuator", "the saved instance resolves to the real tile, not a placeholder");
    assert.equal(placed.linked, false, "the brain cannot link until the tile compiles");
    assert.ok(placed.linkMentionsKey, "the link failure names the missing action key");
  });

  test("an unresolvable-import file contributes its definition alongside its diagnostics", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const project = newProject(env);
    project.setFiles(
      new Map([
        [
          "pos-util.ts",
          `import { Position } from "@lib/acme/pos";

export function toInfluence(position: Position): number {
  return 1;
}
`,
        ],
        [
          "beep.ts",
          `import { Actuator, param, type Context } from "wendoo";
import { toInfluence } from "./pos-util";

export default Actuator({
  id: "acbeep0000000001",
  name: "beep",
  args: [param("level", { type: "number" })],
  onExecute(ctx: Context, args: { level: number }): void {
  },
});
`,
        ],
      ])
    );
    const result = project.compileAll();

    const entry = result.results.get("beep.ts");
    assert.ok(entry);
    assert.ok(entry.diagnostics.some((diag) => diag.code === CompileDiagCode.ImportedFileHasErrors));
    assert.equal(entry.program, undefined);
    assert.ok(entry.definition, "the dependent tile still contributes its definition");

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services: env.brainServices });
    assert.ok(bundle);
    assert.ok(bundle.tiles.some((tile) => tile.tileId === BEEP_TILE_ID));
    assert.equal(bundle.actions.get(BEEP_KEY), undefined);
  });

  test("a tile whose declared surface type is unresolvable is withheld with a precise diagnostic", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const project = newProject(env);
    project.setFiles(
      new Map([
        [
          "steer.ts",
          `import { Actuator, param, type Context } from "wendoo";
import { Position } from "@lib/acme/pos";

export default Actuator({
  id: "acsteer000000001",
  name: "steer",
  args: [param("position", { type: Position, anonymous: true })],
  onExecute(ctx: Context, args: { position: Position }): void {
  },
});
`,
        ],
        ["beep.ts", BEEP_CLEAN],
      ])
    );
    const result = project.compileAll();

    const entry = result.results.get("steer.ts");
    assert.ok(entry, "the surface-unresolvable file carries its blocking diagnostics");
    assert.equal(entry.definition, undefined, "no definition with an unresolvable declared surface");
    assert.equal(entry.program, undefined);
    assert.ok(
      entry.diagnostics.some((diag) => diag.code === CompileDiagCode.UnresolvedTypeReference),
      `expected the unresolvable-surface diagnostic, got ${JSON.stringify(entry.diagnostics)}`
    );

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services: env.brainServices });
    assert.ok(bundle, "the clean sibling still bundles");
    assert.equal(
      bundle.tiles.some(
        (tile) => tile.tileId === mkActuatorTileId(`${TEST_PROJECT_NAMESPACE}:user.actuator.acsteer000000001`)
      ),
      false,
      "the surface-unresolvable tile is withheld"
    );
    assert.ok(bundle.tiles.some((tile) => tile.tileId === BEEP_TILE_ID));
  });

  test("a syntactically broken file contributes nothing", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const project = newProject(env);
    project.setFiles(
      new Map([
        ["garbage.ts", `import { Actuator } from "wendoo";\nexport default Actuator({ name: `],
        ["beep.ts", BEEP_CLEAN],
      ])
    );
    const result = project.compileAll();

    assert.equal(result.results.get("garbage.ts")?.definition, undefined);
    assert.equal(result.results.get("garbage.ts")?.program, undefined);
    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services: env.brainServices });
    assert.ok(bundle, "the clean sibling still bundles");
    assert.equal(
      bundle.tiles.some((tile) => tile.tileId !== BEEP_TILE_ID && tile.tileId.includes("garbage")),
      false
    );
    assert.ok(bundle.tiles.some((tile) => tile.tileId === BEEP_TILE_ID));
  });

  test("a broken recompile keeps the last successfully compiled program, and the brain still links", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const project = newProject(env);
    project.setFiles(new Map([["beep.ts", BEEP_CLEAN]]));
    const clean = project.compileAll();
    const cleanProgram = clean.results.get("beep.ts")?.program;
    assert.ok(cleanProgram, "the clean compile produces the program");

    project.updateFile("beep.ts", BEEP_TYPE_ERROR);
    const broken = project.compileAll();
    assert.ok((broken.tsErrors.get("beep.ts") ?? []).some((diag) => diag.severity === "error"));
    const entry = broken.results.get("beep.ts");
    assert.ok(entry?.program, "the last-good program still contributes");
    assert.equal(entry.program.revisionId, cleanProgram.revisionId, "it is the same compiled program");

    const bundle = buildCompiledActionBundle(broken, { resolveTypeId: resolveCoreTypeId, services: env.brainServices });
    assert.ok(bundle);
    assert.ok(bundle.actions.get(BEEP_KEY), "the executable action stays offered");

    const placed = placeAndLink(env, bundle, BEEP_TILE_ID);
    assert.equal(placed.instanceKind, "actuator");
    assert.equal(placed.linked, true, "the brain links and can run the last-good program");
  });

  test("a last-good program whose types no longer resolve is not offered, and the surface blocks with it", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const project = newProject(env);
    const VEC_SENSOR_CLEAN = `import { Sensor, StructType, NumberType, type Context, type StructOf } from "wendoo";

export const Vec = StructType({
  name: "Vec",
  fields: { x: NumberType },
});
export type Vec = StructOf<typeof Vec>;

export default Sensor({
  id: "snvec00000000001",
  name: "vec probe",
  returnType: Vec,
  onExecute(ctx: Context): Vec {
    return Vec({ x: 1 });
  },
});
`;
    project.setFiles(new Map([["vec.ts", VEC_SENSOR_CLEAN]]));
    const clean = project.compileAll();
    assert.ok(clean.results.get("vec.ts")?.program, "the struct sensor compiles clean");

    // Break the file: its struct type deregisters with the failed recompile,
    // so neither the last-good program nor the fresh surface can resolve Vec.
    project.updateFile(
      "vec.ts",
      VEC_SENSOR_CLEAN.replace("return Vec({ x: 1 });", "const wrong: string = 1;\n    return Vec({ x: 1 });")
    );
    const broken = project.compileAll();
    const entry = broken.results.get("vec.ts");
    assert.ok(entry, "the file carries its blocking diagnostics");
    assert.equal(entry.program, undefined, "the stale-typed last-good program is not offered");
    assert.equal(entry.definition, undefined, "no definition with an unresolvable return type");
    assert.ok(entry.diagnostics.some((diag) => diag.severity === "error"));
  });

  test("a never-compiled tile heals: fixing the file moves it from definition to executable", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const project = newProject(env);
    project.setFiles(new Map([["beep.ts", BEEP_TYPE_ERROR]]));
    const broken = project.compileAll();
    assert.ok(broken.results.get("beep.ts")?.definition, "first compile contributes the definition only");
    const brokenBundle = buildCompiledActionBundle(broken, {
      resolveTypeId: resolveCoreTypeId,
      services: env.brainServices,
    });
    assert.ok(brokenBundle);
    assert.equal(brokenBundle.actions.get(BEEP_KEY), undefined);

    project.updateFile("beep.ts", BEEP_CLEAN);
    const healed = project.compileAll();
    assert.ok(healed.results.get("beep.ts")?.program, "the healed compile produces the program");
    const healedBundle = buildCompiledActionBundle(healed, {
      resolveTypeId: resolveCoreTypeId,
      services: env.brainServices,
    });
    assert.ok(healedBundle);
    assert.ok(healedBundle.actions.get(BEEP_KEY), "the tile becomes executable");

    const placed = placeAndLink(env, healedBundle, BEEP_TILE_ID);
    assert.equal(placed.linked, true);
  });

  test("a broken conversion recompile keeps its last successfully compiled program", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const project = newProject(env);
    const CONV_CLEAN = `import { BufferType, Conversion, NumberType } from "wendoo";

export default Conversion({
  id: "convnumbuf000001",
  from: NumberType,
  to: BufferType,
  cost: 2,
  convert(value: number): Buffer {
    return Buffer.from([value]);
  },
});
`;
    project.setFiles(new Map([["conv.ts", CONV_CLEAN]]));
    const clean = project.compileAll();
    assert.ok(clean.results.get("conv.ts")?.program, "the conversion compiles clean");

    project.updateFile(
      "conv.ts",
      CONV_CLEAN.replace(
        "return Buffer.from([value]);",
        "const wrong: string = value;\n    return Buffer.from([value]);"
      )
    );
    const broken = project.compileAll();
    const entry = broken.results.get("conv.ts");
    assert.ok(entry?.program, "the conversion keeps its last-good program");
    assert.equal(entry.program.kind, "conversion");

    const bundle = buildCompiledActionBundle(broken, { resolveTypeId: resolveCoreTypeId, services: env.brainServices });
    assert.ok(bundle);
    assert.ok(bundle.actions.get(`${TEST_PROJECT_NAMESPACE}:user.conversion.convnumbuf000001`));
  });

  test("definitions participate in the stable-id and shared-tile reconciles", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const project = newProject(env);
    project.setFiles(
      new Map([
        [
          "a.ts",
          `import { Sensor, modifier, optional, type Context } from "wendoo";

export default Sensor({
  id: "sharedid00000001",
  name: "first",
  args: [optional(modifier("modifier.robo.boost", { label: "boost" }))],
  onExecute(ctx: Context): number {
    return 1;
  },
});
`,
        ],
        [
          "b.ts",
          `import { Actuator, modifier, optional, type Context } from "wendoo";

export default Actuator({
  id: "sharedid00000001",
  name: "second",
  args: [optional(modifier("modifier.robo.boost", { label: "turbo" }))],
  onExecute(ctx: Context): void {
    const wrong: string = 1;
  },
});
`,
        ],
      ])
    );
    const result = project.compileAll();

    const conflicted = result.results.get("b.ts");
    assert.ok(conflicted?.definition, "the failing file contributes its definition");
    assert.equal(conflicted.program, undefined, "the duplicate id never adopts the other declaration's program");
    assert.ok(
      conflicted.diagnostics.some((diag) => diag.code === CompileDiagCode.DuplicateActionId),
      `the definition's duplicate id diagnoses, got ${JSON.stringify(conflicted.diagnostics)}`
    );
    // The shared-modifier reconcile walks declarations in action-key order;
    // the definition's declaration participates and the disagreement
    // diagnoses on the later key (the sensor).
    const aDiags = result.results.get("a.ts")?.diagnostics ?? [];
    assert.ok(
      aDiags.some((diag) => diag.code === CompileDiagCode.SharedModifierLabelConflict),
      `the shared-modifier label conflict diagnoses against the definition's declaration, got ${JSON.stringify(aDiags)}`
    );
  });
});
