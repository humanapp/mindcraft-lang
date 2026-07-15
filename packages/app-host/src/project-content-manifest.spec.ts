import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectContentManifest } from "@mindcraft-lang/app-host";
import {
  ProjectContentManifestErrorCode,
  parseExtensionReference,
  parseProjectContentManifest,
  serializeProjectContentManifest,
  validateProjectContentManifest,
  validateProjectExtensions,
} from "@mindcraft-lang/app-host";

const VALID_MANIFEST = {
  name: "My Project",
  version: "1.2.3",
  extensions: {
    "example-org/mindcraft-position": "gh:example-org/mindcraft-position@v1.2.0",
    "mindcraft-lang/microbit-stdlib": "embedded:mindcraft-lang/microbit-stdlib",
    "author/scratch": "local:8f14e45f-ceea-4e17-a396-7f34c2d51b3a",
  },
};

function errorCodes(result: ReturnType<typeof validateProjectContentManifest>): string[] {
  return result.errors.map((error) => error.code);
}

describe("parseExtensionReference", () => {
  it("parses a gh reference", () => {
    assert.deepStrictEqual(parseExtensionReference("gh:example-org/mindcraft-position@v1.2.0"), {
      transport: "gh",
      owner: "example-org",
      repo: "mindcraft-position",
      tag: "v1.2.0",
    });
  });

  it("parses an embedded reference carrying the full coordinate", () => {
    assert.deepStrictEqual(parseExtensionReference("embedded:mindcraft-lang/microbit-stdlib"), {
      transport: "embedded",
      coordinate: "mindcraft-lang/microbit-stdlib",
    });
  });

  it("rejects a repo-only embedded reference", () => {
    assert.strictEqual(parseExtensionReference("embedded:microbit-stdlib"), undefined);
  });

  it("parses a local reference", () => {
    assert.deepStrictEqual(parseExtensionReference("local:8f14e45f-ceea-4e17-a396-7f34c2d51b3a"), {
      transport: "local",
      projectId: "8f14e45f-ceea-4e17-a396-7f34c2d51b3a",
    });
  });

  it("rejects unrecognized transports and malformed forms", () => {
    const malformed = [
      "npm:left-pad@1.0.0",
      "gh:owner/repo",
      "gh:owner@tag",
      "gh:owner/repo@",
      "gh:owner/repo@tag with spaces",
      "gh:owner/repo@v1/extra",
      "gh:/repo@tag",
      "embedded:",
      "embedded:reponly",
      "embedded:owner/repo/extra",
      "embedded:/repo",
      "embedded:owner/",
      "local:",
      "local:has whitespace",
      "",
      "position",
    ];
    for (const reference of malformed) {
      assert.strictEqual(parseExtensionReference(reference), undefined, `Expected rejection for "${reference}"`);
    }
  });
});

describe("parseProjectContentManifest", () => {
  it("parses a manifest with all three reference forms", () => {
    const result = parseProjectContentManifest(JSON.stringify(VALID_MANIFEST));
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.manifest, VALID_MANIFEST);
    }
  });

  it("defaults an absent extensions field to an empty map", () => {
    const result = parseProjectContentManifest(JSON.stringify({ name: "P", version: "0.1.0" }));
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.manifest.extensions, {});
    }
  });

  it("carries string description and thumbnailUrl through and captures other fields as extras", () => {
    const result = parseProjectContentManifest(
      JSON.stringify({
        name: "P",
        version: "0.1.0",
        description: "desc",
        host: { name: "sim", version: "1.0.0" },
        thumbnailUrl: "data:,x",
      })
    );
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.manifest.description, "desc");
      assert.strictEqual(result.manifest.thumbnailUrl, "data:,x");
      assert.strictEqual("host" in result.manifest, false);
      assert.deepStrictEqual(result.manifest.extras, { host: { name: "sim", version: "1.0.0" } });
    }
  });

  it("omits extras when the document carries only schema fields", () => {
    const result = parseProjectContentManifest(JSON.stringify({ name: "P", version: "0.1.0" }));
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual("extras" in result.manifest, false);
    }
  });

  it("omits description and thumbnailUrl when absent or non-string", () => {
    const result = parseProjectContentManifest(
      JSON.stringify({ name: "P", version: "0.1.0", description: 5, thumbnailUrl: null })
    );
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual("description" in result.manifest, false);
      assert.strictEqual("thumbnailUrl" in result.manifest, false);
    }
  });

  it("carries a non-empty files string array through", () => {
    const result = parseProjectContentManifest(
      JSON.stringify({ name: "P", version: "0.1.0", files: ["index.ts", "mindcraft.core.d.ts"] })
    );
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.manifest.files, ["index.ts", "mindcraft.core.d.ts"]);
    }
  });

  it("omits files when absent or empty", () => {
    for (const files of [undefined, []]) {
      const result = parseProjectContentManifest(JSON.stringify({ name: "P", version: "0.1.0", files }));
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual("files" in result.manifest, false);
      }
    }
  });

  it("carries a non-empty ambient string array through", () => {
    const result = parseProjectContentManifest(
      JSON.stringify({ name: "P", version: "0.1.0", ambient: ["mindcraft.core.d.ts", "mindcraft.wodal.d.ts"] })
    );
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.manifest.ambient, ["mindcraft.core.d.ts", "mindcraft.wodal.d.ts"]);
    }
  });

  it("omits ambient when absent or empty", () => {
    for (const ambient of [undefined, []]) {
      const result = parseProjectContentManifest(JSON.stringify({ name: "P", version: "0.1.0", ambient }));
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual("ambient" in result.manifest, false);
      }
    }
  });

  it("carries a non-empty targets map through", () => {
    const result = parseProjectContentManifest(
      JSON.stringify({
        name: "P",
        version: "0.1.0",
        targets: { "mindcraft-lang/microbit-v2": { packageVersion: "^0.2.0" } },
      })
    );
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.manifest.targets, {
        "mindcraft-lang/microbit-v2": { packageVersion: "^0.2.0" },
      });
    }
  });

  it("omits targets when absent or empty", () => {
    for (const targets of [undefined, {}]) {
      const result = parseProjectContentManifest(JSON.stringify({ name: "P", version: "0.1.0", targets }));
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual("targets" in result.manifest, false);
      }
    }
  });

  it("rejects invalid JSON with INVALID_JSON", () => {
    const result = parseProjectContentManifest("{not json");
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(errorCodes(result), [ProjectContentManifestErrorCode.INVALID_JSON]);
  });

  it("rejects a non-object root with INVALID_ROOT", () => {
    const result = parseProjectContentManifest("[1,2]");
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(errorCodes(result), [ProjectContentManifestErrorCode.INVALID_ROOT]);
  });
});

describe("validateProjectContentManifest", () => {
  it("rejects a missing or non-string name with INVALID_NAME", () => {
    for (const name of [undefined, 42]) {
      const result = validateProjectContentManifest({ ...VALID_MANIFEST, name });
      assert.strictEqual(result.ok, false);
      assert.ok(errorCodes(result).includes(ProjectContentManifestErrorCode.INVALID_NAME));
    }
  });

  it("backfills a missing, non-string, or non-semver version to the lowest content version", () => {
    for (const version of [undefined, 42, "1.0", "abc", "1.0.0.0", "01.0.0"]) {
      const result = validateProjectContentManifest({ ...VALID_MANIFEST, version });
      assert.strictEqual(result.ok, true, `Expected acceptance for version ${JSON.stringify(version)}`);
      if (result.ok) {
        assert.strictEqual(result.manifest.version, "0.0.0");
      }
    }
  });

  it("accepts semver prerelease and build metadata", () => {
    for (const version of ["1.0.0-alpha.1", "1.0.0+build.5", "1.0.0-rc.1+sha.abc"]) {
      const result = validateProjectContentManifest({ name: "P", version });
      assert.strictEqual(result.ok, true, `Expected acceptance for version "${version}"`);
    }
  });

  it("rejects a non-array or non-string-element files field with INVALID_FILES", () => {
    for (const files of [5, "x", { a: 1 }, ["ok", 3]]) {
      const result = validateProjectContentManifest({ name: "P", version: "0.1.0", files });
      assert.strictEqual(result.ok, false);
      assert.ok(errorCodes(result).includes(ProjectContentManifestErrorCode.INVALID_FILES));
    }
  });

  it("rejects a non-array or non-string-element ambient field with INVALID_AMBIENT", () => {
    for (const ambient of [5, "x", { a: 1 }, ["ok", 3]]) {
      const result = validateProjectContentManifest({ name: "P", version: "0.1.0", ambient });
      assert.strictEqual(result.ok, false);
      assert.ok(errorCodes(result).includes(ProjectContentManifestErrorCode.INVALID_AMBIENT));
    }
  });

  it("rejects a malformed targets field with INVALID_TARGETS", () => {
    const cases: unknown[] = [
      5,
      ["a"],
      { "-bad/repo": { packageVersion: "^1.0.0" } },
      { "mindcraft-lang/codal": { packageVersion: 3 } },
      { "mindcraft-lang/codal": { packageVersion: "" } },
      { "mindcraft-lang/codal": "^1.0.0" },
    ];
    for (const targets of cases) {
      const result = validateProjectContentManifest({ name: "P", version: "0.1.0", targets });
      assert.strictEqual(result.ok, false, `Expected rejection for targets ${JSON.stringify(targets)}`);
      assert.ok(errorCodes(result).includes(ProjectContentManifestErrorCode.INVALID_TARGETS));
    }
  });

  it("rejects a non-object extensions field with INVALID_EXTENSIONS", () => {
    for (const extensions of [5, "x", ["a"], null]) {
      const result = validateProjectContentManifest({ name: "P", version: "0.1.0", extensions });
      assert.strictEqual(result.ok, false);
      assert.ok(errorCodes(result).includes(ProjectContentManifestErrorCode.INVALID_EXTENSIONS));
    }
  });

  it("rejects an invalid coordinate with INVALID_EXTENSION_COORDINATE", () => {
    for (const coordinate of ["-bad/repo", "no-slash", "owner/repo/extra"]) {
      const result = validateProjectContentManifest({
        name: "P",
        version: "0.1.0",
        extensions: { [coordinate]: "embedded:org/ok" },
      });
      assert.strictEqual(result.ok, false, `Expected rejection for coordinate "${coordinate}"`);
      assert.deepStrictEqual(errorCodes(result), [ProjectContentManifestErrorCode.INVALID_EXTENSION_COORDINATE]);
    }
  });

  it("rejects case-insensitive duplicate coordinates with DUPLICATE_EXTENSION_COORDINATE", () => {
    const result = validateProjectContentManifest({
      name: "P",
      version: "0.1.0",
      extensions: { "org/Sonar": "embedded:org/one", "org/sonar": "embedded:org/two" },
    });
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(errorCodes(result), [ProjectContentManifestErrorCode.DUPLICATE_EXTENSION_COORDINATE]);
  });

  it("rejects malformed and non-string references with INVALID_EXTENSION_REFERENCE", () => {
    for (const reference of ["not-a-ref", 42]) {
      const result = validateProjectContentManifest({
        name: "P",
        version: "0.1.0",
        extensions: { "org/position": reference },
      });
      assert.strictEqual(result.ok, false);
      assert.deepStrictEqual(errorCodes(result), [ProjectContentManifestErrorCode.INVALID_EXTENSION_REFERENCE]);
    }
  });

  it("reports one error per rejected entry with entry paths", () => {
    const result = validateProjectContentManifest({
      name: "P",
      version: "0.1.0",
      extensions: { "org/good": "embedded:org/fine", "org/bad": "nope", "-also/bad": "embedded:org/fine" },
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errors.length, 2);
    assert.deepStrictEqual(result.errors.map((error) => error.path).sort(), [
      '$.extensions["-also/bad"]',
      '$.extensions["org/bad"]',
    ]);
  });
});

describe("validateProjectExtensions", () => {
  it("returns no errors for a valid extensions map", () => {
    assert.deepStrictEqual(validateProjectExtensions(VALID_MANIFEST.extensions), []);
  });
});

describe("serializeProjectContentManifest", () => {
  it("round-trips through parse", () => {
    const manifest: ProjectContentManifest = VALID_MANIFEST;
    const result = parseProjectContentManifest(serializeProjectContentManifest(manifest));
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.manifest, manifest);
    }
  });

  it("omits the extensions field when the map is empty", () => {
    const serialized = serializeProjectContentManifest({ name: "P", version: "0.1.0", extensions: {} });
    assert.strictEqual(serialized.includes("extensions"), false);
  });

  it("round-trips description and thumbnailUrl", () => {
    const manifest: ProjectContentManifest = {
      name: "P",
      version: "0.1.0",
      description: "desc",
      thumbnailUrl: "data:,x",
      extensions: {},
    };
    const result = parseProjectContentManifest(serializeProjectContentManifest(manifest));
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.manifest, manifest);
    }
  });

  it("omits description and thumbnailUrl when absent", () => {
    const serialized = serializeProjectContentManifest({ name: "P", version: "0.1.0", extensions: {} });
    assert.strictEqual(serialized.includes("description"), false);
    assert.strictEqual(serialized.includes("thumbnailUrl"), false);
  });

  it("round-trips a non-empty files list and omits it when empty", () => {
    const manifest: ProjectContentManifest = {
      name: "P",
      version: "0.1.0",
      extensions: {},
      files: ["index.ts", "mindcraft.core.d.ts"],
    };
    const result = parseProjectContentManifest(serializeProjectContentManifest(manifest));
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.manifest, manifest);
    }
    const emptySerialized = serializeProjectContentManifest({
      name: "P",
      version: "0.1.0",
      extensions: {},
      files: [],
    });
    assert.strictEqual(emptySerialized.includes("files"), false);
  });

  it("round-trips a non-empty ambient list and omits it when empty", () => {
    const manifest: ProjectContentManifest = {
      name: "P",
      version: "0.1.0",
      extensions: {},
      ambient: ["mindcraft.core.d.ts"],
    };
    const result = parseProjectContentManifest(serializeProjectContentManifest(manifest));
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.manifest, manifest);
    }
    const emptySerialized = serializeProjectContentManifest({
      name: "P",
      version: "0.1.0",
      extensions: {},
      ambient: [],
    });
    assert.strictEqual(emptySerialized.includes("ambient"), false);
  });

  it("round-trips a non-empty targets map and omits it when empty", () => {
    const manifest: ProjectContentManifest = {
      name: "P",
      version: "0.1.0",
      extensions: {},
      targets: { "mindcraft-lang/microbit-v2": { packageVersion: "^0.2.0" } },
    };
    const result = parseProjectContentManifest(serializeProjectContentManifest(manifest));
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.manifest, manifest);
    }
    const emptySerialized = serializeProjectContentManifest({
      name: "P",
      version: "0.1.0",
      extensions: {},
      targets: {},
    });
    assert.strictEqual(emptySerialized.includes("targets"), false);
  });

  it("round-trips extras byte-faithfully after the schema fields", () => {
    const manifest: ProjectContentManifest = {
      name: "P",
      version: "0.1.0",
      extensions: {},
      files: ["index.ts"],
      extras: { brains: { main: { rules: [1, 2] } }, appChunk: ["verbatim", null] },
    };
    const serialized = serializeProjectContentManifest(manifest);
    const result = parseProjectContentManifest(serialized);
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.manifest, manifest);
      assert.strictEqual(serializeProjectContentManifest(result.manifest), serialized);
    }
  });
});
