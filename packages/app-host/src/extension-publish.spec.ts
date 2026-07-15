import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ExtensionPublishBackend,
  ExtensionPublishCommit,
  ExtensionPublishSource,
  PublishVersionBump,
} from "@mindcraft-lang/app-host";
import {
  ExtensionPublishErrorCode,
  publishExtensionVersion,
  serializeProjectContentManifest,
  validateProjectContentManifest,
} from "@mindcraft-lang/app-host";

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

describe("publishExtensionVersion", () => {
  it("publishes the bumped manifest followed by each listed file", async () => {
    const source = memorySource({
      "mindcraft.json": manifestText({ name: "Position", version: "0.1.0", files: ["index.ts", "assets/a.bin"] }),
      "index.ts": "export const x = 1;",
      "assets/a.bin": new Uint8Array([0, 1, 255, 128]),
    });
    const { backend, applied } = memoryBackend();

    const result = await publishExtensionVersion({ bump: "patch", source, backend });

    assert.deepEqual(result, { ok: true, version: "0.1.1", tag: "v0.1.1" });
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
      const result = await publishExtensionVersion({ bump, source, backend });
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
      files: ["index.ts"],
      brains: { main: { rules: [1, 2, 3], nested: { deep: true } } },
      appChunk: ["verbatim", null, 4],
    });
    const source = memorySource({ "mindcraft.json": original, "index.ts": "export {};" });
    const { backend, applied } = memoryBackend();

    const result = await publishExtensionVersion({ bump: "patch", source, backend });

    assert.equal(result.ok, true);
    const published = decode(applied[0].files[0].content);
    assert.equal(published, original.replace('"version": "1.2.3"', '"version": "1.2.4"'));
  });

  it("refuses a project without a manifest", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
      source: memorySource({}),
      backend: memoryBackend().backend,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, ExtensionPublishErrorCode.MANIFEST_MISSING);
  });

  it("refuses an invalid manifest", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
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
      allowLocalDependencies: true,
      source: memorySource(files),
      backend: memoryBackend().backend,
    });
    assert.equal(confirmed.ok, true);
  });

  it("refuses a repository with uncommitted changes", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
      source: memorySource({ "mindcraft.json": manifestText({ name: "P", version: "0.1.0" }) }),
      backend: memoryBackend({ isClean: async () => false }).backend,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, ExtensionPublishErrorCode.UNCOMMITTED_CHANGES);
  });

  it("refuses when the bumped version is already the head manifest version", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
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
      source: memorySource({ "mindcraft.json": manifestText({ name: "P", version: "0.1.0" }) }),
      backend: memoryBackend({ tagExists: async (tag) => tag === "v0.1.1" }).backend,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, ExtensionPublishErrorCode.TAG_EXISTS);
  });

  it("refuses when a manifest-listed file is missing", async () => {
    const result = await publishExtensionVersion({
      bump: "patch",
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

    const result = await publishExtensionVersion({ bump: "patch", source, backend });

    assert.equal(result.ok, true);
    const manifestEntries = applied[0].files.filter((file) => file.path === "mindcraft.json");
    assert.equal(manifestEntries.length, 1);
    const published = JSON.parse(decode(manifestEntries[0].content)) as Record<string, unknown>;
    assert.equal(published.version, "0.1.1");
  });
});
