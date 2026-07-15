import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ExtensionPublishBackend,
  ExtensionPublishCommit,
  ExtensionPublishSource,
  PublishVersionBump,
} from "@mindcraft-lang/app-host";
import {
  deriveCoordinateFromRemoteUrl,
  ExtensionPublishErrorCode,
  publishExtensionVersion,
  serializeProjectContentManifest,
  validateProjectContentManifest,
} from "@mindcraft-lang/app-host";

const COORDINATE = "acme/position";

function memorySource(files: Record<string, string | Uint8Array>): ExtensionPublishSource {
  const encoder = new TextEncoder();
  return {
    readManifest: async () => {
      const content = files["mindcraft.json"];
      if (content === undefined) return undefined;
      return typeof content === "string" ? content : new TextDecoder().decode(content);
    },
    readFile: async (path) => {
      const content = files[path];
      if (content === undefined) return undefined;
      return typeof content === "string" ? encoder.encode(content) : content;
    },
  };
}

interface MemoryBackend {
  backend: ExtensionPublishBackend;
  applied: ExtensionPublishCommit[];
}

function memoryBackend(overrides?: Partial<ExtensionPublishBackend>): MemoryBackend {
  const applied: ExtensionPublishCommit[] = [];
  const backend: ExtensionPublishBackend = {
    isClean: async () => true,
    tagExists: async () => false,
    hasAnyTags: async () => false,
    readHeadManifest: async () => undefined,
    apply: async (commit) => {
      applied.push(commit);
    },
    ...overrides,
  };
  return { backend, applied };
}

function manifestText(document: Record<string, unknown>): string {
  const result = validateProjectContentManifest(document);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return serializeProjectContentManifest(result.manifest);
}

function decode(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}

describe("deriveCoordinateFromRemoteUrl", () => {
  it("derives the coordinate from the common GitHub remote forms", () => {
    const cases: ReadonlyArray<[string, string]> = [
      ["git@github.com:acme/position.git", "acme/position"],
      ["git@github.com:acme/position", "acme/position"],
      ["ssh://git@github.com/acme/position.git", "acme/position"],
      ["ssh://git@github.com/acme/position", "acme/position"],
      ["https://github.com/acme/position.git", "acme/position"],
      ["https://github.com/acme/position", "acme/position"],
      ["https://github.com/acme/position/", "acme/position"],
    ];
    for (const [url, expected] of cases) {
      assert.equal(deriveCoordinateFromRemoteUrl(url), expected, url);
    }
  });

  it("derives the coordinate from a plain repository path", () => {
    assert.equal(deriveCoordinateFromRemoteUrl("/tmp/fixtures/acme/position.git"), "acme/position");
  });

  it("returns undefined for remotes that yield no coordinate", () => {
    const cases: readonly string[] = [
      "",
      "https://github.com",
      "/position.git",
      "git@github.com:acme/_position.git",
      "https://github.com/_acme/position.git",
    ];
    for (const url of cases) {
      assert.equal(deriveCoordinateFromRemoteUrl(url), undefined, url);
    }
  });
});

describe("publishExtensionVersion", () => {
  it("publishes the bumped manifest followed by each listed file", async () => {
    const source = memorySource({
      "mindcraft.json": manifestText({ name: "Position", version: "0.1.0", files: ["index.ts", "assets/a.bin"] }),
      "index.ts": "export const x = 1;",
      "assets/a.bin": new Uint8Array([0, 1, 255, 128]),
    });
    const { backend, applied } = memoryBackend();

    const result = await publishExtensionVersion({ bump: "patch", coordinate: COORDINATE, source, backend });

    assert.deepEqual(result, { ok: true, version: "0.1.1", tag: "v0.1.1", identity: COORDINATE });
    assert.equal(applied.length, 1);
    const commit = applied[0];
    assert.equal(commit.version, "0.1.1");
    assert.equal(commit.tag, "v0.1.1");
    assert.deepEqual(
      commit.files.map((file) => file.path),
      ["mindcraft.json", "index.ts", "assets/a.bin"]
    );
    const published = JSON.parse(decode(commit.files[0].content)) as Record<string, unknown>;
    assert.equal(published.version, "0.1.1");
    assert.equal(published.identity, COORDINATE);
    assert.deepEqual(Array.from(commit.files[2].content), [0, 1, 255, 128]);
  });

  it("bumps the requested version component", async () => {
    const cases: ReadonlyArray<[PublishVersionBump, string]> = [
      ["patch", "1.2.4"],
      ["minor", "1.3.0"],
      ["major", "2.0.0"],
    ];
    for (const [bump, expected] of cases) {
      const source = memorySource({ "mindcraft.json": manifestText({ name: "P", version: "1.2.3" }) });
      const { backend } = memoryBackend();
      const result = await publishExtensionVersion({ bump, coordinate: COORDINATE, source, backend });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.version, expected);
        assert.equal(result.tag, `v${expected}`);
      }
    }
  });

  it("carries fields outside the manifest schema through the bump byte-faithfully", async () => {
    const original = manifestText({
      name: "Position",
      version: "1.2.3",
      identity: COORDINATE,
      files: ["index.ts"],
      brains: { main: { rules: [1, 2, 3], nested: { deep: true } } },
      appChunk: ["verbatim", null, 4],
    });
    const source = memorySource({ "mindcraft.json": original, "index.ts": "export {};" });
    const { backend, applied } = memoryBackend();

    const result = await publishExtensionVersion({ bump: "patch", coordinate: COORDINATE, source, backend });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.previousIdentity, undefined);
    const published = decode(applied[0].files[0].content);
    assert.equal(published, original.replace('"version": "1.2.3"', '"version": "1.2.4"'));
  });

  it("stamps the identity on a first as-is publish of a manifest without one", async () => {
    const source = memorySource({
      "mindcraft.json": manifestText({ name: "P", version: "0.3.0", files: ["index.ts"] }),
      "index.ts": "export {};",
    });
    const { backend, applied } = memoryBackend({
      // In-place first publish: the manifest version is already at head.
      readHeadManifest: async () => manifestText({ name: "P", version: "0.3.0" }),
    });

    const result = await publishExtensionVersion({ coordinate: COORDINATE, source, backend });

    assert.deepEqual(result, { ok: true, version: "0.3.0", tag: "v0.3.0", identity: COORDINATE });
    const published = JSON.parse(decode(applied[0].files[0].content)) as Record<string, unknown>;
    assert.equal(published.version, "0.3.0");
    assert.equal(published.identity, COORDINATE);
  });

  it("restamps a changed identity and reports the replaced value", async () => {
    const source = memorySource({
      "mindcraft.json": manifestText({ name: "P", version: "0.3.0", identity: "old-owner/position" }),
    });
    const { backend, applied } = memoryBackend();

    const result = await publishExtensionVersion({ coordinate: COORDINATE, source, backend });

    assert.deepEqual(result, {
      ok: true,
      version: "0.3.0",
      tag: "v0.3.0",
      identity: COORDINATE,
      previousIdentity: "old-owner/position",
    });
    const published = JSON.parse(decode(applied[0].files[0].content)) as Record<string, unknown>;
    assert.equal(published.identity, COORDINATE);
  });

  it("refuses a publish without a coordinate", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
      source: memorySource({ "mindcraft.json": manifestText({ name: "P", version: "0.1.0" }) }),
      backend: memoryBackend().backend,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, ExtensionPublishErrorCode.IDENTITY_UNKNOWN);
  });

  it("refuses an as-is publish when the repository already has tags", async () => {
    const result = await publishExtensionVersion({
      coordinate: COORDINATE,
      source: memorySource({ "mindcraft.json": manifestText({ name: "P", version: "0.3.0" }) }),
      backend: memoryBackend({ hasAnyTags: async () => true }).backend,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, ExtensionPublishErrorCode.VERSION_BUMP_REQUIRED);
  });

  it("refuses a project without a manifest", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
      coordinate: COORDINATE,
      source: memorySource({}),
      backend: memoryBackend().backend,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, ExtensionPublishErrorCode.MANIFEST_MISSING);
  });

  it("refuses an invalid manifest", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
      coordinate: COORDINATE,
      source: memorySource({ "mindcraft.json": JSON.stringify({ version: "1.0.0" }) }),
      backend: memoryBackend().backend,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, ExtensionPublishErrorCode.MANIFEST_INVALID);
      assert.match(result.error.message, /PROJECT_MANIFEST_INVALID_NAME/);
    }
  });

  it("refuses unconfirmed local dependencies and proceeds when confirmed", async () => {
    const files = {
      "mindcraft.json": manifestText({
        name: "P",
        version: "0.1.0",
        extensions: { "author/scratch": "local:project-1" },
      }),
    };
    const refused = await publishExtensionVersion({
      bump: "patch",
      coordinate: COORDINATE,
      source: memorySource(files),
      backend: memoryBackend().backend,
    });
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      assert.equal(refused.error.code, ExtensionPublishErrorCode.LOCAL_DEPENDENCIES_UNCONFIRMED);
      assert.match(refused.error.message, /author\/scratch/);
    }

    const confirmed = await publishExtensionVersion({
      bump: "patch",
      coordinate: COORDINATE,
      allowLocalDependencies: true,
      source: memorySource(files),
      backend: memoryBackend().backend,
    });
    assert.equal(confirmed.ok, true);
  });

  it("refuses a repository with uncommitted changes", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
      coordinate: COORDINATE,
      source: memorySource({ "mindcraft.json": manifestText({ name: "P", version: "0.1.0" }) }),
      backend: memoryBackend({ isClean: async () => false }).backend,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, ExtensionPublishErrorCode.UNCOMMITTED_CHANGES);
  });

  it("refuses when the bumped version is already the head manifest version", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
      coordinate: COORDINATE,
      source: memorySource({ "mindcraft.json": manifestText({ name: "P", version: "0.1.0" }) }),
      backend: memoryBackend({
        readHeadManifest: async () => manifestText({ name: "P", version: "0.1.1" }),
      }).backend,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, ExtensionPublishErrorCode.VERSION_ALREADY_PUBLISHED);
  });

  it("refuses when the computed tag already exists", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
      coordinate: COORDINATE,
      source: memorySource({ "mindcraft.json": manifestText({ name: "P", version: "0.1.0" }) }),
      backend: memoryBackend({ tagExists: async (tag) => tag === "v0.1.1" }).backend,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, ExtensionPublishErrorCode.TAG_EXISTS);
  });

  it("refuses when a manifest-listed file is missing", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
      coordinate: COORDINATE,
      source: memorySource({
        "mindcraft.json": manifestText({ name: "P", version: "0.1.0", files: ["ghost.ts"] }),
      }),
      backend: memoryBackend().backend,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, ExtensionPublishErrorCode.LISTED_FILE_MISSING);
      assert.match(result.error.message, /ghost\.ts/);
    }
  });

  it("publishes the bumped manifest once even when the files list names it", async () => {
    const source = memorySource({
      "mindcraft.json": manifestText({ name: "P", version: "0.1.0", files: ["mindcraft.json", "index.ts"] }),
      "index.ts": "export {};",
    });
    const { backend, applied } = memoryBackend();

    const result = await publishExtensionVersion({ bump: "patch", coordinate: COORDINATE, source, backend });

    assert.equal(result.ok, true);
    const manifestEntries = applied[0].files.filter((file) => file.path === "mindcraft.json");
    assert.equal(manifestEntries.length, 1);
    const published = JSON.parse(decode(manifestEntries[0].content)) as Record<string, unknown>;
    assert.equal(published.version, "0.1.1");
  });
});
