import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CoreTypeIds,
  coreModule,
  createMindcraftEnvironment,
  type MindcraftEnvironment,
  mkOutputTileId,
  mkOutputVarKey,
  mkParameterTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import type { BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import {
  buildCompiledActionBundle,
  buildMultiRootActionBundle,
  MultiRootSession,
  type ProjectCompileResult,
  privateArgTileId,
  scopedOutputName,
  UserTileProject,
  type WorkspaceCompileResult,
} from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import {
  applyCompiledUserTiles,
  collectMetadataFromCompile,
  hydrateUserTilesFromCache,
  type UserTileRegistrationOptions,
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

const OUTPUT_SENSOR = `
import { Sensor, setOutput, type Context } from "mindcraft";

export default Sensor({
  id: "snrange",
  name: "range",
  outputs: [{ name: "distance", type: "number" }],
  onExecute(ctx: Context): number {
    setOutput(ctx, "distance", 5);
    return 1;
  },
});
`;

describe("warm-start cache round-trip", () => {
  test("a sensor output hydrates with the same namespace-scoped identity the compiler mints", async () => {
    const source = { "sensor.ts": OUTPUT_SENSOR };

    const authoringEnv = createMindcraftEnvironment({ modules: [coreModule()] });
    const result = compile(authoringEnv, source);
    assert.ok(result.bundle, "expected the output sensor to compile to a bundle");

    const scopedName = scopedOutputName(TEST_PROJECT_NAMESPACE, "distance");
    const outputTileId = mkOutputTileId(CoreTypeIds.Number, scopedName);
    const outputKey = mkOutputVarKey(CoreTypeIds.Number, scopedName);
    const compiledOutputTile = result.bundle.tiles.find((tile) => tile.tileId === outputTileId);
    assert.ok(compiledOutputTile, "the compiled bundle carries the scoped output tile");

    let savedJson: string | undefined;
    const options: UserTileRegistrationOptions = {
      loadMetadata: async () => savedJson,
      saveMetadata: (json) => {
        savedJson = json;
      },
    };
    applyCompiledUserTiles(authoringEnv, result, options);
    assert.ok(savedJson, "the compile should persist a metadata cache");

    const warmStartEnv = createMindcraftEnvironment({ modules: [coreModule()] });
    const restored = await hydrateUserTilesFromCache(warmStartEnv, options);
    assert.ok(restored, "the cache should hydrate");

    const hydratedCatalog = warmStartEnv.tileCatalogs()[1];
    const hydratedOutputTile = hydratedCatalog.get(outputTileId);
    assert.ok(hydratedOutputTile, "the hydrated catalog carries the scoped output tile");

    const hydratedSensor = hydratedCatalog.get(`tile.sensor->${TEST_PROJECT_NAMESPACE}:user.sensor.snrange`);
    assert.ok(hydratedSensor, "the hydrated catalog carries the sensor");
    assert.ok(
      hydratedSensor.providedOutputs().indexOf(outputKey) >= 0,
      "the hydrated sensor provides the scoped output key"
    );
  });

  test("inline and presenceGated survive persist then rehydrate", async () => {
    const source = { "sensor.ts": INLINE_PRESENCE_SENSOR };

    const authoringEnv = createMindcraftEnvironment({ modules: [coreModule()] });
    const result = compile(authoringEnv, source);

    let savedJson: string | undefined;
    const options: UserTileRegistrationOptions = {
      loadMetadata: async () => savedJson,
      saveMetadata: (json) => {
        savedJson = json;
      },
    };

    applyCompiledUserTiles(authoringEnv, result, options);
    assert.ok(savedJson, "the compile should persist a metadata cache");

    // A cold environment restoring only from the persisted cache.
    const warmStartEnv = createMindcraftEnvironment({ modules: [coreModule()] });
    const restored = await hydrateUserTilesFromCache(warmStartEnv, options);
    assert.ok(restored, "the cache should hydrate");

    const sensor = restored.find((m) => m.key === `${TEST_PROJECT_NAMESPACE}:user.sensor.snstick`);
    assert.ok(sensor, "expected the sensor to survive the cache");
    assert.equal(sensor.inline, true, "inline must survive the warm-start cache");
    assert.equal(sensor.presenceGated, true, "presenceGated must survive the warm-start cache");
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

    applyCompiledUserTiles(env, result, {
      loadMetadata: async () => undefined,
      saveMetadata: () => {},
    });

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

const EXT_DERIVED_NAMESPACE = "acme/ranger";
const EXT_DERIVED_ID = "extRange00000001";
const HOST_DERIVED_ID = "hostRange0000001";

const EXT_DERIVED_SENSOR = `
import { Sensor, setOutput, param, type Context } from "mindcraft";

export default Sensor({
  id: "${EXT_DERIVED_ID}",
  name: "ext ranger",
  args: [param("distance", { type: "number" })],
  outputs: [{ name: "reading", type: "number" }],
  onExecute(ctx: Context, args: { distance: number }): number {
    setOutput(ctx, "reading", args.distance);
    return 1;
  },
});
`;

const HOST_DERIVED_SENSOR = `
import { Sensor, setOutput, param, type Context } from "mindcraft";

export default Sensor({
  id: "${HOST_DERIVED_ID}",
  name: "host ranger",
  args: [param("depth", { type: "number" })],
  outputs: [{ name: "level", type: "number" }],
  onExecute(ctx: Context, args: { depth: number }): number {
    setOutput(ctx, "level", args.depth);
    return 2;
  },
});
`;

function compileDerivedRoots(env: MindcraftEnvironment): WorkspaceCompileResult {
  const session = new MultiRootSession({ services: env.brainServices });
  session.setRoots([
    { namespace: TEST_PROJECT_NAMESPACE, files: new Map([["main.ts", HOST_DERIVED_SENSOR]]) },
    { namespace: EXT_DERIVED_NAMESPACE, files: new Map([["index.ts", EXT_DERIVED_SENSOR]]) },
  ]);
  session.compile();
  const rootResults: ProjectCompileResult[] = [...session.results().values()];
  const projectResult = session.results().get(TEST_PROJECT_NAMESPACE)!;
  const bundle = buildMultiRootActionBundle(rootResults, { services: env.brainServices });
  return { files: new Map(), projectResult, rootResults, bundle };
}

describe("warm-start hydration of extension tiles", () => {
  test("an extension tile's derived param and output ids hydrate under the extension namespace", async () => {
    const authoringEnv = createMindcraftEnvironment({ modules: [coreModule()] });
    const result = compileDerivedRoots(authoringEnv);
    assert.ok(result.bundle, "expected a combined bundle over the host and extension roots");

    // Authoritative derived ids, scoped by each tile's own namespace.
    const extParamId = mkParameterTileId(privateArgTileId(EXT_DERIVED_NAMESPACE, EXT_DERIVED_ID, "distance"));
    const extOutputId = mkOutputTileId(CoreTypeIds.Number, scopedOutputName(EXT_DERIVED_NAMESPACE, "reading"));
    const hostParamId = mkParameterTileId(privateArgTileId(TEST_PROJECT_NAMESPACE, HOST_DERIVED_ID, "depth"));
    const hostOutputId = mkOutputTileId(CoreTypeIds.Number, scopedOutputName(TEST_PROJECT_NAMESPACE, "level"));
    // The ids the host-scoped path would mint for the extension tile.
    const extParamHostScoped = mkParameterTileId(privateArgTileId(TEST_PROJECT_NAMESPACE, EXT_DERIVED_ID, "distance"));
    const extOutputHostScoped = mkOutputTileId(CoreTypeIds.Number, scopedOutputName(TEST_PROJECT_NAMESPACE, "reading"));

    const bundleIds = new Set(result.bundle.tiles.map((tile) => tile.tileId));
    assert.ok(bundleIds.has(extParamId), "the compiled bundle scopes the ext param id under the ext namespace");
    assert.ok(bundleIds.has(extOutputId), "the compiled bundle scopes the ext output id under the ext namespace");

    let savedJson: string | undefined;
    const options: UserTileRegistrationOptions = {
      loadMetadata: async () => savedJson,
      saveMetadata: (json) => {
        savedJson = json;
      },
    };
    applyCompiledUserTiles(authoringEnv, result, options);
    assert.ok(savedJson, "the compile should persist a metadata cache");

    const warmStartEnv = createMindcraftEnvironment({ modules: [coreModule()] });
    const restored = await hydrateUserTilesFromCache(warmStartEnv, options);
    assert.ok(restored, "the cache should hydrate");

    const catalog = warmStartEnv.tileCatalogs()[1];
    assert.ok(catalog.get(extParamId), "the ext param hydrates under the ext namespace, matching the compile");
    assert.ok(catalog.get(extOutputId), "the ext output hydrates under the ext namespace, matching the compile");
    assert.ok(!catalog.get(extParamHostScoped), "the ext param is not mis-scoped under the host namespace");
    assert.ok(!catalog.get(extOutputHostScoped), "the ext output is not mis-scoped under the host namespace");

    assert.ok(catalog.get(hostParamId), "a host tile's derived param id is unchanged");
    assert.ok(catalog.get(hostOutputId), "a host tile's derived output id is unchanged");
  });
});
