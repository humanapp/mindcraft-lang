import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DEFAULT_PROJECT_COLLECTION_ID,
  DEFAULT_PROJECT_NAME,
  PROJECT_COLLECTION_NAME_MAX_LENGTH,
  type ProjectCollectionState,
  type ProjectCollectionTabSession,
  type ProjectFileSnapshot,
  ProjectManager,
  type ProjectPersistenceError,
} from "@mindcraft-lang/app-host";
import { logger } from "@mindcraft-lang/core";
import { createProjectCollectionBroadcast } from "./project-collection-broadcast.js";
import { assertRejectsWithCode } from "./test-support/error-assertions.js";
import { MemoryProjectStore } from "./test-support/memory-project-store.js";

describe("ProjectManager", () => {
  let memStore: MemoryProjectStore;
  let pm: ProjectManager;
  const originalBroadcastChannel: typeof BroadcastChannel | undefined = globalThis.BroadcastChannel;

  beforeEach(() => {
    installTestBroadcastChannel();
    memStore = new MemoryProjectStore();
    pm = new ProjectManager(memStore);
  });

  afterEach(async () => {
    await pm.close();
    pm.dispose();
    restoreBroadcastChannel(originalBroadcastChannel);
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

    it("recovers active state before rethrowing stale active project write errors", async () => {
      const active = await pm.create("Active");
      const states: ProjectCollectionState[] = [];
      pm.onProjectCollectionStateChange((state) => states.push(state));

      await memStore.deleteProject(active.id);
      await assertRejectsWithCode(() => pm.updateActive({ name: "Renamed" }), "PROJECT_NOT_FOUND");

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
      await assertRejectsWithCode(() => pm.saveAppData("key1", "value1"), "NO_ACTIVE_PROJECT");
    });

    it("recovers active state before rethrowing stale active project app data write errors", async () => {
      const active = await pm.create("Data Project");
      const states: ProjectCollectionState[] = [];
      pm.onProjectCollectionStateChange((state) => states.push(state));

      await memStore.deleteProject(active.id);
      await assertRejectsWithCode(() => pm.saveAppData("key1", "value1"), "PROJECT_NOT_FOUND");

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

    it("preserves same-project locking across project managers", async () => {
      const lock = new MemoryProjectLock();
      await pm.close();
      pm.dispose();
      pm = new ProjectManager(memStore, { lock });
      const tabB = new ProjectManager(memStore.cloneForNewTab(), { lock });
      const active = await pm.create("Locked");

      await assertRejectsWithCode(() => tabB.open(active.id), "PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB");

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

class FailingSaveProjectStore extends MemoryProjectStore {
  failProjectFileSaves = false;

  override async saveProjectFiles(id: string, snapshot: ProjectFileSnapshot): Promise<void> {
    if (this.failProjectFileSaves) {
      throw new Error("autosave failed");
    }
    await super.saveProjectFiles(id, snapshot);
  }
}

class CountingProjectSessionStore extends MemoryProjectStore {
  projectSessionWriteCount = 0;

  override setProjectSession(session: ProjectCollectionTabSession | undefined): void {
    this.projectSessionWriteCount += 1;
    super.setProjectSession(session);
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

async function waitForTimers(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
