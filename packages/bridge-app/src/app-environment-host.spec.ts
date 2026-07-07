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
import type { IBrainDef } from "@mindcraft-lang/core/app";
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
      "load:brains",
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

const STEER_ACTUATOR_SOURCE = `import { Actuator, type Context, NumberType, modifier, optional, param } from "mindcraft";

export default Actuator({
  id: "steerActuator123",
  name: "steer",
  args: [optional(modifier("hold", { label: "hold" })), param("speed", { type: NumberType })],
  onExecute(ctx: Context, args: { hold: boolean; speed: number }): void {},
});
`;

const OLD_STRUCT_TYPE = "struct:</position.ts::Position>";
const NEW_STRUCT_TYPE = `struct:<${PROJECT_ID}:/position.ts::Position>`;

/** A saved brain in the pre-namespace key format, exercising every user-key shape. */
function oldFormatUserBrain(): Record<string, unknown> {
  return {
    version: 1,
    id: "brain00000000001",
    name: "Gamepad Brain",
    catalog: [
      {
        version: 2,
        kind: "literal",
        tileId: "tile.literal->number:<number>->50",
        valueType: "number:<number>",
        value: 50,
        valueLabel: "50",
        displayFormat: "default",
      },
      {
        version: 1,
        kind: "variable",
        tileId: "tile.var->posvar0000000001",
        varName: "pos",
        varType: OLD_STRUCT_TYPE,
        uniqueId: "posvar0000000001",
      },
    ],
    pages: [
      {
        version: 2,
        pageId: "page000000000001",
        name: "Page 1",
        rules: [
          {
            version: 1,
            when: ["tile.sensor->user.sensor.stickSensor12345", `tile.accessor->${OLD_STRUCT_TYPE}->x`],
            do: [
              "tile.actuator->user.actuator.steerActuator123",
              "tile.modifier->user.steerActuator123.hold",
              "tile.parameter->user.steerActuator123.speed",
              "tile.literal->number:<number>->50",
            ],
            children: [],
          },
          {
            version: 1,
            when: [],
            do: [
              "tile.actuator->user.actuator.steerActuator123",
              "tile.parameter->user.steerActuator123.speed",
              "tile.sensor->user.sensor.stickSensor12345",
              `tile.accessor->${OLD_STRUCT_TYPE}->x`,
            ],
            children: [],
          },
        ],
      },
    ],
  };
}

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

function stubProjectManagerWithAppData(filesystem: ProjectFileSystem, appData: Map<string, string>): AppDataStub {
  const savedKeys: string[] = [];
  let activeProject: ActiveProject = {
    manifest: {
      id: PROJECT_ID,
      projectCollectionId: "collection-1",
      name: PROJECT_ID,
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
  filesystem.applyLocalChange({ action: "write", path: "steer.ts", content: STEER_ACTUATOR_SOURCE, newEtag: "e3" });
  return filesystem;
}

function createHost(projectManager: ProjectManager): AppEnvironmentHost {
  return new AppEnvironmentHost({
    projectManager,
    modules: [coreModule()],
    ambientFiles: [{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }],
    host: { name: "test", version: "0.0.0" },
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

describe("AppEnvironmentHost key-namespace migration", () => {
  it("migrates a pre-namespace brain record on load, resolves every tile, and persists once", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const appData = new Map<string, string>([
      ["brains", JSON.stringify({ main: oldFormatUserBrain(), aux: platformOnlyBrain() })],
    ]);
    const platformBrainBefore = JSON.stringify(platformOnlyBrain());
    const stub = stubProjectManagerWithAppData(createUserTileFilesystem(), appData);
    const host = createHost(stub.projectManager);

    try {
      await host.initialize(PROJECT_ID);

      // Baseline degradation: the same old-format document deserialized
      // without migration resolves user references to missing placeholders.
      const unmigrated = host.env.deserializeBrainJsonFromPlain(oldFormatUserBrain());
      assert.ok(
        collectTileIdsByKind(unmigrated, "missing").length > 0,
        "the fixture must reference pre-namespace keys that no longer resolve"
      );

      const main = host.getCachedBrain("main");
      assert.ok(main, "the migrated brain must load");
      assert.deepEqual(collectTileIdsByKind(main, "missing"), [], "every migrated reference must resolve");

      const variableTile = main.catalog().get("tile.var->posvar0000000001");
      assert.ok(variableTile && variableTile.kind === "variable");
      assert.equal((variableTile as { varType?: string }).varType, NEW_STRUCT_TYPE);

      const linked = host.env.linkBrain(main);
      assert.ok(linked.program, `the migrated brain must compile: ${JSON.stringify(linked.diagnostics)}`);

      // The migrated record persists exactly once, after a fully successful load.
      const brainSaves = stub.savedKeys.filter((key) => key === "brains");
      assert.equal(brainSaves.length, 1);
      const persisted = JSON.parse(appData.get("brains")!) as Record<string, unknown>;
      const persistedText = JSON.stringify(persisted.main);
      assert.ok(persistedText.includes(`${PROJECT_ID}:user.sensor.stickSensor12345`));
      assert.ok(persistedText.includes(`${PROJECT_ID}:user.actuator.steerActuator123`));
      assert.ok(persistedText.includes(`${PROJECT_ID}:user.steerActuator123.speed`));
      assert.ok(persistedText.includes(NEW_STRUCT_TYPE));
      assert.ok(!persistedText.includes(OLD_STRUCT_TYPE));

      // The platform-only brain sharing the record is byte-identical.
      assert.equal(JSON.stringify(persisted.aux), platformBrainBefore);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }

    // A reload of the already-migrated project changes nothing and saves nothing.
    const restoreAgain = installEmptyLocalStorage();
    const secondStub = stubProjectManagerWithAppData(createUserTileFilesystem(), appData);
    const secondHost = createHost(secondStub.projectManager);
    try {
      await secondHost.initialize(PROJECT_ID);
      const reloaded = secondHost.getCachedBrain("main");
      assert.ok(reloaded);
      assert.deepEqual(collectTileIdsByKind(reloaded, "missing"), []);
      assert.deepEqual(
        secondStub.savedKeys.filter((key) => key === "brains"),
        [],
        "an already-migrated record must not be re-persisted"
      );
    } finally {
      secondHost.dispose();
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

  it("leaves unclassifiable references untouched instead of guessing", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const oddBrain = platformOnlyBrain();
    (oddBrain.pages as Array<{ rules: Array<{ when: string[] }> }>)[0].rules[0].when.push("tile.widget->user.mystery");
    const storedRecord = JSON.stringify({ odd: oddBrain });
    const appData = new Map<string, string>([["brains", storedRecord]]);
    const stub = stubProjectManagerWithAppData(createInMemoryProjectFileSystem(), appData);
    const host = createHost(stub.projectManager);

    try {
      await host.initialize(PROJECT_ID);

      const odd = host.getCachedBrain("odd");
      assert.ok(odd);
      assert.deepEqual(collectTileIdsByKind(odd, "missing"), ["tile.widget->user.mystery"]);
      assert.equal(appData.get("brains"), storedRecord, "an unknown-only record is never rewritten");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});

// ---------------------------------------------------------------------------
// Brain persistence across project switches
// ---------------------------------------------------------------------------

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
