import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CoreTypeIds,
  coreModule,
  createMindcraftEnvironment,
  type MindcraftEnvironment,
} from "@mindcraft-lang/core/app";
import { buildCompiledActionBundle, UserTileProject, type WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
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
  return { files: new Map(), projectResult, bundle };
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

describe("warm-start cache round-trip", () => {
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
    const restored = await hydrateUserTilesFromCache(warmStartEnv, options, TEST_PROJECT_NAMESPACE);
    assert.ok(restored, "the cache should hydrate");

    const sensor = restored.find((m) => m.key === `${TEST_PROJECT_NAMESPACE}:user.sensor.snstick`);
    assert.ok(sensor, "expected the sensor to survive the cache");
    assert.equal(sensor.inline, true, "inline must survive the warm-start cache");
    assert.equal(sensor.presenceGated, true, "presenceGated must survive the warm-start cache");
  });
});
