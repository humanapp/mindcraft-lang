import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AppHostErrorCode,
  createIdbProjectStore,
  createProjectCollectionPinVerifier,
  DEFAULT_PROJECT_COLLECTION_ID,
  DEFAULT_PROJECT_COLLECTION_NAME,
  PROJECT_COLLECTION_NAME_MAX_LENGTH,
  type ProjectCollection,
  type ProjectManifest,
  type ProjectStore,
} from "@wendoo-lang/app-host";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { ProjectFileSystemEntry } from "./project-file-snapshot.js";
import { assertRejectsWithCode } from "./test-support/error-assertions.js";

let testId = 0;
const originalSessionStorage: Storage | undefined = globalThis.sessionStorage;
const originalLocalStorage: Storage | undefined = globalThis.localStorage;

afterEach(() => {
  restoreStorage("sessionStorage", originalSessionStorage);
  restoreStorage("localStorage", originalLocalStorage);
});

function nextKeyPrefix(): string {
  testId += 1;
  return `idb-project-store-test-${testId}`;
}

type TestStoreInternals = ProjectStore & {
  db: IDBPDatabase<ProjectDbSchema>;
};

interface ProjectDbSchema extends DBSchema {
  projectCollections: {
    key: string;
    value: ProjectCollection;
  };
  projects: {
    key: string;
    value: ProjectManifest;
  };
  files: {
    key: string;
    value: Array<[string, ProjectFileSystemEntry]>;
  };
  appData: {
    key: string;
    value: string;
  };
}

interface LegacyProjectManifest {
  id: string;
  name: string;
  description: string;
  thumbnailUrl?: string;
  deleted?: true;
  createdAt: number;
  updatedAt: number;
}

interface LegacyV2ProjectDbSchema extends DBSchema {
  projects: {
    key: string;
    value: LegacyProjectManifest;
  };
  files: {
    key: string;
    value: Array<[string, ProjectFileSystemEntry]>;
  };
  appData: {
    key: string;
    value: string;
  };
}

function projectDbName(keyPrefix: string): string {
  return `${keyPrefix}-projects`;
}

async function createLegacyV2ProjectDb(keyPrefix: string, project: LegacyProjectManifest): Promise<void> {
  const db = await openDB<LegacyV2ProjectDbSchema>(projectDbName(keyPrefix), 2, {
    upgrade(db) {
      db.createObjectStore("projects", { keyPath: "id" });
      db.createObjectStore("files");
      db.createObjectStore("appData");
    },
  });
  await db.put("projects", project);
  db.close();
}

describe("createIdbProjectStore project collections", () => {
  it("creates and returns the default project collection", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const collection = await store.ensureDefaultProjectCollection();

    assert.strictEqual(collection.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
    assert.strictEqual(collection.name, DEFAULT_PROJECT_COLLECTION_NAME);
    assert.strictEqual(typeof collection.createdAt, "number");
    assert.strictEqual(typeof collection.updatedAt, "number");

    const listed = await store.listProjectCollections();
    assert.deepStrictEqual(
      listed.map((entry) => entry.projectCollectionId),
      [DEFAULT_PROJECT_COLLECTION_ID]
    );

    const fetched = await store.getProjectCollection(DEFAULT_PROJECT_COLLECTION_ID);
    assert.strictEqual(fetched?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
  });

  it("round-trips collection create, list, get, update, and delete", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const first = await store.createProjectCollection("  Alpha  ");
    const second = await store.createProjectCollection("Alpha");

    assert.strictEqual(first.name, "Alpha");
    assert.notStrictEqual(first.projectCollectionId, second.projectCollectionId);
    assert.strictEqual((await store.listProjectCollections()).length, 2);

    await store.updateProjectCollection(first.projectCollectionId, { name: "  Beta  " });
    const updated = await store.getProjectCollection(first.projectCollectionId);
    assert.strictEqual(updated?.name, "Beta");
    assert.ok(updated!.updatedAt >= first.updatedAt);

    await store.deleteProjectCollection(first.projectCollectionId);
    assert.strictEqual(await store.getProjectCollection(first.projectCollectionId), undefined);

    const remaining = await store.listProjectCollections();
    assert.deepStrictEqual(
      remaining.map((entry) => entry.projectCollectionId),
      [second.projectCollectionId]
    );
  });

  it("sets and clears project collection PIN verifiers", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const collection = await store.createProjectCollection("Protected");
    const pinVerifier = await createProjectCollectionPinVerifier("1234");

    await store.updateProjectCollection(collection.projectCollectionId, { pinVerifier });
    const protectedCollection = await store.getProjectCollection(collection.projectCollectionId);
    assert.strictEqual(protectedCollection?.pinVerifier?.scheme, "v1");
    assert.strictEqual(protectedCollection?.pinVerifier?.hash, pinVerifier.hash);

    await store.updateProjectCollection(collection.projectCollectionId, { name: "Still Protected" });
    assert.strictEqual(
      (await store.getProjectCollection(collection.projectCollectionId))?.pinVerifier?.hash,
      pinVerifier.hash
    );

    await store.updateProjectCollection(collection.projectCollectionId, { pinVerifier: undefined });
    assert.strictEqual((await store.getProjectCollection(collection.projectCollectionId))?.pinVerifier, undefined);
  });

  it("rejects invalid collection names", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const collection = await store.createProjectCollection("Valid");
    const tooLong = "x".repeat(PROJECT_COLLECTION_NAME_MAX_LENGTH + 1);

    await assertRejectsWithCode(
      () => store.createProjectCollection("   "),
      AppHostErrorCode.INVALID_PROJECT_COLLECTION_NAME
    );
    await assertRejectsWithCode(
      () => store.createProjectCollection(tooLong),
      AppHostErrorCode.INVALID_PROJECT_COLLECTION_NAME
    );
    await assertRejectsWithCode(
      () => store.updateProjectCollection(collection.projectCollectionId, { name: "" }),
      AppHostErrorCode.INVALID_PROJECT_COLLECTION_NAME
    );
    await assertRejectsWithCode(
      () => store.updateProjectCollection(collection.projectCollectionId, { name: tooLong }),
      AppHostErrorCode.INVALID_PROJECT_COLLECTION_NAME
    );
    assert.strictEqual((await store.getProjectCollection(collection.projectCollectionId))?.name, "Valid");
  });

  it("rejects deleting the default collection by id", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const defaultCollection = await store.ensureDefaultProjectCollection();

    await store.updateProjectCollection(defaultCollection.projectCollectionId, {
      name: "Renamed Default",
    });
    const nonDefault = await store.createProjectCollection(DEFAULT_PROJECT_COLLECTION_NAME);

    await assertRejectsWithCode(
      () => store.deleteProjectCollection(DEFAULT_PROJECT_COLLECTION_ID),
      AppHostErrorCode.DEFAULT_PROJECT_COLLECTION_DELETE_BLOCKED
    );

    await store.deleteProjectCollection(nonDefault.projectCollectionId);
    const stillDefault = await store.getProjectCollection(DEFAULT_PROJECT_COLLECTION_ID);
    assert.strictEqual(stillDefault?.name, "Renamed Default");
  });

  it("uses the default id for bootstrap status", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const nonDefault = await store.createProjectCollection(DEFAULT_PROJECT_COLLECTION_NAME);
    const bootstrapped = await store.ensureDefaultProjectCollection();

    assert.strictEqual(bootstrapped.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
    assert.notStrictEqual(nonDefault.projectCollectionId, bootstrapped.projectCollectionId);

    await store.updateProjectCollection(DEFAULT_PROJECT_COLLECTION_ID, { name: "Renamed" });
    const ensuredAgain = await store.ensureDefaultProjectCollection();
    assert.strictEqual(ensuredAgain.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
    assert.strictEqual(ensuredAgain.name, "Renamed");
  });

  it("handles concurrent default bootstrap attempts", async () => {
    const keyPrefix = nextKeyPrefix();
    const firstStore = await createIdbProjectStore(keyPrefix);
    const secondStore = await createIdbProjectStore(keyPrefix);

    const [first, second] = await Promise.all([
      firstStore.ensureDefaultProjectCollection(),
      secondStore.ensureDefaultProjectCollection(),
    ]);

    assert.strictEqual(first.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
    assert.strictEqual(second.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
    assert.strictEqual((await firstStore.listProjectCollections()).length, 1);
  });

  it("rereads the default collection after a duplicate-key bootstrap race", async () => {
    const keyPrefix = nextKeyPrefix();
    const firstStore = await createIdbProjectStore(keyPrefix);
    const secondStore = await createIdbProjectStore(keyPrefix);
    const firstStoreInternals = firstStore as TestStoreInternals;
    const add = firstStoreInternals.db.add.bind(firstStoreInternals.db);

    firstStoreInternals.db.add = async (storeName, value, key) => {
      const collection = value as ProjectCollection;
      if (storeName === "projectCollections" && collection.projectCollectionId === DEFAULT_PROJECT_COLLECTION_ID) {
        const inserted = await secondStore.ensureDefaultProjectCollection();
        await secondStore.updateProjectCollection(inserted.projectCollectionId, {
          name: "Raced Default",
        });
      }
      return add(storeName, value, key);
    };

    const collection = await firstStore.ensureDefaultProjectCollection();

    assert.strictEqual(collection.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
    assert.strictEqual(collection.name, "Raced Default");
    assert.strictEqual((await firstStore.listProjectCollections()).length, 1);
  });

  it("scopes default collections by key prefix", async () => {
    const firstStore = await createIdbProjectStore(nextKeyPrefix());
    const secondStore = await createIdbProjectStore(nextKeyPrefix());

    await firstStore.ensureDefaultProjectCollection();
    await firstStore.updateProjectCollection(DEFAULT_PROJECT_COLLECTION_ID, { name: "First" });
    await secondStore.ensureDefaultProjectCollection();

    assert.strictEqual((await firstStore.getProjectCollection(DEFAULT_PROJECT_COLLECTION_ID))?.name, "First");
    assert.strictEqual(
      (await secondStore.getProjectCollection(DEFAULT_PROJECT_COLLECTION_ID))?.name,
      DEFAULT_PROJECT_COLLECTION_NAME
    );
  });
});

describe("createIdbProjectStore project collection membership", () => {
  it("migrates legacy project records into the default collection", async () => {
    const keyPrefix = nextKeyPrefix();
    await createLegacyV2ProjectDb(keyPrefix, {
      id: "legacy-project",
      name: "Legacy",
      description: "existing project",
      createdAt: 1000,
      updatedAt: 2000,
    });

    const store = await createIdbProjectStore(keyPrefix);
    const projects = await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID);

    assert.strictEqual(projects.length, 1);
    assert.strictEqual(projects[0].id, "legacy-project");
    assert.strictEqual(projects[0].projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
    assert.strictEqual((await store.getProject("legacy-project"))?.projectCollectionId, DEFAULT_PROJECT_COLLECTION_ID);
    assert.strictEqual(
      (await store.getProjectCollection(DEFAULT_PROJECT_COLLECTION_ID))?.projectCollectionId,
      DEFAULT_PROJECT_COLLECTION_ID
    );
  });

  it("creates projects only in non-deleted project collections", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());

    await assertRejectsWithCode(
      () => store.createProject("missing", "No Collection"),
      AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
    );

    const collection = await store.createProjectCollection("Transient");
    await store.deleteProjectCollection(collection.projectCollectionId);
    await assertRejectsWithCode(
      () => store.createProject(collection.projectCollectionId, "Tombstoned Collection"),
      AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
    );

    assert.strictEqual((await store.listProjects(collection.projectCollectionId)).length, 0);
  });

  it("lists and reads only live projects in live collections", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const firstCollection = await store.ensureDefaultProjectCollection();
    const secondCollection = await store.createProjectCollection("Second");
    const firstProject = await store.createProject(firstCollection.projectCollectionId, "First");
    const secondProject = await store.createProject(secondCollection.projectCollectionId, "Second");

    assert.deepStrictEqual(
      (await store.listProjects(firstCollection.projectCollectionId)).map((project) => project.id),
      [firstProject.id]
    );
    assert.deepStrictEqual(
      (await store.listProjects(secondCollection.projectCollectionId)).map((project) => project.id),
      [secondProject.id]
    );

    await store.deleteProject(secondProject.id);
    assert.strictEqual(await store.getProject(secondProject.id), undefined);
    assert.deepStrictEqual(await store.listProjects(secondCollection.projectCollectionId), []);
  });

  it("tombstones projects without deleting files or app data", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const collection = await store.ensureDefaultProjectCollection();
    const project = await store.createProject(collection.projectCollectionId, "Delete Me");
    const snapshot = new Map<string, ProjectFileSystemEntry>([
      ["src/main.ts", { kind: "file", content: "run", etag: "etag-1", isReadonly: false }],
    ]);
    await store.saveProjectFiles(project.id, snapshot);
    await store.saveAppData(project.id, "brains", '{"brain":true}');

    await store.deleteProject(project.id);
    await store.deleteProject(project.id);

    assert.strictEqual(await store.getProject(project.id), undefined);
    assert.deepStrictEqual(await store.listProjects(collection.projectCollectionId), []);
    assert.strictEqual((await store.loadProjectFiles(project.id))?.get("src/main.ts")?.kind, "file");
    assert.strictEqual(await store.loadAppData(project.id, "brains"), '{"brain":true}');

    const rawProject = await (store as TestStoreInternals).db.get("projects", project.id);
    assert.strictEqual(rawProject?.deleted, true);
  });

  it("rejects project delete and duplicate when the project is missing", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const targetCollection = await store.ensureDefaultProjectCollection();

    await assertRejectsWithCode(() => store.deleteProject("missing"), AppHostErrorCode.PROJECT_NOT_FOUND);
    await assertRejectsWithCode(() => store.duplicateProject("missing", "Copy"), AppHostErrorCode.PROJECT_NOT_FOUND);
    await assertRejectsWithCode(
      () => store.copyProjectToCollection("missing", targetCollection.projectCollectionId, "Copy"),
      AppHostErrorCode.PROJECT_NOT_FOUND
    );
  });

  it("rejects project delete and duplicate when the owning collection is unavailable", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const collection = await store.createProjectCollection("Owned");
    const project = await store.createProject(collection.projectCollectionId, "Owned Project");
    await (store as TestStoreInternals).db.delete("projectCollections", collection.projectCollectionId);

    assert.strictEqual(await store.getProject(project.id), undefined);
    await assertRejectsWithCode(() => store.deleteProject(project.id), AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND);
    await assertRejectsWithCode(() => store.duplicateProject(project.id, "Copy"), AppHostErrorCode.PROJECT_NOT_FOUND);
    await assertRejectsWithCode(
      () => store.copyProjectToCollection(project.id, DEFAULT_PROJECT_COLLECTION_ID, "Copy"),
      AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
    );
  });

  it("duplicates a project within the source collection", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const collection = await store.createProjectCollection("Source Collection");
    const project = await store.createProject(collection.projectCollectionId, "Source");
    await store.saveProjectFiles(
      project.id,
      new Map([["src/main.ts", { kind: "file", content: "source", etag: "etag-1", isReadonly: false }]])
    );
    await store.saveAppData(project.id, "brains", '{"source":true}');
    await store.updateProject(project.id, {
      description: "source description",
      thumbnailUrl: "data:image/png;base64,source",
      targets: { "wendoo-lang/trg-microbit-v2": { packageVersion: "^0.8.0" } },
    });

    const copy = await store.duplicateProject(project.id, "Copy");

    assert.strictEqual(copy.projectCollectionId, collection.projectCollectionId);
    assert.strictEqual(copy.description, "source description");
    assert.strictEqual(copy.thumbnailUrl, "data:image/png;base64,source");
    assert.deepStrictEqual(copy.targets, { "wendoo-lang/trg-microbit-v2": { packageVersion: "^0.8.0" } });
    assert.strictEqual((await store.loadProjectFiles(copy.id))?.get("src/main.ts")?.kind, "file");
    assert.strictEqual(await store.loadAppData(copy.id, "brains"), '{"source":true}');
  });

  it("copies a project to another project collection without local metadata", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const sourceCollection = await store.createProjectCollection("Source Collection");
    const targetCollection = await store.createProjectCollection("Target Collection");
    const project = await store.createProject(sourceCollection.projectCollectionId, "Source");
    await store.updateProject(project.id, {
      description: "source description",
      thumbnailUrl: "data:image/png;base64,source",
      targets: { "wendoo-lang/trg-microbit-v2": { packageVersion: "^0.8.0" } },
    });
    await store.saveProjectFiles(
      project.id,
      new Map([["src/main.ts", { kind: "file", content: "source", etag: "etag-1", isReadonly: false }]])
    );
    await store.saveAppData(project.id, "brains", '{"source":true}');

    const copy = await store.copyProjectToCollection(project.id, targetCollection.projectCollectionId, "Copy");

    assert.notStrictEqual(copy.id, project.id);
    assert.strictEqual(copy.projectCollectionId, targetCollection.projectCollectionId);
    assert.strictEqual(copy.deleted, undefined);
    assert.strictEqual(copy.name, "Copy");
    assert.strictEqual(copy.description, "source description");
    assert.strictEqual(copy.thumbnailUrl, "data:image/png;base64,source");
    assert.deepStrictEqual(copy.targets, { "wendoo-lang/trg-microbit-v2": { packageVersion: "^0.8.0" } });
    assert.strictEqual((await store.loadProjectFiles(copy.id))?.get("src/main.ts")?.kind, "file");
    assert.strictEqual(await store.loadAppData(copy.id, "brains"), '{"source":true}');
    await assertRejectsWithCode(
      () => store.copyProjectToCollection(project.id, "missing", "No Target"),
      AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
    );
  });

  it("tombstones projects when their project collection is tombstoned", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const collection = await store.createProjectCollection("Collection");
    const project = await store.createProject(collection.projectCollectionId, "Member");
    await store.saveAppData(project.id, "brains", '{"member":true}');

    await store.deleteProjectCollection(collection.projectCollectionId);

    assert.strictEqual(await store.getProject(project.id), undefined);
    assert.deepStrictEqual(await store.listProjects(collection.projectCollectionId), []);
    assert.strictEqual(await store.loadAppData(project.id, "brains"), '{"member":true}');

    const rawProject = await (store as TestStoreInternals).db.get("projects", project.id);
    assert.strictEqual(rawProject?.deleted, true);
  });

  it("stores the current project session in sessionStorage only", async () => {
    installStorage("sessionStorage");
    const localStorage = installStorage("localStorage");
    const keyPrefix = nextKeyPrefix();
    localStorage.setItem(`${keyPrefix}:active-project`, "old-project");
    const store = await createIdbProjectStore(keyPrefix);

    assert.strictEqual(store.getProjectSession(), undefined);

    store.setProjectSession({
      projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
      activeProjectId: "current-project",
    });

    assert.deepStrictEqual(store.getProjectSession(), {
      projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
      activeProjectId: "current-project",
    });
    assert.strictEqual(localStorage.getItem(`${keyPrefix}:active-project`), "old-project");
    assert.strictEqual(localStorage.getItem(`${keyPrefix}:project-session`), null);

    store.setProjectSession(undefined);
    assert.strictEqual(store.getProjectSession(), undefined);
  });

  it("stores the last opened project in localStorage so it survives the browser session", async () => {
    const sessionStorage = installStorage("sessionStorage");
    installStorage("localStorage");
    const keyPrefix = nextKeyPrefix();
    const store = await createIdbProjectStore(keyPrefix);

    assert.strictEqual(store.getLastOpenedProject(), undefined);

    store.setLastOpenedProject({
      projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
      projectId: "current-project",
    });
    sessionStorage.clear();

    assert.deepStrictEqual(store.getLastOpenedProject(), {
      projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
      projectId: "current-project",
    });
  });

  it("rejects guarded project writes after project tombstone", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const collection = await store.ensureDefaultProjectCollection();
    const project = await store.createProject(collection.projectCollectionId, "Stale");

    await store.deleteProject(project.id);

    await assertRejectsWithCode(
      () => store.updateProject(project.id, { name: "Nope" }),
      AppHostErrorCode.PROJECT_NOT_FOUND
    );
    await assertRejectsWithCode(
      () =>
        store.saveProjectFiles(
          project.id,
          new Map([["src/main.ts", { kind: "file", content: "x", etag: "etag-1", isReadonly: false }]])
        ),
      AppHostErrorCode.PROJECT_NOT_FOUND
    );
    await assertRejectsWithCode(
      () => store.saveAppData(project.id, "brains", "{}"),
      AppHostErrorCode.PROJECT_NOT_FOUND
    );
  });

  it("rejects guarded writes after project collection tombstone", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const collection = await store.createProjectCollection("Stale Collection");
    const project = await store.createProject(collection.projectCollectionId, "Stale");

    await store.deleteProjectCollection(collection.projectCollectionId);

    await assertRejectsWithCode(
      () => store.updateProjectCollection(collection.projectCollectionId, { name: "Nope" }),
      AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND
    );
    await assertRejectsWithCode(
      () => store.saveAppData(project.id, "brains", "{}"),
      AppHostErrorCode.PROJECT_NOT_FOUND
    );
  });
});

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

function installStorage(name: "sessionStorage" | "localStorage"): Storage {
  const storage = new TestStorage() as Storage;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: storage,
  });
  return storage;
}

function restoreStorage(name: "sessionStorage" | "localStorage", storage: Storage | undefined): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: storage,
  });
}
