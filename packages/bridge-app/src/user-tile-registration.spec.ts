import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CoreTypeIds,
  coreModule,
  createWendooEnvironment,
  mkSensorTileId,
  type WendooEnvironment,
} from "@wendoo/core/app";
import { BrainDef } from "@wendoo/core/brain/model";
import type { BrainTileSensorDef } from "@wendoo/core/brain/tiles";
import {
  buildCompiledActionBundle,
  buildMultiRootActionBundle,
  MultiRootSession,
  type ProjectCompileResult,
  UserTileProject,
  type WorkspaceCompileResult,
} from "@wendoo/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@wendoo/ts-compiler/testing";
import {
  applyCompiledUserTiles,
  collectMetadataFromCompile,
  collectTileSourceCompileErrors,
} from "./user-tile-registration.js";

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

function compile(env: WendooEnvironment, files: Record<string, string>): WorkspaceCompileResult {
  const project = new UserTileProject({ projectNamespace: TEST_PROJECT_NAMESPACE, services: env.brainServices });
  project.setFiles(new Map(Object.entries(files)));
  const projectResult = project.compileAll();
  const bundle = buildCompiledActionBundle(projectResult, {
    resolveTypeId: resolveCoreTypeId,
    services: env.brainServices,
  });
  return { files: new Map(), projectResult, rootResults: [projectResult], bundle };
}

const INLINE_PRESENCE_SENSOR = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  id: "snstick",
  name: "stick",
  inline: true,
  presenceGated: true,
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;

const CONVERSION = `
import { Conversion, NumberType, StringType } from "wendoo";

export default Conversion({
  id: "cvns",
  from: NumberType,
  to: StringType,
  cost: 1,
  convert(value: number): string {
    return "x";
  },
});
`;

describe("collectMetadataFromCompile", () => {
  test("a Conversion compiles to a program but contributes no tile metadata", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const result = compile(env, { "sensor.ts": INLINE_PRESENCE_SENSOR, "conv.ts": CONVERSION });
    assert.equal(
      result.projectResult.tsErrors.size,
      0,
      `TS errors: ${JSON.stringify([...result.projectResult.tsErrors])}`
    );

    const metadata = collectMetadataFromCompile(result);
    assert.equal(metadata.length, 1, "only the sensor produces metadata; the conversion is excluded");
    assert.equal(metadata[0].key, `${TEST_PROJECT_NAMESPACE}:user.sensor.snstick`);
  });

  test("inline and presenceGated flow onto the tile metadata", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const result = compile(env, { "sensor.ts": INLINE_PRESENCE_SENSOR });
    const metadata = collectMetadataFromCompile(result);

    const sensor = metadata.find((m) => m.key === `${TEST_PROJECT_NAMESPACE}:user.sensor.snstick`);
    assert.ok(sensor, "expected the sensor metadata entry");
    assert.equal(sensor.inline, true);
    assert.equal(sensor.presenceGated, true);
  });

  // Re-anchored for definition presence: a failing file with a resolvable
  // surface contributes definition metadata; only a surface-unresolvable
  // definition is withheld.
  test("metadata matches the bundle: definitions contribute, surface-unresolvable files do not", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const result = compile(env, {
      "sensor.ts": INLINE_PRESENCE_SENSOR,
      "broken.ts": `
import { Sensor, type Context } from "wendoo";
import { Position } from "@lib/acme/pos";

export default Sensor({
  id: "snbroken00000001",
  name: "broken",
  onExecute(ctx: Context): number {
    const position: Position | undefined = undefined;
    return 1;
  },
});
`,
      "steer.ts": `
import { Actuator, param, type Context } from "wendoo";
import { Position } from "@lib/acme/pos";

export default Actuator({
  id: "acsteer000000001",
  name: "steer",
  args: [param("position", { type: Position, anonymous: true })],
  onExecute(ctx: Context, args: { position: Position }): void {
  },
});
`,
    });

    const metadata = collectMetadataFromCompile(result);
    const keys = metadata.map((entry) => entry.key);
    assert.ok(keys.includes(`${TEST_PROJECT_NAMESPACE}:user.sensor.snstick`), "the clean file's metadata is collected");
    assert.ok(
      keys.includes(`${TEST_PROJECT_NAMESPACE}:user.sensor.snbroken00000001`),
      "the failing file's definition metadata is collected"
    );
    assert.equal(
      keys.includes(`${TEST_PROJECT_NAMESPACE}:user.actuator.acsteer000000001`),
      false,
      "the surface-unresolvable file contributes no metadata"
    );
    assert.ok(result.bundle, "the partially-failing project still bundles");
    assert.ok(
      result.bundle.tiles.some(
        (tile) => tile.tileId === mkSensorTileId(`${TEST_PROJECT_NAMESPACE}:user.sensor.snbroken00000001`)
      ),
      "the definition's tile is in the bundle"
    );
    assert.equal(
      result.bundle.actions.get(`${TEST_PROJECT_NAMESPACE}:user.sensor.snbroken00000001`),
      undefined,
      "the definition offers no executable action"
    );
  });
});

const BROKEN_SENSOR = `
import { Sensor, type Context } from "wendoo";
import { Position } from "@lib/acme/pos";

export default Sensor({
  id: "snbroken00000001",
  name: "broken",
  onExecute(ctx: Context): number {
    const position: Position | undefined = undefined;
    return 1;
  },
});
`;

describe("collectTileSourceCompileErrors", () => {
  test("a tile whose file fails to compile maps its key to the compiler's verbatim error diagnostics and source path", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const result = compile(env, { "sensor.ts": INLINE_PRESENCE_SENSOR, "broken.ts": BROKEN_SENSOR });

    const brokenResult = result.projectResult.results.get("broken.ts");
    assert.ok(brokenResult, "broken.ts produced a compile result");
    // The tile's compile errors are the per-file union the workspace surfaces:
    // TypeScript pre-emit diagnostics plus the result's own diagnostics.
    const sourceErrors = [
      ...(result.projectResult.tsErrors.get("broken.ts") ?? []),
      ...brokenResult.diagnostics,
    ].filter((diagnostic) => diagnostic.severity === "error");
    assert.ok(sourceErrors.length > 0, "broken.ts compiled with at least one error diagnostic");

    const byKey = collectTileSourceCompileErrors(result);
    const brokenKey = `${TEST_PROJECT_NAMESPACE}:user.sensor.snbroken00000001`;
    const entry = byKey.get(brokenKey);
    assert.equal(entry?.path, "broken.ts", "the entry carries the tile's compile-root source path");
    assert.deepEqual(
      entry?.diagnostics,
      sourceErrors,
      "the map stores the compiler's own error diagnostics verbatim, keyed by ActionKey"
    );
    for (const diagnostic of entry?.diagnostics ?? []) {
      assert.equal(diagnostic.severity, "error");
    }
  });

  test("a cleanly-compiling tile contributes no entry", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const result = compile(env, { "sensor.ts": INLINE_PRESENCE_SENSOR });

    const byKey = collectTileSourceCompileErrors(result);
    assert.equal(byKey.size, 0, "a clean compile yields an empty map");
    assert.equal(byKey.has(`${TEST_PROJECT_NAMESPACE}:user.sensor.snstick`), false);
  });
});

const EXT_NAMESPACE = "acme/beeper";
const EXT_SENSOR = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  id: "extBeep000000001",
  name: "ext beep",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
const HOST_SENSOR = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  id: "hostThing0000001",
  name: "host thing",
  onExecute(ctx: Context): number {
    return 2;
  },
});
`;

function compileWithExtension(env: WendooEnvironment): {
  result: WorkspaceCompileResult;
  hostKey: string;
  extKey: string;
} {
  const session = new MultiRootSession({ services: env.brainServices });
  session.setRoots([
    { namespace: TEST_PROJECT_NAMESPACE, files: new Map([["main.ts", HOST_SENSOR]]) },
    { namespace: EXT_NAMESPACE, files: new Map([["index.ts", EXT_SENSOR]]) },
  ]);
  session.compile();
  const rootResults: ProjectCompileResult[] = [...session.results().values()];
  const projectResult = session.results().get(TEST_PROJECT_NAMESPACE)!;
  const bundle = buildMultiRootActionBundle(rootResults, { services: env.brainServices });
  return {
    result: { files: new Map(), projectResult, rootResults, bundle },
    hostKey: `${TEST_PROJECT_NAMESPACE}:user.sensor.hostThing0000001`,
    extKey: `${EXT_NAMESPACE}:user.sensor.extBeep000000001`,
  };
}

describe("extension tiles across compilation roots", () => {
  test("collectMetadataFromCompile gathers extension tiles under their namespace", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const { result, hostKey, extKey } = compileWithExtension(env);

    const metadata = collectMetadataFromCompile(result);
    const keys = metadata.map((entry) => entry.key);
    assert.ok(keys.includes(hostKey), "the host tile is gathered");
    assert.ok(keys.includes(extKey), "the extension tile is gathered under its own namespace");
  });

  test("an extension tile is usable: a brain using it links cleanly against the combined bundle", () => {
    const env = createWendooEnvironment({ modules: [coreModule()] });
    const { result, extKey } = compileWithExtension(env);
    assert.ok(result.bundle, "expected a combined bundle");

    applyCompiledUserTiles(env, result);

    const extTile = result.bundle.tiles.find((tile) => tile.tileId === mkSensorTileId(extKey)) as
      | BrainTileSensorDef
      | undefined;
    assert.ok(extTile, "the extension sensor tile is present in the bundle");

    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "Extension Consumer");
    brainDef.pages().get(0)!.children().get(0)!.when().appendTile(extTile);

    const linked = env.linkBrain(brainDef);
    assert.equal(
      linked.diagnostics.size(),
      0,
      `expected a clean link over the extension action, got ${JSON.stringify(linked.diagnostics.toArray())}`
    );
    assert.ok(linked.program, "the extension action links into a runnable brain program");
  });
});
