import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
  ImportDiagnostic,
  ProjectFileChange,
  ProjectFileSnapshot,
  ProjectFileSystem,
  ProjectManifest,
} from "@mindcraft-lang/app-host";
import {
  AppHostErrorCode,
  buildActiveProjectExportDocument,
  buildProjectExportDocument,
  createProjectCollectionPinVerifier,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_PROJECT_COLLECTION_ID,
  DEFAULT_PROJECT_NAME,
  ImportDiagnosticCode,
  importProjectDocument,
  MINDCRAFT_JSON_PATH,
  ProjectContentManifestErrorCode,
  ProjectManager,
  parseProjectContentManifest,
  syncManifestToMindcraftJson,
} from "@mindcraft-lang/app-host";
import { MINDCRAFT_PROJECT_FORMAT, MindcraftProjectDocumentValidationCode } from "@mindcraft-lang/service-api";
import { assertRejectsWithCode } from "./test-support/error-assertions.js";
import { MemoryProjectStore } from "./test-support/memory-project-store.js";

// -- Helpers ------------------------------------------------------------------

function makeProjectFileSystem(
  files?: Map<string, { kind: "file"; content: string; etag: string; isReadonly: boolean }>,
  dirs?: Map<string, { kind: "directory" }>
): ProjectFileSystem {
  const snapshot: ProjectFileSnapshot = new Map();
  for (const [k, v] of files ?? []) snapshot.set(k, v);
  for (const [k, v] of dirs ?? []) snapshot.set(k, v);

  return {
    exportSnapshot() {
      return new Map(snapshot);
    },
    applyRemoteChange(change: ProjectFileChange) {
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
  };
}

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

/** A well-formed v2 document with overridable manifest fields and contents. */
function makeDocument(
  manifestOverrides?: Record<string, unknown>,
  contents?: Record<string, string>
): Record<string, unknown> {
  return {
    format: MINDCRAFT_PROJECT_FORMAT,
    manifest: {
      name: "Shared Project",
      version: "0.1.0",
      description: "shared desc",
      ...manifestOverrides,
    },
    contents: contents ?? {},
  };
}

function makeFile(doc: Record<string, unknown>, name = "test.mindcraft"): File {
  const json = JSON.stringify(doc);
  return new File([json], name, { type: "application/json" });
}

function hasDiagnosticCode(
  diagnostics: ImportDiagnostic[],
  severity: ImportDiagnostic["severity"],
  code: ImportDiagnostic["code"]
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === severity && diagnostic.code === code);
}

// -- Tests --------------------------------------------------------------------

describe("buildProjectExportDocument", () => {
  it("exports user file contents and excludes mindcraft.json", async () => {
    const files = new Map([
      ["src/main.ts", { kind: "file" as const, content: "hello", etag: "e1", isReadonly: false }],
      [MINDCRAFT_JSON_PATH, { kind: "file" as const, content: "{}", etag: "e2", isReadonly: false }],
    ]);
    const ws = makeProjectFileSystem(files);

    const result = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);

    assert.strictEqual(result.format, MINDCRAFT_PROJECT_FORMAT);
    assert.deepStrictEqual(result.contents, { "src/main.ts": "hello" });
    assert.strictEqual(result.manifest.name, "My Project");
    assert.strictEqual(result.manifest.description, "A test project");
  });

  it("excludes read-only files and directory entries", async () => {
    const files = new Map([
      ["src/main.ts", { kind: "file" as const, content: "hello", etag: "e1", isReadonly: false }],
      ["lib/std.ts", { kind: "file" as const, content: "stdlib", etag: "e2", isReadonly: true }],
    ]);
    const dirs = new Map([["src", { kind: "directory" as const }]]);
    const ws = makeProjectFileSystem(files, dirs);

    const result = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);

    assert.deepStrictEqual(Object.keys(result.contents), ["src/main.ts"]);
  });

  it("embeds brains from app data in the manifest", async () => {
    const ws = makeProjectFileSystem();
    const brains = { carnivore: { name: "carnivore" }, herbivore: { name: "herbivore" } };

    const result = await buildProjectExportDocument(makeManifest(), ws, async (key) => {
      if (key === "brains") return JSON.stringify(brains);
      return undefined;
    });

    assert.deepStrictEqual(result.manifest.brains, brains);
  });

  it("omits the brains chunk when no brain data is stored", async () => {
    const ws = makeProjectFileSystem();

    const result = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);

    assert.strictEqual("brains" in result.manifest, false);
  });

  it("embeds the exporting app's chunk and preserves stored chunks of other apps", async () => {
    const ws = makeProjectFileSystem();
    const stored = {
      "test-app": { stale: true },
      "other-app": { preserved: true },
    };

    const result = await buildProjectExportDocument(
      makeManifest(),
      ws,
      async (key) => {
        if (key === "app") return JSON.stringify(stored);
        return undefined;
      },
      { appChunk: { name: "test-app", chunk: { fresh: true } } }
    );

    assert.deepStrictEqual(result.manifest.app, {
      "test-app": { fresh: true },
      "other-app": { preserved: true },
    });
  });

  it("omits the app chunk map when there is none", async () => {
    const ws = makeProjectFileSystem();

    const result = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);

    assert.strictEqual("app" in result.manifest, false);
  });

  it("exports exactly the document keys and none of the local-only store fields", async () => {
    const ws = makeProjectFileSystem();

    const result = await buildProjectExportDocument(
      makeManifest({ version: "1.4.2", projectCollectionId: "private-workspace" }),
      ws,
      async () => undefined
    );

    assert.deepStrictEqual(Object.keys(result), ["format", "manifest", "contents"]);
    assert.deepStrictEqual(Object.keys(result.manifest), ["name", "version", "description"]);
    const serialized = JSON.stringify(result);
    assert.strictEqual(serialized.includes("projectCollectionId"), false);
    assert.strictEqual(serialized.includes("private-workspace"), false);
  });

  it("rejects active project export when the active project collection is locked", async () => {
    const store = new MemoryProjectStore();
    const pm = new ProjectManager(store);
    const active = await pm.create("Protected Export");
    await store.updateProjectCollection(active.projectCollectionId, {
      pinVerifier: await createProjectCollectionPinVerifier("1234"),
    });

    await assertRejectsWithCode(() => buildActiveProjectExportDocument(pm), AppHostErrorCode.PROJECT_COLLECTION_LOCKED);
    await pm.close();
    pm.dispose();
  });
});

describe("project content version interchange", () => {
  let store: MemoryProjectStore;
  let pm: ProjectManager;

  beforeEach(async () => {
    store = new MemoryProjectStore();
    pm = new ProjectManager(store);
    await pm.init();
  });

  afterEach(async () => {
    await pm.close();
  });

  it("exports the manifest content version", async () => {
    const ws = makeProjectFileSystem();

    const result = await buildProjectExportDocument(makeManifest({ version: "1.4.2" }), ws, async () => undefined);

    assert.strictEqual(result.manifest.version, "1.4.2");
  });

  it("round-trips the content version from export through import into the store", async () => {
    const ws = makeProjectFileSystem();
    const document = await buildProjectExportDocument(makeManifest({ version: "3.5.7" }), ws, async () => undefined);

    const result = await importProjectDocument(
      makeFile(document as unknown as Record<string, unknown>),
      "test-app",
      pm
    );

    assert.strictEqual(result.success, true);
    const imported = await store.getProject(result.projectId!);
    assert.strictEqual(imported?.version, "3.5.7");
  });

  it("imports a document without a manifest version as the lowest content version", async () => {
    const doc = makeDocument();
    delete (doc.manifest as Record<string, unknown>).version;

    const result = await importProjectDocument(makeFile(doc), "test-app", pm);

    assert.strictEqual(result.success, true);
    const imported = await store.getProject(result.projectId!);
    assert.strictEqual(imported?.version, "0.0.0");
  });
});

describe("importProjectDocument", () => {
  let store: MemoryProjectStore;
  let pm: ProjectManager;

  beforeEach(async () => {
    store = new MemoryProjectStore();
    pm = new ProjectManager(store);
    await pm.init();
  });

  afterEach(async () => {
    await pm.close();
  });

  it("rejects files over size limit", async () => {
    const content = "x".repeat(100);
    const file = new File([content], "test.mindcraft");

    const result = await importProjectDocument(file, "test-app", pm, { maxFileSize: 10 });

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_FILE_TOO_LARGE));
  });

  it("rejects invalid JSON with the document validation code", async () => {
    const file = new File(["not json {{{"], "test.mindcraft");

    const result = await importProjectDocument(file, "test-app", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", MindcraftProjectDocumentValidationCode.INVALID_JSON));
  });

  it("rejects a document in the retired doc-level shape", async () => {
    const legacy = {
      format: "mindcraft.project",
      name: "Old Project",
      description: "",
      files: [{ path: "src/main.ts", content: "hello" }],
      brains: {},
      targets: {},
    };

    const result = await importProjectDocument(makeFile(legacy), "test-app", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", MindcraftProjectDocumentValidationCode.INVALID_FORMAT));
    assert.strictEqual((await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).length, 0);
  });

  it("rejects an invalid embedded manifest with the content manifest code", async () => {
    const result = await importProjectDocument(makeFile(makeDocument({ name: 123 })), "test-app", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ProjectContentManifestErrorCode.INVALID_NAME));
    assert.strictEqual((await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).length, 0);
  });

  it("rejects escaping and absolute content paths without writing a project", async () => {
    for (const path of ["../escape.ts", "/absolute.ts", "src\\backslash.ts"]) {
      const result = await importProjectDocument(makeFile(makeDocument({}, { [path]: "bad" })), "test-app", pm);
      assert.strictEqual(result.success, false, `Expected failure for ${path}`);
      assert.ok(
        hasDiagnosticCode(result.diagnostics, "error", MindcraftProjectDocumentValidationCode.INVALID_FILE_PATH)
      );
    }
    assert.strictEqual((await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).length, 0);
  });

  it("creates the project and writes its files from the contents map", async () => {
    const doc = makeDocument(
      { name: "Import Test", description: "imported desc" },
      { "src/main.ts": "hello world", "src/lib.ts": "lib code" }
    );

    const result = await importProjectDocument(makeFile(doc), "test-app", pm);

    assert.strictEqual(result.success, true);
    assert.ok(result.projectId);

    const snapshot = await store.loadProjectFiles(result.projectId!);
    const mainEntry = snapshot?.get("src/main.ts");
    assert.ok(mainEntry && mainEntry.kind === "file");
    assert.strictEqual(mainEntry.content, "hello world");
    const libEntry = snapshot?.get("src/lib.ts");
    assert.ok(libEntry && libEntry.kind === "file");
    assert.strictEqual(libEntry.content, "lib code");

    const project = await store.getProject(result.projectId!);
    assert.strictEqual(project?.name, "Import Test");
    assert.strictEqual(project?.description, "imported desc");
  });

  it("skips a mindcraft.json entry carried in the contents map", async () => {
    const doc = makeDocument({}, { [MINDCRAFT_JSON_PATH]: "{}", "src/main.ts": "hello" });

    const result = await importProjectDocument(makeFile(doc), "test-app", pm);

    assert.strictEqual(result.success, true);
    const snapshot = await store.loadProjectFiles(result.projectId!);
    assert.strictEqual(snapshot?.has(MINDCRAFT_JSON_PATH), false);
    assert.ok(snapshot?.get("src/main.ts"));
  });

  it("seeds the manifest's brains chunk into app data", async () => {
    const brains = { carnivore: { name: "carnivore" } };

    const result = await importProjectDocument(makeFile(makeDocument({ brains })), "test-app", pm);

    assert.strictEqual(result.success, true);
    const raw = await store.loadAppData(result.projectId!, "brains");
    assert.ok(raw);
    assert.deepStrictEqual(JSON.parse(raw), brains);
  });

  it("rejects a non-object brains chunk", async () => {
    const result = await importProjectDocument(makeFile(makeDocument({ brains: [] })), "test-app", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_INVALID_BRAINS));
  });

  it("stores the whole app chunk map, preserving chunks of unknown apps", async () => {
    const app = {
      "test-app": { settings: true },
      "unknown-app": { keep: true },
    };

    const result = await importProjectDocument(makeFile(makeDocument({ app })), "test-app", pm);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(JSON.parse((await store.loadAppData(result.projectId!, "app"))!), app);
  });

  it("rejects a non-object app chunk map", async () => {
    const result = await importProjectDocument(makeFile(makeDocument({ app: "chunk" })), "test-app", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_INVALID_APP_CHUNKS));
  });

  it("passes the importing app's chunk to the callback and merges its app data", async () => {
    const app = { "test-app": { actors: [{ archetype: "carnivore" }] } };
    let receivedChunk: unknown;

    const result = await importProjectDocument(makeFile(makeDocument({ app })), "test-app", pm, {
      appChunkCallback: (appChunk) => {
        receivedChunk = appChunk;
        return {
          diagnostics: [{ severity: "warning", message: "app warning" }],
          appData: { actors: '{"carnivore":5}' },
        };
      },
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(receivedChunk, app["test-app"]);
    assert.strictEqual(await store.loadAppData(result.projectId!, "actors"), '{"carnivore":5}');
    assert.strictEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length, 1);
  });

  it("invokes the callback with undefined when the document carries no chunk for the app", async () => {
    let receivedChunk: unknown = "unset";

    const result = await importProjectDocument(makeFile(makeDocument()), "test-app", pm, {
      appChunkCallback: (appChunk) => {
        receivedChunk = appChunk;
        return { diagnostics: [] };
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(receivedChunk, undefined);
  });

  it("lets the app callback reject its chunk, defaulting the translation code", async () => {
    const result = await importProjectDocument(
      makeFile(makeDocument({ app: { "test-app": { unsupported: true } } })),
      "test-app",
      pm,
      {
        appChunkCallback: () => ({ diagnostics: [{ severity: "error", message: "Unsupported app chunk." }] }),
      }
    );

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_APP_TRANSLATION_FAILED));
    assert.strictEqual((await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).length, 0);
  });

  it("brains chunk from the manifest wins over callback appData.brains", async () => {
    const doc = makeDocument({
      brains: { carnivore: { name: "c" } },
      app: { "test-app": { actors: [] } },
    });

    const result = await importProjectDocument(makeFile(doc), "test-app", pm, {
      appChunkCallback: () => ({ diagnostics: [], appData: { brains: '{"hijack":true}' } }),
    });

    assert.strictEqual(result.success, true);
    const brainsRaw = await store.loadAppData(result.projectId!, "brains");
    assert.deepStrictEqual(JSON.parse(brainsRaw!), { carnivore: { name: "c" } });
  });

  it("substitutes DEFAULT_PROJECT_NAME when the manifest name is blank", async () => {
    const result = await importProjectDocument(makeFile(makeDocument({ name: "   " })), "test-app", pm);

    assert.strictEqual(result.success, true);
    const project = await store.getProject(result.projectId!);
    assert.strictEqual(project?.name, DEFAULT_PROJECT_NAME);
  });

  it("assigns imported projects to the active project collection", async () => {
    const targetCollection = await pm.createProjectCollection("Import Target");
    await pm.switchProjectCollection(targetCollection.projectCollectionId);

    const result = await importProjectDocument(makeFile(makeDocument()), "test-app", pm);

    assert.strictEqual(result.success, true);
    const project = await store.getProject(result.projectId!);
    assert.strictEqual(project?.projectCollectionId, targetCollection.projectCollectionId);
  });

  it("allows imported projects to use a duplicate name", async () => {
    await store.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Shared Project");

    const result = await importProjectDocument(makeFile(makeDocument()), "test-app", pm);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(
      (await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).map((project) => project.name),
      ["Shared Project", "Shared Project"]
    );
  });

  it("never throws -- catches unexpected errors and returns error diagnostic", async () => {
    const badPm = {
      createFromSnapshot() {
        throw new Error("boom");
      },
    } as unknown as ProjectManager;

    const result = await importProjectDocument(makeFile(makeDocument()), "test-app", badPm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_UNEXPECTED_ERROR));
  });

  it("rejects without writing a project when there is no active project collection", async () => {
    await pm.close();
    pm.dispose();
    store = new MemoryProjectStore();
    pm = new ProjectManager(store);

    const result = await importProjectDocument(makeFile(makeDocument()), "test-app", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_UNEXPECTED_ERROR));
    assert.strictEqual((await store.listProjectCollections()).length, 0);
  });

  it("rejects without writing a project when the active project collection is tombstoned", async () => {
    const collection = await pm.createProjectCollection("Import Tombstone");
    await pm.switchProjectCollection(collection.projectCollectionId);
    await pm.close();
    await store.deleteProjectCollection(collection.projectCollectionId);

    const result = await importProjectDocument(makeFile(makeDocument()), "test-app", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_UNEXPECTED_ERROR));
    assert.deepStrictEqual(await store.listProjects(collection.projectCollectionId), []);
  });

  it("rejects without writing a project when the active project collection is locked", async () => {
    const activeCollectionId = pm.activeProjectCollection!.projectCollectionId;
    await store.updateProjectCollection(activeCollectionId, {
      pinVerifier: await createProjectCollectionPinVerifier("1234"),
    });
    const before = await store.listProjects(activeCollectionId);

    const result = await importProjectDocument(makeFile(makeDocument()), "test-app", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_UNEXPECTED_ERROR));
    assert.deepStrictEqual(await store.listProjects(activeCollectionId), before);
  });
});

describe("project round-trips through import and export", () => {
  let store: MemoryProjectStore;
  let pm: ProjectManager;

  beforeEach(async () => {
    store = new MemoryProjectStore();
    pm = new ProjectManager(store);
    await pm.init();
  });

  afterEach(async () => {
    await pm.close();
  });

  it("re-exports an imported project byte-stably, extras chunks included", async () => {
    const original = {
      format: MINDCRAFT_PROJECT_FORMAT,
      manifest: {
        name: "Shared Project",
        version: "1.0.0",
        description: "shared desc",
        extensions: { "example-org/mindcraft-position": "gh:example-org/mindcraft-position@v1.2.0" },
        targets: { "example-org/trg-platform": { packageVersion: "^1.0.0" } },
        brains: { main: { pages: [] } },
        app: { "other-app": { settings: true } },
      },
      contents: { "src/main.ts": "hello" },
    };
    const imported = await importProjectDocument(makeFile(original), "test-app", pm);
    assert.strictEqual(imported.success, true);

    await pm.open(imported.projectId!);
    const exported = await buildActiveProjectExportDocument(pm);

    assert.strictEqual(JSON.stringify(exported), JSON.stringify(original));
  });

  it("re-exports with the importing app's fresh chunk replacing its stored one", async () => {
    const original = makeDocument({
      app: { "test-app": { stale: true }, "other-app": { keep: true } },
    });
    const imported = await importProjectDocument(makeFile(original), "test-app", pm);
    assert.strictEqual(imported.success, true);

    await pm.open(imported.projectId!);
    const exported = await buildActiveProjectExportDocument(pm, {
      appChunk: { name: "test-app", chunk: { fresh: true } },
    });

    assert.deepStrictEqual(exported.manifest.app, {
      "test-app": { fresh: true },
      "other-app": { keep: true },
    });
  });
});

describe("project extensions interchange", () => {
  const EXTENSIONS = {
    "example-org/mindcraft-position": "gh:example-org/mindcraft-position@v1.2.0",
    "example-org/steering": "gh:example-org/steering#main",
    "mindcraft-lang/microbit-stdlib": "embedded:mindcraft-lang/microbit-stdlib",
  };

  let store: MemoryProjectStore;
  let pm: ProjectManager;

  beforeEach(async () => {
    store = new MemoryProjectStore();
    pm = new ProjectManager(store);
    await pm.init();
  });

  afterEach(async () => {
    await pm.close();
  });

  it("exports extensions from the project manifest", async () => {
    const ws = makeProjectFileSystem();

    const result = await buildProjectExportDocument(
      makeManifest({ extensions: EXTENSIONS }),
      ws,
      async () => undefined
    );

    assert.deepStrictEqual(result.manifest.extensions, EXTENSIONS);
  });

  it("omits the extensions field when the manifest has none or an empty map", async () => {
    const ws = makeProjectFileSystem();

    const absent = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);
    assert.strictEqual("extensions" in absent.manifest, false);

    const empty = await buildProjectExportDocument(makeManifest({ extensions: {} }), ws, async () => undefined);
    assert.strictEqual("extensions" in empty.manifest, false);
  });

  it("imports extensions into the project manifest", async () => {
    const result = await importProjectDocument(makeFile(makeDocument({ extensions: EXTENSIONS })), "test-app", pm);

    assert.strictEqual(result.success, true);
    const manifest = await store.getProject(result.projectId!);
    assert.ok(manifest);
    assert.deepStrictEqual(manifest.extensions, EXTENSIONS);
  });

  it("projects imported extensions into mindcraft.json when the project is opened and synced", async () => {
    const result = await importProjectDocument(makeFile(makeDocument({ extensions: EXTENSIONS })), "test-app", pm);
    assert.strictEqual(result.success, true);

    const active = await pm.open(result.projectId!);
    syncManifestToMindcraftJson(active.filesystem, active.manifest);

    const entry = active.filesystem.exportSnapshot().get(MINDCRAFT_JSON_PATH);
    assert.ok(entry && entry.kind === "file");
    const parsed = parseProjectContentManifest(entry.content);
    assert.ok(parsed.ok);
    assert.deepStrictEqual(parsed.manifest.extensions, EXTENSIONS);
  });

  it("leaves the manifest without extensions when the document has none", async () => {
    const result = await importProjectDocument(makeFile(makeDocument()), "test-app", pm);

    assert.strictEqual(result.success, true);
    const manifest = await store.getProject(result.projectId!);
    assert.strictEqual(manifest?.extensions, undefined);
  });

  it("round-trips extensions through import and export", async () => {
    const imported = await importProjectDocument(makeFile(makeDocument({ extensions: EXTENSIONS })), "test-app", pm);
    assert.strictEqual(imported.success, true);

    await pm.open(imported.projectId!);
    const exported = await buildActiveProjectExportDocument(pm);

    assert.deepStrictEqual(exported.manifest.extensions, EXTENSIONS);
  });

  it("rejects structurally invalid extensions with the content manifest code", async () => {
    const result = await importProjectDocument(makeFile(makeDocument({ extensions: 5 })), "test-app", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ProjectContentManifestErrorCode.INVALID_EXTENSIONS));
  });

  it("rejects malformed extension references with the content manifest code", async () => {
    const result = await importProjectDocument(
      makeFile(makeDocument({ extensions: { "org/position": "not-a-ref" } })),
      "test-app",
      pm
    );

    assert.strictEqual(result.success, false);
    assert.ok(
      hasDiagnosticCode(result.diagnostics, "error", ProjectContentManifestErrorCode.INVALID_EXTENSION_REFERENCE)
    );
    assert.strictEqual((await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).length, 0);
  });

  it("rejects invalid extension coordinates with the content manifest code", async () => {
    const result = await importProjectDocument(
      makeFile(makeDocument({ extensions: { "bad-coordinate": "embedded:org/fine" } })),
      "test-app",
      pm
    );

    assert.strictEqual(result.success, false);
    assert.ok(
      hasDiagnosticCode(result.diagnostics, "error", ProjectContentManifestErrorCode.INVALID_EXTENSION_COORDINATE)
    );
  });
});

describe("project targets interchange", () => {
  const TARGETS = {
    "mindcraft-lang/trg-microbit-v2": { packageVersion: "^0.8.0" },
    "mindcraft-lang/lib-missing-platform": { packageVersion: "^1.0.0" },
  };

  let store: MemoryProjectStore;
  let pm: ProjectManager;

  beforeEach(async () => {
    store = new MemoryProjectStore();
    pm = new ProjectManager(store);
    await pm.init();
  });

  afterEach(async () => {
    await pm.close();
  });

  it("exports targets from the project manifest", async () => {
    const ws = makeProjectFileSystem();

    const result = await buildProjectExportDocument(makeManifest({ targets: TARGETS }), ws, async () => undefined);

    assert.deepStrictEqual(result.manifest.targets, TARGETS);
  });

  it("omits the targets field when the manifest has none or an empty map", async () => {
    const ws = makeProjectFileSystem();

    const absent = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);
    assert.strictEqual("targets" in absent.manifest, false);

    const empty = await buildProjectExportDocument(makeManifest({ targets: {} }), ws, async () => undefined);
    assert.strictEqual("targets" in empty.manifest, false);
  });

  it("imports targets into the project manifest", async () => {
    const result = await importProjectDocument(makeFile(makeDocument({ targets: TARGETS })), "test-app", pm);

    assert.strictEqual(result.success, true);
    const manifest = await store.getProject(result.projectId!);
    assert.ok(manifest);
    assert.deepStrictEqual(manifest.targets, TARGETS);
  });

  it("leaves the manifest without targets when the document has none", async () => {
    const result = await importProjectDocument(makeFile(makeDocument()), "test-app", pm);

    assert.strictEqual(result.success, true);
    const manifest = await store.getProject(result.projectId!);
    assert.strictEqual(manifest?.targets, undefined);
  });

  it("projects imported targets into mindcraft.json when the project is opened and synced", async () => {
    const result = await importProjectDocument(makeFile(makeDocument({ targets: TARGETS })), "test-app", pm);
    assert.strictEqual(result.success, true);

    const active = await pm.open(result.projectId!);
    syncManifestToMindcraftJson(active.filesystem, active.manifest);

    const entry = active.filesystem.exportSnapshot().get(MINDCRAFT_JSON_PATH);
    assert.ok(entry && entry.kind === "file");
    const parsed = parseProjectContentManifest(entry.content);
    assert.ok(parsed.ok);
    assert.deepStrictEqual(parsed.manifest.targets, TARGETS);
  });

  it("round-trips targets through import and export", async () => {
    const imported = await importProjectDocument(makeFile(makeDocument({ targets: TARGETS })), "test-app", pm);
    assert.strictEqual(imported.success, true);

    await pm.open(imported.projectId!);
    const exported = await buildActiveProjectExportDocument(pm);

    assert.deepStrictEqual(exported.manifest.targets, TARGETS);
  });

  it("round-trips a project without targets with the field absent", async () => {
    const imported = await importProjectDocument(makeFile(makeDocument()), "test-app", pm);
    assert.strictEqual(imported.success, true);

    await pm.open(imported.projectId!);
    const exported = await buildActiveProjectExportDocument(pm);

    assert.strictEqual("targets" in exported.manifest, false);
  });

  it("rejects structurally invalid targets with the content manifest code", async () => {
    const result = await importProjectDocument(makeFile(makeDocument({ targets: 5 })), "test-app", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ProjectContentManifestErrorCode.INVALID_TARGETS));
    assert.strictEqual((await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).length, 0);
  });
});

describe("ProjectManager.createFromSnapshot", () => {
  it("writes manifest, description, project files, and app data without opening", async () => {
    const store = new MemoryProjectStore();
    const pm = new ProjectManager(store);
    await pm.init();

    const snapshot: ProjectFileSnapshot = new Map([
      ["src/main.ts", { kind: "file", content: "hello", etag: "e1", isReadonly: false }],
    ]);

    const manifest = await pm.createFromSnapshot("Snap Project", "snap desc", snapshot, {
      brains: '{"a":1}',
      actors: '{"b":2}',
    });

    assert.strictEqual(manifest.name, "Snap Project");
    assert.strictEqual(pm.activeProject, undefined);

    const stored = await store.getProject(manifest.id);
    assert.strictEqual(stored?.description, "snap desc");

    const ws = await store.loadProjectFiles(manifest.id);
    const file = ws?.get("src/main.ts");
    assert.ok(file && file.kind === "file");
    assert.strictEqual(file.content, "hello");

    assert.strictEqual(await store.loadAppData(manifest.id, "brains"), '{"a":1}');
    assert.strictEqual(await store.loadAppData(manifest.id, "actors"), '{"b":2}');
  });

  it("persists a targets map into the created manifest and leaves it absent when omitted", async () => {
    const store = new MemoryProjectStore();
    const pm = new ProjectManager(store);
    await pm.init();
    const targets = { "mindcraft-lang/trg-microbit-v2": { packageVersion: "^0.8.0" } };
    const snapshot: ProjectFileSnapshot = new Map();

    const withTargets = await pm.createFromSnapshot(
      "Targeted",
      "",
      snapshot,
      undefined,
      undefined,
      undefined,
      "0.1.0",
      targets
    );
    assert.deepStrictEqual((await store.getProject(withTargets.id))?.targets, targets);

    const withoutTargets = await pm.createFromSnapshot("Untargeted", "", new Map());
    assert.strictEqual((await store.getProject(withoutTargets.id))?.targets, undefined);
  });

  it("rejects without writing a project when there is no active project collection", async () => {
    const store = new MemoryProjectStore();
    const pm = new ProjectManager(store);
    const snapshot: ProjectFileSnapshot = new Map([
      ["src/main.ts", { kind: "file", content: "hello", etag: "e1", isReadonly: false }],
    ]);

    await assertRejectsWithCode(
      () => pm.createFromSnapshot("No Collection", "", snapshot),
      AppHostErrorCode.NO_ACTIVE_PROJECT_COLLECTION
    );
    assert.deepStrictEqual(await store.listProjectCollections(), []);
  });

  it("rejects without writing a project when the active project collection is tombstoned", async () => {
    const store = new MemoryProjectStore();
    const pm = new ProjectManager(store);
    await pm.init();
    const collection = await pm.createProjectCollection("Transient");
    await pm.switchProjectCollection(collection.projectCollectionId);
    await store.deleteProjectCollection(collection.projectCollectionId);
    const snapshot: ProjectFileSnapshot = new Map([
      ["src/main.ts", { kind: "file", content: "hello", etag: "e1", isReadonly: false }],
    ]);

    await assertRejectsWithCode(
      () => pm.createFromSnapshot("No Collection", "", snapshot),
      AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
    );
    assert.deepStrictEqual(await store.listProjects(collection.projectCollectionId), []);
  });

  it("rejects without writing a project when the active project collection is locked", async () => {
    const store = new MemoryProjectStore();
    const pm = new ProjectManager(store);
    await pm.init();
    const collection = pm.activeProjectCollection!;
    await store.updateProjectCollection(collection.projectCollectionId, {
      pinVerifier: await createProjectCollectionPinVerifier("1234"),
    });
    const snapshot: ProjectFileSnapshot = new Map([
      ["src/main.ts", { kind: "file", content: "hello", etag: "e1", isReadonly: false }],
    ]);

    await assertRejectsWithCode(
      () => pm.createFromSnapshot("Locked", "", snapshot),
      AppHostErrorCode.PROJECT_COLLECTION_LOCKED
    );
    assert.deepStrictEqual(await store.listProjects(collection.projectCollectionId), []);
  });
});
