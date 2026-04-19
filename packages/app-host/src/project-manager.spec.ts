import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ProjectManifest, ProjectStore, WorkspaceSnapshot } from "@mindcraft-lang/app-host";
import { ProjectManager } from "@mindcraft-lang/app-host";

class MemoryProjectStore implements ProjectStore {
  readonly keyPrefix = "test-app";
  private projects: ProjectManifest[] = [];
  private workspaces = new Map<string, WorkspaceSnapshot>();
  private appData = new Map<string, string>();
  private activeId: string | undefined;

  listProjects(): ProjectManifest[] {
    return [...this.projects];
  }

  getProject(id: string): ProjectManifest | undefined {
    return this.projects.find((p) => p.id === id);
  }

  createProject(name: string): ProjectManifest {
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

  deleteProject(id: string): void {
    this.projects = this.projects.filter((p) => p.id !== id);
    this.workspaces.delete(id);
    for (const key of this.appData.keys()) {
      if (key.startsWith(`${id}:`)) {
        this.appData.delete(key);
      }
    }
  }

  updateProject(id: string, updates: Partial<Pick<ProjectManifest, "name" | "description">>): void {
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx === -1) return;
    this.projects[idx] = { ...this.projects[idx], ...updates, updatedAt: Date.now() };
  }

  duplicateProject(id: string, newName: string): ProjectManifest {
    const source = this.getProject(id);
    if (!source) throw new Error(`not found: ${id}`);
    const dup = this.createProject(newName);
    const ws = this.workspaces.get(id);
    if (ws) this.workspaces.set(dup.id, new Map(ws));
    return dup;
  }

  loadWorkspace(id: string): WorkspaceSnapshot | undefined {
    return this.workspaces.get(id);
  }

  saveWorkspace(id: string, snapshot: WorkspaceSnapshot): void {
    this.workspaces.set(id, snapshot);
  }

  loadAppData(id: string, key: string): string | undefined {
    return this.appData.get(`${id}:${key}`);
  }

  saveAppData(id: string, key: string, data: string): void {
    this.appData.set(`${id}:${key}`, data);
  }

  deleteAppData(id: string, key: string): void {
    this.appData.delete(`${id}:${key}`);
  }

  getActiveProjectId(): string | undefined {
    return this.activeId;
  }

  setActiveProjectId(id: string | undefined): void {
    this.activeId = id;
  }
}

class MockLocalStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
}

describe("ProjectManager", () => {
  let memStore: MemoryProjectStore;
  let pm: ProjectManager;

  beforeEach(() => {
    const mock = new MockLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = mock;
    (globalThis as Record<string, unknown>).window = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    memStore = new MemoryProjectStore();
    pm = new ProjectManager(memStore);
  });

  afterEach(() => {
    pm.close();
    delete (globalThis as Record<string, unknown>).localStorage;
    delete (globalThis as Record<string, unknown>).window;
  });

  describe("ensureDefaultProject", () => {
    it("creates a project when none exist", () => {
      const active = pm.ensureDefaultProject("Default");
      assert.strictEqual(active.manifest.name, "Default");
      assert.strictEqual(pm.activeProject?.manifest.id, active.manifest.id);
    });

    it("returns existing active project if one is already open", () => {
      const first = pm.ensureDefaultProject("First");
      const second = pm.ensureDefaultProject("Second");
      assert.strictEqual(first.manifest.id, second.manifest.id);
      assert.strictEqual(pm.projects.length, 1);
    });

    it("opens first existing project when no active project", () => {
      memStore.createProject("Existing");
      const fresh = new ProjectManager(memStore);
      const active = fresh.ensureDefaultProject("Ignored");
      assert.strictEqual(active.manifest.name, "Existing");
      fresh.close();
    });
  });

  describe("create", () => {
    it("creates and opens the new project", () => {
      const manifest = pm.create("New One");
      assert.strictEqual(manifest.name, "New One");
      assert.strictEqual(pm.activeProject?.manifest.id, manifest.id);
    });

    it("fires project list listener", () => {
      const calls: number[] = [];
      pm.onProjectListChange((projects) => calls.push(projects.length));
      pm.create("A");
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0], 1);
    });
  });

  describe("open / close", () => {
    it("opens a project by ID", () => {
      const m = pm.create("Openable");
      pm.close();
      assert.strictEqual(pm.activeProject, undefined);

      const opened = pm.open(m.id);
      assert.strictEqual(opened.manifest.id, m.id);
    });

    it("throws when opening nonexistent project", () => {
      assert.throws(() => pm.open("ghost"), /not found/i);
    });

    it("fires active project listener on open and close", () => {
      const calls: Array<string | undefined> = [];
      pm.onActiveProjectChange((p) => calls.push(p?.manifest.name));
      const m = pm.create("Watched");
      pm.close();
      assert.deepStrictEqual(calls, ["Watched", undefined]);
    });

    it("close is idempotent when nothing is open", () => {
      pm.close();
      assert.strictEqual(pm.activeProject, undefined);
    });
  });

  describe("delete", () => {
    it("removes a non-active project", () => {
      const a = pm.create("A");
      const b = memStore.createProject("B");
      pm.delete(b.id);
      assert.strictEqual(pm.projects.length, 1);
      assert.strictEqual(pm.projects[0].id, a.id);
    });

    it("throws when deleting the active project", () => {
      pm.create("Active");
      assert.throws(() => pm.delete(pm.activeProject!.manifest.id), /active project/i);
    });

    it("fires project list listener", () => {
      pm.create("A");
      const b = memStore.createProject("B");
      const calls: number[] = [];
      pm.onProjectListChange((projects) => calls.push(projects.length));
      pm.delete(b.id);
      assert.deepStrictEqual(calls, [1]);
    });
  });

  describe("updateActive", () => {
    it("renames the active project", () => {
      pm.create("Old Name");
      pm.updateActive({ name: "New Name" });
      assert.strictEqual(pm.activeProject?.manifest.name, "New Name");
    });

    it("updates the description", () => {
      pm.create("Project");
      pm.updateActive({ description: "A cool project" });
      assert.strictEqual(pm.activeProject?.manifest.description, "A cool project");
    });

    it("fires both listeners", () => {
      pm.create("X");
      const activeCalls: string[] = [];
      const listCalls: string[] = [];
      pm.onActiveProjectChange((p) => activeCalls.push(p?.manifest.name ?? ""));
      pm.onProjectListChange((projects) => listCalls.push(projects[0]?.name ?? ""));
      pm.updateActive({ name: "Y" });
      assert.deepStrictEqual(activeCalls, ["Y"]);
      assert.deepStrictEqual(listCalls, ["Y"]);
    });

    it("throws when no active project", () => {
      assert.throws(() => pm.updateActive({ name: "Nope" }), /no active project/i);
    });
  });

  describe("app data pass-through", () => {
    it("saves and loads app data for the active project", () => {
      pm.create("Data Project");
      pm.saveAppData("key1", "value1");
      assert.strictEqual(pm.loadAppData("key1"), "value1");
    });

    it("returns undefined when no active project", () => {
      assert.strictEqual(pm.loadAppData("key1"), undefined);
    });

    it("throws on save when no active project", () => {
      assert.throws(() => pm.saveAppData("key1", "value1"), /no active project/i);
    });

    it("deletes app data", () => {
      pm.create("Deletable");
      pm.saveAppData("k", "v");
      pm.deleteAppData("k");
      assert.strictEqual(pm.loadAppData("k"), undefined);
    });
  });

  describe("listener unsubscribe", () => {
    it("stops receiving events after unsubscribe", () => {
      const calls: number[] = [];
      const unsub = pm.onProjectListChange((projects) => calls.push(projects.length));
      pm.create("A");
      unsub();
      pm.create("B");
      assert.strictEqual(calls.length, 1);
    });
  });

  describe("constructor restores active project", () => {
    it("opens previously active project on construction", () => {
      const manifest = memStore.createProject("Persisted");
      memStore.setActiveProjectId(manifest.id);

      const restored = new ProjectManager(memStore);
      assert.strictEqual(restored.activeProject?.manifest.name, "Persisted");
      restored.close();
    });

    it("handles stale active project ID gracefully", () => {
      memStore.setActiveProjectId("deleted-id");
      const restored = new ProjectManager(memStore);
      assert.strictEqual(restored.activeProject, undefined);
      restored.close();
    });
  });
});
