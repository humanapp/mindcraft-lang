import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ProjectFileChange,
  ProjectFileSnapshot,
  ProjectFileSystem,
  ProjectManifest,
} from "@mindcraft-lang/app-host";
import {
  DEFAULT_PROJECT_COLLECTION_ID,
  diffMindcraftJsonToManifest,
  MINDCRAFT_JSON_PATH,
  parseMindcraftJson,
  serializeMindcraftJson,
  syncManifestToMindcraftJson,
} from "@mindcraft-lang/app-host";

const HOST = { name: "test-app", version: "1.0.0" };

function makeManifest(overrides?: Partial<ProjectManifest>): ProjectManifest {
  return {
    id: "proj-1",
    projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
    name: "My Project",
    description: "A test project",
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeProjectFileSystem(
  files?: Map<string, { kind: "file"; content: string; etag: string; isReadonly: boolean }>
): ProjectFileSystem {
  const snapshot: ProjectFileSnapshot = new Map(files ?? []);
  const changes: ProjectFileChange[] = [];

  return {
    exportSnapshot() {
      return new Map(snapshot);
    },
    applyRemoteChange(change: ProjectFileChange) {
      changes.push(change);
      if (change.action === "write") {
        snapshot.set(change.path, {
          kind: "file",
          content: change.content,
          etag: change.newEtag,
          isReadonly: change.isReadonly ?? false,
        });
      }
    },
    applyLocalChange(change: ProjectFileChange) {
      changes.push(change);
      if (change.action === "write") {
        snapshot.set(change.path, {
          kind: "file",
          content: change.content,
          etag: change.newEtag,
          isReadonly: change.isReadonly ?? false,
        });
      }
    },
    onLocalChange() {
      return () => {};
    },
    onAnyChange() {
      return () => {};
    },
    flush() {},
    get _changes() {
      return changes;
    },
  } as ProjectFileSystem & { _changes: ProjectFileChange[] };
}

function projectFileSystemWithMindcraftJson(json: { name: string; description: string; version?: string }) {
  const content = serializeMindcraftJson({
    name: json.name,
    host: HOST,
    version: json.version ?? "0.0.1",
    description: json.description,
  });
  return makeProjectFileSystem(
    new Map([[MINDCRAFT_JSON_PATH, { kind: "file", content, etag: "existing", isReadonly: false }]])
  );
}

describe("syncManifestToMindcraftJson", () => {
  it("creates mindcraft.json when it does not exist", () => {
    const ws = makeProjectFileSystem();
    const manifest = makeManifest();

    syncManifestToMindcraftJson(ws, manifest, HOST);

    const snapshot = ws.exportSnapshot();
    const entry = snapshot.get(MINDCRAFT_JSON_PATH);
    assert.ok(entry);
    assert.strictEqual(entry.kind, "file");
    if (entry.kind === "file") {
      const parsed = parseMindcraftJson(entry.content);
      assert.ok(parsed);
      assert.strictEqual(parsed.name, "My Project");
      assert.strictEqual(parsed.description, "A test project");
      assert.strictEqual(parsed.host.name, "test-app");
      assert.strictEqual(parsed.version, "0.0.1");
    }
  });

  it("updates name in existing mindcraft.json", () => {
    const ws = projectFileSystemWithMindcraftJson({ name: "Old Name", description: "desc" });
    const manifest = makeManifest({ name: "New Name", description: "desc" });

    syncManifestToMindcraftJson(ws, manifest, HOST);

    const entry = ws.exportSnapshot().get(MINDCRAFT_JSON_PATH);
    assert.ok(entry && entry.kind === "file");
    const parsed = parseMindcraftJson(entry.content);
    assert.ok(parsed);
    assert.strictEqual(parsed.name, "New Name");
    assert.strictEqual(parsed.description, "desc");
  });

  it("updates description in existing mindcraft.json", () => {
    const ws = projectFileSystemWithMindcraftJson({ name: "Same", description: "old desc" });
    const manifest = makeManifest({ name: "Same", description: "new desc" });

    syncManifestToMindcraftJson(ws, manifest, HOST);

    const entry = ws.exportSnapshot().get(MINDCRAFT_JSON_PATH);
    assert.ok(entry && entry.kind === "file");
    const parsed = parseMindcraftJson(entry.content);
    assert.ok(parsed);
    assert.strictEqual(parsed.description, "new desc");
  });

  it("does not write when synced fields already match", () => {
    const ws = projectFileSystemWithMindcraftJson({ name: "Match", description: "same" });
    const manifest = makeManifest({ name: "Match", description: "same" });
    const adapter = ws as ProjectFileSystem & { _changes: ProjectFileChange[] };

    syncManifestToMindcraftJson(ws, manifest, HOST);

    assert.strictEqual(adapter._changes.length, 0);
  });

  it("writes manifest extensions when creating mindcraft.json", () => {
    const extensions = { position: "gh:example-org/mindcraft-position@v1.2.0" };
    const ws = makeProjectFileSystem();
    const manifest = makeManifest({ extensions });

    syncManifestToMindcraftJson(ws, manifest, HOST);

    const entry = ws.exportSnapshot().get(MINDCRAFT_JSON_PATH);
    assert.ok(entry && entry.kind === "file");
    const parsed = parseMindcraftJson(entry.content);
    assert.ok(parsed);
    assert.deepStrictEqual(parsed.extensions, extensions);
  });

  it("writes manifest extensions into an existing mindcraft.json", () => {
    const extensions = { position: "gh:example-org/mindcraft-position@v1.2.0" };
    const ws = projectFileSystemWithMindcraftJson({ name: "My Project", description: "A test project" });
    const manifest = makeManifest({ extensions });

    syncManifestToMindcraftJson(ws, manifest, HOST);

    const entry = ws.exportSnapshot().get(MINDCRAFT_JSON_PATH);
    assert.ok(entry && entry.kind === "file");
    const parsed = parseMindcraftJson(entry.content);
    assert.ok(parsed);
    assert.deepStrictEqual(parsed.extensions, extensions);
  });

  it("removes file extensions the manifest does not have", () => {
    const content = serializeMindcraftJson({
      name: "My Project",
      host: HOST,
      version: "0.0.1",
      description: "A test project",
      extensions: { position: "gh:example-org/mindcraft-position@v1.2.0" },
    });
    const ws = makeProjectFileSystem(
      new Map([[MINDCRAFT_JSON_PATH, { kind: "file", content, etag: "existing", isReadonly: false }]])
    );

    syncManifestToMindcraftJson(ws, makeManifest(), HOST);

    const entry = ws.exportSnapshot().get(MINDCRAFT_JSON_PATH);
    assert.ok(entry && entry.kind === "file");
    const parsed = parseMindcraftJson(entry.content);
    assert.ok(parsed);
    assert.strictEqual(parsed.extensions, undefined);
  });

  it("does not write when extensions already match", () => {
    const extensions = { position: "gh:example-org/mindcraft-position@v1.2.0" };
    const content = serializeMindcraftJson({
      name: "My Project",
      host: HOST,
      version: "0.0.1",
      description: "A test project",
      extensions,
    });
    const ws = makeProjectFileSystem(
      new Map([[MINDCRAFT_JSON_PATH, { kind: "file", content, etag: "existing", isReadonly: false }]])
    );
    const adapter = ws as ProjectFileSystem & { _changes: ProjectFileChange[] };

    syncManifestToMindcraftJson(ws, makeManifest({ extensions }), HOST);

    assert.strictEqual(adapter._changes.length, 0);
  });

  it("preserves non-synced fields (host, version) when updating", () => {
    const ws = projectFileSystemWithMindcraftJson({ name: "Old", description: "desc", version: "2.0.0" });
    const manifest = makeManifest({ name: "New", description: "desc" });

    syncManifestToMindcraftJson(ws, manifest, HOST);

    const entry = ws.exportSnapshot().get(MINDCRAFT_JSON_PATH);
    assert.ok(entry && entry.kind === "file");
    const parsed = parseMindcraftJson(entry.content);
    assert.ok(parsed);
    assert.strictEqual(parsed.version, "2.0.0");
  });
});

describe("diffMindcraftJsonToManifest", () => {
  it("returns undefined when no fields differ", () => {
    const manifest = makeManifest({ name: "Same", description: "same" });
    const content = serializeMindcraftJson({
      name: "Same",
      description: "same",
      host: HOST,
      version: "0.0.1",
    });

    assert.strictEqual(diffMindcraftJsonToManifest(content, manifest), undefined);
  });

  it("returns name patch when name differs", () => {
    const manifest = makeManifest({ name: "Old", description: "desc" });
    const content = serializeMindcraftJson({
      name: "New",
      description: "desc",
      host: HOST,
      version: "0.0.1",
    });

    const patch = diffMindcraftJsonToManifest(content, manifest);
    assert.deepStrictEqual(patch, { name: "New" });
  });

  it("returns description patch when description differs", () => {
    const manifest = makeManifest({ name: "Same", description: "old" });
    const content = serializeMindcraftJson({
      name: "Same",
      description: "new",
      host: HOST,
      version: "0.0.1",
    });

    const patch = diffMindcraftJsonToManifest(content, manifest);
    assert.deepStrictEqual(patch, { description: "new" });
  });

  it("returns patch with both fields when both differ", () => {
    const manifest = makeManifest({ name: "A", description: "X" });
    const content = serializeMindcraftJson({
      name: "B",
      description: "Y",
      host: HOST,
      version: "0.0.1",
    });

    const patch = diffMindcraftJsonToManifest(content, manifest);
    assert.deepStrictEqual(patch, { name: "B", description: "Y" });
  });

  it("returns undefined for invalid JSON", () => {
    const manifest = makeManifest();
    assert.strictEqual(diffMindcraftJsonToManifest("not json", manifest), undefined);
  });

  it("returns undefined for valid JSON with missing fields", () => {
    const manifest = makeManifest();
    assert.strictEqual(diffMindcraftJsonToManifest('{"name": "test"}', manifest), undefined);
  });

  it("returns an extensions patch when the file adds extensions", () => {
    const extensions = { position: "gh:example-org/mindcraft-position@v1.2.0" };
    const manifest = makeManifest();
    const content = serializeMindcraftJson({
      name: manifest.name,
      description: manifest.description,
      host: HOST,
      version: "0.0.1",
      extensions,
    });

    const patch = diffMindcraftJsonToManifest(content, manifest);
    assert.deepStrictEqual(patch, { extensions });
  });

  it("returns an empty extensions patch when the file removes extensions", () => {
    const manifest = makeManifest({ extensions: { position: "gh:example-org/mindcraft-position@v1.2.0" } });
    const content = serializeMindcraftJson({
      name: manifest.name,
      description: manifest.description,
      host: HOST,
      version: "0.0.1",
    });

    const patch = diffMindcraftJsonToManifest(content, manifest);
    assert.deepStrictEqual(patch, { extensions: {} });
  });

  it("returns undefined when extensions match", () => {
    const extensions = { position: "gh:example-org/mindcraft-position@v1.2.0" };
    const manifest = makeManifest({ extensions });
    const content = serializeMindcraftJson({
      name: manifest.name,
      description: manifest.description,
      host: HOST,
      version: "0.0.1",
      extensions: { ...extensions },
    });

    assert.strictEqual(diffMindcraftJsonToManifest(content, manifest), undefined);
  });
});
