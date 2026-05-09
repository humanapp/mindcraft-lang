import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createIdbProjectStore,
  DEFAULT_PROJECT_COLLECTION_ID,
  DEFAULT_PROJECT_COLLECTION_NAME,
  type ProjectCollection,
  type ProjectStore,
} from "@mindcraft-lang/app-host";

let testId = 0;

function nextKeyPrefix(): string {
  testId += 1;
  return `idb-project-store-test-${testId}`;
}

type TestStoreInternals = ProjectStore & {
  db: {
    add(storeName: "projectCollections", value: ProjectCollection, key?: IDBValidKey): Promise<IDBValidKey>;
  };
};

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
      if (storeName === "projectCollections" && value.projectCollectionId === DEFAULT_PROJECT_COLLECTION_ID) {
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
