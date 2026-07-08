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
  EXAMPLES_FOLDER,
  ImportDiagnosticCode,
  importProjectDocument,
  MINDCRAFT_JSON_PATH,
  PROJECT_TARGETS_APP_DATA_KEY,
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

function makeExportDoc(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    host: { name: "test-app", version: "1.0.0" },
    name: "Test Project",
    description: "desc",
    files: [],
    brains: {},
    ...overrides,
  };
}

function makeSharedProjectDoc(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    format: MINDCRAFT_PROJECT_FORMAT,
    name: "Shared Project",
    description: "shared desc",
    files: [],
    brains: {},
    targets: {},
    ...overrides,
  };
}

function makeFile(doc: Record<string, unknown>, name = "test.mindcraft"): File {
  const json = JSON.stringify(doc);
  return new File([json], name, { type: "application/json" });
}

function hasDiagnosticCode(
  diagnostics: ImportDiagnostic[],
  severity: ImportDiagnostic["severity"],
  code: ImportDiagnosticCode
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === severity && diagnostic.code === code);
}

function countDiagnosticCode(diagnostics: ImportDiagnostic[], code: ImportDiagnosticCode): number {
  return diagnostics.filter((diagnostic) => diagnostic.code === code).length;
}

// -- Tests --------------------------------------------------------------------

describe("buildProjectExportDocument", () => {
  it("exports user files and excludes mindcraft.json", async () => {
    const files = new Map([
      ["src/main.ts", { kind: "file" as const, content: "hello", etag: "e1", isReadonly: false }],
      [MINDCRAFT_JSON_PATH, { kind: "file" as const, content: "{}", etag: "e2", isReadonly: false }],
    ]);
    const ws = makeProjectFileSystem(files);
    const manifest = makeManifest();

    const result = await buildProjectExportDocument(manifest, ws, async () => undefined);

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, "src/main.ts");
    assert.strictEqual(result.files[0].content, "hello");
    assert.strictEqual(result.name, "My Project");
    assert.strictEqual(result.description, "A test project");
    assert.strictEqual("projectCollectionId" in result, false);
  });

  it("serializes without local project collection metadata", async () => {
    const ws = makeProjectFileSystem();
    const manifest = makeManifest({ projectCollectionId: "private-workspace" });

    const result = await buildProjectExportDocument(manifest, ws, async () => undefined);
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

  it("excludes read-only files", async () => {
    const files = new Map([
      ["src/main.ts", { kind: "file" as const, content: "hello", etag: "e1", isReadonly: false }],
      ["lib/std.ts", { kind: "file" as const, content: "stdlib", etag: "e2", isReadonly: true }],
    ]);
    const ws = makeProjectFileSystem(files);

    const result = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, "src/main.ts");
  });

  it("excludes __examples__/ paths", async () => {
    const files = new Map([
      ["src/main.ts", { kind: "file" as const, content: "hello", etag: "e1", isReadonly: false }],
      [`${EXAMPLES_FOLDER}/demo.ts`, { kind: "file" as const, content: "demo", etag: "e2", isReadonly: false }],
    ]);
    const ws = makeProjectFileSystem(files);

    const result = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, "src/main.ts");
  });

  it("excludes directory entries", async () => {
    const files = new Map([
      ["src/main.ts", { kind: "file" as const, content: "hello", etag: "e1", isReadonly: false }],
    ]);
    const dirs = new Map([["src", { kind: "directory" as const }]]);
    const ws = makeProjectFileSystem(files, dirs);

    const result = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, "src/main.ts");
  });

  it("loads and includes brains from app data", async () => {
    const ws = makeProjectFileSystem();
    const brains = { carnivore: { name: "carnivore" }, herbivore: { name: "herbivore" } };

    const result = await buildProjectExportDocument(makeManifest(), ws, async (key) => {
      if (key === "brains") return JSON.stringify(brains);
      return undefined;
    });

    assert.deepStrictEqual(result.brains, brains);
  });

  it("returns empty brains object when no brain data stored", async () => {
    const ws = makeProjectFileSystem();

    const result = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);

    assert.deepStrictEqual(result.brains, {});
  });

  it("returns empty files array when project file system has no user files", async () => {
    const files = new Map([
      [MINDCRAFT_JSON_PATH, { kind: "file" as const, content: "{}", etag: "e1", isReadonly: false }],
    ]);
    const ws = makeProjectFileSystem(files);

    const result = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);

    assert.strictEqual(result.files.length, 0);
  });
});

describe("buildProjectExportDocument", () => {
  it("exports active project as a shared project document with targets", async () => {
    const files = new Map([
      ["src/main.ts", { kind: "file" as const, content: "hello", etag: "e1", isReadonly: false }],
    ]);
    const ws = makeProjectFileSystem(files);
    const manifest = makeManifest();
    const targets = { "@mindcraft-lang/wodal": { profile: "microbit-v2" } };

    const result = await buildProjectExportDocument(manifest, ws, async () => undefined, { targets });

    assert.strictEqual(result.format, MINDCRAFT_PROJECT_FORMAT);
    assert.deepStrictEqual(result.targets, targets);
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual("host" in result, false);
  });

  it("reuses stored target data when explicit targets are not supplied", async () => {
    const ws = makeProjectFileSystem();
    const targets = {
      "test-app": { actors: [] },
      "unknown-target": { preserved: true },
    };

    const result = await buildProjectExportDocument(makeManifest(), ws, async (key) => {
      if (key === PROJECT_TARGETS_APP_DATA_KEY) return JSON.stringify(targets);
      return undefined;
    });

    assert.deepStrictEqual(result.targets, targets);
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

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm, {
      maxFileSize: 10,
    });

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_FILE_TOO_LARGE));
  });

  it("rejects invalid JSON", async () => {
    const file = new File(["not json {{{"], "test.mindcraft");

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_INVALID_JSON));
  });

  it("rejects mismatched host.name", async () => {
    const file = makeFile(makeExportDoc({ host: { name: "other-app", version: "1.0.0" } }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_HOST_MISMATCH));
  });

  it("rejects missing host.name", async () => {
    const file = makeFile(makeExportDoc({ host: {} }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_HOST_MISMATCH));
  });

  it("rejects newer host.version", async () => {
    const file = makeFile(makeExportDoc({ host: { name: "test-app", version: "2.0.0" } }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_NEWER_HOST_VERSION));
  });

  it("accepts same host.version", async () => {
    const file = makeFile(makeExportDoc());

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    assert.ok(result.projectId);
  });

  it("accepts older host.version", async () => {
    const file = makeFile(makeExportDoc({ host: { name: "test-app", version: "0.9.0" } }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    assert.ok(result.projectId);
  });

  it("imports shared project documents into durable project data", async () => {
    const targets = {
      "test-app": { settings: true },
      "unknown-target": { keep: true },
    };
    const brains = { main: { pages: [] } };
    const file = makeFile(
      makeSharedProjectDoc({
        name: "Shared Import",
        files: [{ path: "src/main.ts", content: "hello shared" }],
        brains,
        targets,
      })
    );

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const snapshot = await store.loadProjectFiles(result.projectId!);
    const main = snapshot?.get("src/main.ts");
    assert.ok(main && main.kind === "file");
    assert.strictEqual(main.content, "hello shared");
    assert.deepStrictEqual(JSON.parse((await store.loadAppData(result.projectId!, "brains"))!), brains);
    assert.deepStrictEqual(
      JSON.parse((await store.loadAppData(result.projectId!, PROJECT_TARGETS_APP_DATA_KEY))!),
      targets
    );
  });

  it("maps shared document validation errors from service-api diagnostics", async () => {
    const file = makeFile(makeSharedProjectDoc({ name: 123 }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.severity === "error" && diagnostic.code === MindcraftProjectDocumentValidationCode.INVALID_NAME
      )
    );
    assert.strictEqual((await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).length, 0);
  });

  it("lets app callbacks reject shared target payloads", async () => {
    const file = makeFile(makeSharedProjectDoc({ targets: { "test-app": { unsupported: true } } }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm, {
      targetsCallback: (_targets, appTarget) => {
        assert.deepStrictEqual(appTarget, { unsupported: true });
        return { diagnostics: [{ severity: "error", message: "Unsupported app target." }] };
      },
    });

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_TARGET_TRANSLATION_FAILED));
    assert.strictEqual((await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).length, 0);
  });

  it("passes unknown shared targets to the app callback", async () => {
    const targets = {
      "test-app": { settings: true },
      "unknown-target": { keep: true },
    };
    let receivedTargets: unknown;
    const file = makeFile(makeSharedProjectDoc({ targets }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm, {
      targetsCallback: (allTargets) => {
        receivedTargets = allTargets;
        return { diagnostics: [], appData: { settings: '{"ok":true}' } };
      },
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(receivedTargets, targets);
    assert.strictEqual(await store.loadAppData(result.projectId!, "settings"), '{"ok":true}');
    assert.deepStrictEqual(
      JSON.parse((await store.loadAppData(result.projectId!, PROJECT_TARGETS_APP_DATA_KEY))!),
      targets
    );
  });

  it("rejects missing required fields", async () => {
    const cases: Array<{ field: string; doc: Record<string, unknown>; code: ImportDiagnosticCode }> = [
      { field: "name", doc: makeExportDoc({ name: 123 }), code: ImportDiagnosticCode.IMPORT_INVALID_NAME },
      {
        field: "description",
        doc: makeExportDoc({ description: null }),
        code: ImportDiagnosticCode.IMPORT_INVALID_DESCRIPTION,
      },
      { field: "files", doc: makeExportDoc({ files: "not-array" }), code: ImportDiagnosticCode.IMPORT_INVALID_FILES },
      { field: "brains", doc: makeExportDoc({ brains: null }), code: ImportDiagnosticCode.IMPORT_INVALID_BRAINS },
      { field: "brains (array)", doc: makeExportDoc({ brains: [] }), code: ImportDiagnosticCode.IMPORT_INVALID_BRAINS },
    ];

    for (const { field, doc, code } of cases) {
      const file = makeFile(doc);
      const result = await importProjectDocument(file, "test-app", "1.0.0", pm);
      assert.strictEqual(result.success, false, `Expected failure for ${field}`);
      assert.ok(hasDiagnosticCode(result.diagnostics, "error", code));
    }
  });

  it("substitutes DEFAULT_PROJECT_NAME when name is empty", async () => {
    const file = makeFile(makeExportDoc({ name: "   " }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const project = await store.getProject(result.projectId!);
    assert.strictEqual(project?.name, DEFAULT_PROJECT_NAME);
  });

  it("creates project and writes project files", async () => {
    const doc = makeExportDoc({
      name: "Import Test",
      description: "imported desc",
      files: [
        { path: "src/main.ts", content: "hello world" },
        { path: "src/lib.ts", content: "lib code" },
      ],
    });
    const file = makeFile(doc);

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    assert.ok(result.projectId);

    const snapshot = await store.loadProjectFiles(result.projectId!);
    assert.ok(snapshot);
    const mainEntry = snapshot.get("src/main.ts");
    assert.ok(mainEntry && mainEntry.kind === "file");
    assert.strictEqual(mainEntry.content, "hello world");

    const libEntry = snapshot.get("src/lib.ts");
    assert.ok(libEntry && libEntry.kind === "file");
    assert.strictEqual(libEntry.content, "lib code");

    const project = await store.getProject(result.projectId!);
    assert.strictEqual(project?.name, "Import Test");
    assert.strictEqual(project?.description, "imported desc");
  });

  it("assigns imported projects to the active project collection", async () => {
    const targetCollection = await pm.createProjectCollection("Import Target");
    await pm.switchProjectCollection(targetCollection.projectCollectionId);
    const file = makeFile(makeExportDoc({ projectCollectionId: "file-owned-workspace" }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const project = await store.getProject(result.projectId!);
    assert.strictEqual(project?.projectCollectionId, targetCollection.projectCollectionId);
  });

  it("allows imported projects to use a duplicate name", async () => {
    await store.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Test Project");
    const file = makeFile(makeExportDoc({ name: "Test Project" }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(
      (await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).map((project) => project.name),
      ["Test Project", "Test Project"]
    );
  });

  it("skips invalid file entries with warning diagnostic", async () => {
    const doc = makeExportDoc({
      files: [
        { path: "valid.ts", content: "ok" },
        { path: 123, content: "bad path" },
        { path: "good.ts", content: 456 },
      ],
    });
    const file = makeFile(doc);

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const snapshot = await store.loadProjectFiles(result.projectId!);
    assert.ok(snapshot?.get("valid.ts"));
    assert.strictEqual(countDiagnosticCode(result.diagnostics, ImportDiagnosticCode.IMPORT_INVALID_FILE_ENTRY), 2);
  });

  it("saves brains to app data", async () => {
    const brains = { carnivore: { name: "carnivore" } };
    const doc = makeExportDoc({ brains });
    const file = makeFile(doc);

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const raw = await store.loadAppData(result.projectId!, "brains");
    assert.ok(raw);
    assert.deepStrictEqual(JSON.parse(raw), brains);
  });

  it("normalizes legacy app payloads into shared target data", async () => {
    const app = { actors: [{ archetype: "carnivore" }] };
    const file = makeFile(makeExportDoc({ app }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(JSON.parse((await store.loadAppData(result.projectId!, PROJECT_TARGETS_APP_DATA_KEY))!), {
      "test-app": app,
    });
  });

  it("calls app layer callback when app is present", async () => {
    const appData = { actors: [{ archetype: "carnivore" }] };
    const doc = makeExportDoc({ app: appData });
    const file = makeFile(doc);
    let callbackCalled = false;
    let receivedApp: unknown;
    let receivedVersion: string | undefined;

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm, {
      appLayerCallback: (app, version) => {
        callbackCalled = true;
        receivedApp = app;
        receivedVersion = version;
        return { diagnostics: [{ severity: "warning", message: "app warning" }] };
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(callbackCalled, true);
    assert.deepStrictEqual(receivedApp, appData);
    assert.strictEqual(receivedVersion, "1.0.0");
    assert.strictEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length, 1);
  });

  it("returns error when app is missing but callback is provided", async () => {
    const doc = makeExportDoc();
    delete (doc as Record<string, unknown>).app;
    const file = makeFile(doc);
    let callbackCalled = false;

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm, {
      appLayerCallback: () => {
        callbackCalled = true;
        return { diagnostics: [] };
      },
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(callbackCalled, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_MISSING_APP_DATA));
    assert.strictEqual((await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).length, 0);
  });

  it("aborts import when app layer callback returns error diagnostic", async () => {
    const doc = makeExportDoc({ app: { actors: [] } });
    const file = makeFile(doc);

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm, {
      appLayerCallback: () => ({
        diagnostics: [{ severity: "error", message: "bad app data" }],
      }),
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length, 1);
    assert.strictEqual((await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).length, 0);
  });

  it("merges app layer appData into store alongside brains", async () => {
    const doc = makeExportDoc({
      brains: { carnivore: { name: "c" } },
      app: { actors: [] },
    });
    const file = makeFile(doc);

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm, {
      appLayerCallback: () => ({
        diagnostics: [],
        appData: { actors: '{"carnivore":5}', settings: '{"speed":2}' },
      }),
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(await store.loadAppData(result.projectId!, "actors"), '{"carnivore":5}');
    assert.strictEqual(await store.loadAppData(result.projectId!, "settings"), '{"speed":2}');
    const brainsRaw = await store.loadAppData(result.projectId!, "brains");
    assert.deepStrictEqual(JSON.parse(brainsRaw!), { carnivore: { name: "c" } });
  });

  it("brains key from common layer wins over callback appData.brains", async () => {
    const doc = makeExportDoc({
      brains: { carnivore: { name: "c" } },
      app: { actors: [] },
    });
    const file = makeFile(doc);

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm, {
      appLayerCallback: () => ({
        diagnostics: [],
        appData: { brains: '{"hijack":true}' },
      }),
    });

    assert.strictEqual(result.success, true);
    const brainsRaw = await store.loadAppData(result.projectId!, "brains");
    assert.deepStrictEqual(JSON.parse(brainsRaw!), { carnivore: { name: "c" } });
  });

  it("re-exports a legacy-imported project as a shared project document", async () => {
    const app = { actors: [{ archetype: "carnivore" }] };
    const imported = await importProjectDocument(makeFile(makeExportDoc({ app })), "test-app", "1.0.0", pm);
    assert.strictEqual(imported.success, true);

    await pm.open(imported.projectId!);
    const exported = await buildActiveProjectExportDocument(pm);

    assert.strictEqual(exported.format, MINDCRAFT_PROJECT_FORMAT);
    assert.deepStrictEqual(exported.targets, { "test-app": app });
  });

  it("never throws -- catches unexpected errors and returns error diagnostic", async () => {
    const file = makeFile(makeExportDoc());

    const badPm = {
      createFromSnapshot() {
        throw new Error("boom");
      },
    } as unknown as ProjectManager;

    const result = await importProjectDocument(file, "test-app", "1.0.0", badPm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_UNEXPECTED_ERROR));
  });

  it("validates file paths -- rejects .. and leading /", async () => {
    const doc = makeExportDoc({
      files: [
        { path: "../escape.ts", content: "bad" },
        { path: "/absolute.ts", content: "bad" },
        { path: "src\\backslash.ts", content: "bad" },
        { path: "valid/file.ts", content: "ok" },
      ],
    });
    const file = makeFile(doc);

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const snapshot = await store.loadProjectFiles(result.projectId!);
    assert.ok(snapshot?.get("valid/file.ts"));
    assert.strictEqual(snapshot?.has("../escape.ts"), false);
    assert.strictEqual(snapshot?.has("/absolute.ts"), false);
    assert.strictEqual(snapshot?.has("src\\backslash.ts"), false);
    assert.strictEqual(countDiagnosticCode(result.diagnostics, ImportDiagnosticCode.IMPORT_INVALID_FILE_PATH), 3);
  });

  it("rejects without writing a project when there is no active project collection", async () => {
    await pm.close();
    pm.dispose();
    store = new MemoryProjectStore();
    pm = new ProjectManager(store);

    const result = await importProjectDocument(makeFile(makeExportDoc()), "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_UNEXPECTED_ERROR));
    assert.strictEqual((await store.listProjectCollections()).length, 0);
  });

  it("rejects without writing a project when the active project collection is tombstoned", async () => {
    const collection = await pm.createProjectCollection("Import Tombstone");
    await pm.switchProjectCollection(collection.projectCollectionId);
    await pm.close();
    await store.deleteProjectCollection(collection.projectCollectionId);

    const result = await importProjectDocument(makeFile(makeExportDoc()), "test-app", "1.0.0", pm);

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

    const result = await importProjectDocument(makeFile(makeExportDoc()), "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasDiagnosticCode(result.diagnostics, "error", ImportDiagnosticCode.IMPORT_UNEXPECTED_ERROR));
    assert.deepStrictEqual(await store.listProjects(activeCollectionId), before);
  });
});

describe("project extensions interchange", () => {
  const EXTENSIONS = {
    "example-org/mindcraft-position": "gh:example-org/mindcraft-position@v1.2.0",
    "mindcraft-lang/microbit-stdlib": "embedded:mindcraft-lang/microbit-stdlib",
    "author/scratch": "local:8f14e45f-ceea-4e17-a396-7f34c2d51b3a",
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

    assert.deepStrictEqual(result.extensions, EXTENSIONS);
  });

  it("omits the extensions field when the manifest has none", async () => {
    const ws = makeProjectFileSystem();

    const result = await buildProjectExportDocument(makeManifest(), ws, async () => undefined);

    assert.strictEqual("extensions" in result, false);
  });

  it("omits the extensions field when the manifest's extensions map is empty", async () => {
    const ws = makeProjectFileSystem();

    const result = await buildProjectExportDocument(makeManifest({ extensions: {} }), ws, async () => undefined);

    assert.strictEqual("extensions" in result, false);
  });

  it("imports extensions into the project manifest", async () => {
    const file = makeFile(makeSharedProjectDoc({ extensions: EXTENSIONS }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const manifest = await store.getProject(result.projectId!);
    assert.ok(manifest);
    assert.deepStrictEqual(manifest.extensions, EXTENSIONS);
  });

  it("projects imported extensions into mindcraft.json when the project is opened and synced", async () => {
    const file = makeFile(makeSharedProjectDoc({ extensions: EXTENSIONS }));
    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);
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
    const file = makeFile(makeSharedProjectDoc());

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const manifest = await store.getProject(result.projectId!);
    assert.strictEqual(manifest?.extensions, undefined);
  });

  it("round-trips extensions through import and export", async () => {
    const original = makeSharedProjectDoc({ extensions: EXTENSIONS });
    const imported = await importProjectDocument(makeFile(original), "test-app", "1.0.0", pm);
    assert.strictEqual(imported.success, true);

    await pm.open(imported.projectId!);
    const exported = await buildActiveProjectExportDocument(pm);

    assert.deepStrictEqual(exported.extensions, EXTENSIONS);
  });

  it("round-trips a document without extensions byte-stably", async () => {
    const original = makeSharedProjectDoc({
      files: [{ path: "src/main.ts", content: "hello" }],
      brains: { main: { pages: [] } },
      targets: { "test-app": { settings: true } },
    });
    const imported = await importProjectDocument(makeFile(original), "test-app", "1.0.0", pm);
    assert.strictEqual(imported.success, true);

    await pm.open(imported.projectId!);
    const exported = await buildActiveProjectExportDocument(pm);

    assert.strictEqual(JSON.stringify(exported), JSON.stringify(original));
  });

  it("rejects structurally invalid extensions with the document validation code", async () => {
    const file = makeFile(makeSharedProjectDoc({ extensions: 5 }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.severity === "error" &&
          diagnostic.code === MindcraftProjectDocumentValidationCode.INVALID_EXTENSIONS
      )
    );
  });

  it("rejects non-string extension references with the document validation code", async () => {
    const file = makeFile(makeSharedProjectDoc({ extensions: { "org/position": 42 } }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.severity === "error" &&
          diagnostic.code === MindcraftProjectDocumentValidationCode.INVALID_EXTENSION_REFERENCE
      )
    );
  });

  it("rejects malformed extension references with the content manifest code", async () => {
    const file = makeFile(makeSharedProjectDoc({ extensions: { "org/position": "not-a-ref" } }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.severity === "error" &&
          diagnostic.code === ProjectContentManifestErrorCode.INVALID_EXTENSION_REFERENCE
      )
    );
    assert.strictEqual((await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).length, 0);
  });

  it("rejects invalid extension coordinates with the content manifest code", async () => {
    const file = makeFile(makeSharedProjectDoc({ extensions: { "bad-coordinate": "embedded:org/fine" } }));

    const result = await importProjectDocument(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.severity === "error" &&
          diagnostic.code === ProjectContentManifestErrorCode.INVALID_EXTENSION_COORDINATE
      )
    );
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
