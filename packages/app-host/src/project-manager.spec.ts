import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DEFAULT_PROJECT_COLLECTION_ID,
  DEFAULT_PROJECT_NAME,
  PROJECT_COLLECTION_NAME_MAX_LENGTH,
  type ProjectCollectionState,
  ProjectManager,
} from "@mindcraft-lang/app-host";
import { assertRejectsWithCode } from "./test-support/error-assertions.js";
import { MemoryProjectStore } from "./test-support/memory-project-store.js";

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
      await memStore.ensureDefaultProjectCollection();
      await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Existing");
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
      await assertRejectsWithCode(() => pm.open("ghost"), "PROJECT_NOT_FOUND");
    });

    it("throws when opening a project from another project collection", async () => {
      await pm.init();
      const otherCollection = await memStore.createProjectCollection("Other");
      const otherProject = await memStore.createProject(otherCollection.projectCollectionId, "Other Project");

      await assertRejectsWithCode(() => pm.open(otherProject.id), "PROJECT_NOT_IN_ACTIVE_COLLECTION");
    });

    it("throws when opening tombstoned projects or projects in tombstoned collections", async () => {
      await pm.init();
      const local = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Local");
      const otherCollection = await memStore.createProjectCollection("Other");
      const otherProject = await memStore.createProject(otherCollection.projectCollectionId, "Other Project");

      await memStore.deleteProject(local.id);
      await memStore.deleteProjectCollection(otherCollection.projectCollectionId);

      await assertRejectsWithCode(() => pm.open(local.id), "PROJECT_NOT_FOUND");
      await assertRejectsWithCode(() => pm.open(otherProject.id), "PROJECT_NOT_FOUND");
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
      const b = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "B");
      await pm.delete(b.id);
      const projects = await pm.listProjects();
      assert.strictEqual(projects.length, 1);
      assert.strictEqual(projects[0].id, a.id);
    });

    it("throws when deleting the active project", async () => {
      await pm.create("Active");
      await assertRejectsWithCode(() => pm.delete(pm.activeProject!.manifest.id), "ACTIVE_PROJECT_DELETE_BLOCKED");
    });

    it("fires project list listener", async () => {
      await pm.create("A");
      const b = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "B");
      const calls: number[] = [];
      pm.onProjectListChange((projects) => calls.push(projects.length));
      await pm.delete(b.id);
      assert.deepStrictEqual(calls, [1]);
    });

    it("rejects deleting projects from another project collection", async () => {
      await pm.init();
      const otherCollection = await memStore.createProjectCollection("Other");
      const otherProject = await memStore.createProject(otherCollection.projectCollectionId, "Other Project");

      await assertRejectsWithCode(() => pm.delete(otherProject.id), "PROJECT_NOT_IN_ACTIVE_COLLECTION");
    });
  });

  describe("duplicate", () => {
    it("duplicates projects only in the active project collection", async () => {
      const source = await pm.create("Source");
      const copy = await pm.duplicate(source.id, "Copy");

      assert.strictEqual(copy.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual((await pm.listProjects()).length, 2);
    });

    it("rejects duplicating a project from another project collection", async () => {
      await pm.init();
      const otherCollection = await memStore.createProjectCollection("Other");
      const otherProject = await memStore.createProject(otherCollection.projectCollectionId, "Other Project");

      await assertRejectsWithCode(() => pm.duplicate(otherProject.id, "Copy"), "PROJECT_NOT_IN_ACTIVE_COLLECTION");
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
      await assertRejectsWithCode(() => pm.updateActive({ name: "Nope" }), "NO_ACTIVE_PROJECT");
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
      await assertRejectsWithCode(() => pm.saveAppData("key1", "value1"), "NO_ACTIVE_PROJECT");
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
      await memStore.ensureDefaultProjectCollection();
      const manifest = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Persisted");
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

  describe("project collection state", () => {
    it("subscribes without replaying current state", async () => {
      await pm.init();
      const calls: ProjectCollectionState[] = [];
      pm.onProjectCollectionStateChange((state) => calls.push(state));

      assert.strictEqual(calls.length, 0);

      const initial = await pm.getProjectCollectionState();
      assert.strictEqual(initial.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(initial.access, "ready");

      await pm.createProjectCollection("Later");
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].projectCollections.length, 2);
    });

    it("keeps listeners attached across init reruns", async () => {
      await pm.init();
      const calls: ProjectCollectionState[] = [];
      pm.onProjectCollectionStateChange((state) => calls.push(state));

      await pm.init();
      await pm.createProjectCollection("Still Attached");

      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(calls[1].projectCollections.length, 2);
    });

    it("emits state after active project open and close", async () => {
      await pm.init();
      const calls: ProjectCollectionState[] = [];
      pm.onProjectCollectionStateChange((state) => calls.push(state));

      const manifest = await pm.create("Tracked");
      await pm.close();

      assert.strictEqual(
        calls.some((state) => state.activeProjectId === manifest.id),
        true
      );
      assert.strictEqual(calls.at(-1)?.activeProjectId, undefined);
    });
  });

  describe("project collection management", () => {
    it("lists, creates, and renames project collections", async () => {
      await pm.init();
      const created = await pm.createProjectCollection("  Workspace A  ");
      await pm.renameProjectCollection(created.projectCollectionId, "  Workspace B  ");

      const collections = await pm.listProjectCollections();
      assert.deepStrictEqual(collections.map((collection) => collection.name).sort(), [
        "Default Workspace",
        "Workspace B",
      ]);
    });

    it("rejects invalid project collection names", async () => {
      await pm.init();
      const collection = await pm.createProjectCollection("Valid");
      const tooLong = "x".repeat(PROJECT_COLLECTION_NAME_MAX_LENGTH + 1);

      await assertRejectsWithCode(() => pm.createProjectCollection("   "), "INVALID_PROJECT_COLLECTION_NAME");
      await assertRejectsWithCode(() => pm.createProjectCollection(tooLong), "INVALID_PROJECT_COLLECTION_NAME");
      await assertRejectsWithCode(
        () => pm.renameProjectCollection(collection.projectCollectionId, ""),
        "INVALID_PROJECT_COLLECTION_NAME"
      );
      await assertRejectsWithCode(
        () => pm.renameProjectCollection(collection.projectCollectionId, tooLong),
        "INVALID_PROJECT_COLLECTION_NAME"
      );
      assert.strictEqual(
        (await pm.listProjectCollections()).find(
          (entry) => entry.projectCollectionId === collection.projectCollectionId
        )?.name,
        "Valid"
      );
    });

    it("switches project collections, flushes the current project, and opens an existing target project", async () => {
      const source = await pm.create("Source");
      pm.activeProject?.filesystem.applyLocalChange({
        action: "write",
        path: "src/main.ts",
        content: "saved",
        newEtag: "etag-1",
      });
      const targetCollection = await pm.createProjectCollection("Target");
      const targetProject = await memStore.createProject(targetCollection.projectCollectionId, "Target Project");
      const stateCalls: ProjectCollectionState[] = [];
      pm.onProjectCollectionStateChange((state) => stateCalls.push(state));

      const result = await pm.switchProjectCollection(targetCollection.projectCollectionId);

      assert.strictEqual(result.collection.projectCollectionId, targetCollection.projectCollectionId);
      assert.strictEqual(result.access, "ready");
      assert.strictEqual(stateCalls.length, 1);
      assert.strictEqual(
        stateCalls[0].activeProjectCollection?.projectCollectionId,
        targetCollection.projectCollectionId
      );
      assert.strictEqual(stateCalls[0].activeProjectId, targetProject.id);
      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, targetCollection.projectCollectionId);
      assert.strictEqual(pm.activeProject?.manifest.id, targetProject.id);
      const savedEntry = (await memStore.loadProjectFiles(source.id))?.get("src/main.ts");
      assert.ok(savedEntry && savedEntry.kind === "file");
      assert.strictEqual(savedEntry.content, "saved");
    });

    it("creates a default project when switching to an empty project collection", async () => {
      await pm.init();
      const targetCollection = await pm.createProjectCollection("Empty");

      await pm.switchProjectCollection(targetCollection.projectCollectionId);

      assert.strictEqual(pm.activeProject?.manifest.projectCollectionId, targetCollection.projectCollectionId);
      assert.strictEqual(pm.activeProject?.manifest.name, DEFAULT_PROJECT_NAME);
    });

    it("rejects switching to missing or tombstoned project collections without changing active collection", async () => {
      await pm.init();
      const targetCollection = await pm.createProjectCollection("Gone");
      await memStore.deleteProjectCollection(targetCollection.projectCollectionId);

      await assertRejectsWithCode(() => pm.switchProjectCollection("missing"), "PROJECT_COLLECTION_NOT_FOUND");
      await assertRejectsWithCode(
        () => pm.switchProjectCollection(targetCollection.projectCollectionId),
        "PROJECT_COLLECTION_NOT_FOUND"
      );
      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
    });

    it("blocks deleting the active collection and the default collection", async () => {
      await pm.init();
      const targetCollection = await pm.createProjectCollection("Target");
      await pm.switchProjectCollection(targetCollection.projectCollectionId);

      await assertRejectsWithCode(
        () => pm.deleteProjectCollection(targetCollection.projectCollectionId),
        "ACTIVE_PROJECT_COLLECTION_DELETE_BLOCKED"
      );
      await assertRejectsWithCode(
        () => pm.deleteProjectCollection(DEFAULT_PROJECT_COLLECTION_ID),
        "DEFAULT_PROJECT_COLLECTION_DELETE_BLOCKED"
      );
    });

    it("deletes non-active collections by tombstoning the collection and its projects", async () => {
      await pm.init();
      const targetCollection = await pm.createProjectCollection("Archive");
      const project = await memStore.createProject(targetCollection.projectCollectionId, "Archived Project");

      await pm.deleteProjectCollection(targetCollection.projectCollectionId);

      assert.strictEqual(await memStore.getProjectCollection(targetCollection.projectCollectionId), undefined);
      assert.strictEqual(await memStore.getProject(project.id), undefined);
      assert.strictEqual(
        (await pm.listProjectCollections()).some(
          (collection) => collection.projectCollectionId === targetCollection.projectCollectionId
        ),
        false
      );
    });
  });
});
