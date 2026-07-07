import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionReference, ProjectContentManifest } from "@mindcraft-lang/app-host";
import {
  ProjectContentManifestErrorCode,
  parseExtensionReference,
  parseProjectContentManifest,
  serializeExtensionReference,
  serializeProjectContentManifest,
  validateProjectContentManifest,
  validateProjectExtensions,
} from "@mindcraft-lang/app-host";

const VALID_MANIFEST = {
  name: "My Project",
  version: "1.2.3",
  extensions: {
    "example-org/mindcraft-position": "gh:example-org/mindcraft-position@v1.2.0",
    "mindcraft-lang/microbit-stdlib": "embedded:microbit-stdlib",
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

  it("parses an embedded reference", () => {
    assert.deepStrictEqual(parseExtensionReference("embedded:microbit-stdlib"), {
      transport: "embedded",
      slug: "microbit-stdlib",
    });
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
      "embedded:has/slash",
      "local:",
      "local:has whitespace",
      "",
      "position",
    ];
    for (const reference of malformed) {
      assert.strictEqual(parseExtensionReference(reference), undefined, `Expected rejection for "${reference}"`);
    }
  });

  it("round-trips through serializeExtensionReference", () => {
    const references = [
      "gh:example-org/mindcraft-position@v1.2.0",
      "embedded:microbit-stdlib",
      "local:8f14e45f-ceea-4e17-a396-7f34c2d51b3a",
    ];
    for (const reference of references) {
      const parsed = parseExtensionReference(reference) as ExtensionReference;
      assert.ok(parsed);
      assert.strictEqual(serializeExtensionReference(parsed), reference);
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

  it("ignores fields outside the content manifest", () => {
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

  it("rejects a missing, non-string, or non-semver version with INVALID_VERSION", () => {
    for (const version of [undefined, 42, "1.0", "abc", "1.0.0.0", "01.0.0"]) {
      const result = validateProjectContentManifest({ ...VALID_MANIFEST, version });
      assert.strictEqual(result.ok, false, `Expected rejection for version ${JSON.stringify(version)}`);
      assert.ok(errorCodes(result).includes(ProjectContentManifestErrorCode.INVALID_VERSION));
    }
  });

  it("accepts semver prerelease and build metadata", () => {
    for (const version of ["1.0.0-alpha.1", "1.0.0+build.5", "1.0.0-rc.1+sha.abc"]) {
      const result = validateProjectContentManifest({ name: "P", version });
      assert.strictEqual(result.ok, true, `Expected acceptance for version "${version}"`);
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
        extensions: { [coordinate]: "embedded:ok" },
      });
      assert.strictEqual(result.ok, false, `Expected rejection for coordinate "${coordinate}"`);
      assert.deepStrictEqual(errorCodes(result), [ProjectContentManifestErrorCode.INVALID_EXTENSION_COORDINATE]);
    }
  });

  it("rejects case-insensitive duplicate coordinates with DUPLICATE_EXTENSION_COORDINATE", () => {
    const result = validateProjectContentManifest({
      name: "P",
      version: "0.1.0",
      extensions: { "org/Sonar": "embedded:one", "org/sonar": "embedded:two" },
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
      extensions: { "org/good": "embedded:fine", "org/bad": "nope", "-also/bad": "embedded:fine" },
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
});
