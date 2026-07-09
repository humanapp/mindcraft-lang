import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CoreTypeIds,
  coreModule,
  createMindcraftEnvironment,
  type MindcraftEnvironment,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import type { BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import {
  buildCompiledActionBundle,
  buildMultiRootActionBundle,
  MultiRootSession,
  type ProjectCompileResult,
  UserTileProject,
  type WorkspaceCompileResult,
} from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { applyCompiledUserTiles, collectMetadataFromCompile } from "./user-tile-registration.js";

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

function compile(env: MindcraftEnvironment, files: Record<string, string>): WorkspaceCompileResult {
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
import { Sensor, type Context } from "mindcraft";

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
import { Conversion, NumberType, StringType } from "mindcraft";

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
    const env = createMindcraftEnvironment({ modules: [coreModule()] });
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
    const env = createMindcraftEnvironment({ modules: [coreModule()] });
    const result = compile(env, { "sensor.ts": INLINE_PRESENCE_SENSOR });
    const metadata = collectMetadataFromCompile(result);

    const sensor = metadata.find((m) => m.key === `${TEST_PROJECT_NAMESPACE}:user.sensor.snstick`);
    assert.ok(sensor, "expected the sensor metadata entry");
    assert.equal(sensor.inline, true);
    assert.equal(sensor.presenceGated, true);
  });
});

const EXT_NAMESPACE = "acme/beeper";
const EXT_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "extBeep000000001",
  name: "ext beep",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
const HOST_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "hostThing0000001",
  name: "host thing",
  onExecute(ctx: Context): number {
    return 2;
  },
});
`;

function compileWithExtension(env: MindcraftEnvironment): {
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
    const env = createMindcraftEnvironment({ modules: [coreModule()] });
    const { result, hostKey, extKey } = compileWithExtension(env);

    const metadata = collectMetadataFromCompile(result);
    const keys = metadata.map((entry) => entry.key);
    assert.ok(keys.includes(hostKey), "the host tile is gathered");
    assert.ok(keys.includes(extKey), "the extension tile is gathered under its own namespace");
  });

  test("an extension tile is usable: a brain using it links cleanly against the combined bundle", () => {
    const env = createMindcraftEnvironment({ modules: [coreModule()] });
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
