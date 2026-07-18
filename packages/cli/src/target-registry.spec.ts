import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import {
  loadTargetRegistry,
  parseTargetRegistry,
  TargetRegistryError,
  TargetRegistryErrorCode,
} from "./target-registry.js";

const MICROBIT_COORDINATE = "mindcraft-lang/trg-microbit-v2";
const MICROBIT_REF = "gh:mindcraft-lang/trg-microbit-v2@c6cfc18d88a6c475be7af63cd6529480d444d8e4";

const SHA_A = "1111111111111111111111111111111111111111";
const SHA_B = "2222222222222222222222222222222222222222";

/** A catalog entry object for a fixture registry document. */
function entry(coordinate: string, sha: string, kind = "library"): Record<string, unknown> {
  return {
    kind,
    coordinate,
    ref: `gh:${coordinate}@${sha}`,
    name: `Name ${coordinate}`,
    version: "1.0.0",
    description: `Description ${coordinate}`,
  };
}

/** Serialize a `mindcraft.catalog/1` document around the given entries. */
function registryDocument(entries: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ format: "mindcraft.catalog/1", entries });
}

describe("target registry", () => {
  it("loads the bundled registry and resolves the micro:bit target", () => {
    const registry = loadTargetRegistry();
    assert.equal(registry.entries.length, 1);
    const [only] = registry.entries;
    assert.equal(only.coordinate, MICROBIT_COORDINATE);
    assert.equal(only.name, "micro:bit v2");
    assert.equal(only.version, "0.7.0");
    assert.equal(only.ref, MICROBIT_REF);
    assert.equal(registry.resolve(MICROBIT_COORDINATE), MICROBIT_REF);
  });

  it("lists and resolves both entries of a two-entry registry", () => {
    const first = "example-org/trg-first";
    const second = "example-org/trg-second";
    const registry = parseTargetRegistry(registryDocument([entry(first, SHA_A), entry(second, SHA_B)]));

    assert.deepEqual(
      registry.entries.map((candidate) => candidate.coordinate),
      [first, second]
    );
    assert.equal(registry.resolve(first), `gh:${first}@${SHA_A}`);
    assert.equal(registry.resolve(second), `gh:${second}@${SHA_B}`);
  });

  it("rejects resolving a coordinate absent from the registry", () => {
    const registry = parseTargetRegistry(registryDocument([entry("example-org/trg-first", SHA_A)]));
    assert.throws(
      () => registry.resolve("example-org/trg-missing"),
      (thrown: unknown) =>
        thrown instanceof TargetRegistryError && thrown.code === TargetRegistryErrorCode.UNKNOWN_TARGET_COORDINATE
    );
  });

  it("fails rather than silently dropping an unknown-kind entry", () => {
    const document = registryDocument([entry("example-org/trg-first", SHA_A, "widget")]);
    assert.throws(
      () => parseTargetRegistry(document),
      (thrown: unknown) =>
        thrown instanceof TargetRegistryError &&
        thrown.code === TargetRegistryErrorCode.REGISTRY_PARSE_FAILED &&
        thrown.parseWarnings.length === 1
    );
  });

  it("resolves the bundled registry from any working directory", () => {
    const originalCwd = process.cwd();
    process.chdir(tmpdir());
    try {
      const registry = loadTargetRegistry();
      assert.equal(registry.resolve(MICROBIT_COORDINATE), MICROBIT_REF);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
