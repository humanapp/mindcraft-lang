import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PROJECT_COLLECTION_ID, type ProjectManifest } from "@mindcraft-lang/app-host";
import { MemoryProjectStore } from "./memory-project-store.js";

function storeWithVersionlessProject(): MemoryProjectStore {
  const now = 1000;
  const versionless = {
    id: "p1",
    projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
    name: "Legacy",
    description: "",
    createdAt: now,
    updatedAt: now,
  } as unknown as ProjectManifest;
  return new MemoryProjectStore("test-app", {
    projectCollections: [
      { projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID, name: "Default", createdAt: now, updatedAt: now },
    ],
    projects: [versionless],
    projectFiles: new Map(),
    appData: new Map(),
  });
}

describe("MemoryProjectStore content version default", () => {
  it("defaults a version-less stored manifest to the lowest content version on getProject", async () => {
    const store = storeWithVersionlessProject();
    const project = await store.getProject("p1");
    assert.strictEqual(project?.version, "0.0.0");
  });

  it("defaults a version-less stored manifest to the lowest content version on listProjects", async () => {
    const store = storeWithVersionlessProject();
    const [listed] = await store.listProjects(DEFAULT_PROJECT_COLLECTION_ID);
    assert.strictEqual(listed.version, "0.0.0");
  });
});
