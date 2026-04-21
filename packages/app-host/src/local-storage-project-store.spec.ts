import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ProjectStore } from "@mindcraft-lang/app-host";
import { createLocalStorageProjectStore } from "@mindcraft-lang/app-host";

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
    const keys = [...this.data.keys()];
    return keys[index] ?? null;
  }

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }
}

describe("LocalStorageProjectStore", () => {
  let store: ProjectStore;

  beforeEach(() => {
    const mock = new MockLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = mock;
    (globalThis as Record<string, unknown>).sessionStorage = new MockLocalStorage();
    store = createLocalStorageProjectStore("test-app");
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
    delete (globalThis as Record<string, unknown>).sessionStorage;
  });

  describe("listProjects", () => {
    it("returns empty array when no projects exist", async () => {
      assert.deepStrictEqual(await store.listProjects(), []);
    });

    it("returns projects after creation", async () => {
      await store.createProject("Alpha");
      await store.createProject("Beta");
      const list = await store.listProjects();
      assert.strictEqual(list.length, 2);
      assert.strictEqual(list[0].name, "Alpha");
      assert.strictEqual(list[1].name, "Beta");
    });
  });

  describe("createProject", () => {
    it("returns a manifest with name and timestamps", async () => {
      const before = Date.now();
      const manifest = await store.createProject("My Project");
      const after = Date.now();

      assert.strictEqual(manifest.name, "My Project");
      assert.ok(manifest.id.length > 0);
      assert.ok(manifest.createdAt >= before && manifest.createdAt <= after);
      assert.ok(manifest.updatedAt >= before && manifest.updatedAt <= after);
    });

    it("assigns unique IDs to each project", async () => {
      const a = await store.createProject("A");
      const b = await store.createProject("B");
      assert.notStrictEqual(a.id, b.id);
    });
  });

  describe("getProject", () => {
    it("returns undefined for nonexistent ID", async () => {
      assert.strictEqual(await store.getProject("no-such-id"), undefined);
    });

    it("returns the matching manifest", async () => {
      const created = await store.createProject("Lookup");
      const found = await store.getProject(created.id);
      assert.strictEqual(found?.name, "Lookup");
      assert.strictEqual(found?.id, created.id);
    });
  });

  describe("updateProject", () => {
    it("renames a project and updates updatedAt", async () => {
      const created = await store.createProject("Original");
      const originalUpdatedAt = created.updatedAt;

      await store.updateProject(created.id, { name: "Renamed" });

      const updated = await store.getProject(created.id);
      assert.strictEqual(updated?.name, "Renamed");
      assert.ok(updated!.updatedAt >= originalUpdatedAt);
    });

    it("no-ops for nonexistent ID", async () => {
      await store.updateProject("nonexistent", { name: "Nope" });
      assert.deepStrictEqual(await store.listProjects(), []);
    });
  });

  describe("deleteProject", () => {
    it("removes the project from the list", async () => {
      const a = await store.createProject("A");
      const b = await store.createProject("B");
      await store.deleteProject(a.id);
      const list = await store.listProjects();
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].id, b.id);
    });

    it("clears metadata, workspace, and app data for the deleted project", async () => {
      const p = await store.createProject("Doomed");
      await store.saveWorkspace(
        p.id,
        new Map([["file.ts", { kind: "file", content: "x", etag: "1", isReadonly: false }]])
      );
      await store.saveAppData(p.id, "brains", "{}");
      await store.deleteProject(p.id);

      assert.strictEqual(await store.getProject(p.id), undefined);
      assert.strictEqual(await store.loadWorkspace(p.id), undefined);
      assert.strictEqual(await store.loadAppData(p.id, "brains"), undefined);
    });

    it("clears active project ID if deleted project was active", async () => {
      const p = await store.createProject("Active");
      store.setActiveProjectId(p.id);
      await store.deleteProject(p.id);
      assert.strictEqual(store.getActiveProjectId(), undefined);
    });
  });

  describe("workspace persistence", () => {
    it("round-trips a workspace snapshot", async () => {
      const p = await store.createProject("WS");
      const snapshot = new Map([
        ["src/main.ts", { kind: "file" as const, content: "console.log('hi')", etag: "abc", isReadonly: false }],
        ["src/", { kind: "directory" as const }],
      ]);
      await store.saveWorkspace(p.id, snapshot);
      const loaded = await store.loadWorkspace(p.id);
      assert.ok(loaded);
      assert.strictEqual(loaded.size, 2);
      const file = loaded.get("src/main.ts");
      assert.strictEqual(file?.kind, "file");
      if (file?.kind === "file") {
        assert.strictEqual(file.content, "console.log('hi')");
      }
    });

    it("returns undefined when no workspace saved", async () => {
      const p = await store.createProject("Empty");
      assert.strictEqual(await store.loadWorkspace(p.id), undefined);
    });
  });

  describe("app data", () => {
    it("round-trips app data", async () => {
      const p = await store.createProject("AppData");
      await store.saveAppData(p.id, "brains", '{"carnivore":{}}');
      assert.strictEqual(await store.loadAppData(p.id, "brains"), '{"carnivore":{}}');
    });

    it("returns undefined for missing key", async () => {
      const p = await store.createProject("Empty");
      assert.strictEqual(await store.loadAppData(p.id, "missing"), undefined);
    });

    it("deletes app data", async () => {
      const p = await store.createProject("Deletable");
      await store.saveAppData(p.id, "settings", "{}");
      await store.deleteAppData(p.id, "settings");
      assert.strictEqual(await store.loadAppData(p.id, "settings"), undefined);
    });
  });

  describe("duplicateProject", () => {
    it("copies workspace and app data to the new project", async () => {
      const original = await store.createProject("Original");
      await store.saveWorkspace(
        original.id,
        new Map([["a.ts", { kind: "file", content: "a", etag: "1", isReadonly: false }]])
      );
      await store.saveAppData(original.id, "brains", '{"x":1}');
      await store.saveAppData(original.id, "settings", '{"y":2}');

      const dup = await store.duplicateProject(original.id, "Copy");

      assert.strictEqual(dup.name, "Copy");
      assert.notStrictEqual(dup.id, original.id);

      const ws = await store.loadWorkspace(dup.id);
      assert.ok(ws);
      assert.strictEqual(ws.get("a.ts")?.kind, "file");

      assert.strictEqual(await store.loadAppData(dup.id, "brains"), '{"x":1}');
      assert.strictEqual(await store.loadAppData(dup.id, "settings"), '{"y":2}');
    });

    it("throws for nonexistent source project", async () => {
      await assert.rejects(() => store.duplicateProject("ghost", "Copy"), /not found/);
    });
  });

  describe("active project ID", () => {
    it("returns undefined when not set", () => {
      assert.strictEqual(store.getActiveProjectId(), undefined);
    });

    it("round-trips active project ID", () => {
      store.setActiveProjectId("some-id");
      assert.strictEqual(store.getActiveProjectId(), "some-id");
    });

    it("clears active project ID", () => {
      store.setActiveProjectId("some-id");
      store.setActiveProjectId(undefined);
      assert.strictEqual(store.getActiveProjectId(), undefined);
    });

    it("prefers sessionStorage over localStorage", () => {
      localStorage.setItem("test-app:active-project", "from-local");
      sessionStorage.setItem("test-app:active-project", "from-session");
      assert.strictEqual(store.getActiveProjectId(), "from-session");
    });

    it("falls back to localStorage when sessionStorage is empty", () => {
      localStorage.setItem("test-app:active-project", "from-local");
      assert.strictEqual(store.getActiveProjectId(), "from-local");
    });

    it("writes to both sessionStorage and localStorage", () => {
      store.setActiveProjectId("dual");
      assert.strictEqual(sessionStorage.getItem("test-app:active-project"), "dual");
      assert.strictEqual(localStorage.getItem("test-app:active-project"), "dual");
    });
  });

  describe("storage layout", () => {
    it("stores only IDs in the project index", async () => {
      const a = await store.createProject("Alpha");
      const b = await store.createProject("Beta");

      const raw = localStorage.getItem("test-app:project-index");
      assert.ok(raw);
      const index = JSON.parse(raw) as unknown;
      assert.deepStrictEqual(index, [a.id, b.id]);
    });

    it("stores metadata in a per-project key", async () => {
      const p = await store.createProject("Test");
      const raw = localStorage.getItem(`test-app:project:${p.id}:metadata`);
      assert.ok(raw);
      const metadata = JSON.parse(raw) as Record<string, unknown>;
      assert.strictEqual(metadata.name, "Test");
      assert.strictEqual(metadata.description, "");
      assert.strictEqual(metadata.id, p.id);
    });

    it("updates metadata without touching the index", async () => {
      const p = await store.createProject("Before");
      const indexBefore = localStorage.getItem("test-app:project-index");

      await store.updateProject(p.id, { name: "After" });

      const indexAfter = localStorage.getItem("test-app:project-index");
      assert.strictEqual(indexBefore, indexAfter);

      const updated = await store.getProject(p.id);
      assert.strictEqual(updated?.name, "After");
    });
  });
});
