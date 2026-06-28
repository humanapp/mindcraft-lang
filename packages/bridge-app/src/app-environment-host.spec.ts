import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type ActiveProject,
  AppHostError,
  createInMemoryProjectFileSystem,
  type ProjectCollection,
  type ProjectCollectionUnlockResult,
  type ProjectFileChange,
  type ProjectFileSnapshot,
  type ProjectFileSystem,
  type ProjectManager,
} from "@mindcraft-lang/app-host";
import { coreModule } from "@mindcraft-lang/core/app";
import { AppEnvironmentHost } from "./app-environment-host.js";

class EmptyProjectFileSystem implements ProjectFileSystem {
  exportSnapshot(): ProjectFileSnapshot {
    return new Map();
  }

  applyRemoteChange(_change: ProjectFileChange): void {}

  applyLocalChange(_change: ProjectFileChange): void {}

  onLocalChange(_listener: (change: ProjectFileChange) => void): () => void {
    return () => {};
  }

  onAnyChange(_listener: () => void): () => void {
    return () => {};
  }

  flush(): void {}
}

function createActiveProject(id: string): ActiveProject {
  return {
    manifest: {
      id,
      projectCollectionId: "collection-1",
      name: id,
      description: "",
      createdAt: 1,
      updatedAt: 1,
    },
    filesystem: new EmptyProjectFileSystem(),
  };
}

function createProjectCollection(): ProjectCollection {
  return {
    projectCollectionId: "collection-1",
    name: "Collection",
    createdAt: 1,
    updatedAt: 1,
  };
}

function installEmptyLocalStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage: Storage = {
    get length(): number {
      return 0;
    },
    clear(): void {},
    getItem(): string | null {
      return null;
    },
    key(): string | null {
      return null;
    },
    removeItem(): void {},
    setItem(): void {},
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  return () => {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
      return;
    }
    Reflect.deleteProperty(globalThis, "localStorage");
  };
}

const CORE_AMBIENT = readFileSync(
  fileURLToPath(new URL("../../core/ambient/mindcraft.core.d.ts", import.meta.url)),
  "utf8"
);

const NO_ID_SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "scan",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;

function stubProjectManager(filesystem: ProjectFileSystem): ProjectManager {
  return {
    activeProject: {
      manifest: {
        id: "p1",
        projectCollectionId: "collection-1",
        name: "p1",
        description: "",
        createdAt: 1,
        updatedAt: 1,
      },
      filesystem,
    } as ActiveProject,
    activeProjectCollection: createProjectCollection(),
    async init(): Promise<void> {},
    async getProjectCollectionState(): Promise<{ access: "ready" }> {
      return { access: "ready" };
    },
    async ensureDefaultProject(): Promise<void> {},
    async saveAppData(): Promise<void> {},
    async loadAppData(): Promise<string | undefined> {
      return undefined;
    },
    dispose(): void {},
  } as unknown as ProjectManager;
}

describe("AppEnvironmentHost user-action id write-back", () => {
  it("mints a stable id for an id-less tile and writes it back into the source on compile", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem();
    filesystem.applyLocalChange({
      action: "write",
      path: "tiles/scan.ts",
      content: NO_ID_SENSOR_SOURCE,
      newEtag: "e1",
    });

    const host = new AppEnvironmentHost({
      projectManager: stubProjectManager(filesystem),
      modules: [coreModule()],
      ambientFiles: [{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }],
      host: { name: "test", version: "0.0.0" },
    });

    try {
      await host.initialize("p1");

      const written = filesystem.exportSnapshot().get("tiles/scan.ts");
      assert.ok(written && written.kind === "file");
      const idMatch = written.content.match(/id: "([A-Za-z0-9]{16})"/);
      assert.ok(idMatch, `expected a minted id written back into the source, got:\n${written.content}`);
      assert.match(written.content, /name: "scan"/);

      const metadata = host.lastUserTileMetadata;
      assert.ok(metadata && metadata.length === 1);
      assert.equal(metadata[0].id, idMatch[1]);
      assert.equal(metadata[0].key, `user.sensor.${idMatch[1]}`);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});

describe("AppEnvironmentHost project transitions", () => {
  it("does not emit project unloading when switching fails before the active project changes", async () => {
    const activeProject = createActiveProject("active");
    const saveAppDataCalls: Array<{ key: string; data: string }> = [];
    const projectManager = {
      activeProject,
      activeProjectCollection: createProjectCollection(),
      async saveAppData(key: string, data: string): Promise<void> {
        saveAppDataCalls.push({ key, data });
      },
      async open(): Promise<ActiveProject> {
        throw new AppHostError("PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB", "Project is already open in another tab");
      },
    } as unknown as ProjectManager;
    const host = new AppEnvironmentHost({
      projectManager,
      modules: [],
      ambientFiles: [],
      host: { name: "test", version: "0.0.0" },
    });
    let unloadingCalls = 0;
    host.onProjectUnloading(() => {
      unloadingCalls++;
    });

    await assert.rejects(
      () => host.switchProject("other"),
      (error) => error instanceof AppHostError && error.code === "PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB"
    );

    assert.deepStrictEqual(saveAppDataCalls, [{ key: "brains", data: "{}" }]);
    assert.strictEqual(unloadingCalls, 0);
  });

  it("flushes app-owned project state before locking the active project collection and reloads without resaving on unlock", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const activeProject = createActiveProject("active");
    const saveAppDataCalls: Array<{ key: string; data: string }> = [];
    const events: string[] = [];
    const projectManagerStub: {
      activeProject: ActiveProject | undefined;
      activeProjectCollection: ProjectCollection;
      saveAppData(key: string, data: string): Promise<void>;
      loadAppData(key: string): Promise<string | undefined>;
      deleteAppData(key: string): Promise<void>;
      lockProjectCollection(
        projectCollectionId: string,
        options?: { beforeActiveProjectChange?: () => void }
      ): Promise<void>;
      unlockProjectCollection(projectCollectionId: string, pin: string): Promise<ProjectCollectionUnlockResult>;
    } = {
      activeProject,
      activeProjectCollection: createProjectCollection(),
      async saveAppData(key: string, data: string): Promise<void> {
        events.push(`save:${key}`);
        saveAppDataCalls.push({ key, data });
      },
      async loadAppData(key: string): Promise<string | undefined> {
        events.push(`load:${key}`);
        return undefined;
      },
      async deleteAppData(key: string): Promise<void> {
        events.push(`delete:${key}`);
      },
      async lockProjectCollection(
        _projectCollectionId: string,
        options?: { beforeActiveProjectChange?: () => void }
      ): Promise<void> {
        events.push("lock");
        options?.beforeActiveProjectChange?.();
        projectManagerStub.activeProject = undefined;
      },
      async unlockProjectCollection(): Promise<ProjectCollectionUnlockResult> {
        events.push("unlock");
        projectManagerStub.activeProject = activeProject;
        return { collection: projectManagerStub.activeProjectCollection, access: "ready" };
      },
    };
    const projectManager = projectManagerStub as unknown as ProjectManager;
    const host = new AppEnvironmentHost({
      projectManager,
      modules: [],
      ambientFiles: [],
      host: { name: "test", version: "0.0.0" },
    });
    const unloadingProjectIds: Array<string | undefined> = [];
    host.onProjectUnloading(() => {
      events.push(`unload:${host.activeProjectManifest?.id ?? ""}`);
      unloadingProjectIds.push(host.activeProjectManifest?.id);
    });
    host.onProjectLoaded(() => {
      events.push("loaded");
    });

    try {
      await host.lockProjectCollection("collection-1");
      await host.unlockProjectCollection("collection-1", "1234");
    } finally {
      restoreLocalStorage();
    }

    assert.deepStrictEqual(saveAppDataCalls, [{ key: "brains", data: "{}" }]);
    assert.deepStrictEqual(unloadingProjectIds, ["active"]);
    assert.deepStrictEqual(events, [
      "save:brains",
      "lock",
      "unload:active",
      "unlock",
      "load:user-tile-metadata",
      "delete:user-tile-metadata",
      "load:brains",
      "loaded",
    ]);
    assert.strictEqual(host.activeProjectManifest?.id, "active");
  });
});
