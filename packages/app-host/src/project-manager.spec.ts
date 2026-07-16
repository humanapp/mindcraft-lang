import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  AppHostErrorCode,
  createProjectCollectionPinVerifier,
  DEFAULT_PROJECT_COLLECTION_ID,
  DEFAULT_PROJECT_NAME,
  diffMindcraftJsonToManifest,
  normalizeProjectCollectionPin,
  PROJECT_COLLECTION_NAME_MAX_LENGTH,
  type ProjectCollection,
  type ProjectCollectionEvent,
  type ProjectCollectionReloadUnlock,
  type ProjectCollectionState,
  type ProjectCollectionSummaryChange,
  type ProjectCollectionTabSession,
  type ProjectFileChange,
  type ProjectFileSnapshot,
  ProjectManager,
  type ProjectManifest,
  type ProjectPersistenceError,
  RELOAD_UNLOCK_REFRESH_INTERVAL_MS,
  RELOAD_UNLOCK_TTL_MS,
  serializeProjectContentManifest,
  verifyProjectCollectionPin,
} from "@mindcraft-lang/app-host";
import { logger } from "@mindcraft-lang/core";
import { createProjectCollectionBroadcast } from "./project-collection-broadcast.js";
import { assertRejectsWithCode } from "./test-support/error-assertions.js";
import { MemoryProjectStore } from "./test-support/memory-project-store.js";

describe("ProjectManager", () => {
  let memStore: MemoryProjectStore;
  let pm: ProjectManager;
  const originalBroadcastChannel: typeof BroadcastChannel | undefined = globalThis.BroadcastChannel;
  const originalSessionStorage: Storage | undefined = globalThis.sessionStorage;

  beforeEach(() => {
    installTestBroadcastChannel();
    memStore = new MemoryProjectStore();
    pm = new ProjectManager(memStore);
  });

  afterEach(async () => {
    await pm.close();
    pm.dispose();
    restoreBroadcastChannel(originalBroadcastChannel);
    restoreStorage("sessionStorage", originalSessionStorage);
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
      fresh.dispose();
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

  describe("default extensions", () => {
    it("seeds the host default extensions into a newly created project's manifest", async () => {
      const defaults = { "mindcraft-lang/codal": "embedded:mindcraft-lang/codal" };
      const withDefaults = new ProjectManager(memStore, { defaultExtensions: defaults });
      try {
        const manifest = await withDefaults.create("Seeded");
        assert.deepStrictEqual(manifest.extensions, defaults);
        const stored = await memStore.getProject(manifest.id);
        assert.deepStrictEqual(stored?.extensions, defaults);
      } finally {
        await withDefaults.close();
        withDefaults.dispose();
      }
    });

    it("creates a project with no extensions when the host designates none", async () => {
      const manifest = await pm.create("Plain");
      assert.strictEqual(manifest.extensions, undefined);
    });

    it("treats an empty default set as no defaults", async () => {
      const withEmpty = new ProjectManager(memStore, { defaultExtensions: {} });
      try {
        const manifest = await withEmpty.create("Empty");
        assert.strictEqual(manifest.extensions, undefined);
      } finally {
        await withEmpty.close();
        withEmpty.dispose();
      }
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
      await assertRejectsWithCode(() => pm.open("ghost"), AppHostErrorCode.PROJECT_NOT_FOUND);
    });

    it("throws when opening a project from another project collection", async () => {
      await pm.init();
      const otherCollection = await memStore.createProjectCollection("Other");
      const otherProject = await memStore.createProject(otherCollection.projectCollectionId, "Other Project");

      await assertRejectsWithCode(() => pm.open(otherProject.id), AppHostErrorCode.PROJECT_NOT_IN_ACTIVE_COLLECTION);
    });

    it("throws when opening tombstoned projects or projects in tombstoned collections", async () => {
      await pm.init();
      const local = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Local");
      const otherCollection = await memStore.createProjectCollection("Other");
      const otherProject = await memStore.createProject(otherCollection.projectCollectionId, "Other Project");

      await memStore.deleteProject(local.id);
      await memStore.deleteProjectCollection(otherCollection.projectCollectionId);

      await assertRejectsWithCode(() => pm.open(local.id), AppHostErrorCode.PROJECT_NOT_FOUND);
      await assertRejectsWithCode(() => pm.open(otherProject.id), AppHostErrorCode.PROJECT_NOT_FOUND);
    });

    it("fires active project listener on open and close", async () => {
      const calls: Array<string | undefined> = [];
      pm.onActiveProjectChange((p) => calls.push(p?.manifest.name));
      await pm.create("Watched");
      await pm.close();
      assert.deepStrictEqual(calls, ["Watched", undefined]);
    });

    it("calls beforeActiveProjectChange after reserving the target and before replacing the current project", async () => {
      const source = await pm.create("Source");
      const target = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Target");
      let callbackCount = 0;

      await pm.open(target.id, {
        beforeActiveProjectChange: () => {
          callbackCount++;
          assert.strictEqual(pm.activeProject?.manifest.id, source.id);
        },
      });

      assert.strictEqual(callbackCount, 1);
      assert.strictEqual(pm.activeProject?.manifest.id, target.id);
    });

    it("does not call beforeActiveProjectChange when target project locking fails", async () => {
      const lock = new MemoryProjectLock();
      await pm.close();
      pm.dispose();
      pm = new ProjectManager(memStore, { lock });
      const tabB = new ProjectManager(memStore.cloneForNewTab(), { lock });
      const source = await pm.create("Source");
      const target = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Target");
      await tabB.init();
      await tabB.open(target.id);
      let callbackCount = 0;

      await assertRejectsWithCode(
        () =>
          pm.open(target.id, {
            beforeActiveProjectChange: () => {
              callbackCount++;
            },
          }),
        AppHostErrorCode.PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB
      );

      assert.strictEqual(callbackCount, 0);
      assert.strictEqual(pm.activeProject?.manifest.id, source.id);
      await tabB.close();
      tabB.dispose();
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
      await assertRejectsWithCode(
        () => pm.delete(pm.activeProject!.manifest.id),
        AppHostErrorCode.ACTIVE_PROJECT_DELETE_BLOCKED
      );
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

      await assertRejectsWithCode(() => pm.delete(otherProject.id), AppHostErrorCode.PROJECT_NOT_IN_ACTIVE_COLLECTION);
    });
  });

  describe("duplicate", () => {
    it("duplicates projects only in the active project collection", async () => {
      const source = await pm.create("Source");
      await memStore.updateProject(source.id, {
        description: "source description",
        thumbnailUrl: "data:image/png;base64,source",
      });
      await memStore.saveProjectFiles(
        source.id,
        new Map([["src/main.ts", { kind: "file", content: "source", etag: "etag-1", isReadonly: false }]])
      );
      await memStore.saveAppData(source.id, "brains", '{"source":true}');
      const copy = await pm.duplicate(source.id, "Copy");

      assert.strictEqual(copy.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(copy.description, "source description");
      assert.strictEqual(copy.thumbnailUrl, "data:image/png;base64,source");
      assert.strictEqual((await memStore.loadProjectFiles(copy.id))?.get("src/main.ts")?.kind, "file");
      assert.strictEqual(await memStore.loadAppData(copy.id, "brains"), '{"source":true}');
      assert.strictEqual((await pm.listProjects()).length, 2);
    });

    it("rejects duplicating a project from another project collection", async () => {
      await pm.init();
      const otherCollection = await memStore.createProjectCollection("Other");
      const otherProject = await memStore.createProject(otherCollection.projectCollectionId, "Other Project");

      await assertRejectsWithCode(
        () => pm.duplicate(otherProject.id, "Copy"),
        AppHostErrorCode.PROJECT_NOT_IN_ACTIVE_COLLECTION
      );
    });
  });

  describe("copyProjectToCollection", () => {
    it("copies project content to another collection without copying local metadata or active session", async () => {
      const source = await pm.create("Source");
      await memStore.updateProject(source.id, {
        description: "source description",
        thumbnailUrl: "data:image/png;base64,source",
      });
      await memStore.saveProjectFiles(
        source.id,
        new Map([["src/main.ts", { kind: "file", content: "source", etag: "etag-1", isReadonly: false }]])
      );
      await memStore.saveAppData(source.id, "brains", '{"source":true}');
      const targetCollection = await pm.createProjectCollection("Target");
      const sessionBefore = memStore.getProjectSession();

      const copy = await pm.copyProjectToCollection(source.id, targetCollection.projectCollectionId, "Remix");

      assert.strictEqual(copy.name, "Remix");
      assert.strictEqual(copy.description, "source description");
      assert.strictEqual(copy.thumbnailUrl, "data:image/png;base64,source");
      assert.strictEqual(copy.projectCollectionId, targetCollection.projectCollectionId);
      assert.strictEqual(copy.deleted, undefined);
      assert.notStrictEqual(copy.id, source.id);
      assert.strictEqual((await memStore.loadProjectFiles(copy.id))?.get("src/main.ts")?.kind, "file");
      assert.strictEqual(await memStore.loadAppData(copy.id, "brains"), '{"source":true}');
      assert.deepStrictEqual(memStore.getProjectSession(), sessionBefore);
      assert.strictEqual(pm.activeProject?.manifest.id, source.id);
      assert.deepStrictEqual(
        (await pm.listProjectsForCollection(targetCollection.projectCollectionId)).map((project) => project.id),
        [copy.id]
      );
    });

    it("requires unlocked source and target project collections", async () => {
      await pm.init();
      const sourceCollection = await pm.createProjectCollection("Source Protected");
      const source = await memStore.createProject(sourceCollection.projectCollectionId, "Source");
      const targetCollection = await pm.createProjectCollection("Target Protected");
      await pm.setProjectCollectionPin(sourceCollection.projectCollectionId, "1234");
      await pm.lockProjectCollection(sourceCollection.projectCollectionId);

      await assertRejectsWithCode(
        () => pm.copyProjectToCollection(source.id, targetCollection.projectCollectionId, "Copy"),
        AppHostErrorCode.PROJECT_COLLECTION_LOCKED
      );
      assert.deepStrictEqual(await memStore.listProjects(targetCollection.projectCollectionId), []);

      await pm.unlockProjectCollection(sourceCollection.projectCollectionId, "1234");
      await pm.setProjectCollectionPin(targetCollection.projectCollectionId, "5678");
      await pm.lockProjectCollection(targetCollection.projectCollectionId);

      await assertRejectsWithCode(
        () => pm.copyProjectToCollection(source.id, targetCollection.projectCollectionId, "Copy"),
        AppHostErrorCode.PROJECT_COLLECTION_LOCKED
      );
      assert.deepStrictEqual(await memStore.listProjects(targetCollection.projectCollectionId), []);
    });

    it("rejects missing or tombstoned source projects without writing to the target collection", async () => {
      await pm.init();
      const targetCollection = await pm.createProjectCollection("Target");
      await assertRejectsWithCode(
        () => pm.copyProjectToCollection("missing", targetCollection.projectCollectionId, "Copy"),
        AppHostErrorCode.PROJECT_NOT_FOUND
      );

      const source = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Source");
      await memStore.deleteProject(source.id);
      await assertRejectsWithCode(
        () => pm.copyProjectToCollection(source.id, targetCollection.projectCollectionId, "Copy"),
        AppHostErrorCode.PROJECT_NOT_FOUND
      );
      assert.deepStrictEqual(await memStore.listProjects(targetCollection.projectCollectionId), []);
    });

    it("rejects missing or tombstoned target project collections without writing a copy", async () => {
      const source = await pm.create("Source");
      const targetCollection = await pm.createProjectCollection("Target");
      await memStore.deleteProjectCollection(targetCollection.projectCollectionId);

      await assertRejectsWithCode(
        () => pm.copyProjectToCollection(source.id, "missing", "Copy"),
        AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
      );
      await assertRejectsWithCode(
        () => pm.copyProjectToCollection(source.id, targetCollection.projectCollectionId, "Copy"),
        AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
      );
      assert.deepStrictEqual(
        (await memStore.listProjects(DEFAULT_PROJECT_COLLECTION_ID)).map((project) => project.id),
        [source.id]
      );
    });

    it("rejects unavailable source project collections without writing to the target collection", async () => {
      await pm.close();
      pm.dispose();
      const store = new MissingProjectCollectionStore();
      memStore = store;
      pm = new ProjectManager(store);
      await pm.init();
      const sourceCollection = await pm.createProjectCollection("Source");
      const source = await memStore.createProject(sourceCollection.projectCollectionId, "Source");
      const targetCollection = await pm.createProjectCollection("Target");
      store.unavailableProject = source;
      store.unavailableProjectCollectionId = sourceCollection.projectCollectionId;

      await assertRejectsWithCode(
        () => pm.copyProjectToCollection(source.id, targetCollection.projectCollectionId, "Copy"),
        AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
      );
      assert.deepStrictEqual(await memStore.listProjects(targetCollection.projectCollectionId), []);
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

    it("applies a mindcraft.json version edit through to the store", async () => {
      await pm.create("Versioned");
      const active = pm.activeProject!.manifest;
      const content = serializeProjectContentManifest({ name: active.name, version: "2.3.4", extensions: {} });
      const patch = diffMindcraftJsonToManifest(content, active);
      assert.ok(patch);
      await pm.updateActive(patch);
      assert.strictEqual(pm.activeProject?.manifest.version, "2.3.4");
      const [stored] = await memStore.listProjects(DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(stored.version, "2.3.4");
    });

    it("does not downgrade the stored version when mindcraft.json omits it", async () => {
      await pm.create("Versioned");
      const active = pm.activeProject!.manifest;
      const originalVersion = active.version;
      const content = JSON.stringify({ name: active.name, description: active.description });
      const patch = diffMindcraftJsonToManifest(content, active);
      if (patch) {
        await pm.updateActive(patch);
      }
      const [stored] = await memStore.listProjects(DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(stored.version, originalVersion);
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
      await assertRejectsWithCode(() => pm.updateActive({ name: "Nope" }), AppHostErrorCode.NO_ACTIVE_PROJECT);
    });

    it("recovers active state before rethrowing stale active project write errors", async () => {
      const active = await pm.create("Active");
      const states: ProjectCollectionState[] = [];
      pm.onProjectCollectionStateChange((state) => states.push(state));

      await memStore.deleteProject(active.id);
      await assertRejectsWithCode(() => pm.updateActive({ name: "Renamed" }), AppHostErrorCode.PROJECT_NOT_FOUND);

      assert.notStrictEqual(pm.activeProject?.manifest.id, active.id);
      assert.strictEqual(pm.activeProject?.manifest.name, DEFAULT_PROJECT_NAME);
      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(states.at(-1)?.activeProjectId, pm.activeProject?.manifest.id);
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
      await assertRejectsWithCode(() => pm.saveAppData("key1", "value1"), AppHostErrorCode.NO_ACTIVE_PROJECT);
    });

    it("recovers active state before rethrowing stale active project app data write errors", async () => {
      const active = await pm.create("Data Project");
      const states: ProjectCollectionState[] = [];
      pm.onProjectCollectionStateChange((state) => states.push(state));

      await memStore.deleteProject(active.id);
      await assertRejectsWithCode(() => pm.saveAppData("key1", "value1"), AppHostErrorCode.PROJECT_NOT_FOUND);

      assert.notStrictEqual(pm.activeProject?.manifest.id, active.id);
      assert.strictEqual(pm.activeProject?.manifest.name, DEFAULT_PROJECT_NAME);
      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(states.at(-1)?.activeProjectId, pm.activeProject?.manifest.id);
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
      memStore.setProjectSession({
        projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
        activeProjectId: manifest.id,
      });

      const restored = new ProjectManager(memStore);
      await restored.init();
      assert.strictEqual(restored.activeProject?.manifest.name, "Persisted");
      await restored.close();
      restored.dispose();
    });

    it("does not rewrite an unchanged tab session on re-init", async () => {
      const countingStore = new CountingProjectSessionStore();
      const manager = new ProjectManager(countingStore);
      await manager.init();
      await manager.ensureDefaultProject(DEFAULT_PROJECT_NAME);
      const writeCount = countingStore.projectSessionWriteCount;

      await manager.init();

      assert.strictEqual(countingStore.projectSessionWriteCount, writeCount);
      await manager.close();
      manager.dispose();
    });

    it("falls back when the session project is stale", async () => {
      memStore.setProjectSession({
        projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
        activeProjectId: "deleted-id",
      });
      const restored = new ProjectManager(memStore);
      await restored.init();
      assert.strictEqual(restored.activeProject?.manifest.name, DEFAULT_PROJECT_NAME);
      await restored.close();
      restored.dispose();
    });

    it("falls back when the session project collection is stale", async () => {
      const defaultProject = await pm.create("Default Project");
      await pm.close();

      memStore.setProjectSession({
        projectCollectionId: "deleted-collection",
        activeProjectId: "deleted-id",
      });
      const restored = new ProjectManager(memStore);
      await restored.init();

      assert.strictEqual(restored.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(restored.activeProject?.manifest.id, defaultProject.id);
      await restored.close();
      restored.dispose();
    });

    it("restores recently autosaved project files without a manual save boundary", async () => {
      const fastStore = new MemoryProjectStore();
      const first = new ProjectManager(fastStore, { autoSaveDelayMs: 0 });
      await first.create("Autosaved");
      first.activeProject?.filesystem.applyLocalChange({
        action: "write",
        path: "src/main.ts",
        content: "autosaved",
        newEtag: "etag-1",
      });
      await waitForTimers();

      const restored = new ProjectManager(fastStore);
      await restored.init();

      const entry = restored.activeProject?.filesystem.exportSnapshot().get("src/main.ts");
      assert.ok(entry && entry.kind === "file");
      assert.strictEqual(entry.content, "autosaved");
      await first.close();
      await restored.close();
      first.dispose();
      restored.dispose();
    });

    it("autosaves local-only edits through the change-granular store write path", async () => {
      const countingStore = new CountingFileWriteStore();
      const manager = new ProjectManager(countingStore, { autoSaveDelayMs: 0 });
      try {
        await manager.create("Change Granular");
        countingStore.saveProjectFilesCount = 0;
        countingStore.appliedChangeBatches.length = 0;
        manager.activeProject?.filesystem.applyLocalChange({
          action: "write",
          path: "src/a.ts",
          content: "a",
          newEtag: "etag-a",
        });
        manager.activeProject?.filesystem.applyLocalChange({
          action: "write",
          path: "src/b.ts",
          content: "b",
          newEtag: "etag-b",
        });
        await waitForTimers();

        assert.strictEqual(countingStore.saveProjectFilesCount, 0);
        assert.strictEqual(countingStore.appliedChangeBatches.length, 1);
        assert.deepStrictEqual(
          countingStore.appliedChangeBatches[0].map((change) => (change.action === "write" ? change.path : "")),
          ["src/a.ts", "src/b.ts"]
        );
        const saved = await countingStore.loadProjectFiles(manager.activeProject!.manifest.id);
        const entry = saved?.get("src/b.ts");
        assert.ok(entry && entry.kind === "file");
        assert.strictEqual(entry.content, "b");
      } finally {
        await manager.close();
        manager.dispose();
      }
    });

    it("autosaves with a whole-snapshot store write when a remote change arrived", async () => {
      const countingStore = new CountingFileWriteStore();
      const manager = new ProjectManager(countingStore, { autoSaveDelayMs: 0 });
      try {
        await manager.create("Remote Fallback");
        countingStore.saveProjectFilesCount = 0;
        countingStore.appliedChangeBatches.length = 0;
        manager.activeProject?.filesystem.applyLocalChange({
          action: "write",
          path: "src/local.ts",
          content: "local",
          newEtag: "etag-local",
        });
        manager.activeProject?.filesystem.applyRemoteChange({
          action: "write",
          path: "src/remote.ts",
          content: "remote",
          newEtag: "etag-remote",
        });
        await waitForTimers();

        assert.strictEqual(countingStore.saveProjectFilesCount, 1);
        assert.strictEqual(countingStore.appliedChangeBatches.length, 0);
        const saved = await countingStore.loadProjectFiles(manager.activeProject!.manifest.id);
        assert.ok(saved?.has("src/local.ts"));
        assert.ok(saved?.has("src/remote.ts"));
      } finally {
        await manager.close();
        manager.dispose();
      }
    });

    it("emits onProjectPersistenceError and logs non-tombstone autosave failures", async () => {
      const failingStore = new FailingSaveProjectStore();
      const manager = new ProjectManager(failingStore, { autoSaveDelayMs: 0 });
      const persistenceErrors: ProjectPersistenceError[] = [];
      const loggerErrors: unknown[][] = [];
      const originalLoggerError = logger.error.bind(logger);
      logger.error = (message: string, data?: unknown) => {
        loggerErrors.push([message, data]);
      };

      try {
        const manifest = await manager.create("Autosave Failure");
        failingStore.failProjectFileSaves = true;
        manager.activeProject?.filesystem.applyLocalChange({
          action: "write",
          path: "src/main.ts",
          content: "not persisted",
          newEtag: "etag-1",
        });
        manager.onProjectPersistenceError((error) => {
          persistenceErrors.push(error);
        });

        await waitForTimers();

        assert.strictEqual(persistenceErrors.length, 1);
        assert.strictEqual(persistenceErrors[0].operation, "autosave");
        assert.strictEqual(persistenceErrors[0].projectCollectionId, manifest.projectCollectionId);
        assert.strictEqual(persistenceErrors[0].projectId, manifest.id);
        assert.strictEqual((persistenceErrors[0].error as Error).message, "autosave failed");
        assert.strictEqual(loggerErrors.length, 1);
        assert.strictEqual(loggerErrors[0][0], "[app-host] project autosave failed");
      } finally {
        logger.error = originalLoggerError;
        failingStore.failProjectFileSaves = false;
        await manager.close();
        manager.dispose();
      }
    });

    it("uses stale-project recovery without logging tombstone autosave failures", async () => {
      const fastStore = new MemoryProjectStore();
      const manager = new ProjectManager(fastStore, { autoSaveDelayMs: 0 });
      const persistenceErrors: ProjectPersistenceError[] = [];
      const loggerErrors: unknown[][] = [];
      const originalLoggerError = logger.error.bind(logger);
      logger.error = (message: string, data?: unknown) => {
        loggerErrors.push([message, data]);
      };

      try {
        const active = await manager.ensureDefaultProject(DEFAULT_PROJECT_NAME);
        manager.onProjectPersistenceError((error) => {
          persistenceErrors.push(error);
        });
        await fastStore.deleteProject(active.manifest.id);
        manager.activeProject?.filesystem.applyLocalChange({
          action: "write",
          path: "src/main.ts",
          content: "stale",
          newEtag: "etag-1",
        });

        await waitForTimers();

        assert.strictEqual(persistenceErrors.length, 0);
        assert.strictEqual(loggerErrors.length, 0);
        assert.notStrictEqual(manager.activeProject?.manifest.id, active.manifest.id);
        assert.strictEqual(manager.activeProject?.manifest.name, DEFAULT_PROJECT_NAME);
      } finally {
        logger.error = originalLoggerError;
        await manager.close();
        manager.dispose();
      }
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

  describe("project collection UI data APIs", () => {
    it("watches committed project collection state with an initial value", async () => {
      await pm.init();
      const calls: ProjectCollectionState[] = [];

      const subscription = await pm.watchProjectCollectionState((state) => calls.push(state));

      assert.strictEqual(
        subscription.initial.activeProjectCollection?.projectCollectionId,
        DEFAULT_PROJECT_COLLECTION_ID
      );
      assert.strictEqual(calls.length, 0);

      await pm.createProjectCollection("Later");
      assert.strictEqual(calls.length, 1);
      subscription.unsubscribe();

      await pm.createProjectCollection("After Unsubscribe");
      assert.strictEqual(calls.length, 1);
    });

    it("returns initial workspace summaries with project counts and emits targeted patches", async () => {
      await pm.init();
      await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Default A");
      const otherCollection = await pm.createProjectCollection("Other");
      await memStore.createProject(otherCollection.projectCollectionId, "Other A");
      await memStore.createProject(otherCollection.projectCollectionId, "Other B");
      const changes: ProjectCollectionSummaryChange[] = [];

      const subscription = await pm.watchProjectCollectionSummaries((change) => changes.push(change));
      const initialSummaryCounts = subscription.initial.map((summary): [string, number] => [
        summary.collection.projectCollectionId,
        summary.projectCount,
      ]);
      const expectedSummaryCounts: Array<[string, number]> = [
        [DEFAULT_PROJECT_COLLECTION_ID, 1],
        [otherCollection.projectCollectionId, 2],
      ];

      assert.deepStrictEqual(
        initialSummaryCounts.sort((left, right) => left[0].localeCompare(right[0])),
        expectedSummaryCounts.sort((left, right) => left[0].localeCompare(right[0]))
      );

      const createdCollection = await pm.createProjectCollection("Created");
      const createChange = changes.at(-1);
      if (createChange?.type !== "upsert") {
        assert.fail("Expected project collection summary upsert");
      }
      assert.strictEqual(createChange.summary.collection.projectCollectionId, createdCollection.projectCollectionId);
      assert.strictEqual(createChange.summary.projectCount, 0);

      await pm.deleteProjectCollection(createdCollection.projectCollectionId);
      assert.deepStrictEqual(changes.at(-1), {
        type: "remove",
        projectCollectionId: createdCollection.projectCollectionId,
      });
      subscription.unsubscribe();
    });

    it("broadcasts project collection creates and renames to summary watchers in other managers", async () => {
      await pm.init();
      const tabB = new ProjectManager(memStore.cloneForNewTab());
      await tabB.init();
      const changes: ProjectCollectionSummaryChange[] = [];
      const subscription = await tabB.watchProjectCollectionSummaries((change) => changes.push(change));

      const createdCollection = await pm.createProjectCollection("Created");
      await waitForTimers();

      const createChange = changes.at(-1);
      if (createChange?.type !== "upsert") {
        assert.fail("Expected cross-tab project collection create upsert");
      }
      assert.strictEqual(createChange.summary.collection.projectCollectionId, createdCollection.projectCollectionId);
      assert.strictEqual(createChange.summary.collection.name, "Created");

      await pm.renameProjectCollection(createdCollection.projectCollectionId, "Renamed");
      await waitForTimers();

      const renameChange = changes.at(-1);
      if (renameChange?.type !== "upsert") {
        assert.fail("Expected cross-tab project collection rename upsert");
      }
      assert.strictEqual(renameChange.summary.collection.projectCollectionId, createdCollection.projectCollectionId);
      assert.strictEqual(renameChange.summary.collection.name, "Renamed");
      subscription.unsubscribe();
      await tabB.close();
      tabB.dispose();
    });

    it("buffers summary changes until after initial summaries resolve", async () => {
      const store = new DelayedSummaryCountStore();
      const manager = new ProjectManager(store);
      await manager.init();
      const changes: ProjectCollectionSummaryChange[] = [];

      const pendingSubscription = manager.watchProjectCollectionSummaries((change) => changes.push(change));
      await manager.create("Buffered Project");

      assert.strictEqual(changes.length, 0);
      store.resolveCountProjectsByCollection();
      const subscription = await pendingSubscription;
      assert.strictEqual(changes.length, 0);
      await waitForTimers();

      assert.strictEqual(
        subscription.initial.find((summary) => summary.collection.projectCollectionId === DEFAULT_PROJECT_COLLECTION_ID)
          ?.projectCount,
        1
      );
      assert.strictEqual(changes.length, 1);
      const change = changes[0];
      if (change.type !== "upsert") {
        assert.fail("Expected buffered summary upsert");
      }
      assert.strictEqual(change.summary.collection.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(change.summary.projectCount, 1);
      subscription.unsubscribe();
      await manager.close();
      manager.dispose();
    });

    it("refreshes only the affected workspace summary after project count changes", async () => {
      const countingStore = new CountingListProjectsStore();
      const manager = new ProjectManager(countingStore);
      await manager.init();
      const otherCollection = await manager.createProjectCollection("Other");
      await countingStore.createProject(otherCollection.projectCollectionId, "Other Project");
      const changes: ProjectCollectionSummaryChange[] = [];
      await manager.watchProjectCollectionSummaries((change) => changes.push(change));
      assert.strictEqual(countingStore.countProjectCalls, 1);
      countingStore.listProjectCalls = [];

      await manager.create("Default Project");

      assert.deepStrictEqual(
        countingStore.listProjectCalls.filter(
          (projectCollectionId) => projectCollectionId === otherCollection.projectCollectionId
        ),
        []
      );
      const projectChange = changes.at(-1);
      if (projectChange?.type !== "upsert") {
        assert.fail("Expected project count summary upsert");
      }
      assert.strictEqual(projectChange.summary.collection.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      await manager.close();
      manager.dispose();
    });

    it("emits one summary patch for local project delete", async () => {
      await pm.init();
      const active = await pm.create("Active");
      const deleted = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Deleted");
      const changes: ProjectCollectionSummaryChange[] = [];
      await pm.watchProjectCollectionSummaries((change) => changes.push(change));
      changes.length = 0;

      await pm.delete(deleted.id);

      assert.strictEqual(pm.activeProject?.manifest.id, active.id);
      assert.strictEqual(changes.length, 1);
      const change = changes[0];
      if (change.type !== "upsert") {
        assert.fail("Expected local project delete summary upsert");
      }
      assert.strictEqual(change.summary.collection.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(change.summary.projectCount, 1);
    });

    it("lists projects for a non-active collection without changing active collection", async () => {
      await pm.init();
      const otherCollection = await pm.createProjectCollection("Other");
      const otherProject = await memStore.createProject(otherCollection.projectCollectionId, "Other Project");

      const projects = await pm.listProjectsForCollection(otherCollection.projectCollectionId);

      assert.deepStrictEqual(
        projects.map((project) => project.id),
        [otherProject.id]
      );
      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      await assertRejectsWithCode(
        () => pm.listProjectsForCollection("missing"),
        AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
      );
    });

    it("watches project lists for non-active collections and refreshes after tombstone broadcasts", async () => {
      await pm.init();
      const otherCollection = await pm.createProjectCollection("Other");
      const otherProject = await memStore.createProject(otherCollection.projectCollectionId, "Other Project");
      const calls: string[][] = [];

      const subscription = await pm.watchProjectListForCollection(otherCollection.projectCollectionId, (projects) => {
        calls.push(projects.map((project) => project.id));
      });
      await memStore.deleteProject(otherProject.id);
      const broadcast = createProjectCollectionBroadcast("test-app");
      broadcast.post({
        type: "project-tombstoned",
        projectCollectionId: otherCollection.projectCollectionId,
        projectId: otherProject.id,
      });
      await waitForTimers();

      assert.deepStrictEqual(
        subscription.initial.map((project) => project.id),
        [otherProject.id]
      );
      assert.deepStrictEqual(calls, [[]]);
      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      subscription.unsubscribe();
      broadcast.close();
    });

    it("handles collection tombstone before stale project tombstone for watched project lists", async () => {
      await pm.init();
      const otherCollection = await pm.createProjectCollection("Other");
      const otherProject = await memStore.createProject(otherCollection.projectCollectionId, "Other Project");
      const calls: string[][] = [];

      const subscription = await pm.watchProjectListForCollection(otherCollection.projectCollectionId, (projects) => {
        calls.push(projects.map((project) => project.id));
      });
      await memStore.deleteProjectCollection(otherCollection.projectCollectionId);
      const broadcast = createProjectCollectionBroadcast("test-app");
      broadcast.post({
        type: "project-collection-tombstoned",
        projectCollectionId: otherCollection.projectCollectionId,
      });
      await waitForTimers();
      broadcast.post({
        type: "project-tombstoned",
        projectCollectionId: otherCollection.projectCollectionId,
        projectId: otherProject.id,
      });
      await waitForTimers();

      assert.deepStrictEqual(
        subscription.initial.map((project) => project.id),
        [otherProject.id]
      );
      assert.deepStrictEqual(calls, [[]]);
      subscription.unsubscribe();
      broadcast.close();
    });

    it("emits low-level project collection events without replay", async () => {
      await pm.init();
      const events: ProjectCollectionEvent[] = [];
      pm.onProjectCollectionEvent((event) => events.push(event));

      const collection = await pm.createProjectCollection("Events");
      await pm.renameProjectCollection(collection.projectCollectionId, "Renamed");
      await pm.deleteProjectCollection(collection.projectCollectionId);

      assert.deepStrictEqual(
        events.map((event) => event.type),
        ["project-collection-changed", "project-collection-changed", "project-collection-tombstoned"]
      );
    });

    it("emits project list change and project tombstone events after local project delete", async () => {
      await pm.init();
      await pm.create("Active");
      const deleted = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Deleted");
      const events: ProjectCollectionEvent[] = [];
      pm.onProjectCollectionEvent((event) => events.push(event));

      await pm.delete(deleted.id);

      assert.deepStrictEqual(events, [
        {
          type: "project-list-changed",
          projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
        },
        {
          type: "project-tombstoned",
          projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
          projectId: deleted.id,
        },
      ]);
    });
  });

  describe("project collection PIN protection", () => {
    it("validates and verifies v1 PIN verifiers without storing raw PINs", async () => {
      const verifier = await createProjectCollectionPinVerifier("  1234  ");

      assert.strictEqual(normalizeProjectCollectionPin("  phrase with spaces  "), "phrase with spaces");
      assert.strictEqual(verifier.scheme, "v1");
      assert.strictEqual(typeof verifier.createdAt, "number");
      assert.notStrictEqual(verifier.hash, "1234");
      assert.strictEqual(await verifyProjectCollectionPin("1234", verifier), true);
      assert.strictEqual(await verifyProjectCollectionPin(" 1234 ", verifier), true);
      assert.strictEqual(await verifyProjectCollectionPin("9999", verifier), false);
      assert.throws(() => normalizeProjectCollectionPin("123"), /Workspace PIN/);
      assert.throws(() => normalizeProjectCollectionPin("ab\ncd"), /Workspace PIN/);
    });

    it("fails clearly when WebCrypto PBKDF2 is unavailable", async () => {
      const originalCrypto = globalThis.crypto;
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        writable: true,
        value: undefined,
      });
      try {
        await assertRejectsWithCode(
          () => createProjectCollectionPinVerifier("1234"),
          AppHostErrorCode.PROJECT_COLLECTION_PIN_CAPABILITY_UNAVAILABLE
        );
      } finally {
        Object.defineProperty(globalThis, "crypto", {
          configurable: true,
          writable: true,
          value: originalCrypto,
        });
      }
    });

    it("reports protected collection access per tab in summaries and state", async () => {
      await pm.init();
      const collection = await pm.createProjectCollection("Protected");
      await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");
      const tabB = new ProjectManager(memStore.cloneForNewTab());

      await tabB.init();
      const tabBSummaries = await tabB.watchProjectCollectionSummaries(() => {});
      assert.strictEqual(
        tabBSummaries.initial.find(
          (summary) => summary.collection.projectCollectionId === collection.projectCollectionId
        )?.access,
        "locked"
      );

      const changes: ProjectCollectionSummaryChange[] = [];
      await tabB.watchProjectCollectionSummaries((change) => changes.push(change));
      await tabB.unlockProjectCollection(collection.projectCollectionId, "1234");

      const change = changes.at(-1);
      if (change?.type !== "upsert") {
        assert.fail("Expected unlock summary upsert");
      }
      assert.strictEqual(change.summary.access, "ready");
      assert.strictEqual(tabB.isProjectCollectionUnlocked(collection.projectCollectionId), true);
      await tabB.close();
      tabB.dispose();
    });

    it("switches to a protected locked collection without opening a project", async () => {
      const source = await pm.create("Source");
      const collection = await pm.createProjectCollection("Protected");
      await memStore.createProject(collection.projectCollectionId, "Hidden");
      await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");
      await pm.lockProjectCollection(collection.projectCollectionId);

      const result = await pm.switchProjectCollection(collection.projectCollectionId);

      assert.strictEqual(result.access, "locked");
      assert.strictEqual(pm.activeProject, undefined);
      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, collection.projectCollectionId);
      assert.strictEqual(memStore.getProjectSession()?.activeProjectId, undefined);
      assert.strictEqual((await memStore.loadProjectFiles(source.id)) !== undefined, true);
      await assertRejectsWithCode(() => pm.listProjects(), AppHostErrorCode.PROJECT_COLLECTION_LOCKED);
    });

    it("rejects open, create, delete, and import-target actions while protected collections are locked", async () => {
      const active = await pm.create("Active");
      const collection = await pm.createProjectCollection("Protected");
      const project = await memStore.createProject(collection.projectCollectionId, "Hidden");
      await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");
      await pm.lockProjectCollection(collection.projectCollectionId);

      await assertRejectsWithCode(
        () => pm.switchProjectCollectionAndOpenProject(collection.projectCollectionId, project.id),
        AppHostErrorCode.PROJECT_COLLECTION_LOCKED
      );
      await assertRejectsWithCode(
        () => pm.switchProjectCollectionAndCreateProject(collection.projectCollectionId, "Nope"),
        AppHostErrorCode.PROJECT_COLLECTION_LOCKED
      );
      await assertRejectsWithCode(
        () => pm.listProjectsForCollection(collection.projectCollectionId),
        AppHostErrorCode.PROJECT_COLLECTION_LOCKED
      );
      await assertRejectsWithCode(
        () => pm.deleteProjectCollection(collection.projectCollectionId),
        AppHostErrorCode.PROJECT_COLLECTION_LOCKED
      );

      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(pm.activeProject?.manifest.id, active.id);
      assert.deepStrictEqual(await memStore.listProjects(collection.projectCollectionId), [project]);
    });

    it("requires unlock before changing or removing a project collection PIN", async () => {
      await pm.init();
      const collection = await pm.createProjectCollection("Protected");
      await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");
      await pm.lockProjectCollection(collection.projectCollectionId);

      await assertRejectsWithCode(
        () => pm.setProjectCollectionPin(collection.projectCollectionId, "5678"),
        AppHostErrorCode.PROJECT_COLLECTION_LOCKED
      );
      await assertRejectsWithCode(
        () => pm.clearProjectCollectionPin(collection.projectCollectionId),
        AppHostErrorCode.PROJECT_COLLECTION_LOCKED
      );

      await pm.unlockProjectCollection(collection.projectCollectionId, "1234");
      const changed = await pm.setProjectCollectionPin(collection.projectCollectionId, "5678");
      assert.strictEqual(await verifyProjectCollectionPin("5678", changed.pinVerifier!), true);
      const cleared = await pm.clearProjectCollectionPin(collection.projectCollectionId);
      assert.strictEqual(cleared.pinVerifier, undefined);
    });

    it("requires unlock before renaming a protected project collection", async () => {
      await pm.init();
      const collection = await pm.createProjectCollection("Protected");
      await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");
      await pm.lockProjectCollection(collection.projectCollectionId);

      await assertRejectsWithCode(
        () => pm.renameProjectCollection(collection.projectCollectionId, "Renamed"),
        AppHostErrorCode.PROJECT_COLLECTION_LOCKED
      );
      assert.strictEqual((await memStore.getProjectCollection(collection.projectCollectionId))?.name, "Protected");

      await pm.unlockProjectCollection(collection.projectCollectionId, "1234");
      await pm.renameProjectCollection(collection.projectCollectionId, "Renamed");
      assert.strictEqual((await memStore.getProjectCollection(collection.projectCollectionId))?.name, "Renamed");
    });

    it("writes reload unlock records only for the current tab session collection", async () => {
      installStorage("sessionStorage");
      await pm.init();
      const activeCollection = pm.activeProjectCollection!;
      const otherCollection = await pm.createProjectCollection("Other");
      await pm.setProjectCollectionPin(activeCollection.projectCollectionId, "1234");
      await pm.setProjectCollectionPin(otherCollection.projectCollectionId, "5678");
      await pm.lockProjectCollection(activeCollection.projectCollectionId);
      await pm.lockProjectCollection(otherCollection.projectCollectionId);

      await pm.unlockProjectCollection(otherCollection.projectCollectionId, "5678");
      assert.strictEqual(readReloadUnlockRecord(memStore), undefined);

      await pm.unlockProjectCollection(activeCollection.projectCollectionId, "1234");
      assert.strictEqual(readReloadUnlockRecord(memStore)?.projectCollectionId, activeCollection.projectCollectionId);

      await pm.lockProjectCollection(activeCollection.projectCollectionId);
      assert.strictEqual(readReloadUnlockRecord(memStore), undefined);
    });

    it("calls beforeActiveProjectChange before closing the active project on lock", async () => {
      const active = await pm.create("Active");
      const activeCollection = pm.activeProjectCollection!;
      await pm.setProjectCollectionPin(activeCollection.projectCollectionId, "1234");
      let callbackCount = 0;

      await pm.lockProjectCollection(activeCollection.projectCollectionId, {
        beforeActiveProjectChange: () => {
          callbackCount++;
          assert.strictEqual(pm.activeProject?.manifest.id, active.id);
        },
      });

      assert.strictEqual(callbackCount, 1);
      assert.strictEqual(pm.activeProject, undefined);
    });

    it("runs one PBKDF2 pass when unlocking with a cloned matching verifier", async () => {
      await pm.close();
      pm.dispose();
      const cloningStore = new CloningProjectCollectionStore();
      memStore = cloningStore;
      pm = new ProjectManager(cloningStore);
      await pm.init();
      const collection = await pm.createProjectCollection("Protected");
      await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");
      await pm.lockProjectCollection(collection.projectCollectionId);
      cloningStore.cloneProjectCollectionsOnRead = true;

      const originalCrypto = globalThis.crypto;
      const originalDeriveBits = originalCrypto.subtle.deriveBits.bind(originalCrypto.subtle);
      let deriveBitsCalls = 0;
      const subtle = {
        importKey: originalCrypto.subtle.importKey.bind(originalCrypto.subtle),
        deriveBits: (...args: Parameters<SubtleCrypto["deriveBits"]>): Promise<ArrayBuffer> => {
          deriveBitsCalls += 1;
          return originalDeriveBits(...args);
        },
      } as unknown as SubtleCrypto;
      const cryptoOverride = Object.create(originalCrypto) as Crypto;
      Object.defineProperty(cryptoOverride, "subtle", {
        configurable: true,
        value: subtle,
      });
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        writable: true,
        value: cryptoOverride,
      });
      try {
        await pm.unlockProjectCollection(collection.projectCollectionId, "1234");
        assert.strictEqual(deriveBitsCalls, 1);
      } finally {
        Object.defineProperty(globalThis, "crypto", {
          configurable: true,
          writable: true,
          value: originalCrypto,
        });
      }
    });

    it("uses unexpired reload unlock records for same-tab restore and ignores expired records", async () => {
      installStorage("sessionStorage");
      const active = await pm.create("Active");
      const collection = pm.activeProjectCollection!;
      await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");

      assert.strictEqual(readReloadUnlockRecord(memStore)?.projectCollectionId, collection.projectCollectionId);
      pm.dispose();
      assert.strictEqual(readReloadUnlockRecord(memStore)?.projectCollectionId, collection.projectCollectionId);
      const restored = new ProjectManager(memStore);
      await restored.init();
      assert.strictEqual(restored.activeProject?.manifest.id, active.id);
      assert.strictEqual((await restored.getProjectCollectionState()).access, "ready");
      await restored.close();
      restored.dispose();

      memStore.setProjectSession({
        projectCollectionId: collection.projectCollectionId,
        activeProjectId: active.id,
      });
      writeReloadUnlockRecord(memStore, {
        projectCollectionId: collection.projectCollectionId,
        expiresAt: Date.now() - 1,
      });
      const expired = new ProjectManager(memStore);
      await expired.init();
      assert.strictEqual(expired.activeProject, undefined);
      assert.strictEqual((await expired.getProjectCollectionState()).access, "locked");
      await expired.close();
      expired.dispose();
    });

    it("ignores reload unlock records for mismatched, deleted, or unprotected collections", async () => {
      installStorage("sessionStorage");
      await pm.create("Active");
      const collection = await pm.createProjectCollection("Protected");
      const active = await memStore.createProject(collection.projectCollectionId, "Protected Active");
      await pm.switchProjectCollectionAndOpenProject(collection.projectCollectionId, active.id);
      await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");

      writeReloadUnlockRecord(memStore, {
        projectCollectionId: "other",
        expiresAt: Date.now() + RELOAD_UNLOCK_TTL_MS,
      });
      const mismatched = new ProjectManager(memStore);
      await mismatched.init();
      assert.strictEqual((await mismatched.getProjectCollectionState()).access, "locked");
      await mismatched.close();
      mismatched.dispose();

      memStore.setProjectSession({
        projectCollectionId: collection.projectCollectionId,
        activeProjectId: active.id,
      });
      await memStore.updateProjectCollection(collection.projectCollectionId, { pinVerifier: undefined });
      writeReloadUnlockRecord(memStore, {
        projectCollectionId: collection.projectCollectionId,
        expiresAt: Date.now() + RELOAD_UNLOCK_TTL_MS,
      });
      const unprotected = new ProjectManager(memStore);
      await unprotected.init();
      assert.strictEqual(unprotected.activeProject?.manifest.id, active.id);
      await unprotected.close();
      unprotected.dispose();

      await memStore.updateProjectCollection(collection.projectCollectionId, {
        pinVerifier: await createProjectCollectionPinVerifier("1234"),
      });
      await memStore.deleteProjectCollection(collection.projectCollectionId);
      pm.dispose();
      pm = new ProjectManager(new MemoryProjectStore());
      const deleted = new ProjectManager(memStore);
      await deleted.init();
      assert.strictEqual(deleted.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      await deleted.close();
      deleted.dispose();
    });

    it("clears protected unlock state and previous reload record on committed switch", async () => {
      installStorage("sessionStorage");
      await pm.init();
      const defaultCollection = pm.activeProjectCollection!;
      const pending = await pm.createProjectCollection("Pending");
      const target = await pm.createProjectCollection("Target");
      await pm.setProjectCollectionPin(defaultCollection.projectCollectionId, "1234");
      await pm.setProjectCollectionPin(pending.projectCollectionId, "5678");
      await pm.unlockProjectCollection(defaultCollection.projectCollectionId, "1234");
      await pm.unlockProjectCollection(pending.projectCollectionId, "5678");
      const changes: ProjectCollectionSummaryChange[] = [];
      await pm.watchProjectCollectionSummaries((change) => changes.push(change));
      changes.length = 0;

      await pm.switchProjectCollection(target.projectCollectionId);
      await waitForTimers();

      assert.strictEqual(pm.isProjectCollectionUnlocked(defaultCollection.projectCollectionId), false);
      assert.strictEqual(pm.isProjectCollectionUnlocked(pending.projectCollectionId), false);
      assert.strictEqual(readReloadUnlockRecord(memStore), undefined);
      const accessByCollection = new Map(
        changes
          .filter((change) => change.type === "upsert")
          .map((change) => [change.summary.collection.projectCollectionId, change.summary.access])
      );
      assert.strictEqual(accessByCollection.get(defaultCollection.projectCollectionId), "locked");
      assert.strictEqual(accessByCollection.get(pending.projectCollectionId), "locked");
    });

    it("refreshes reload unlock records for active protected collections on the refresh timer", async () => {
      installStorage("sessionStorage");
      const intervals = installIntervalCapture();
      const originalDateNow = Date.now;
      try {
        let now = 1_000;
        Date.now = () => now;
        await pm.create("Active");
        const collection = pm.activeProjectCollection!;
        await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");
        const initialRecord = readReloadUnlockRecord(memStore);

        now += RELOAD_UNLOCK_REFRESH_INTERVAL_MS;
        await intervals.runForDelay(RELOAD_UNLOCK_REFRESH_INTERVAL_MS);

        const refreshedRecord = readReloadUnlockRecord(memStore);
        assert.strictEqual(initialRecord?.projectCollectionId, collection.projectCollectionId);
        assert.strictEqual(refreshedRecord?.projectCollectionId, collection.projectCollectionId);
        assert.strictEqual(initialRecord?.expiresAt, 1_000 + RELOAD_UNLOCK_TTL_MS);
        assert.strictEqual(refreshedRecord?.expiresAt, now + RELOAD_UNLOCK_TTL_MS);
        assert.strictEqual(intervals.count(), 1);
      } finally {
        Date.now = originalDateNow;
        intervals.restore();
      }
    });

    it("does not refresh non-active unlocked collections and stops refresh on lock, verifier removal, and dispose", async () => {
      installStorage("sessionStorage");
      const intervals = installIntervalCapture();
      try {
        await pm.init();
        const activeCollection = pm.activeProjectCollection!;
        const otherCollection = await pm.createProjectCollection("Other");
        await pm.setProjectCollectionPin(otherCollection.projectCollectionId, "5678");
        assert.strictEqual(intervals.count(), 0);

        await pm.setProjectCollectionPin(activeCollection.projectCollectionId, "1234");
        assert.strictEqual(intervals.count(), 1);
        await pm.lockProjectCollection(activeCollection.projectCollectionId);
        assert.strictEqual(intervals.count(), 0);

        await pm.unlockProjectCollection(activeCollection.projectCollectionId, "1234");
        assert.strictEqual(intervals.count(), 1);
        await pm.clearProjectCollectionPin(activeCollection.projectCollectionId);
        assert.strictEqual(intervals.count(), 0);

        await pm.setProjectCollectionPin(activeCollection.projectCollectionId, "1234");
        assert.strictEqual(intervals.count(), 1);
        pm.dispose();
        assert.strictEqual(intervals.count(), 0);
        assert.strictEqual(readReloadUnlockRecord(memStore)?.projectCollectionId, activeCollection.projectCollectionId);
      } finally {
        intervals.restore();
      }
    });

    it("stops reload unlock refresh after switch away and tombstone", async () => {
      installStorage("sessionStorage");
      const intervals = installIntervalCapture();
      try {
        await pm.init();
        const activeCollection = pm.activeProjectCollection!;
        const otherCollection = await pm.createProjectCollection("Other");
        await pm.setProjectCollectionPin(activeCollection.projectCollectionId, "1234");
        await pm.switchProjectCollection(otherCollection.projectCollectionId);
        assert.strictEqual(intervals.count(), 0);

        await pm.setProjectCollectionPin(otherCollection.projectCollectionId, "5678");
        assert.strictEqual(intervals.count(), 1);
        await memStore.deleteProjectCollection(otherCollection.projectCollectionId);
        await intervals.runForDelay(RELOAD_UNLOCK_REFRESH_INTERVAL_MS);
        assert.strictEqual(intervals.count(), 0);
        assert.strictEqual(readReloadUnlockRecord(memStore), undefined);
      } finally {
        intervals.restore();
      }
    });

    it("logs reload unlock refresh failures from the interval callback", async () => {
      installStorage("sessionStorage");
      await pm.close();
      pm.dispose();
      const failingStore = new FailingProjectCollectionReadStore();
      memStore = failingStore;
      pm = new ProjectManager(failingStore);
      const intervals = installIntervalCapture();
      const loggerErrors: unknown[][] = [];
      const originalLoggerError = logger.error.bind(logger);
      logger.error = (message: string, data?: unknown) => {
        loggerErrors.push([message, data]);
      };
      try {
        await pm.create("Active");
        const collection = pm.activeProjectCollection!;
        await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");

        failingStore.failProjectCollectionReads = true;
        await intervals.runForDelay(RELOAD_UNLOCK_REFRESH_INTERVAL_MS);

        assert.strictEqual(loggerErrors.length, 1);
        assert.strictEqual(loggerErrors[0][0], "[app-host] project collection reload unlock refresh failed");
        assert.strictEqual((loggerErrors[0][1] as Error).message, "project collection read failed");
      } finally {
        logger.error = originalLoggerError;
        failingStore.failProjectCollectionReads = false;
        intervals.restore();
      }
    });

    it("does not refresh reload unlock records during autosave or close-time project saves", async () => {
      installStorage("sessionStorage");
      await pm.close();
      pm.dispose();
      memStore = new MemoryProjectStore();
      pm = new ProjectManager(memStore, { autoSaveDelayMs: 0 });
      const originalDateNow = Date.now;
      try {
        let now = 1_000;
        Date.now = () => now;
        const active = await pm.create("Autosaved");
        const collection = pm.activeProjectCollection!;
        await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");
        const initialRecord = readReloadUnlockRecord(memStore);

        now += 10_000;
        pm.activeProject?.filesystem.applyLocalChange({
          action: "write",
          path: "src/main.ts",
          content: "autosaved",
          newEtag: "etag-1",
        });
        await waitForTimers();
        const autosaveRecord = readReloadUnlockRecord(memStore);
        assert.strictEqual(autosaveRecord?.expiresAt, initialRecord?.expiresAt);
        const autosaved = await memStore.loadProjectFiles(active.id);
        const autosavedEntry = autosaved?.get("src/main.ts");
        assert.ok(autosavedEntry && autosavedEntry.kind === "file");
        assert.strictEqual(autosavedEntry.content, "autosaved");

        now += 10_000;
        pm.activeProject?.filesystem.applyLocalChange({
          action: "write",
          path: "src/main.ts",
          content: "closed",
          newEtag: "etag-2",
        });
        await pm.close();
        const closeRecord = readReloadUnlockRecord(memStore);
        assert.strictEqual(closeRecord?.expiresAt, initialRecord?.expiresAt);
        const closed = await memStore.loadProjectFiles(active.id);
        const closedEntry = closed?.get("src/main.ts");
        assert.ok(closedEntry && closedEntry.kind === "file");
        assert.strictEqual(closedEntry.content, "closed");
      } finally {
        Date.now = originalDateNow;
      }
    });

    it("leaves unlock state unchanged when PIN verification fails or collection is tombstoned", async () => {
      await pm.init();
      const collection = await pm.createProjectCollection("Protected");
      await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");
      await pm.lockProjectCollection(collection.projectCollectionId);

      await assertRejectsWithCode(
        () => pm.unlockProjectCollection(collection.projectCollectionId, "9999"),
        AppHostErrorCode.PROJECT_COLLECTION_PIN_INVALID
      );
      assert.strictEqual(pm.isProjectCollectionUnlocked(collection.projectCollectionId), false);

      await memStore.deleteProjectCollection(collection.projectCollectionId);
      await assertRejectsWithCode(
        () => pm.unlockProjectCollection(collection.projectCollectionId, "1234"),
        AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
      );
      assert.strictEqual(pm.isProjectCollectionUnlocked(collection.projectCollectionId), false);
    });

    it("leaves unlock state unchanged when a collection is tombstoned while PIN verification is awaiting work", async () => {
      await pm.init();
      const collection = await pm.createProjectCollection("Protected");
      await pm.setProjectCollectionPin(collection.projectCollectionId, "1234");
      await pm.lockProjectCollection(collection.projectCollectionId);
      const originalCrypto = globalThis.crypto;
      const originalDeriveBits = originalCrypto.subtle.deriveBits.bind(originalCrypto.subtle);
      let deriveBitsCalled = false;
      const subtle = {
        importKey: originalCrypto.subtle.importKey.bind(originalCrypto.subtle),
        deriveBits: async (...args: Parameters<SubtleCrypto["deriveBits"]>): Promise<ArrayBuffer> => {
          deriveBitsCalled = true;
          const derived = originalDeriveBits(...args);
          await memStore.deleteProjectCollection(collection.projectCollectionId);
          return derived;
        },
      } as unknown as SubtleCrypto;
      const cryptoOverride = Object.create(originalCrypto) as Crypto;
      Object.defineProperty(cryptoOverride, "subtle", {
        configurable: true,
        value: subtle,
      });
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        writable: true,
        value: cryptoOverride,
      });
      try {
        await assertRejectsWithCode(
          () => pm.unlockProjectCollection(collection.projectCollectionId, "1234"),
          AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
        );
        assert.strictEqual(deriveBitsCalled, true);
        assert.strictEqual(pm.isProjectCollectionUnlocked(collection.projectCollectionId), false);
      } finally {
        Object.defineProperty(globalThis, "crypto", {
          configurable: true,
          writable: true,
          value: originalCrypto,
        });
      }
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

      await assertRejectsWithCode(
        () => pm.createProjectCollection("   "),
        AppHostErrorCode.INVALID_PROJECT_COLLECTION_NAME
      );
      await assertRejectsWithCode(
        () => pm.createProjectCollection(tooLong),
        AppHostErrorCode.INVALID_PROJECT_COLLECTION_NAME
      );
      await assertRejectsWithCode(
        () => pm.renameProjectCollection(collection.projectCollectionId, ""),
        AppHostErrorCode.INVALID_PROJECT_COLLECTION_NAME
      );
      await assertRejectsWithCode(
        () => pm.renameProjectCollection(collection.projectCollectionId, tooLong),
        AppHostErrorCode.INVALID_PROJECT_COLLECTION_NAME
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

    it("keeps active project collection state independent across tab sessions", async () => {
      const tabAStore = memStore;
      const tabBStore = memStore.cloneForNewTab();
      const tabB = new ProjectManager(tabBStore);
      await pm.init();
      await tabB.init();
      const collectionA = await pm.createProjectCollection("Tab A");
      const collectionB = await pm.createProjectCollection("Tab B");

      await pm.switchProjectCollection(collectionA.projectCollectionId);
      await tabB.switchProjectCollection(collectionB.projectCollectionId);

      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, collectionA.projectCollectionId);
      assert.strictEqual(tabB.activeProjectCollection?.projectCollectionId, collectionB.projectCollectionId);
      assert.strictEqual(tabAStore.getProjectSession()?.projectCollectionId, collectionA.projectCollectionId);
      assert.strictEqual(tabBStore.getProjectSession()?.projectCollectionId, collectionB.projectCollectionId);
      await tabB.close();
      tabB.dispose();
    });

    it("broadcasts active project collection renames to state watchers in other managers", async () => {
      const tabB = new ProjectManager(memStore.cloneForNewTab());
      await pm.init();
      const targetCollection = await pm.createProjectCollection("Original");
      await tabB.init();
      await tabB.switchProjectCollection(targetCollection.projectCollectionId);
      const states: ProjectCollectionState[] = [];
      tabB.onProjectCollectionStateChange((state) => states.push(state));

      await pm.renameProjectCollection(targetCollection.projectCollectionId, "Renamed");
      await waitForTimers();

      assert.strictEqual(tabB.activeProjectCollection?.name, "Renamed");
      assert.strictEqual(states.at(-1)?.activeProjectCollection?.name, "Renamed");
      await tabB.close();
      tabB.dispose();
    });

    it("preserves same-project locking across project managers", async () => {
      const lock = new MemoryProjectLock();
      await pm.close();
      pm.dispose();
      pm = new ProjectManager(memStore, { lock });
      const tabB = new ProjectManager(memStore.cloneForNewTab(), { lock });
      const active = await pm.create("Locked");

      await assertRejectsWithCode(() => tabB.open(active.id), AppHostErrorCode.PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB);

      await tabB.close();
      tabB.dispose();
    });

    it("creates a default project when switching to an empty project collection", async () => {
      await pm.init();
      const targetCollection = await pm.createProjectCollection("Empty");

      await pm.switchProjectCollection(targetCollection.projectCollectionId);

      assert.strictEqual(pm.activeProject?.manifest.projectCollectionId, targetCollection.projectCollectionId);
      assert.strictEqual(pm.activeProject?.manifest.name, DEFAULT_PROJECT_NAME);
    });

    it("switches and opens a selected project without creating an intermediate project", async () => {
      await pm.create("Source");
      const targetCollection = await pm.createProjectCollection("Target");
      const targetProject = await memStore.createProject(targetCollection.projectCollectionId, "Target Project");

      const result = await pm.switchProjectCollectionAndOpenProject(
        targetCollection.projectCollectionId,
        targetProject.id
      );

      assert.strictEqual(result.collection.projectCollectionId, targetCollection.projectCollectionId);
      assert.strictEqual(result.project.id, targetProject.id);
      assert.strictEqual(result.access, "ready");
      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, targetCollection.projectCollectionId);
      assert.strictEqual(pm.activeProject?.manifest.id, targetProject.id);
      assert.deepStrictEqual(
        (await pm.listProjectsForCollection(targetCollection.projectCollectionId)).map((project) => project.id),
        [targetProject.id]
      );
    });

    it("writes a reload unlock record when committing a previously unlocked protected project collection", async () => {
      installStorage("sessionStorage");
      await pm.create("Source");
      const targetCollection = await pm.createProjectCollection("Target");
      const targetProject = await memStore.createProject(targetCollection.projectCollectionId, "Target Project");
      await pm.setProjectCollectionPin(targetCollection.projectCollectionId, "1234");
      await pm.lockProjectCollection(targetCollection.projectCollectionId);
      await pm.unlockProjectCollection(targetCollection.projectCollectionId, "1234");

      assert.strictEqual(readReloadUnlockRecord(memStore), undefined);

      await pm.switchProjectCollectionAndOpenProject(targetCollection.projectCollectionId, targetProject.id);

      const record = readReloadUnlockRecord(memStore);
      assert.strictEqual(record?.projectCollectionId, targetCollection.projectCollectionId);
      const restored = new ProjectManager(memStore);
      await restored.init();
      assert.strictEqual(restored.activeProject?.manifest.id, targetProject.id);
      assert.strictEqual((await restored.getProjectCollectionState()).access, "ready");
      await restored.close();
      restored.dispose();
    });

    it("switches and creates a project in the target collection without restoring another project", async () => {
      await pm.create("Source");
      const targetCollection = await pm.createProjectCollection("Target");
      const events: ProjectCollectionEvent[] = [];
      pm.onProjectCollectionEvent((event) => events.push(event));

      const result = await pm.switchProjectCollectionAndCreateProject(targetCollection.projectCollectionId, "Created");

      assert.strictEqual(result.collection.projectCollectionId, targetCollection.projectCollectionId);
      assert.strictEqual(result.project.name, "Created");
      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, targetCollection.projectCollectionId);
      assert.strictEqual(pm.activeProject?.manifest.id, result.project.id);
      assert.deepStrictEqual(
        (await pm.listProjectsForCollection(targetCollection.projectCollectionId)).map((project) => project.name),
        ["Created"]
      );
      assert.deepStrictEqual(events, [
        {
          type: "project-list-changed",
          projectCollectionId: targetCollection.projectCollectionId,
        },
      ]);
    });

    it("leaves active state unchanged when pending open commit validation fails", async () => {
      const active = await pm.create("Source");
      const targetCollection = await pm.createProjectCollection("Target");
      const otherCollection = await pm.createProjectCollection("Other");
      const otherProject = await memStore.createProject(otherCollection.projectCollectionId, "Other Project");

      await assertRejectsWithCode(
        () => pm.switchProjectCollectionAndOpenProject(targetCollection.projectCollectionId, otherProject.id),
        AppHostErrorCode.PROJECT_NOT_IN_ACTIVE_COLLECTION
      );

      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(pm.activeProject?.manifest.id, active.id);
    });

    it("rejects pending create commits for missing collections without creating a project", async () => {
      const active = await pm.create("Source");

      await assertRejectsWithCode(
        () => pm.switchProjectCollectionAndCreateProject("missing", "Created"),
        AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
      );

      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(pm.activeProject?.manifest.id, active.id);
      assert.deepStrictEqual(
        (await pm.listProjectsForCollection(DEFAULT_PROJECT_COLLECTION_ID)).map((project) => project.id),
        [active.id]
      );
    });

    it("tombstones the pending created project when create commit locking fails", async () => {
      const lock = new SecondAcquireFailsProjectLock();
      await pm.close();
      pm.dispose();
      pm = new ProjectManager(memStore, { lock });
      const active = await pm.create("Source");
      const targetCollection = await pm.createProjectCollection("Target");

      await assertRejectsWithCode(
        () => pm.switchProjectCollectionAndCreateProject(targetCollection.projectCollectionId, "Created"),
        AppHostErrorCode.PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB
      );

      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(pm.activeProject?.manifest.id, active.id);
      assert.deepStrictEqual(await pm.listProjectsForCollection(targetCollection.projectCollectionId), []);
    });

    it("tombstones the pending created project when create commit close fails", async () => {
      await pm.close();
      pm.dispose();
      const lock = new MemoryProjectLock();
      const failingStore = new FailingSaveProjectStore();
      memStore = failingStore;
      pm = new ProjectManager(failingStore, { lock });
      const active = await pm.create("Source");
      const targetCollection = await pm.createProjectCollection("Target");

      failingStore.failProjectFileSaves = true;
      try {
        await assert.rejects(
          () => pm.switchProjectCollectionAndCreateProject(targetCollection.projectCollectionId, "Created"),
          /autosave failed/
        );
      } finally {
        failingStore.failProjectFileSaves = false;
      }

      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(pm.activeProject?.manifest.id, active.id);
      assert.deepStrictEqual(await pm.listProjectsForCollection(targetCollection.projectCollectionId), []);
      const tabB = new ProjectManager(failingStore.cloneForNewTab(), { lock });
      await assertRejectsWithCode(() => tabB.open(active.id), AppHostErrorCode.PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB);
      tabB.dispose();
    });

    it("does not fail a pending create commit when closing the previous project releases with an error", async () => {
      const lock = new FirstReleaseThrowsProjectLock();
      await pm.close();
      pm.dispose();
      pm = new ProjectManager(memStore, { lock });
      const originalLoggerError = logger.error.bind(logger);
      logger.error = () => {};
      try {
        await pm.create("Source");
        const targetCollection = await pm.createProjectCollection("Target");

        const result = await pm.switchProjectCollectionAndCreateProject(
          targetCollection.projectCollectionId,
          "Created"
        );

        assert.strictEqual(result.collection.projectCollectionId, targetCollection.projectCollectionId);
        assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, targetCollection.projectCollectionId);
        assert.strictEqual(pm.activeProject?.manifest.id, result.project.id);
        assert.deepStrictEqual(
          (await pm.listProjectsForCollection(targetCollection.projectCollectionId)).map((project) => project.id),
          [result.project.id]
        );
      } finally {
        logger.error = originalLoggerError;
      }
    });

    it("rejects switching to missing or tombstoned project collections without changing active collection", async () => {
      await pm.init();
      const targetCollection = await pm.createProjectCollection("Gone");
      await memStore.deleteProjectCollection(targetCollection.projectCollectionId);

      await assertRejectsWithCode(
        () => pm.switchProjectCollection("missing"),
        AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
      );
      await assertRejectsWithCode(
        () => pm.switchProjectCollection(targetCollection.projectCollectionId),
        AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
      );
      assert.strictEqual(pm.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
    });

    it("blocks deleting the active collection and the default collection", async () => {
      await pm.init();
      const targetCollection = await pm.createProjectCollection("Target");
      await pm.switchProjectCollection(targetCollection.projectCollectionId);

      await assertRejectsWithCode(
        () => pm.deleteProjectCollection(targetCollection.projectCollectionId),
        AppHostErrorCode.ACTIVE_PROJECT_COLLECTION_DELETE_BLOCKED
      );
      await assertRejectsWithCode(
        () => pm.deleteProjectCollection(DEFAULT_PROJECT_COLLECTION_ID),
        AppHostErrorCode.DEFAULT_PROJECT_COLLECTION_DELETE_BLOCKED
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

    it("broadcasts project tombstones and replaces active state in another manager", async () => {
      const tabB = new ProjectManager(memStore.cloneForNewTab());
      const first = await pm.create("First");
      const second = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Second");
      await tabB.init();
      await tabB.open(second.id);
      const states: ProjectCollectionState[] = [];
      tabB.onProjectCollectionStateChange((state) => states.push(state));

      await pm.delete(second.id);
      await waitForTimers();

      assert.notStrictEqual(tabB.activeProject?.manifest.id, second.id);
      assert.strictEqual(tabB.activeProject?.manifest.id, first.id);
      assert.strictEqual(states.at(-1)?.activeProjectId, first.id);
      await tabB.close();
      tabB.dispose();
    });

    it("broadcasts project tombstones and creates a replacement when no project remains", async () => {
      const tabB = new ProjectManager(memStore.cloneForNewTab());
      await memStore.ensureDefaultProjectCollection();
      const deleted = await memStore.createProject(DEFAULT_PROJECT_COLLECTION_ID, "Only Project");
      await pm.init();
      await tabB.init();
      await tabB.open(deleted.id);
      const states: ProjectCollectionState[] = [];
      tabB.onProjectCollectionStateChange((state) => states.push(state));

      await pm.delete(deleted.id);
      await waitForTimers();

      assert.notStrictEqual(tabB.activeProject?.manifest.id, deleted.id);
      assert.strictEqual(tabB.activeProject?.manifest.name, DEFAULT_PROJECT_NAME);
      const projects = await tabB.listProjects();
      assert.deepStrictEqual(
        projects.map((project) => project.id),
        [tabB.activeProject?.manifest.id]
      );
      assert.strictEqual(states.at(-1)?.activeProjectId, tabB.activeProject?.manifest.id);
      await tabB.close();
      tabB.dispose();
    });

    it("broadcasts project collection tombstones and falls back in another manager", async () => {
      const tabB = new ProjectManager(memStore.cloneForNewTab());
      const defaultProject = await pm.create("Default");
      const targetCollection = await pm.createProjectCollection("Target");
      await memStore.createProject(targetCollection.projectCollectionId, "Target Project");
      await tabB.init();
      await tabB.switchProjectCollection(targetCollection.projectCollectionId);

      await pm.deleteProjectCollection(targetCollection.projectCollectionId);
      await waitForTimers();

      assert.strictEqual(tabB.activeProjectCollection?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
      assert.strictEqual(tabB.activeProject?.manifest.id, defaultProject.id);
      await tabB.close();
      tabB.dispose();
    });

    it("ignores tombstone broadcasts from a different key prefix", async () => {
      const otherStore = new MemoryProjectStore("other-app");
      const other = new ProjectManager(otherStore);
      await other.init();
      const active = await other.ensureDefaultProject(DEFAULT_PROJECT_NAME);
      const states: ProjectCollectionState[] = [];
      other.onProjectCollectionStateChange((state) => states.push(state));

      const broadcast = createProjectCollectionBroadcast("test-app");
      broadcast.post({
        type: "project-tombstoned",
        projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
        projectId: active.manifest.id,
      });
      await waitForTimers();

      assert.strictEqual(other.activeProject?.manifest.id, active.manifest.id);
      assert.strictEqual(states.length, 0);
      broadcast.close();
      await other.close();
      other.dispose();
    });
  });
});

type TestBroadcastListener = (event: MessageEvent<unknown>) => void;

class TestBroadcastChannel {
  private static readonly channels = new Map<string, Set<TestBroadcastChannel>>();
  private readonly listeners = new Set<TestBroadcastListener>();
  private closed = false;

  constructor(readonly name: string) {
    let channels = TestBroadcastChannel.channels.get(name);
    if (!channels) {
      channels = new Set();
      TestBroadcastChannel.channels.set(name, channels);
    }
    channels.add(this);
  }

  postMessage(message: unknown): void {
    const channels = TestBroadcastChannel.channels.get(this.name);
    if (!channels) {
      return;
    }
    for (const channel of channels) {
      if (channel !== this && !channel.closed) {
        setTimeout(() => {
          channel.dispatch(message);
        }, 0);
      }
    }
  }

  addEventListener(type: string, listener: TestBroadcastListener): void {
    if (type === "message") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: TestBroadcastListener): void {
    if (type === "message") {
      this.listeners.delete(listener);
    }
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    TestBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  unref(): void {}

  private dispatch(message: unknown): void {
    const event = { data: message } as MessageEvent<unknown>;
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class MemoryProjectLock {
  private readonly held = new Set<string>();

  async tryAcquire(projectId: string): Promise<{ release(): void } | undefined> {
    if (this.held.has(projectId)) {
      return undefined;
    }
    this.held.add(projectId);
    return {
      release: () => {
        this.held.delete(projectId);
      },
    };
  }
}

class SecondAcquireFailsProjectLock {
  private acquireCount = 0;

  async tryAcquire(_projectId: string): Promise<{ release(): void } | undefined> {
    this.acquireCount += 1;
    if (this.acquireCount > 1) {
      return undefined;
    }
    return {
      release() {},
    };
  }
}

class FirstReleaseThrowsProjectLock {
  private releaseCount = 0;

  async tryAcquire(_projectId: string): Promise<{ release(): void }> {
    return {
      release: () => {
        this.releaseCount += 1;
        if (this.releaseCount === 1) {
          throw new Error("release failed");
        }
      },
    };
  }
}

class FailingSaveProjectStore extends MemoryProjectStore {
  failProjectFileSaves = false;

  override async saveProjectFiles(id: string, snapshot: ProjectFileSnapshot): Promise<void> {
    if (this.failProjectFileSaves) {
      throw new Error("autosave failed");
    }
    await super.saveProjectFiles(id, snapshot);
  }
}

class CountingFileWriteStore extends MemoryProjectStore {
  saveProjectFilesCount = 0;
  appliedChangeBatches: ProjectFileChange[][] = [];
  private inChangeApply = false;

  override async saveProjectFiles(id: string, snapshot: ProjectFileSnapshot): Promise<void> {
    if (!this.inChangeApply) {
      this.saveProjectFilesCount += 1;
    }
    await super.saveProjectFiles(id, snapshot);
  }

  override async applyProjectFileChanges(id: string, changes: readonly ProjectFileChange[]): Promise<void> {
    this.appliedChangeBatches.push([...changes]);
    this.inChangeApply = true;
    try {
      await super.applyProjectFileChanges(id, changes);
    } finally {
      this.inChangeApply = false;
    }
  }
}

class CountingProjectSessionStore extends MemoryProjectStore {
  projectSessionWriteCount = 0;

  override setProjectSession(session: ProjectCollectionTabSession | undefined): void {
    this.projectSessionWriteCount += 1;
    super.setProjectSession(session);
  }
}

class CountingListProjectsStore extends MemoryProjectStore {
  listProjectCalls: string[] = [];
  countProjectCalls = 0;

  override async listProjects(projectCollectionId: string) {
    this.listProjectCalls.push(projectCollectionId);
    return super.listProjects(projectCollectionId);
  }

  override async countProjectsByCollection() {
    this.countProjectCalls += 1;
    return super.countProjectsByCollection();
  }
}

class CloningProjectCollectionStore extends MemoryProjectStore {
  cloneProjectCollectionsOnRead = false;

  override async getProjectCollection(projectCollectionId: string): Promise<ProjectCollection | undefined> {
    const collection = await super.getProjectCollection(projectCollectionId);
    if (!collection || !this.cloneProjectCollectionsOnRead) {
      return collection;
    }
    return {
      ...collection,
      pinVerifier: collection.pinVerifier ? { ...collection.pinVerifier } : undefined,
    };
  }
}

class MissingProjectCollectionStore extends MemoryProjectStore {
  unavailableProject: ProjectManifest | undefined;
  unavailableProjectCollectionId: string | undefined;

  override async getProject(id: string): Promise<ProjectManifest | undefined> {
    if (this.unavailableProject?.id === id) {
      return this.unavailableProject;
    }
    return super.getProject(id);
  }

  override async getProjectCollection(projectCollectionId: string): Promise<ProjectCollection | undefined> {
    if (this.unavailableProjectCollectionId === projectCollectionId) {
      return undefined;
    }
    return super.getProjectCollection(projectCollectionId);
  }
}

class FailingProjectCollectionReadStore extends MemoryProjectStore {
  failProjectCollectionReads = false;

  override async getProjectCollection(projectCollectionId: string): Promise<ProjectCollection | undefined> {
    if (this.failProjectCollectionReads) {
      throw new Error("project collection read failed");
    }
    return super.getProjectCollection(projectCollectionId);
  }
}

class Deferred {
  readonly promise: Promise<void>;
  private resolvePromise: (() => void) | undefined;

  constructor() {
    this.promise = new Promise<void>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  resolve(): void {
    this.resolvePromise?.();
  }
}

class DelayedSummaryCountStore extends MemoryProjectStore {
  private readonly countProjectsDelay = new Deferred();
  private delayedCountProjects = false;

  resolveCountProjectsByCollection(): void {
    this.countProjectsDelay.resolve();
  }

  override async countProjectsByCollection() {
    if (!this.delayedCountProjects) {
      this.delayedCountProjects = true;
      await this.countProjectsDelay.promise;
    }
    return super.countProjectsByCollection();
  }
}

function installTestBroadcastChannel(): void {
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    writable: true,
    value: TestBroadcastChannel,
  });
}

function restoreBroadcastChannel(original: typeof BroadcastChannel | undefined): void {
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    writable: true,
    value: original,
  });
}

class TestStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function installStorage(name: "sessionStorage"): Storage {
  const storage = new TestStorage() as Storage;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: storage,
  });
  return storage;
}

function restoreStorage(name: "sessionStorage", storage: Storage | undefined): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: storage,
  });
}

function reloadUnlockKey(store: MemoryProjectStore): string {
  return `${store.keyPrefix}:project-collection-reload-unlock`;
}

function readReloadUnlockRecord(store: MemoryProjectStore): ProjectCollectionReloadUnlock | undefined {
  const raw = sessionStorage.getItem(reloadUnlockKey(store));
  return raw ? (JSON.parse(raw) as ProjectCollectionReloadUnlock) : undefined;
}

function writeReloadUnlockRecord(store: MemoryProjectStore, record: ProjectCollectionReloadUnlock): void {
  sessionStorage.setItem(reloadUnlockKey(store), JSON.stringify(record));
}

interface IntervalCapture {
  count(): number;
  restore(): void;
  runForDelay(delay: number): Promise<void>;
}

function installIntervalCapture(): IntervalCapture {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let nextId = 1;
  const callbacks = new Map<number, { callback: () => unknown; delay: number | undefined }>();
  Object.defineProperty(globalThis, "setInterval", {
    configurable: true,
    writable: true,
    value: (callback: () => unknown, delay?: number) => {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, { callback, delay });
      return id;
    },
  });
  Object.defineProperty(globalThis, "clearInterval", {
    configurable: true,
    writable: true,
    value: (id: number) => {
      callbacks.delete(id);
    },
  });
  return {
    count: () => callbacks.size,
    restore: () => {
      Object.defineProperty(globalThis, "setInterval", {
        configurable: true,
        writable: true,
        value: originalSetInterval,
      });
      Object.defineProperty(globalThis, "clearInterval", {
        configurable: true,
        writable: true,
        value: originalClearInterval,
      });
    },
    runForDelay: async (delay: number) => {
      for (const { callback } of Array.from(callbacks.values()).filter((entry) => entry.delay === delay)) {
        await callback();
      }
      await waitForTimers();
    },
  };
}

async function waitForTimers(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
