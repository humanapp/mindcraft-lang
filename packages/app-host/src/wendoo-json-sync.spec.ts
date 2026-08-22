import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectFileChange, ProjectFileSnapshot, ProjectFileSystem, ProjectManifest } from "@wendoo-lang/app-host";
import {
  DEFAULT_PROJECT_COLLECTION_ID,
  diffWendooJsonToManifest,
  parseProjectContentManifest,
  serializeProjectContentManifest,
  syncManifestToWendooJson,
  WENDOO_JSON_PATH,
} from "@wendoo-lang/app-host";

function makeManifest(overrides?: Partial<ProjectManifest>): ProjectManifest {
  return {
    id: "proj-1",
    projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
    name: "My Project",
    version: "0.1.0",
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

function projectFileSystemWithWendooJson(fields: {
  name: string;
  version?: string;
  description?: string;
  extensions?: Readonly<Record<string, string>>;
}) {
  const content = serializeProjectContentManifest({
    name: fields.name,
    version: fields.version ?? "0.1.0",
    ...(fields.description !== undefined ? { description: fields.description } : {}),
    extensions: fields.extensions ?? {},
  });
  return makeProjectFileSystem(
    new Map([[WENDOO_JSON_PATH, { kind: "file", content, etag: "existing", isReadonly: false }]])
  );
}

function parseWritten(ws: ProjectFileSystem) {
  const entry = ws.exportSnapshot().get(WENDOO_JSON_PATH);
  assert.ok(entry && entry.kind === "file" && typeof entry.content === "string");
  const parsed = parseProjectContentManifest(entry.content);
  assert.ok(parsed.ok);
  return parsed.manifest;
}

describe("syncManifestToWendooJson", () => {
  it("creates wendoo.json with the project content version and no host block", () => {
    const ws = makeProjectFileSystem();

    syncManifestToWendooJson(ws, makeManifest({ version: "1.4.2" }));

    const entry = ws.exportSnapshot().get(WENDOO_JSON_PATH);
    assert.ok(entry && entry.kind === "file" && typeof entry.content === "string");
    assert.strictEqual(entry.content.includes('"host"'), false);
    const manifest = parseWritten(ws);
    assert.strictEqual(manifest.name, "My Project");
    assert.strictEqual(manifest.description, "A test project");
    assert.strictEqual(manifest.version, "1.4.2");
  });

  it("writes the project content version so extension resolution reads it, not the removed schema constant", () => {
    // The sync writer previously stamped a hardcoded "0.0.1" schema version;
    // take-newest (readOwnManifest -> parseProjectContentManifest ->
    // manifest.version) then pinned every host-project-as-extension at "0.0.1".
    // The writer now emits the real content version, and the reader take-newest
    // uses reads it back.
    const ws = makeProjectFileSystem();

    syncManifestToWendooJson(ws, makeManifest({ version: "3.1.4" }));

    const manifest = parseWritten(ws);
    assert.strictEqual(manifest.version, "3.1.4");
    assert.notStrictEqual(manifest.version, "0.0.1");
  });

  it("updates name in existing wendoo.json", () => {
    const ws = projectFileSystemWithWendooJson({ name: "Old Name", description: "desc" });

    syncManifestToWendooJson(ws, makeManifest({ name: "New Name", description: "desc" }));

    const manifest = parseWritten(ws);
    assert.strictEqual(manifest.name, "New Name");
    assert.strictEqual(manifest.description, "desc");
  });

  it("updates description in existing wendoo.json", () => {
    const ws = projectFileSystemWithWendooJson({ name: "Same", description: "old desc" });

    syncManifestToWendooJson(ws, makeManifest({ name: "Same", description: "new desc" }));

    assert.strictEqual(parseWritten(ws).description, "new desc");
  });

  it("rewrites the file when only the content version changes", () => {
    const ws = projectFileSystemWithWendooJson({ name: "Same", description: "same", version: "0.1.0" });

    syncManifestToWendooJson(ws, makeManifest({ name: "Same", description: "same", version: "2.0.0" }));

    assert.strictEqual(parseWritten(ws).version, "2.0.0");
  });

  it("does not write when synced fields and version already match", () => {
    const ws = projectFileSystemWithWendooJson({ name: "Match", description: "same", version: "0.1.0" });
    const adapter = ws as ProjectFileSystem & { _changes: ProjectFileChange[] };

    syncManifestToWendooJson(ws, makeManifest({ name: "Match", description: "same", version: "0.1.0" }));

    assert.strictEqual(adapter._changes.length, 0);
  });

  it("writes manifest extensions when creating wendoo.json", () => {
    const extensions = { "example-org/wendoo-position": "gh:example-org/wendoo-position@v1.2.0" };
    const ws = makeProjectFileSystem();

    syncManifestToWendooJson(ws, makeManifest({ extensions }));

    assert.deepStrictEqual(parseWritten(ws).extensions, extensions);
  });

  it("writes manifest extensions into an existing wendoo.json", () => {
    const extensions = { "example-org/wendoo-position": "gh:example-org/wendoo-position@v1.2.0" };
    const ws = projectFileSystemWithWendooJson({ name: "My Project", description: "A test project" });

    syncManifestToWendooJson(ws, makeManifest({ extensions }));

    assert.deepStrictEqual(parseWritten(ws).extensions, extensions);
  });

  it("removes file extensions the manifest does not have", () => {
    const ws = projectFileSystemWithWendooJson({
      name: "My Project",
      description: "A test project",
      extensions: { "example-org/wendoo-position": "gh:example-org/wendoo-position@v1.2.0" },
    });

    syncManifestToWendooJson(ws, makeManifest());

    assert.deepStrictEqual(parseWritten(ws).extensions, {});
  });

  it("does not write when extensions already match", () => {
    const extensions = { "example-org/wendoo-position": "gh:example-org/wendoo-position@v1.2.0" };
    const ws = projectFileSystemWithWendooJson({ name: "My Project", description: "A test project", extensions });
    const adapter = ws as ProjectFileSystem & { _changes: ProjectFileChange[] };

    syncManifestToWendooJson(ws, makeManifest({ extensions }));

    assert.strictEqual(adapter._changes.length, 0);
  });
});

describe("diffWendooJsonToManifest", () => {
  function fileContent(fields: {
    name: string;
    version?: string;
    description?: string;
    extensions?: Readonly<Record<string, string>>;
  }): string {
    return serializeProjectContentManifest({
      name: fields.name,
      version: fields.version ?? "0.1.0",
      ...(fields.description !== undefined ? { description: fields.description } : {}),
      extensions: fields.extensions ?? {},
    });
  }

  it("returns undefined when no fields differ", () => {
    const manifest = makeManifest({ name: "Same", description: "same" });
    const content = fileContent({ name: "Same", description: "same" });

    assert.strictEqual(diffWendooJsonToManifest(content, manifest), undefined);
  });

  it("returns name patch when name differs", () => {
    const manifest = makeManifest({ name: "Old", description: "desc" });
    const content = fileContent({ name: "New", description: "desc" });

    assert.deepStrictEqual(diffWendooJsonToManifest(content, manifest), { name: "New" });
  });

  it("returns description patch when description differs", () => {
    const manifest = makeManifest({ name: "Same", description: "old" });
    const content = fileContent({ name: "Same", description: "new" });

    assert.deepStrictEqual(diffWendooJsonToManifest(content, manifest), { description: "new" });
  });

  it("returns patch with both fields when both differ", () => {
    const manifest = makeManifest({ name: "A", description: "X" });
    const content = fileContent({ name: "B", description: "Y" });

    assert.deepStrictEqual(diffWendooJsonToManifest(content, manifest), { name: "B", description: "Y" });
  });

  it("returns undefined for invalid JSON", () => {
    assert.strictEqual(diffWendooJsonToManifest("not json", makeManifest()), undefined);
  });

  it("returns a version patch when the file declares a new explicit semver", () => {
    const manifest = makeManifest({ name: "Same", description: "same", version: "1.0.0" });
    const content = fileContent({ name: "Same", description: "same", version: "2.3.4" });

    assert.deepStrictEqual(diffWendooJsonToManifest(content, manifest), { version: "2.3.4" });
  });

  it("does not patch version when the file omits it (no downgrade)", () => {
    const manifest = makeManifest({ name: "Same", description: "same", version: "2.0.0" });
    const content = '{"name":"Same","description":"same"}';

    assert.strictEqual(diffWendooJsonToManifest(content, manifest), undefined);
  });

  it("does not patch version when the file version is not a valid semver (no downgrade)", () => {
    const manifest = makeManifest({ name: "Same", description: "same", version: "2.0.0" });
    const content = '{"name":"Same","description":"same","version":"not-semver"}';

    assert.strictEqual(diffWendooJsonToManifest(content, manifest), undefined);
  });

  it("returns an extensions patch when the file adds extensions", () => {
    const extensions = { "example-org/wendoo-position": "gh:example-org/wendoo-position@v1.2.0" };
    const manifest = makeManifest();
    const content = fileContent({ name: manifest.name, description: manifest.description, extensions });

    assert.deepStrictEqual(diffWendooJsonToManifest(content, manifest), { extensions });
  });

  it("returns an empty extensions patch when the file removes extensions", () => {
    const manifest = makeManifest({
      extensions: { "example-org/wendoo-position": "gh:example-org/wendoo-position@v1.2.0" },
    });
    const content = fileContent({ name: manifest.name, description: manifest.description });

    assert.deepStrictEqual(diffWendooJsonToManifest(content, manifest), { extensions: {} });
  });

  it("returns undefined when extensions match", () => {
    const extensions = { "example-org/wendoo-position": "gh:example-org/wendoo-position@v1.2.0" };
    const manifest = makeManifest({ extensions });
    const content = fileContent({
      name: manifest.name,
      description: manifest.description,
      extensions: { ...extensions },
    });

    assert.strictEqual(diffWendooJsonToManifest(content, manifest), undefined);
  });
});
