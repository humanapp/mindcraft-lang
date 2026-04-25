import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
  ImportDiagnostic,
  ProjectManifest,
  ProjectStore,
  WorkspaceAdapter,
  WorkspaceChange,
  WorkspaceSnapshot,
} from "@mindcraft-lang/app-host";
import {
  buildExportCommon,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_PROJECT_NAME,
  EXAMPLES_FOLDER,
  importProject,
  MINDCRAFT_JSON_PATH,
  ProjectManager,
} from "@mindcraft-lang/app-host";

// -- Helpers ------------------------------------------------------------------

class MemoryProjectStore implements ProjectStore {
  readonly keyPrefix = "test-app";
  private projects: ProjectManifest[] = [];
  private workspaces = new Map<string, WorkspaceSnapshot>();
  private appData = new Map<string, string>();
  private activeId: string | undefined;

  async listProjects(): Promise<ProjectManifest[]> {
    return [...this.projects];
  }

  async getProject(id: string): Promise<ProjectManifest | undefined> {
    return this.projects.find((p) => p.id === id);
  }

  async createProject(name: string): Promise<ProjectManifest> {
    const manifest: ProjectManifest = {
      id: `id-${this.projects.length + 1}`,
      name,
      description: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.projects.push(manifest);
    return manifest;
  }

  async deleteProject(id: string): Promise<void> {
    this.projects = this.projects.filter((p) => p.id !== id);
    this.workspaces.delete(id);
    for (const key of this.appData.keys()) {
      if (key.startsWith(`${id}:`)) {
        this.appData.delete(key);
      }
    }
  }

  async updateProject(
    id: string,
    updates: Partial<Pick<ProjectManifest, "name" | "description" | "thumbnailUrl">>
  ): Promise<void> {
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx === -1) return;
    this.projects[idx] = { ...this.projects[idx], ...updates, updatedAt: Date.now() };
  }

  async duplicateProject(id: string, newName: string): Promise<ProjectManifest> {
    const source = await this.getProject(id);
    if (!source) throw new Error(`not found: ${id}`);
    const dup = await this.createProject(newName);
    const ws = this.workspaces.get(id);
    if (ws) this.workspaces.set(dup.id, new Map(ws));
    return dup;
  }

  async loadWorkspace(id: string): Promise<WorkspaceSnapshot | undefined> {
    return this.workspaces.get(id);
  }

  async saveWorkspace(id: string, snapshot: WorkspaceSnapshot): Promise<void> {
    this.workspaces.set(id, snapshot);
  }

  async loadAppData(id: string, key: string): Promise<string | undefined> {
    return this.appData.get(`${id}:${key}`);
  }

  async saveAppData(id: string, key: string, data: string): Promise<void> {
    this.appData.set(`${id}:${key}`, data);
  }

  async deleteAppData(id: string, key: string): Promise<void> {
    this.appData.delete(`${id}:${key}`);
  }

  getActiveProjectId(): string | undefined {
    return this.activeId;
  }

  setActiveProjectId(id: string | undefined): void {
    this.activeId = id;
  }
}

function makeWorkspace(
  files?: Map<string, { kind: "file"; content: string; etag: string; isReadonly: boolean }>,
  dirs?: Map<string, { kind: "directory" }>
): WorkspaceAdapter {
  const snapshot: WorkspaceSnapshot = new Map();
  for (const [k, v] of files ?? []) snapshot.set(k, v);
  for (const [k, v] of dirs ?? []) snapshot.set(k, v);

  return {
    exportSnapshot() {
      return new Map(snapshot);
    },
    applyRemoteChange(change: WorkspaceChange) {
      if (change.action === "write") {
        snapshot.set(change.path, {
          kind: "file",
          content: change.content,
          etag: change.newEtag,
          isReadonly: change.isReadonly ?? false,
        });
      }
    },
    applyLocalChange(change: WorkspaceChange) {
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
    name: "My Project",
    description: "A test project",
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

const HOST = { name: "test-app", version: "1.0.0" };

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

function makeFile(doc: Record<string, unknown>, name = "test.mindcraft"): File {
  const json = JSON.stringify(doc);
  return new File([json], name, { type: "application/json" });
}

function hasError(diagnostics: ImportDiagnostic[], substring: string): boolean {
  return diagnostics.some((d) => d.severity === "error" && d.message.includes(substring));
}

function hasWarning(diagnostics: ImportDiagnostic[], substring: string): boolean {
  return diagnostics.some((d) => d.severity === "warning" && d.message.includes(substring));
}

// -- Tests --------------------------------------------------------------------

describe("buildExportCommon", () => {
  it("exports user files and excludes mindcraft.json", async () => {
    const files = new Map([
      ["src/main.ts", { kind: "file" as const, content: "hello", etag: "e1", isReadonly: false }],
      [MINDCRAFT_JSON_PATH, { kind: "file" as const, content: "{}", etag: "e2", isReadonly: false }],
    ]);
    const ws = makeWorkspace(files);
    const manifest = makeManifest();

    const result = await buildExportCommon(HOST, manifest, ws, async () => undefined);

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, "src/main.ts");
    assert.strictEqual(result.files[0].content, "hello");
    assert.strictEqual(result.name, "My Project");
    assert.strictEqual(result.description, "A test project");
  });

  it("excludes read-only files", async () => {
    const files = new Map([
      ["src/main.ts", { kind: "file" as const, content: "hello", etag: "e1", isReadonly: false }],
      ["lib/std.ts", { kind: "file" as const, content: "stdlib", etag: "e2", isReadonly: true }],
    ]);
    const ws = makeWorkspace(files);

    const result = await buildExportCommon(HOST, makeManifest(), ws, async () => undefined);

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, "src/main.ts");
  });

  it("excludes __examples__/ paths", async () => {
    const files = new Map([
      ["src/main.ts", { kind: "file" as const, content: "hello", etag: "e1", isReadonly: false }],
      [`${EXAMPLES_FOLDER}/demo.ts`, { kind: "file" as const, content: "demo", etag: "e2", isReadonly: false }],
    ]);
    const ws = makeWorkspace(files);

    const result = await buildExportCommon(HOST, makeManifest(), ws, async () => undefined);

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, "src/main.ts");
  });

  it("excludes directory entries", async () => {
    const files = new Map([
      ["src/main.ts", { kind: "file" as const, content: "hello", etag: "e1", isReadonly: false }],
    ]);
    const dirs = new Map([["src", { kind: "directory" as const }]]);
    const ws = makeWorkspace(files, dirs);

    const result = await buildExportCommon(HOST, makeManifest(), ws, async () => undefined);

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, "src/main.ts");
  });

  it("loads and includes brains from app data", async () => {
    const ws = makeWorkspace();
    const brains = { carnivore: { name: "carnivore" }, herbivore: { name: "herbivore" } };

    const result = await buildExportCommon(HOST, makeManifest(), ws, async (key) => {
      if (key === "brains") return JSON.stringify(brains);
      return undefined;
    });

    assert.deepStrictEqual(result.brains, brains);
  });

  it("returns empty brains object when no brain data stored", async () => {
    const ws = makeWorkspace();

    const result = await buildExportCommon(HOST, makeManifest(), ws, async () => undefined);

    assert.deepStrictEqual(result.brains, {});
  });

  it("returns empty files array when workspace has no user files", async () => {
    const files = new Map([
      [MINDCRAFT_JSON_PATH, { kind: "file" as const, content: "{}", etag: "e1", isReadonly: false }],
    ]);
    const ws = makeWorkspace(files);

    const result = await buildExportCommon(HOST, makeManifest(), ws, async () => undefined);

    assert.strictEqual(result.files.length, 0);
  });
});

describe("importProject", () => {
  let store: MemoryProjectStore;
  let pm: ProjectManager;

  beforeEach(() => {
    store = new MemoryProjectStore();
    pm = new ProjectManager(store);
  });

  afterEach(async () => {
    await pm.close();
  });

  it("rejects files over size limit", async () => {
    const content = "x".repeat(100);
    const file = new File([content], "test.mindcraft");

    const result = await importProject(file, "test-app", "1.0.0", pm, {
      maxFileSize: 10,
    });

    assert.strictEqual(result.success, false);
    assert.ok(hasError(result.diagnostics, "maximum size"));
  });

  it("rejects invalid JSON", async () => {
    const file = new File(["not json {{{"], "test.mindcraft");

    const result = await importProject(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasError(result.diagnostics, "not valid JSON"));
  });

  it("rejects mismatched host.name", async () => {
    const file = makeFile(makeExportDoc({ host: { name: "other-app", version: "1.0.0" } }));

    const result = await importProject(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasError(result.diagnostics, "other-app"));
    assert.ok(hasError(result.diagnostics, "cannot be imported"));
  });

  it("rejects missing host.name", async () => {
    const file = makeFile(makeExportDoc({ host: {} }));

    const result = await importProject(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasError(result.diagnostics, "cannot be imported"));
  });

  it("rejects newer host.version", async () => {
    const file = makeFile(makeExportDoc({ host: { name: "test-app", version: "2.0.0" } }));

    const result = await importProject(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, false);
    assert.ok(hasError(result.diagnostics, "newer version"));
  });

  it("accepts same host.version", async () => {
    const file = makeFile(makeExportDoc());

    const result = await importProject(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    assert.ok(result.projectId);
  });

  it("accepts older host.version", async () => {
    const file = makeFile(makeExportDoc({ host: { name: "test-app", version: "0.9.0" } }));

    const result = await importProject(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    assert.ok(result.projectId);
  });

  it("rejects missing required fields", async () => {
    const cases = [
      { field: "name", doc: makeExportDoc({ name: 123 }), expected: '"name"' },
      { field: "description", doc: makeExportDoc({ description: null }), expected: '"description"' },
      { field: "files", doc: makeExportDoc({ files: "not-array" }), expected: '"files"' },
      { field: "brains", doc: makeExportDoc({ brains: null }), expected: '"brains"' },
      { field: "brains (array)", doc: makeExportDoc({ brains: [] }), expected: '"brains"' },
    ];

    for (const { field, doc, expected } of cases) {
      const file = makeFile(doc);
      const result = await importProject(file, "test-app", "1.0.0", pm);
      assert.strictEqual(result.success, false, `Expected failure for ${field}`);
      assert.ok(hasError(result.diagnostics, expected), `Expected error mentioning ${expected} for ${field}`);
    }
  });

  it("substitutes DEFAULT_PROJECT_NAME when name is empty", async () => {
    const file = makeFile(makeExportDoc({ name: "   " }));

    const result = await importProject(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const project = await store.getProject(result.projectId!);
    assert.strictEqual(project?.name, DEFAULT_PROJECT_NAME);
  });

  it("creates project and writes files to workspace", async () => {
    const doc = makeExportDoc({
      name: "Import Test",
      description: "imported desc",
      files: [
        { path: "src/main.ts", content: "hello world" },
        { path: "src/lib.ts", content: "lib code" },
      ],
    });
    const file = makeFile(doc);

    const result = await importProject(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    assert.ok(result.projectId);

    const snapshot = await store.loadWorkspace(result.projectId!);
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

  it("skips invalid file entries with warning diagnostic", async () => {
    const doc = makeExportDoc({
      files: [
        { path: "valid.ts", content: "ok" },
        { path: 123, content: "bad path" },
        { path: "good.ts", content: 456 },
      ],
    });
    const file = makeFile(doc);

    const result = await importProject(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const snapshot = await store.loadWorkspace(result.projectId!);
    assert.ok(snapshot?.get("valid.ts"));
    assert.strictEqual(result.diagnostics.filter((d) => d.severity === "warning").length, 2);
  });

  it("saves brains to app data", async () => {
    const brains = { carnivore: { name: "carnivore" } };
    const doc = makeExportDoc({ brains });
    const file = makeFile(doc);

    const result = await importProject(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const raw = await store.loadAppData(result.projectId!, "brains");
    assert.ok(raw);
    assert.deepStrictEqual(JSON.parse(raw), brains);
  });

  it("calls app layer callback when app is present", async () => {
    const appData = { actors: [{ archetype: "carnivore" }] };
    const doc = makeExportDoc({ app: appData });
    const file = makeFile(doc);
    let callbackCalled = false;
    let receivedApp: unknown;
    let receivedVersion: string | undefined;

    const result = await importProject(file, "test-app", "1.0.0", pm, {
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
    assert.ok(hasWarning(result.diagnostics, "app warning"));
  });

  it("returns error when app is missing but callback is provided", async () => {
    const doc = makeExportDoc();
    delete (doc as Record<string, unknown>).app;
    const file = makeFile(doc);
    let callbackCalled = false;

    const result = await importProject(file, "test-app", "1.0.0", pm, {
      appLayerCallback: () => {
        callbackCalled = true;
        return { diagnostics: [] };
      },
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(callbackCalled, false);
    assert.ok(hasError(result.diagnostics, "No app-specific data"));
    assert.strictEqual((await store.listProjects()).length, 0);
  });

  it("aborts import when app layer callback returns error diagnostic", async () => {
    const doc = makeExportDoc({ app: { actors: [] } });
    const file = makeFile(doc);

    const result = await importProject(file, "test-app", "1.0.0", pm, {
      appLayerCallback: () => ({
        diagnostics: [{ severity: "error", message: "bad app data" }],
      }),
    });

    assert.strictEqual(result.success, false);
    assert.ok(hasError(result.diagnostics, "bad app data"));
    assert.strictEqual((await store.listProjects()).length, 0);
  });

  it("merges app layer appData into store alongside brains", async () => {
    const doc = makeExportDoc({
      brains: { carnivore: { name: "c" } },
      app: { actors: [] },
    });
    const file = makeFile(doc);

    const result = await importProject(file, "test-app", "1.0.0", pm, {
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

    const result = await importProject(file, "test-app", "1.0.0", pm, {
      appLayerCallback: () => ({
        diagnostics: [],
        appData: { brains: '{"hijack":true}' },
      }),
    });

    assert.strictEqual(result.success, true);
    const brainsRaw = await store.loadAppData(result.projectId!, "brains");
    assert.deepStrictEqual(JSON.parse(brainsRaw!), { carnivore: { name: "c" } });
  });

  it("never throws -- catches unexpected errors and returns error diagnostic", async () => {
    const file = makeFile(makeExportDoc());

    const badPm = {
      createFromSnapshot() {
        throw new Error("boom");
      },
    } as unknown as ProjectManager;

    const result = await importProject(file, "test-app", "1.0.0", badPm);

    assert.strictEqual(result.success, false);
    assert.ok(hasError(result.diagnostics, "boom"));
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

    const result = await importProject(file, "test-app", "1.0.0", pm);

    assert.strictEqual(result.success, true);
    const snapshot = await store.loadWorkspace(result.projectId!);
    assert.ok(snapshot?.get("valid/file.ts"));
    assert.strictEqual(snapshot?.has("../escape.ts"), false);
    assert.strictEqual(snapshot?.has("/absolute.ts"), false);
    assert.strictEqual(snapshot?.has("src\\backslash.ts"), false);
    assert.strictEqual(
      result.diagnostics.filter((d) => d.severity === "warning" && d.message.includes("invalid path")).length,
      3
    );
  });
});

describe("ProjectManager.createFromSnapshot", () => {
  it("writes manifest, description, workspace, and app data without opening", async () => {
    const store = new MemoryProjectStore();
    const pm = new ProjectManager(store);

    const snapshot: WorkspaceSnapshot = new Map([
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

    const ws = await store.loadWorkspace(manifest.id);
    const file = ws?.get("src/main.ts");
    assert.ok(file && file.kind === "file");
    assert.strictEqual(file.content, "hello");

    assert.strictEqual(await store.loadAppData(manifest.id, "brains"), '{"a":1}');
    assert.strictEqual(await store.loadAppData(manifest.id, "actors"), '{"b":2}');
  });
});
