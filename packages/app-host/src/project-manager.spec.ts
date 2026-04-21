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

  async updateProject(id: string, updates: Partial<Pick<ProjectManifest, "name" | "description">>): Promise<void> {
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

describe("ProjectManager", () => {
  let memStore: MemoryProjectStore;
  let pm: ProjectManager;

  beforeEach(() => {
    memStore = new MemoryProjectStore();
    pm = new ProjectManager(memStore);
  });

  afterEach(async () => {
    await pm.close();
  });

  describe("ensureDefaultProject", () => {
    it("creates a project when none exist", async () => {
      const active = await pm.ensureDefaultProject("Default");
      assert.strictEqual(active.manifest.name, "Default");
      assert.strictEqual(pm.activeProject?.manifest.id, active.manifest.id);
    });

    it("returns existing active project if one is already open", async () => {
      const first = await pm.ensureDefaultProject("First");
      const second = await pm.ensureDefaultProject("Second");
      assert.strictEqual(first.manifest.id, second.manifest.id);
      const projects = await pm.listProjects();
      assert.strictEqual(projects.length, 1);
    });

    it("opens first existing project when no active project", async () => {
      await memStore.createProject("Existing");
      const fresh = new ProjectManager(memStore);
      const active = await fresh.ensureDefaultProject("Ignored");
      assert.strictEqual(active.manifest.name, "Existing");
      await fresh.close();
    });
  });

  describe("create", () => {
    it("creates and opens the new project", async () => {
      const manifest = await pm.create("New One");
      assert.strictEqual(manifest.name, "New One");
      assert.strictEqual(pm.activeProject?.manifest.id, manifest.id);
    });

    it("fires project list listener", async () => {
      const calls: number[] = [];
      pm.onProjectListChange((projects) => calls.push(projects.length));
      await pm.create("A");
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0], 1);
    });
  });

  describe("open / close", () => {
    it("opens a project by ID", async () => {
      const m = await pm.create("Openable");
      await pm.close();
      assert.strictEqual(pm.activeProject, undefined);

      const opened = await pm.open(m.id);
      assert.strictEqual(opened.manifest.id, m.id);
    });

    it("throws when opening nonexistent project", async () => {
      await assert.rejects(() => pm.open("ghost"), /not found/i);
    });

    it("fires active project listener on open and close", async () => {
      const calls: Array<string | undefined> = [];
      pm.onActiveProjectChange((p) => calls.push(p?.manifest.name));
      await pm.create("Watched");
      await pm.close();
      assert.deepStrictEqual(calls, ["Watched", undefined]);
    });

    it("close is idempotent when nothing is open", async () => {
      await pm.close();
      assert.strictEqual(pm.activeProject, undefined);
    });
  });

  describe("delete", () => {
    it("removes a non-active project", async () => {
      const a = await pm.create("A");
      const b = await memStore.createProject("B");
      await pm.delete(b.id);
      const projects = await pm.listProjects();
      assert.strictEqual(projects.length, 1);
      assert.strictEqual(projects[0].id, a.id);
    });

    it("throws when deleting the active project", async () => {
      await pm.create("Active");
      await assert.rejects(() => pm.delete(pm.activeProject!.manifest.id), /active project/i);
    });

    it("fires project list listener", async () => {
      await pm.create("A");
      const b = await memStore.createProject("B");
      const calls: number[] = [];
      pm.onProjectListChange((projects) => calls.push(projects.length));
      await pm.delete(b.id);
      assert.deepStrictEqual(calls, [1]);
    });
  });

  describe("updateActive", () => {
    it("renames the active project", async () => {
      await pm.create("Old Name");
      await pm.updateActive({ name: "New Name" });
      assert.strictEqual(pm.activeProject?.manifest.name, "New Name");
    });

    it("updates the description", async () => {
      await pm.create("Project");
      await pm.updateActive({ description: "A cool project" });
      assert.strictEqual(pm.activeProject?.manifest.description, "A cool project");
    });

    it("fires both listeners", async () => {
      await pm.create("X");
      const activeCalls: string[] = [];
      const listCalls: string[] = [];
      pm.onActiveProjectChange((p) => activeCalls.push(p?.manifest.name ?? ""));
      pm.onProjectListChange((projects) => listCalls.push(projects[0]?.name ?? ""));
      await pm.updateActive({ name: "Y" });
      assert.deepStrictEqual(activeCalls, ["Y"]);
      assert.deepStrictEqual(listCalls, ["Y"]);
    });

    it("throws when no active project", async () => {
      await assert.rejects(() => pm.updateActive({ name: "Nope" }), /no active project/i);
    });
  });

  describe("app data pass-through", () => {
    it("saves and loads app data for the active project", async () => {
      await pm.create("Data Project");
      await pm.saveAppData("key1", "value1");
      assert.strictEqual(await pm.loadAppData("key1"), "value1");
    });

    it("returns undefined when no active project", async () => {
      assert.strictEqual(await pm.loadAppData("key1"), undefined);
    });

    it("throws on save when no active project", async () => {
      await assert.rejects(() => pm.saveAppData("key1", "value1"), /no active project/i);
    });

    it("deletes app data", async () => {
      await pm.create("Deletable");
      await pm.saveAppData("k", "v");
      await pm.deleteAppData("k");
      assert.strictEqual(await pm.loadAppData("k"), undefined);
    });
  });

  describe("listener unsubscribe", () => {
    it("stops receiving events after unsubscribe", async () => {
      const calls: number[] = [];
      const unsub = pm.onProjectListChange((projects) => calls.push(projects.length));
      await pm.create("A");
      unsub();
      await pm.create("B");
      assert.strictEqual(calls.length, 1);
    });
  });

  describe("init restores active project", () => {
    it("opens previously active project on init", async () => {
      const manifest = await memStore.createProject("Persisted");
      memStore.setActiveProjectId(manifest.id);

      const restored = new ProjectManager(memStore);
      await restored.init();
      assert.strictEqual(restored.activeProject?.manifest.name, "Persisted");
      await restored.close();
    });

    it("handles stale active project ID gracefully", async () => {
      memStore.setActiveProjectId("deleted-id");
      const restored = new ProjectManager(memStore);
      await restored.init();
      assert.strictEqual(restored.activeProject, undefined);
      await restored.close();
    });
  });
});
