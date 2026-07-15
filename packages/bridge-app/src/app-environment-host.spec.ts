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
import type { IBrainDef, MindcraftBrain } from "@mindcraft-lang/core/app";
import { BrainDef, CoreTypeIds, coreModule, List, mkSensorTileId } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { declarationMount, type WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import { AppEnvironmentHost } from "./app-environment-host.js";
import type { EmbeddedExtension } from "./embedded-extensions.js";

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
      version: "0.1.0",
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
        version: "0.1.0",
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
      mounts: [declarationMount([{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }])],
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
      assert.equal(metadata[0].key, `${host.projectManager.activeProject!.manifest.id}:user.sensor.${idMatch[1]}`);
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
      async loadAppData(): Promise<string | undefined> {
        return undefined;
      },
      async open(): Promise<ActiveProject> {
        throw new AppHostError("PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB", "Project is already open in another tab");
      },
    } as unknown as ProjectManager;
    const host = new AppEnvironmentHost({
      projectManager,
      modules: [],
      mounts: [],
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
      mounts: [],
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
      "load:brains",
      "save:brains",
      "lock",
      "unload:active",
      "unlock",
      "load:brains",
      "loaded",
    ]);
    assert.strictEqual(host.activeProjectManifest?.id, "active");
  });

  it("clears the outgoing project's user types on unload", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const activeProject = createActiveProject("active");
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
    } = {
      activeProject,
      activeProjectCollection: createProjectCollection(),
      async saveAppData(): Promise<void> {},
      async loadAppData(): Promise<string | undefined> {
        return undefined;
      },
      async deleteAppData(): Promise<void> {},
      async lockProjectCollection(
        _projectCollectionId: string,
        options?: { beforeActiveProjectChange?: () => void }
      ): Promise<void> {
        options?.beforeActiveProjectChange?.();
        projectManagerStub.activeProject = undefined;
      },
    };
    const host = new AppEnvironmentHost({
      projectManager: projectManagerStub as unknown as ProjectManager,
      modules: [coreModule()],
      mounts: [],
    });

    const types = host.env.brainServices.runtime.types;
    const typeName = "active:/main.ts::Probe";
    types.withOwner("dynamic", () =>
      types.addStructType(typeName, {
        fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
      })
    );
    assert.ok(types.resolveByName(typeName));

    try {
      await host.lockProjectCollection("collection-1");
    } finally {
      restoreLocalStorage();
    }

    assert.strictEqual(types.resolveByName(typeName), undefined);
  });
});

// ---------------------------------------------------------------------------
// Key-namespace migration of saved brains
// ---------------------------------------------------------------------------

const PROJECT_ID = "p1";

const POSITION_SOURCE = `import { NumberType, type StructOf, StructType } from "mindcraft";

export const Position = StructType({
  name: "Position",
  fields: { x: NumberType, y: NumberType },
  accessors: true,
  variables: true,
});

export type Position = StructOf<typeof Position>;
`;

const STICK_SENSOR_SOURCE = `import { type Context, Sensor } from "mindcraft";
import { Position } from "./position";

export default Sensor({
  id: "stickSensor12345",
  name: "stick",
  inline: true,
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 1, y: 2 });
  },
});
`;

/** A saved brain that references platform tiles only. */
function platformOnlyBrain(): Record<string, unknown> {
  return {
    version: 1,
    id: "brain00000000002",
    name: "Platform Brain",
    catalog: [
      {
        version: 2,
        kind: "literal",
        tileId: "tile.literal->number:<number>->7",
        valueType: "number:<number>",
        value: 7,
        valueLabel: "7",
        displayFormat: "default",
      },
    ],
    pages: [
      {
        version: 2,
        pageId: "page000000000002",
        name: "Page 1",
        rules: [{ version: 1, when: [], do: [], children: [] }],
      },
    ],
  };
}

interface AppDataStub {
  projectManager: ProjectManager;
  appData: Map<string, string>;
  savedKeys: string[];
}

function stubProjectManagerWithAppData(
  filesystem: ProjectFileSystem,
  appData: Map<string, string>,
  projectId: string = PROJECT_ID
): AppDataStub {
  const savedKeys: string[] = [];
  let activeProject: ActiveProject = {
    manifest: {
      id: projectId,
      projectCollectionId: "collection-1",
      name: projectId,
      description: "",
      createdAt: 1,
      updatedAt: 1,
    },
    filesystem,
  } as ActiveProject;
  const projectManager = {
    get activeProject(): ActiveProject {
      return activeProject;
    },
    activeProjectCollection: createProjectCollection(),
    async init(): Promise<void> {},
    async getProjectCollectionState(): Promise<{ access: "ready" }> {
      return { access: "ready" };
    },
    async ensureDefaultProject(): Promise<void> {},
    async open(id: string, options?: { beforeActiveProjectChange?: () => void }): Promise<ActiveProject> {
      options?.beforeActiveProjectChange?.();
      activeProject = createActiveProject(id);
      return activeProject;
    },
    async saveAppData(key: string, data: string): Promise<void> {
      savedKeys.push(key);
      appData.set(key, data);
    },
    async loadAppData(key: string): Promise<string | undefined> {
      return appData.get(key);
    },
    async deleteAppData(key: string): Promise<void> {
      appData.delete(key);
    },
    dispose(): void {},
  } as unknown as ProjectManager;
  return { projectManager, appData, savedKeys };
}

function createUserTileFilesystem(): ProjectFileSystem {
  const filesystem = createInMemoryProjectFileSystem();
  filesystem.applyLocalChange({ action: "write", path: "position.ts", content: POSITION_SOURCE, newEtag: "e1" });
  filesystem.applyLocalChange({ action: "write", path: "stick.ts", content: STICK_SENSOR_SOURCE, newEtag: "e2" });
  return filesystem;
}

function createHost(projectManager: ProjectManager): AppEnvironmentHost {
  return new AppEnvironmentHost({
    projectManager,
    modules: [coreModule()],
    mounts: [declarationMount([{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }])],
  });
}

function collectTileIdsByKind(brainDef: IBrainDef, kind: string): string[] {
  const collected: string[] = [];
  const pages = brainDef.pages();
  for (let p = 0; p < pages.size(); p++) {
    const rules = pages.get(p)!.children();
    for (let r = 0; r < rules.size(); r++) {
      const rule = rules.get(r)!;
      for (const side of [rule.when(), rule.do()]) {
        const tiles = side.tiles();
        for (let t = 0; t < tiles.size(); t++) {
          const tile = tiles.get(t)!;
          if (tile.kind === kind) {
            collected.push(tile.tileId);
          }
        }
      }
    }
  }
  return collected;
}

describe("AppEnvironmentHost namespaced-key save and reload", () => {
  it("stores own-tile references namespace-relative and reloads them with no re-persist", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const appData = new Map<string, string>();
    const stub = stubProjectManagerWithAppData(createUserTileFilesystem(), appData);
    const host = createHost(stub.projectManager);
    try {
      await host.initialize(PROJECT_ID);

      const metadata = host.lastUserTileMetadata;
      assert.ok(metadata, "the user tile must compile");
      const sensor = metadata.find((entry) => entry.kind === "sensor");
      assert.ok(sensor, "the sensor tile must compile");
      const sensorKey = sensor.key;
      const outputType = sensor.outputType;
      assert.ok(outputType, "the sensor must produce a struct output type");

      // The compiler mints namespaced keys: a placed tile carries exactly these.
      assert.ok(
        sensorKey.startsWith(`${PROJECT_ID}:user.sensor.`),
        `sensor key must be namespaced, not bare: ${sensorKey}`
      );
      assert.ok(outputType.includes(`<${PROJECT_ID}:`), `struct type id must be namespaced: ${outputType}`);

      // A brain built from the minted keys is exactly what the save path writes.
      const brainJson = {
        version: 1,
        id: "brain00000000010",
        name: "Namespaced Brain",
        catalog: [
          {
            version: 1,
            kind: "variable",
            tileId: "tile.var->posvar0000000010",
            varName: "pos",
            varType: outputType,
            uniqueId: "posvar0000000010",
          },
        ],
        pages: [
          {
            version: 2,
            pageId: "page000000000010",
            name: "Page 1",
            rules: [
              {
                version: 1,
                when: [`tile.sensor->${sensorKey}`, `tile.accessor->${outputType}->x`],
                do: [],
                children: [],
              },
            ],
          },
        ],
      };

      const built = host.env.deserializeBrainJsonFromPlain(brainJson, PROJECT_ID);
      assert.deepEqual(collectTileIdsByKind(built, "missing"), [], "minted-key brain resolves with no migration");

      // In memory the brain carries fully qualified keys.
      const inMemory = JSON.stringify(built.toJson());
      assert.ok(inMemory.includes(`${PROJECT_ID}:user.sensor.`), "the in-memory brain carries the qualified key");

      await host.saveBrainForKey("robot", built);

      // On disk the own-namespace references are stored structured with the
      // namespace absent.
      const actionId = sensorKey.slice(`${PROJECT_ID}:user.sensor.`.length);
      const stored = appData.get("brains")!;
      assert.ok(
        stored.includes(`{"k":"action","area":"sensor","id":"${actionId}"}`),
        "the stored sensor reference is structured with the namespace absent"
      );
      assert.ok(
        stored.includes('{"k":"named","t":"struct","name":"/position.ts::Position"}'),
        "the stored struct type is structured with the namespace absent"
      );
      assert.ok(!stored.includes(`${PROJECT_ID}:`), "the stored brain never embeds the owning project id");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }

    // A fresh host loads the saved brain as-is: every reference resolves and the
    // record is not re-persisted, because no load-time rewrite runs.
    const restoreAgain = installEmptyLocalStorage();
    const secondStub = stubProjectManagerWithAppData(createUserTileFilesystem(), appData);
    const secondHost = createHost(secondStub.projectManager);
    try {
      await secondHost.initialize(PROJECT_ID);
      const reloaded = secondHost.getCachedBrain("robot");
      assert.ok(reloaded, "the saved brain must reload");
      assert.deepEqual(collectTileIdsByKind(reloaded, "missing"), [], "reloaded brain resolves with no migration");
      assert.deepEqual(
        secondStub.savedKeys.filter((key) => key === "brains"),
        [],
        "a loaded record is never re-persisted"
      );
    } finally {
      secondHost.dispose();
      restoreAgain();
    }
  });

  it("resolves a saved brain's own-tile references after import mints a new project id", async () => {
    // Import copies the brains blob verbatim into a project with a freshly
    // minted id, so the saved form must not bind the source project's
    // namespace into its own tile and type references.
    const appData = new Map<string, string>();
    const restoreLocalStorage = installEmptyLocalStorage();
    const stub = stubProjectManagerWithAppData(createUserTileFilesystem(), appData);
    const host = createHost(stub.projectManager);
    try {
      await host.initialize(PROJECT_ID);
      const metadata = host.lastUserTileMetadata;
      assert.ok(metadata, "the user tile must compile");
      const sensor = metadata.find((entry) => entry.kind === "sensor");
      assert.ok(sensor?.outputType, "the sensor tile must compile with a struct output type");
      const outputType = sensor.outputType;

      const brainJson = {
        version: 1,
        id: "brain00000000020",
        name: "Imported Brain",
        catalog: [
          {
            version: 1,
            kind: "variable",
            tileId: "tile.var->posvar0000000020",
            varName: "pos",
            varType: outputType,
            uniqueId: "posvar0000000020",
          },
        ],
        pages: [
          {
            version: 2,
            pageId: "page000000000020",
            name: "Page 1",
            rules: [
              {
                version: 1,
                when: [`tile.sensor->${sensor.key}`, `tile.accessor->${outputType}->x`],
                do: [],
                children: [],
              },
            ],
          },
        ],
      };
      const built = host.env.deserializeBrainJsonFromPlain(brainJson, PROJECT_ID);
      assert.deepEqual(collectTileIdsByKind(built, "missing"), [], "the brain resolves in its owning project");
      await host.saveBrainForKey("robot", built);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }

    // The importing host: same files, same brains blob, new project id.
    const importedProjectId = "p2imported000001";
    const restoreAgain = installEmptyLocalStorage();
    const importedStub = stubProjectManagerWithAppData(createUserTileFilesystem(), appData, importedProjectId);
    const importedHost = createHost(importedStub.projectManager);
    try {
      await importedHost.initialize(importedProjectId);

      const importedMetadata = importedHost.lastUserTileMetadata;
      const importedSensor = importedMetadata?.find((entry) => entry.kind === "sensor");
      assert.ok(importedSensor?.outputType, "the imported project's sensor must compile");
      assert.ok(
        importedSensor.key.startsWith(`${importedProjectId}:user.sensor.`),
        "the imported project registers its tiles under the minted id"
      );

      const reloaded = importedHost.getCachedBrain("robot");
      assert.ok(reloaded, "the imported brain must load");
      assert.deepEqual(
        collectTileIdsByKind(reloaded, "missing"),
        [],
        "the imported brain's own-tile references resolve under the minted project id"
      );
      const variableTile = reloaded.catalog().get("tile.var->posvar0000000020");
      assert.ok(variableTile && variableTile.kind === "variable");
      assert.equal(
        (variableTile as { varType?: string }).varType,
        importedSensor.outputType,
        "the variable's struct type follows the loading project's namespace"
      );
    } finally {
      importedHost.dispose();
      restoreAgain();
    }
  });

  it("stores extension references absolute while own references stay relative, and both survive import", async () => {
    const POS_COORDINATE = "mindcraft-lang/pos-lib";
    const POS_EXTENSION: EmbeddedExtension = {
      canonicalOrigin: POS_COORDINATE,
      files: [
        {
          path: "index.ts",
          content: `import { type Context, NumberType, Sensor, type StructOf, StructType } from "mindcraft";

export const EPos = StructType({
  name: "EPos",
  fields: { x: NumberType, y: NumberType },
  accessors: true,
  variables: true,
});

export type EPos = StructOf<typeof EPos>;

export default Sensor({
  id: "extStick00000001",
  name: "ext stick",
  inline: true,
  returnType: EPos,
  onExecute(ctx: Context): EPos {
    return EPos({ x: 1, y: 2 });
  },
});
`,
        },
      ],
    };
    const buildHost = (projectManager: ProjectManager): AppEnvironmentHost =>
      new AppEnvironmentHost({
        projectManager,
        modules: [coreModule()],
        mounts: [declarationMount([{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }])],
        embeddedExtensions: [POS_EXTENSION],
      });
    const installExtension = (stub: AppDataStub): void => {
      (stub.projectManager.activeProject!.manifest as { extensions?: Record<string, string> }).extensions = {
        [POS_COORDINATE]: `embedded:${POS_COORDINATE}`,
      };
    };
    const findByActionId = (host: AppEnvironmentHost, id: string) =>
      host.lastUserTileMetadata?.find((entry) => entry.id === id);

    const appData = new Map<string, string>();
    const restoreLocalStorage = installEmptyLocalStorage();
    const stub = stubProjectManagerWithAppData(createUserTileFilesystem(), appData);
    installExtension(stub);
    const host = buildHost(stub.projectManager);
    try {
      await host.initialize(PROJECT_ID);
      const ownSensor = findByActionId(host, "stickSensor12345");
      const extSensor = findByActionId(host, "extStick00000001");
      assert.ok(ownSensor?.outputType, "the project's own sensor must compile");
      assert.ok(extSensor?.outputType, "the extension's sensor must compile");
      assert.ok(extSensor.key.startsWith(`${POS_COORDINATE}:user.sensor.`), "the extension key carries its coordinate");

      const brainJson = {
        version: 1,
        id: "brain00000000030",
        name: "Mixed Brain",
        catalog: [
          {
            version: 1,
            kind: "variable",
            tileId: "tile.var->ownvar0000000030",
            varName: "own",
            varType: ownSensor.outputType,
            uniqueId: "ownvar0000000030",
          },
          {
            version: 1,
            kind: "variable",
            tileId: "tile.var->extvar0000000030",
            varName: "ext",
            varType: extSensor.outputType,
            uniqueId: "extvar0000000030",
          },
        ],
        pages: [
          {
            version: 2,
            pageId: "page000000000030",
            name: "Page 1",
            rules: [
              {
                version: 1,
                when: [`tile.sensor->${ownSensor.key}`, `tile.sensor->${extSensor.key}`],
                do: [],
                children: [],
              },
            ],
          },
        ],
      };
      const built = host.env.deserializeBrainJsonFromPlain(brainJson, PROJECT_ID);
      assert.deepEqual(collectTileIdsByKind(built, "missing"), [], "the mixed brain resolves in its owning project");
      await host.saveBrainForKey("mixed", built);

      const stored = appData.get("brains")!;
      assert.ok(
        stored.includes('{"k":"action","area":"sensor","id":"stickSensor12345"}'),
        "own reference stored structured with the namespace absent"
      );
      assert.ok(
        stored.includes(`{"k":"action","area":"sensor","id":"extStick00000001","ns":"${POS_COORDINATE}"}`),
        "extension reference carries its coordinate namespace"
      );
      assert.ok(
        stored.includes('{"k":"named","t":"struct","name":"/position.ts::Position"}'),
        "own struct type stored structured with the namespace absent"
      );
      assert.ok(
        stored.includes(`{"k":"named","t":"struct","name":"/index.ts::EPos","ns":"${POS_COORDINATE}"}`),
        "extension struct type carries its coordinate namespace"
      );
      assert.ok(!stored.includes(`${PROJECT_ID}:`), "the stored brain never embeds the owning project id");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }

    // Import: same files, same extension install, same brains blob, new id.
    const importedProjectId = "p3imported000001";
    const restoreAgain = installEmptyLocalStorage();
    const importedStub = stubProjectManagerWithAppData(createUserTileFilesystem(), appData, importedProjectId);
    installExtension(importedStub);
    const importedHost = buildHost(importedStub.projectManager);
    try {
      await importedHost.initialize(importedProjectId);
      const ownSensor = findByActionId(importedHost, "stickSensor12345");
      const extSensor = findByActionId(importedHost, "extStick00000001");
      assert.ok(ownSensor?.outputType && extSensor?.outputType);

      const reloaded = importedHost.getCachedBrain("mixed");
      assert.ok(reloaded, "the imported mixed brain must load");
      assert.deepEqual(collectTileIdsByKind(reloaded, "missing"), [], "own and extension references both resolve");
      const ownVar = reloaded.catalog().get("tile.var->ownvar0000000030") as { varType?: string } | undefined;
      const extVar = reloaded.catalog().get("tile.var->extvar0000000030") as { varType?: string } | undefined;
      assert.equal(ownVar?.varType, ownSensor.outputType, "the own struct type follows the loading project");
      assert.equal(extVar?.varType, extSensor.outputType, "the extension struct type stays coordinate-qualified");
    } finally {
      importedHost.dispose();
      restoreAgain();
    }
  });

  it("leaves a platform-only brain record untouched", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const storedRecord = JSON.stringify({ only: platformOnlyBrain() });
    const appData = new Map<string, string>([["brains", storedRecord]]);
    const stub = stubProjectManagerWithAppData(createInMemoryProjectFileSystem(), appData);
    const host = createHost(stub.projectManager);

    try {
      await host.initialize(PROJECT_ID);

      assert.ok(host.getCachedBrain("only"));
      assert.deepEqual(
        stub.savedKeys.filter((key) => key === "brains"),
        []
      );
      assert.equal(appData.get("brains"), storedRecord);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});

// ---------------------------------------------------------------------------
// Brain persistence across project switches
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Embedded extensions and the stdlib import migration
// ---------------------------------------------------------------------------

const DEMO_REPO = "demo-lib";
const DEMO_COORDINATE = `mindcraft-lang/${DEMO_REPO}`;
const DEMO_REFERENCE = `embedded:${DEMO_COORDINATE}`;

/** A minimal embedded extension whose entry re-exports a pure helper. */
const DEMO_EXTENSION: EmbeddedExtension = {
  canonicalOrigin: DEMO_COORDINATE,
  files: [
    { path: "index.ts", content: 'export { level } from "./level";\n' },
    { path: "level.ts", content: "export function level(): number {\n  return 7;\n}\n" },
  ],
};

/** A sensor whose value comes from the embedded extension's helper, imported via `@ext`. */
const EXT_SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";
import { level } from "@ext/mindcraft-lang/demo-lib";

export default Sensor({
  id: "extSensor00000001",
  name: "level",
  onExecute(ctx: Context): number {
    return level();
  },
});
`;

function createEmbeddedExtensionHost(projectManager: ProjectManager): AppEnvironmentHost {
  return new AppEnvironmentHost({
    projectManager,
    modules: [coreModule()],
    mounts: [declarationMount([{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }])],
    embeddedExtensions: [DEMO_EXTENSION],
  });
}

/**
 * A project manager stub whose `updateActive` replaces the active project's
 * manifest object with the applied updates merged over the previous manifest.
 */
function stubProjectManagerWithLiveExtensions(
  filesystem: ProjectFileSystem,
  initialExtensions: Record<string, string>
): ProjectManager {
  let activeProject: ActiveProject = {
    manifest: {
      id: PROJECT_ID,
      projectCollectionId: "collection-1",
      name: PROJECT_ID,
      version: "0.1.0",
      description: "",
      createdAt: 1,
      updatedAt: 1,
      extensions: initialExtensions,
    },
    filesystem,
  } as ActiveProject;
  return {
    get activeProject(): ActiveProject {
      return activeProject;
    },
    activeProjectCollection: createProjectCollection(),
    async init(): Promise<void> {},
    async getProjectCollectionState(): Promise<{ access: "ready" }> {
      return { access: "ready" };
    },
    async ensureDefaultProject(): Promise<void> {},
    async updateActive(updates: { extensions?: Record<string, string> }): Promise<void> {
      activeProject = {
        manifest: { ...activeProject.manifest, ...updates },
        filesystem: activeProject.filesystem,
      } as ActiveProject;
    },
    async saveAppData(): Promise<void> {},
    async loadAppData(): Promise<string | undefined> {
      return undefined;
    },
    async deleteAppData(): Promise<void> {},
    dispose(): void {},
  } as unknown as ProjectManager;
}

describe("AppEnvironmentHost live extension changes", () => {
  it("materializes an installed add-on's tree live and de-materializes it on uninstall", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem();
    filesystem.applyLocalChange({ action: "write", path: "level.ts", content: EXT_SENSOR_SOURCE, newEtag: "e1" });
    const projectManager = stubProjectManagerWithLiveExtensions(filesystem, {});

    // Capture every compile: the `@ext` import in level.ts resolves only while
    // the add-on's source is materialized under `.extensions/`, so a compile
    // error there is the observable signal that the tree is absent.
    let latest: WorkspaceCompileResult | undefined;
    const host = new AppEnvironmentHost({
      projectManager,
      modules: [coreModule()],
      mounts: [declarationMount([{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }])],
      embeddedExtensions: [DEMO_EXTENSION],
      onDidCompile: (result) => {
        latest = result;
      },
    });

    const levelHasError = (): boolean => {
      for (const [path, diagnostics] of latest?.files ?? []) {
        if (path.endsWith("level.ts") && diagnostics.some((d) => d.severity === "error")) {
          return true;
        }
      }
      return false;
    };
    const hasLevelTile = (): boolean =>
      (host.lastUserTileMetadata ?? []).some((entry) => entry.id === "extSensor00000001");

    try {
      await host.initialize(PROJECT_ID);

      // Uninstalled: the `@ext` import is unresolved, so level.ts fails to compile
      // and no tile is produced.
      assert.equal(levelHasError(), true, "the @ext import is unresolved while the add-on is uninstalled");
      assert.equal(hasLevelTile(), false, "no sensor tile is registered while the add-on is uninstalled");

      // Install through the same path the browser drives; no project transition.
      await host.updateProjectExtensions({ [DEMO_COORDINATE]: DEMO_REFERENCE });
      assert.equal(levelHasError(), false, "installing live materializes .extensions so the @ext import resolves");
      assert.equal(hasLevelTile(), true, "the sensor compiles into a user tile once the add-on is installed live");

      // Uninstall live: the mount drops, `.extensions/mindcraft-lang/demo-lib`
      // de-materializes, and the import is unresolved once more.
      await host.updateProjectExtensions({});
      assert.equal(levelHasError(), true, "uninstalling live de-materializes .extensions and the import fails again");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});

describe("AppEnvironmentHost embedded extensions", () => {
  it("compiles user code that imports an embedded extension via @ext", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem();
    filesystem.applyLocalChange({ action: "write", path: "level.ts", content: EXT_SENSOR_SOURCE, newEtag: "e1" });
    const appData = new Map<string, string>();
    const stub = stubProjectManagerWithAppData(filesystem, appData);
    (stub.projectManager.activeProject!.manifest as { extensions?: Record<string, string> }).extensions = {
      [DEMO_COORDINATE]: DEMO_REFERENCE,
    };
    const host = createEmbeddedExtensionHost(stub.projectManager);

    try {
      await host.initialize(PROJECT_ID);
      const metadata = host.lastUserTileMetadata;
      assert.ok(metadata && metadata.length === 1, "the @ext-importing sensor must compile into a user tile");
      assert.equal(metadata[0].id, "extSensor00000001");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});

describe("AppEnvironmentHost brain persistence across project switches", () => {
  it("preserves the stored bytes of a brain that fails to deserialize", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const unsupportedBrain = { version: 999, id: "brain00000000003", name: "Future Brain", catalog: [], pages: [] };
    const appData = new Map<string, string>([
      ["brains", JSON.stringify({ good: platformOnlyBrain(), bad: unsupportedBrain })],
    ]);
    const stub = stubProjectManagerWithAppData(createInMemoryProjectFileSystem(), appData);
    const host = createHost(stub.projectManager);

    try {
      await host.initialize(PROJECT_ID);

      assert.ok(host.getCachedBrain("good"), "the valid brain must load");
      assert.equal(host.getCachedBrain("bad"), undefined, "the fixture must fail to deserialize");

      await host.switchProject("p2");

      const persisted = JSON.parse(appData.get("brains")!) as Record<string, unknown>;
      assert.deepStrictEqual(persisted.bad, unsupportedBrain, "the unloadable entry must survive the switch");
      assert.ok(persisted.good, "the loadable brain must survive the switch");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});

// ---------------------------------------------------------------------------
// Compile-scheduled brain rebuild (the per-tick flush revives born-broke brains)
// ---------------------------------------------------------------------------

const SIGNAL_REPO = "signal-lib";
const SIGNAL_COORDINATE = `mindcraft-lang/${SIGNAL_REPO}`;
const SIGNAL_REFERENCE = `embedded:${SIGNAL_COORDINATE}`;
const SIGNAL_SENSOR_ID = "signalSensor0001";

/** The bundle action key the extension's sensor publishes when installed. */
const SIGNAL_ACTION_KEY = `${SIGNAL_COORDINATE}:user.sensor.${SIGNAL_SENSOR_ID}`;

/** An embedded extension whose entry publishes one sensor action into the bundle. */
const SIGNAL_EXTENSION: EmbeddedExtension = {
  canonicalOrigin: SIGNAL_COORDINATE,
  files: [
    {
      path: "index.ts",
      content: `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "${SIGNAL_SENSOR_ID}",
  name: "signal",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`,
    },
  ],
};

/** A host-owned sensor that keeps the bundle non-empty whether or not the extension is installed. */
const HOST_SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "hostSensor000001",
  name: "host signal",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;

function findBundleTile(tiles: readonly IBrainTileDef[], tileId: string): IBrainTileDef {
  for (const tile of tiles) {
    if (tile.tileId === tileId) return tile;
  }
  throw new Error(`tile ${tileId} not found in bundle`);
}

/** True when the brain's linked program binds the given bytecode action key. */
function brainBindsAction(brain: MindcraftBrain, key: string): boolean {
  const actions = brain.getProgram()?.actions;
  if (!actions) return false;
  for (let i = 0; i < actions.size(); i++) {
    if (actions.get(i).descriptor.key === key) return true;
  }
  return false;
}

describe("AppEnvironmentHost compile-scheduled brain rebuild", () => {
  it("revives a born-broke brain through the per-tick flush after a compile changes the action bundle", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem();
    filesystem.applyLocalChange({ action: "write", path: "main.ts", content: HOST_SENSOR_SOURCE, newEtag: "e1" });
    const projectManager = stubProjectManagerWithLiveExtensions(filesystem, {
      [SIGNAL_COORDINATE]: SIGNAL_REFERENCE,
    });

    let latestTiles: readonly IBrainTileDef[] = [];
    const host = new AppEnvironmentHost({
      projectManager,
      modules: [coreModule()],
      mounts: [declarationMount([{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }])],
      embeddedExtensions: [SIGNAL_EXTENSION],
      onDidCompile: (result) => {
        if (result.bundle) {
          latestTiles = result.bundle.tiles;
        }
      },
    });

    try {
      await host.initialize(PROJECT_ID);

      // The extension is installed, so its sensor action is in the live bundle.
      // Capture the tile and build a brain whose rule binds that action.
      const signalTile = findBundleTile(latestTiles, mkSensorTileId(SIGNAL_ACTION_KEY));
      const def = BrainDef.emptyBrainDef(host.env.brainServices, "signal-brain");
      def.pages().get(0)!.children().get(0)!.when().appendTile(signalTile);

      // Uninstall the extension: the recompile drops the sensor action from the
      // bundle. Flush any rebuild it scheduled so none is pending before the
      // born-broke brain exists.
      await host.updateProjectExtensions({});
      host.flushPendingBrainRebuilds();

      // Born broke: created while its action is missing, the brain fails its
      // initial build and is tracked in the invalidated set for retry.
      const brain = host.env.createBrain(def);
      assert.equal(brain.status, "invalidated", "the brain is born invalidated while its action is missing");
      assert.equal(brainBindsAction(brain, SIGNAL_ACTION_KEY), false, "a born-broke brain binds no action");

      // Creating a born-broke brain schedules no host rebuild, so a flush now is
      // a no-op: the brain is only revived by a real bundle-changing compile.
      host.flushPendingBrainRebuilds();
      assert.equal(brain.status, "invalidated", "an unscheduled flush leaves the born-broke brain invalidated");

      // Re-add the extension. The recompile raises changed action keys, which the
      // host must translate into a scheduled brain rebuild.
      await host.updateProjectExtensions({ [SIGNAL_COORDINATE]: SIGNAL_REFERENCE });

      // The compile alone does not rebuild the born-broke brain...
      assert.equal(brain.status, "invalidated", "the recompile alone does not revive the born-broke brain");

      // ...the per-tick flush does, proving the compile scheduled the rebuild.
      host.flushPendingBrainRebuilds();
      assert.equal(brain.status, "active", "the scheduled flush revives the born-broke brain");
      assert.equal(
        brainBindsAction(brain, SIGNAL_ACTION_KEY),
        true,
        "the revived brain binds the previously-missing action"
      );
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});
