/**
 * Per-file compile granularity: a compilation root whose compile produces
 * diagnostics still contributes the programs of its cleanly-compiling files.
 * Only failing files' tiles are withheld, a file importing a failing file
 * (directly or transitively) is withheld with its own diagnostic, and saved
 * instances of withheld tiles round-trip losslessly as missing-tile
 * placeholders.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { coreModule, createWendooEnvironment, type HydratedTileMetadataSnapshot } from "@wendoo/core";
import type { BrainServices, IBrainDef } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { BrainDef } from "@wendoo/core/brain/model";
import {
  CoreTypeIds,
  mkActuatorTileId,
  mkModifierTileId,
  mkParameterTileId,
  mkSensorTileId,
} from "@wendoo/core/runtime";
import { buildCompiledActionBundle, buildMultiRootActionBundle } from "../runtime/action-bundle.js";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { CompileDiagCode } from "./diag-codes.js";
import type { DependencyMount } from "./extension-mounts.js";
import { type ProjectCompileResult, UserTileProject } from "./project.js";
import { MultiRootSession, type ProjectRoot } from "./project-set.js";

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

let services: BrainServices;

function compileProject(files: Record<string, string>, dependencyMounts?: readonly DependencyMount[]) {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    services,
    ...(dependencyMounts
      ? {
          dependencies: dependencyMounts.map((mount) => ({ coordinate: mount.namespace })),
          dependencyMounts,
        }
      : {}),
  });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

/** Error-severity diagnostics recorded for `path` across the per-file results and TS error maps. */
function errorsAt(result: ProjectCompileResult, path: string): readonly { code: number }[] {
  return [...(result.results.get(path)?.diagnostics ?? []), ...(result.tsErrors.get(path) ?? [])].filter(
    (diag) => diag.severity === "error"
  );
}

const MOVEMENT_HELPER = `export function rate(value: number): number {
  return value * 2;
}
`;

/** The incident shape: a tile file whose \`@lib\` import names an unresolved dependency. */
const STEER_BROKEN = `import { Actuator, param, type Context } from "wendoo";
import { Position } from "@lib/acme/pos";

export default Actuator({
  id: "acsteer000000001",
  name: "steer",
  args: [param("target", { type: "number" })],
  onExecute(ctx: Context, args: { target: number }): void {
    const position: Position | undefined = undefined;
  },
});
`;

const DRIVE_CLEAN = `import { Actuator, type Context } from "wendoo";
import { rate } from "./movement";

export default Actuator({
  id: "acdrive000000001",
  name: "drive",
  onExecute(ctx: Context): void {
    const value = rate(2);
  },
});
`;

const LINE_CLEAN = `import { Sensor, param, type Context } from "wendoo";

export default Sensor({
  id: "snline0000000001",
  name: "line",
  args: [param("level", { type: "number" })],
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;

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

describe("per-file compile granularity", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  // Re-anchored for definition presence: a failing file's tile stays on the
  // language surface without an executable action.
  test("a failing file keeps its tile on the surface without an action; sibling files compile fully", () => {
    const result = compileProject({
      "movement.ts": MOVEMENT_HELPER,
      "steer.ts": STEER_BROKEN,
      "drive.ts": DRIVE_CLEAN,
      "line.ts": LINE_CLEAN,
      "conv.ts": CONV_CLEAN,
    });

    assert.ok(errorsAt(result, "steer.ts").length > 0, "the failing file reports its error");
    assert.equal(result.results.get("steer.ts")?.program, undefined, "the failing file compiles no program");
    assert.ok(result.results.get("steer.ts")?.definition, "the failing file still contributes its definition");
    assert.ok(result.results.get("drive.ts")?.program, "a clean sibling still compiles");
    assert.ok(result.results.get("line.ts")?.program, "an unrelated clean file still compiles");
    assert.ok(result.results.get("conv.ts")?.program, "a clean conversion still compiles");

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle, "the partially-failing root still produces a bundle");
    const tileIds = bundle.tiles.map((tile) => tile.tileId);
    assert.ok(tileIds.includes(mkActuatorTileId(`${TEST_PROJECT_NAMESPACE}:user.actuator.acdrive000000001`)));
    assert.ok(tileIds.includes(mkSensorTileId(`${TEST_PROJECT_NAMESPACE}:user.sensor.snline0000000001`)));
    assert.ok(
      tileIds.includes(mkParameterTileId(`${TEST_PROJECT_NAMESPACE}:user.snline0000000001.level`)),
      "a clean file's parameter tile is offered"
    );
    assert.ok(
      tileIds.includes(mkActuatorTileId(`${TEST_PROJECT_NAMESPACE}:user.actuator.acsteer000000001`)),
      "the failing file's tile stays on the surface"
    );
    assert.ok(
      tileIds.includes(mkParameterTileId(`${TEST_PROJECT_NAMESPACE}:user.acsteer000000001.target`)),
      "the failing file's parameter tile stays on the surface"
    );
    assert.ok(bundle.actions.get(`${TEST_PROJECT_NAMESPACE}:user.conversion.convnumbuf000001`));
    assert.equal(
      bundle.actions.get(`${TEST_PROJECT_NAMESPACE}:user.actuator.acsteer000000001`),
      undefined,
      "the never-compiled tile offers no executable action"
    );
  });

  // Re-anchored for definition presence: the dependent tile keeps its own
  // diagnostic and its surface; only its executable action is withheld.
  test("a tile importing a failing helper carries its own diagnostic and stays placeable without an action", () => {
    const result = compileProject({
      "pos-util.ts": `import { Position } from "@lib/acme/pos";

export function toInfluence(position: Position): number {
  return 1;
}
`,
      "follow.ts": `import { Actuator, type Context } from "wendoo";
import { toInfluence } from "./pos-util";

export default Actuator({
  id: "acfollow00000001",
  name: "follow",
  onExecute(ctx: Context): void {
  },
});
`,
      "solo.ts": LINE_CLEAN,
    });

    const followDiags = result.results.get("follow.ts")?.diagnostics ?? [];
    assert.ok(
      followDiags.some((diag) => diag.code === CompileDiagCode.ImportedFileHasErrors),
      `the dependent tile carries the imported-file diagnostic, got ${JSON.stringify(followDiags)}`
    );
    assert.equal(result.results.get("follow.ts")?.program, undefined);
    assert.ok(result.results.get("follow.ts")?.definition, "the dependent tile still contributes its definition");
    assert.ok(result.results.get("solo.ts")?.program);

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const tileIds = bundle.tiles.map((tile) => tile.tileId);
    assert.ok(tileIds.includes(mkSensorTileId(`${TEST_PROJECT_NAMESPACE}:user.sensor.snline0000000001`)));
    assert.ok(tileIds.includes(mkActuatorTileId(`${TEST_PROJECT_NAMESPACE}:user.actuator.acfollow00000001`)));
    assert.equal(bundle.actions.get(`${TEST_PROJECT_NAMESPACE}:user.actuator.acfollow00000001`), undefined);
  });

  test("a tile importing another tile file that fails compiles no program transitively", () => {
    const result = compileProject({
      "steer.ts": `import { Actuator, type Context } from "wendoo";
import { Position } from "@lib/acme/pos";

export function steerFactor(): number {
  return 1;
}

export default Actuator({
  id: "acsteer000000001",
  name: "steer",
  onExecute(ctx: Context): void {
    const position: Position | undefined = undefined;
  },
});
`,
      "chase.ts": `import { Actuator, type Context } from "wendoo";
import { steerFactor } from "./steer";

export default Actuator({
  id: "acchase000000001",
  name: "chase",
  onExecute(ctx: Context): void {
    const factor = steerFactor();
  },
});
`,
      "line.ts": LINE_CLEAN,
    });

    const chaseDiags = result.results.get("chase.ts")?.diagnostics ?? [];
    assert.ok(chaseDiags.some((diag) => diag.code === CompileDiagCode.ImportedFileHasErrors));
    assert.equal(result.results.get("chase.ts")?.program, undefined);
    assert.ok(result.results.get("line.ts")?.program);
  });

  // Re-anchored for definition presence: type-error files with resolvable
  // surfaces contribute a tiles-only bundle; only a root whose every
  // definition is unextractable produces no bundle.
  test("a root whose every file fails contributes definitions only; unextractable definitions produce no bundle", () => {
    const result = compileProject({
      "steer.ts": STEER_BROKEN,
      "other.ts": `import { Sensor, type Context } from "wendoo";
import { Position } from "@lib/acme/pos";

export default Sensor({
  id: "snother000000001",
  name: "other",
  onExecute(ctx: Context): number {
    const position: Position | undefined = undefined;
    return 1;
  },
});
`,
    });

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle, "extractable definitions keep the surface alive");
    const tileIds = bundle.tiles.map((tile) => tile.tileId);
    assert.ok(tileIds.includes(mkActuatorTileId(`${TEST_PROJECT_NAMESPACE}:user.actuator.acsteer000000001`)));
    assert.ok(tileIds.includes(mkSensorTileId(`${TEST_PROJECT_NAMESPACE}:user.sensor.snother000000001`)));
    assert.equal(bundle.actions.keys().toArray().length, 0, "nothing is executable");

    const unextractable = compileProject({
      "garbage.ts": `import { Actuator } from "wendoo";\nexport default Actuator({ name: `,
    });
    assert.equal(
      buildCompiledActionBundle(unextractable, { resolveTypeId: resolveCoreTypeId, services }),
      undefined,
      "a sole root with no extractable definition keeps the last good bundle"
    );
  });

  test("a warning-only file still contributes its tile", () => {
    const result = compileProject({
      "beep.ts": `import { Actuator, type Context } from "wendoo";

export default Actuator({
  id: "acbeep0000000001",
  name: "beep",
  icon: "./missing.svg",
  onExecute(ctx: Context): void {
  },
});
`,
    });

    const beep = result.results.get("beep.ts");
    assert.ok(beep?.program, "the warning-carrying file still compiles a program");
    assert.ok(beep.diagnostics.some((diag) => diag.severity === "warning"));

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle, "a warning does not withhold the bundle");
    assert.ok(
      bundle.tiles.some(
        (tile) => tile.tileId === mkActuatorTileId(`${TEST_PROJECT_NAMESPACE}:user.actuator.acbeep0000000001`)
      )
    );
  });

  test("a deep-import rejection withholds only the rejecting file", () => {
    const posMount: DependencyMount = {
      namespace: "acme/pos",
      files: new Map([
        ["/index.ts", "export const surface = 1;\n"],
        ["/inner.ts", "export const secret = 2;\n"],
      ]),
    };
    const result = compileProject(
      {
        "deep.ts": `import { Actuator, type Context } from "wendoo";
import { secret } from "@lib/acme/pos/inner";

export default Actuator({
  id: "acdeep0000000001",
  name: "deep",
  onExecute(ctx: Context): void {
  },
});
`,
        "line.ts": LINE_CLEAN,
      },
      [posMount]
    );

    const deepDiags = result.results.get("deep.ts")?.diagnostics ?? [];
    assert.deepEqual(
      deepDiags.map((diag) => diag.code),
      [CompileDiagCode.ExtensionDeepImport],
      "the deep-importing file reports exactly the deep-import rejection"
    );
    assert.equal(result.tsErrors.get("deep.ts"), undefined, "the rejection subsumes the file's module-not-found noise");
    assert.ok(result.results.get("line.ts")?.program, "the sibling file still compiles");

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const tileIds = bundle.tiles.map((tile) => tile.tileId);
    assert.ok(tileIds.includes(mkSensorTileId(`${TEST_PROJECT_NAMESPACE}:user.sensor.snline0000000001`)));
    // Re-anchored for definition presence: the rejected file's tile stays on
    // the surface without an executable action.
    assert.ok(tileIds.includes(mkActuatorTileId(`${TEST_PROJECT_NAMESPACE}:user.actuator.acdeep0000000001`)));
    assert.equal(bundle.actions.get(`${TEST_PROJECT_NAMESPACE}:user.actuator.acdeep0000000001`), undefined);
  });

  // Re-anchored for definition presence: a conflicting declaration keeps its
  // compiled program and its tile; the conflict diagnostic stands and the
  // shared modifier keeps its first-declared label.
  test("a shared-tile reconcile conflict diagnoses without pulling the conflicting tile", () => {
    const modifierSensor = (
      id: string,
      label: string
    ) => `import { Sensor, modifier, optional, type Context } from "wendoo";

export default Sensor({
  id: "${id}",
  name: "sensor ${id}",
  args: [optional(modifier("modifier.robo.boost", { label: "${label}" }))],
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const result = compileProject({
      "a.ts": modifierSensor("snfirst000000001", "boost"),
      "b.ts": modifierSensor("snsecond00000001", "turbo"),
    });

    const conflicted = result.results.get("b.ts");
    assert.ok(conflicted?.program, "the reconcile leaves the compiled program on the result");
    assert.ok(conflicted.diagnostics.some((diag) => diag.code === CompileDiagCode.SharedModifierLabelConflict));

    const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(bundle);
    const tileIds = bundle.tiles.map((tile) => tile.tileId);
    assert.ok(tileIds.includes(mkSensorTileId(`${TEST_PROJECT_NAMESPACE}:user.sensor.snfirst000000001`)));
    assert.ok(
      tileIds.includes(mkSensorTileId(`${TEST_PROJECT_NAMESPACE}:user.sensor.snsecond00000001`)),
      "the conflicting declaration stays on the surface"
    );
    assert.ok(bundle.actions.get(`${TEST_PROJECT_NAMESPACE}:user.sensor.snsecond00000001`));
    assert.equal(
      bundle.tiles.filter((tile) => tile.tileId === mkModifierTileId("modifier.robo.boost")).length,
      1,
      "the shared modifier registers once"
    );
  });
});

const HOST_NS = "host-store-id-0001";
const ROBOT_NS = "acme/robot";
const POS_NS = "acme/pos";

const POS_LIB_INDEX = `export { Position } from "./position";\n`;
const POS_LIB_SOURCE = `import { NumberType, StructType, type StructOf } from "wendoo";

export const Position = StructType({
  name: "Position",
  fields: { x: NumberType, y: NumberType },
});
export type Position = StructOf<typeof Position>;
`;

// The real cutebot shape: the tile's declared surface is typed by the
// dependency, so a missing dependency makes the surface unresolvable.
const ROBOT_STEER = `import { Actuator, param, type Context } from "wendoo";
import { Position } from "@lib/acme/pos";

export default Actuator({
  id: "acsteer000000001",
  name: "robot steer",
  args: [param("position", { type: Position, anonymous: true })],
  onExecute(ctx: Context, args: { position: Position }): void {
  },
});
`;

// A failing file whose declared surface stays resolvable: the import breaks
// the program, never the definition.
const ROBOT_BEEP = `import { Actuator, type Context } from "wendoo";
import { Position } from "@lib/acme/pos";

export default Actuator({
  id: "acrobotbeep00001",
  name: "robot beep",
  onExecute(ctx: Context): void {
    const position: Position | undefined = undefined;
  },
});
`;

const ROBOT_DRIVE = `import { Actuator, type Context } from "wendoo";
import { rate } from "./movement";

export default Actuator({
  id: "acdrive000000001",
  name: "robot drive",
  onExecute(ctx: Context): void {
    const value = rate(3);
  },
});
`;

const HOST_TILE = `import { Sensor, type Context } from "wendoo";

export default Sensor({
  id: "snhost0000000001",
  name: "host probe",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;

const ROBOT_DRIVE_TILE_ID = mkActuatorTileId(`${ROBOT_NS}:user.actuator.acdrive000000001`);
const ROBOT_STEER_TILE_ID = mkActuatorTileId(`${ROBOT_NS}:user.actuator.acsteer000000001`);
const ROBOT_BEEP_KEY = `${ROBOT_NS}:user.actuator.acrobotbeep00001`;
const ROBOT_BEEP_TILE_ID = mkActuatorTileId(ROBOT_BEEP_KEY);
const HOST_TILE_ID = mkSensorTileId(`${HOST_NS}:user.sensor.snhost0000000001`);

function posRoot(): ProjectRoot {
  return {
    namespace: POS_NS,
    files: new Map([
      ["index.ts", POS_LIB_INDEX],
      ["position.ts", POS_LIB_SOURCE],
    ]),
    readOnlySource: true,
  };
}

function robotRoot(withPosDependency: boolean): ProjectRoot {
  return {
    namespace: ROBOT_NS,
    files: new Map([
      ["movement.ts", MOVEMENT_HELPER],
      ["steer.ts", ROBOT_STEER],
      ["drive.ts", ROBOT_DRIVE],
      ["beep.ts", ROBOT_BEEP],
    ]),
    dependencies: withPosDependency ? [{ coordinate: POS_NS }] : [],
    readOnlySource: true,
  };
}

function hostRoot(): ProjectRoot {
  return { namespace: HOST_NS, files: new Map([["main.ts", HOST_TILE]]) };
}

/** Every tile placed on the first rule of the brain's first page, in placement order. */
function firstRuleTileKinds(brainDef: IBrainDef, tileId: string): string[] {
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  const kinds: string[] = [];
  rule
    .when()
    .tiles()
    .forEach((tile) => {
      if (tile.tileId === tileId) kinds.push(tile.kind);
    });
  rule
    .do()
    .tiles()
    .forEach((tile) => {
      if (tile.tileId === tileId) kinds.push(tile.kind);
    });
  return kinds;
}

describe("partial library loading across roots", () => {
  // Re-anchored for definition presence: a failing file with a resolvable
  // surface keeps its tile (no placeholder, no action); placeholders remain
  // only for tiles whose declared surface cannot resolve.
  test("a failing library file keeps its tile; only surface-unresolvable tiles placeholder losslessly and heal", () => {
    // Healthy shape first: the library's dependency resolves, every file
    // compiles, and a brain places the steer, drive, beep, and host tiles.
    const healthyEnv = createWendooEnvironment({ modules: [coreModule()] });
    const healthySession = new MultiRootSession({ services: healthyEnv.brainServices });
    healthySession.setRoots([posRoot(), robotRoot(true), hostRoot()]);
    healthySession.compile();
    const healthyBundle = buildMultiRootActionBundle([...healthySession.results().values()], {
      services: healthyEnv.brainServices,
    });
    assert.ok(healthyBundle, "the healthy resolved set compiles a bundle");
    const steerTile = healthyBundle.tiles.find((tile) => tile.tileId === ROBOT_STEER_TILE_ID);
    const driveTile = healthyBundle.tiles.find((tile) => tile.tileId === ROBOT_DRIVE_TILE_ID);
    const beepTile = healthyBundle.tiles.find((tile) => tile.tileId === ROBOT_BEEP_TILE_ID);
    const hostTile = healthyBundle.tiles.find((tile) => tile.tileId === HOST_TILE_ID);
    assert.ok(steerTile && driveTile && beepTile && hostTile, "all four tiles compile in the healthy shape");

    const brainDef = BrainDef.emptyBrainDef(healthyEnv.brainServices, "Robot Brain");
    const rule = brainDef.pages().get(0)!.children().get(0)!;
    rule.when().appendTile(hostTile);
    rule.do().appendTile(steerTile);
    rule.do().appendTile(driveTile);
    rule.do().appendTile(beepTile);
    const savedJson = brainDef.toJson();

    // The incident shape: the library's dependency is gone. steer.ts fails
    // AND its declared surface is typed by the missing dependency; beep.ts
    // fails but its declared surface stays resolvable; drive.ts compiles.
    const brokenEnv = createWendooEnvironment({ modules: [coreModule()] });
    const brokenSession = new MultiRootSession({ services: brokenEnv.brainServices });
    brokenSession.setRoots([robotRoot(false), hostRoot()]);
    const { roots } = brokenSession.compile();
    const robotResult = roots.get(ROBOT_NS)!;
    assert.ok(errorsAt(robotResult, "steer.ts").length > 0, "steer.ts reports its unresolved surface");
    assert.ok(robotResult.results.get("drive.ts")?.program, "drive.ts still compiles");
    assert.ok(robotResult.results.get("beep.ts")?.definition, "beep.ts contributes its definition");

    const brokenBundle = buildMultiRootActionBundle([...brokenSession.results().values()], {
      services: brokenEnv.brainServices,
    });
    assert.ok(brokenBundle, "the partially-failing library still loads");
    const brokenTileIds = brokenBundle.tiles.map((tile) => tile.tileId);
    assert.ok(brokenTileIds.includes(ROBOT_DRIVE_TILE_ID), "the library's clean tile is offered");
    assert.ok(brokenTileIds.includes(ROBOT_BEEP_TILE_ID), "the failing file's tile stays on the surface");
    assert.equal(brokenBundle.actions.get(ROBOT_BEEP_KEY), undefined, "the never-compiled tile is not executable");
    assert.ok(brokenTileIds.includes(HOST_TILE_ID), "the host tile is offered");
    assert.equal(brokenTileIds.includes(ROBOT_STEER_TILE_ID), false, "only the surface-unresolvable tile is withheld");

    // The saved brain loads: the withheld tile renders as a missing-tile
    // placeholder, every other instance resolves, and serialization is
    // lossless.
    const hydration: HydratedTileMetadataSnapshot = { revision: brokenBundle.revision, tiles: brokenBundle.tiles };
    brokenEnv.hydrateTileMetadata(hydration);
    const restored = brokenEnv.deserializeBrainJson(savedJson);
    assert.deepEqual(firstRuleTileKinds(restored, ROBOT_STEER_TILE_ID), ["missing"]);
    assert.deepEqual(firstRuleTileKinds(restored, ROBOT_DRIVE_TILE_ID), ["actuator"]);
    assert.deepEqual(firstRuleTileKinds(restored, ROBOT_BEEP_TILE_ID), ["actuator"]);
    assert.deepEqual(firstRuleTileKinds(restored, HOST_TILE_ID), ["sensor"]);
    const roundTripped = restored.toJson();
    assert.deepEqual(roundTripped, savedJson, "the placeholder round-trips the saved form verbatim");

    // Healing the dependency restores the withheld tile from the same saved form.
    const healedEnv = createWendooEnvironment({ modules: [coreModule()] });
    const healedSession = new MultiRootSession({ services: healedEnv.brainServices });
    healedSession.setRoots([posRoot(), robotRoot(true), hostRoot()]);
    healedSession.compile();
    const healedBundle = buildMultiRootActionBundle([...healedSession.results().values()], {
      services: healedEnv.brainServices,
    });
    assert.ok(healedBundle);
    healedEnv.hydrateTileMetadata({ revision: healedBundle.revision, tiles: healedBundle.tiles });
    const healed = healedEnv.deserializeBrainJson(roundTripped);
    assert.deepEqual(firstRuleTileKinds(healed, ROBOT_STEER_TILE_ID), ["actuator"]);
    assert.deepEqual(firstRuleTileKinds(healed, ROBOT_BEEP_TILE_ID), ["actuator"]);
  });

  test("publication proceeds when the entry surface avoids the failing file", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const session = new MultiRootSession({ services: env.brainServices });
    session.setRoots([
      {
        namespace: "acme/pubroot",
        files: new Map([
          ["index.ts", `export { Vec } from "./vec";\n`],
          [
            "vec.ts",
            `import { NumberType, StructType, type StructOf } from "wendoo";

export const Vec = StructType({
  name: "Vec",
  fields: { x: NumberType },
});
export type Vec = StructOf<typeof Vec>;
`,
          ],
          ["steer.ts", ROBOT_STEER],
        ]),
        readOnlySource: true,
      },
      {
        namespace: HOST_NS,
        files: new Map([
          [
            "probe.ts",
            `import { Sensor, type Context } from "wendoo";
import { Vec } from "@lib/acme/pubroot";

export default Sensor({
  id: "snprobe000000001",
  name: "vec probe",
  returnType: Vec,
  onExecute(ctx: Context): Vec {
    return Vec({ x: 1 });
  },
});
`,
          ],
        ]),
        dependencies: [{ coordinate: "acme/pubroot" }],
      },
    ]);
    const { roots } = session.compile();

    const pubResult = roots.get("acme/pubroot")!;
    assert.ok(errorsAt(pubResult, "steer.ts").length > 0, "the sibling file still fails");
    assert.ok(
      [...(pubResult.publishedTypes?.keys() ?? [])].some((key) => key.endsWith("::Vec")),
      "the entry surface publishes"
    );

    const hostResult = roots.get(HOST_NS)!;
    assert.deepEqual(errorsAt(hostResult, "probe.ts"), [], "the consumer of the published type compiles clean");
    assert.ok(hostResult.results.get("probe.ts")?.program);
  });

  test("publication is withheld when the entry surface reaches the failing file, and consumers are withheld with it", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const session = new MultiRootSession({ services: env.brainServices });
    session.setRoots([
      {
        namespace: "acme/pubroot",
        files: new Map([
          ["index.ts", `export { steerFactor } from "./steer";\n`],
          [
            "steer.ts",
            `import { Position } from "@lib/acme/pos";

export function steerFactor(position: Position): number {
  return 1;
}
`,
          ],
        ]),
        readOnlySource: true,
      },
      {
        namespace: HOST_NS,
        files: new Map([
          [
            "probe.ts",
            `import { Sensor, type Context } from "wendoo";
import { steerFactor } from "@lib/acme/pubroot";

export default Sensor({
  id: "snprobe000000001",
  name: "factor probe",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`,
          ],
        ]),
        dependencies: [{ coordinate: "acme/pubroot" }],
      },
    ]);
    const { roots } = session.compile();

    const pubResult = roots.get("acme/pubroot")!;
    const indexDiags = pubResult.results.get("index.ts")?.diagnostics ?? [];
    assert.ok(
      indexDiags.some((diag) => diag.code === CompileDiagCode.ImportedFileHasErrors),
      `the entry module reports its failing dependency, got ${JSON.stringify(indexDiags)}`
    );

    const hostResult = roots.get(HOST_NS)!;
    const probeDiags = hostResult.results.get("probe.ts")?.diagnostics ?? [];
    assert.ok(
      probeDiags.some((diag) => diag.code === CompileDiagCode.ImportedFileHasErrors),
      `the consuming tile is withheld with the imported-file diagnostic, got ${JSON.stringify(probeDiags)}`
    );
    assert.equal(hostResult.results.get("probe.ts")?.program, undefined);
  });

  test("publication is withheld when the entry module itself fails", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const session = new MultiRootSession({ services: env.brainServices });
    session.setRoots([
      {
        namespace: "acme/pubroot",
        files: new Map([
          [
            "index.ts",
            `import { Position } from "@lib/acme/pos";

export function steerFactor(position: Position): number {
  return 1;
}
`,
          ],
        ]),
        readOnlySource: true,
      },
    ]);
    const { roots } = session.compile();

    const pubResult = roots.get("acme/pubroot")!;
    assert.ok(errorsAt(pubResult, "index.ts").length > 0, "the entry module reports its own error");
    const indexDiags = pubResult.results.get("index.ts")?.diagnostics ?? [];
    assert.equal(
      indexDiags.some((diag) => diag.code === CompileDiagCode.ImportedFileHasErrors),
      false,
      "the entry's own error is its diagnostic; no imported-file diagnostic is added"
    );
    assert.deepEqual([...(pubResult.publishedTypes?.keys() ?? [])], [], "the failed entry publishes nothing");
  });

  test("an entry module that is itself a tile importing a failing file carries exactly one imported-file diagnostic", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const session = new MultiRootSession({ services: env.brainServices });
    session.setRoots([
      {
        namespace: "acme/pubroot",
        files: new Map([
          [
            "index.ts",
            `import { Actuator, type Context } from "wendoo";
import { toInfluence } from "./pos-util";

export default Actuator({
  id: "acindex000000001",
  name: "index tile",
  onExecute(ctx: Context): void {
  },
});
`,
          ],
          [
            "pos-util.ts",
            `import { Position } from "@lib/acme/pos";

export function toInfluence(position: Position): number {
  return 1;
}
`,
          ],
        ]),
        readOnlySource: true,
      },
    ]);
    const { roots } = session.compile();

    const pubResult = roots.get("acme/pubroot")!;
    const indexDiags = (pubResult.results.get("index.ts")?.diagnostics ?? []).filter(
      (diag) => diag.code === CompileDiagCode.ImportedFileHasErrors
    );
    assert.equal(indexDiags.length, 1, "the tile entry and the publication guard emit one diagnostic between them");
    assert.equal(pubResult.results.get("index.ts")?.program, undefined);
    assert.deepEqual([...(pubResult.publishedTypes?.keys() ?? [])], [], "the blocked entry publishes nothing");
  });

  test("a clean empty host root keeps the bundle when a library root is fully blocked", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const session = new MultiRootSession({ services: env.brainServices });
    session.setRoots([
      {
        namespace: ROBOT_NS,
        files: new Map([["steer.ts", ROBOT_STEER]]),
        readOnlySource: true,
      },
      { namespace: HOST_NS, files: new Map() },
    ]);
    session.compile();

    const bundle = buildMultiRootActionBundle([...session.results().values()], { services: env.brainServices });
    assert.ok(bundle, "the clean host root keeps the bundle live");
    assert.deepEqual(bundle.tiles, [], "the fully-blocked library contributes nothing");
  });
});
