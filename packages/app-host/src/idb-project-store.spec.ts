import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createIdbProjectStore,
  DEFAULT_PROJECT_COLLECTION_ID,
  DEFAULT_PROJECT_COLLECTION_NAME,
  type ProjectCollection,
  type ProjectManifest,
  type ProjectStore,
} from "@mindcraft-lang/app-host";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { ProjectFileSystemEntry } from "./project-file-snapshot.js";

let testId = 0;

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
    const first = await store.createProjectCollection("Alpha");
    const second = await store.createProjectCollection("Alpha");

    assert.notStrictEqual(first.projectCollectionId, second.projectCollectionId);
    assert.strictEqual((await store.listProjectCollections()).length, 2);

    await store.updateProjectCollection(first.projectCollectionId, { name: "Beta" });
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

  it("rejects deleting the default collection by id", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const defaultCollection = await store.ensureDefaultProjectCollection();

    await store.updateProjectCollection(defaultCollection.projectCollectionId, {
      name: "Renamed Default",
    });
    const nonDefault = await store.createProjectCollection(DEFAULT_PROJECT_COLLECTION_NAME);

    await assert.rejects(
      () => store.deleteProjectCollection(DEFAULT_PROJECT_COLLECTION_ID),
      /default project collection/i
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

    await assert.rejects(() => store.createProject("missing", "No Collection"), /project collection not found/i);

    const collection = await store.createProjectCollection("Transient");
    await store.deleteProjectCollection(collection.projectCollectionId);
    await assert.rejects(
      () => store.createProject(collection.projectCollectionId, "Tombstoned Collection"),
      /project collection not found/i
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

    await assert.rejects(() => store.deleteProject("missing"), /project not found/i);
    await assert.rejects(() => store.duplicateProject("missing", "Copy"), /project not found/i);
  });

  it("rejects project delete and duplicate when the owning collection is unavailable", async () => {
    const store = await createIdbProjectStore(nextKeyPrefix());
    const collection = await store.createProjectCollection("Owned");
    const project = await store.createProject(collection.projectCollectionId, "Owned Project");
    await (store as TestStoreInternals).db.delete("projectCollections", collection.projectCollectionId);

    assert.strictEqual(await store.getProject(project.id), undefined);
    await assert.rejects(() => store.deleteProject(project.id), /project collection not found/i);
    await assert.rejects(() => store.duplicateProject(project.id, "Copy"), /project not found/i);
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

    const copy = await store.duplicateProject(project.id, "Copy");

    assert.strictEqual(copy.projectCollectionId, collection.projectCollectionId);
    assert.strictEqual((await store.loadProjectFiles(copy.id))?.get("src/main.ts")?.kind, "file");
    assert.strictEqual(await store.loadAppData(copy.id, "brains"), '{"source":true}');
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
});
