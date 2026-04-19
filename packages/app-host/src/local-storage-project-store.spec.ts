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
    store = createLocalStorageProjectStore("test-app");
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  describe("listProjects", () => {
    it("returns empty array when no projects exist", () => {
      assert.deepStrictEqual(store.listProjects(), []);
    });

    it("returns projects after creation", () => {
      store.createProject("Alpha");
      store.createProject("Beta");
      const list = store.listProjects();
      assert.strictEqual(list.length, 2);
      assert.strictEqual(list[0].name, "Alpha");
      assert.strictEqual(list[1].name, "Beta");
    });
  });

  describe("createProject", () => {
    it("returns a manifest with name and timestamps", () => {
      const before = Date.now();
      const manifest = store.createProject("My Project");
      const after = Date.now();

      assert.strictEqual(manifest.name, "My Project");
      assert.ok(manifest.id.length > 0);
      assert.ok(manifest.createdAt >= before && manifest.createdAt <= after);
      assert.ok(manifest.updatedAt >= before && manifest.updatedAt <= after);
    });

    it("assigns unique IDs to each project", () => {
      const a = store.createProject("A");
      const b = store.createProject("B");
      assert.notStrictEqual(a.id, b.id);
    });
  });

  describe("getProject", () => {
    it("returns undefined for nonexistent ID", () => {
      assert.strictEqual(store.getProject("no-such-id"), undefined);
    });

    it("returns the matching manifest", () => {
      const created = store.createProject("Lookup");
      const found = store.getProject(created.id);
      assert.strictEqual(found?.name, "Lookup");
      assert.strictEqual(found?.id, created.id);
    });
  });

  describe("updateProject", () => {
    it("renames a project and updates updatedAt", () => {
      const created = store.createProject("Original");
      const originalUpdatedAt = created.updatedAt;

      store.updateProject(created.id, { name: "Renamed" });

      const updated = store.getProject(created.id);
      assert.strictEqual(updated?.name, "Renamed");
      assert.ok(updated!.updatedAt >= originalUpdatedAt);
    });

    it("no-ops for nonexistent ID", () => {
      store.updateProject("nonexistent", { name: "Nope" });
      assert.deepStrictEqual(store.listProjects(), []);
    });
  });

  describe("deleteProject", () => {
    it("removes the project from the list", () => {
      const a = store.createProject("A");
      const b = store.createProject("B");
      store.deleteProject(a.id);
      const list = store.listProjects();
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].id, b.id);
    });

    it("clears metadata, workspace, and app data for the deleted project", () => {
      const p = store.createProject("Doomed");
      store.saveWorkspace(p.id, new Map([["file.ts", { kind: "file", content: "x", etag: "1", isReadonly: false }]]));
      store.saveAppData(p.id, "brains", "{}");
      store.deleteProject(p.id);

      assert.strictEqual(store.getProject(p.id), undefined);
      assert.strictEqual(store.loadWorkspace(p.id), undefined);
      assert.strictEqual(store.loadAppData(p.id, "brains"), undefined);
    });

    it("clears active project ID if deleted project was active", () => {
      const p = store.createProject("Active");
      store.setActiveProjectId(p.id);
      store.deleteProject(p.id);
      assert.strictEqual(store.getActiveProjectId(), undefined);
    });
  });

  describe("workspace persistence", () => {
    it("round-trips a workspace snapshot", () => {
      const p = store.createProject("WS");
      const snapshot = new Map([
        ["src/main.ts", { kind: "file" as const, content: "console.log('hi')", etag: "abc", isReadonly: false }],
        ["src/", { kind: "directory" as const }],
      ]);
      store.saveWorkspace(p.id, snapshot);
      const loaded = store.loadWorkspace(p.id);
      assert.ok(loaded);
      assert.strictEqual(loaded.size, 2);
      const file = loaded.get("src/main.ts");
      assert.strictEqual(file?.kind, "file");
      if (file?.kind === "file") {
        assert.strictEqual(file.content, "console.log('hi')");
      }
    });

    it("returns undefined when no workspace saved", () => {
      const p = store.createProject("Empty");
      assert.strictEqual(store.loadWorkspace(p.id), undefined);
    });
  });

  describe("app data", () => {
    it("round-trips app data", () => {
      const p = store.createProject("AppData");
      store.saveAppData(p.id, "brains", '{"carnivore":{}}');
      assert.strictEqual(store.loadAppData(p.id, "brains"), '{"carnivore":{}}');
    });

    it("returns undefined for missing key", () => {
      const p = store.createProject("Empty");
      assert.strictEqual(store.loadAppData(p.id, "missing"), undefined);
    });

    it("deletes app data", () => {
      const p = store.createProject("Deletable");
      store.saveAppData(p.id, "settings", "{}");
      store.deleteAppData(p.id, "settings");
      assert.strictEqual(store.loadAppData(p.id, "settings"), undefined);
    });
  });

  describe("duplicateProject", () => {
    it("copies workspace and app data to the new project", () => {
      const original = store.createProject("Original");
      store.saveWorkspace(
        original.id,
        new Map([["a.ts", { kind: "file", content: "a", etag: "1", isReadonly: false }]])
      );
      store.saveAppData(original.id, "brains", '{"x":1}');
      store.saveAppData(original.id, "settings", '{"y":2}');

      const dup = store.duplicateProject(original.id, "Copy");

      assert.strictEqual(dup.name, "Copy");
      assert.notStrictEqual(dup.id, original.id);

      const ws = store.loadWorkspace(dup.id);
      assert.ok(ws);
      assert.strictEqual(ws.get("a.ts")?.kind, "file");

      assert.strictEqual(store.loadAppData(dup.id, "brains"), '{"x":1}');
      assert.strictEqual(store.loadAppData(dup.id, "settings"), '{"y":2}');
    });

    it("throws for nonexistent source project", () => {
      assert.throws(() => store.duplicateProject("ghost", "Copy"), /not found/);
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
  });

  describe("storage layout", () => {
    it("stores only IDs in the project index", () => {
      const a = store.createProject("Alpha");
      const b = store.createProject("Beta");

      const raw = localStorage.getItem("test-app:project-index");
      assert.ok(raw);
      const index = JSON.parse(raw) as unknown;
      assert.deepStrictEqual(index, [a.id, b.id]);
    });

    it("stores metadata in a per-project key", () => {
      const p = store.createProject("Test");
      const raw = localStorage.getItem(`test-app:project:${p.id}:metadata`);
      assert.ok(raw);
      const metadata = JSON.parse(raw) as Record<string, unknown>;
      assert.strictEqual(metadata.name, "Test");
      assert.strictEqual(metadata.description, "");
      assert.strictEqual(metadata.id, p.id);
    });

    it("updates metadata without touching the index", () => {
      const p = store.createProject("Before");
      const indexBefore = localStorage.getItem("test-app:project-index");

      store.updateProject(p.id, { name: "After" });

      const indexAfter = localStorage.getItem("test-app:project-index");
      assert.strictEqual(indexBefore, indexAfter);

      const updated = store.getProject(p.id);
      assert.strictEqual(updated?.name, "After");
    });
  });
});
