import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type ActiveProject,
  createInMemoryProjectFileSystem,
  type ProjectCollection,
  type ProjectFileSystem,
  type ProjectManager,
} from "@mindcraft-lang/app-host";
import { AppEnvironmentHost, buildCoreStdlibExtension, type EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import { coreModule } from "@mindcraft-lang/core/app";
import { isCompilerControlledPath, type Mount } from "@mindcraft-lang/ts-compiler";
import { createSimModule } from "@/brain";
import { ECOSIM_TELEPORT_EXT_COORDINATE, SIM_LIB_COORDINATE, SIM_LIB_REFERENCE } from "./sim-extension-coordinates";

const TELEPORT_ICON_PATH = `.extensions/${ECOSIM_TELEPORT_EXT_COORDINATE}/teleport.svg`;
const TELEPORT_REFERENCE = `embedded:${ECOSIM_TELEPORT_EXT_COORDINATE}`;

const SIM_MOUNTS: readonly Mount[] = [];

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const TELEPORT_ICON_SVG = readText("../../extensions/ecosim-teleport-ext/teleport.svg");

/** The sim embed record built from on-disk source (the app's `?raw` imports are Vite-only). */
function simEmbedRecord(): EmbeddedExtension[] {
  const simLib: EmbeddedExtension = {
    canonicalOrigin: SIM_LIB_COORDINATE,
    files: [
      { path: "index.ts", content: readText("../../lib/index.ts") },
      { path: "mindcraft.sim.d.ts", content: readText("../../ambient/mindcraft.sim.d.ts") },
      { path: "mindcraft.json", content: readText("../../lib/mindcraft.json") },
    ],
  };
  const coreLib = buildCoreStdlibExtension({
    entry: readText("../../../../packages/core/lib/index.ts"),
    ambient: readText("../../../../packages/core/ambient/mindcraft.core.d.ts"),
    manifest: readText("../../../../packages/core/lib/mindcraft.json"),
  });
  const teleportAddon: EmbeddedExtension = {
    canonicalOrigin: ECOSIM_TELEPORT_EXT_COORDINATE,
    files: [
      { path: "teleport.ts", content: readText("../../extensions/ecosim-teleport-ext/teleport.ts") },
      { path: "teleport.svg", content: TELEPORT_ICON_SVG },
      { path: "teleport.md", content: readText("../../extensions/ecosim-teleport-ext/teleport.md") },
      { path: "mindcraft.json", content: readText("../../extensions/ecosim-teleport-ext/mindcraft.json") },
    ],
  };
  return [simLib, coreLib, teleportAddon];
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
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  return () => {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
      return;
    }
    Reflect.deleteProperty(globalThis, "localStorage");
  };
}

function stubProjectManager(filesystem: ProjectFileSystem, initialExtensions: Record<string, string>): ProjectManager {
  const collection: ProjectCollection = {
    projectCollectionId: "collection-1",
    name: "Collection",
    createdAt: 1,
    updatedAt: 1,
  };
  let activeProject: ActiveProject = {
    manifest: {
      id: "sim-p1",
      projectCollectionId: "collection-1",
      name: "sim-p1",
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
    activeProjectCollection: collection,
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

describe("sim service worker served extension assets", () => {
  test("the served file system serves the Teleport tile icon once the add-on is installed", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem({
      shouldExclude: (path) => isCompilerControlledPath(path, SIM_MOUNTS),
    });
    const host = new AppEnvironmentHost({
      projectManager: stubProjectManager(filesystem, { [SIM_LIB_COORDINATE]: SIM_LIB_REFERENCE }),
      modules: [coreModule(), createSimModule()],
      mounts: SIM_MOUNTS,
      embeddedExtensions: simEmbedRecord(),
    });

    try {
      await host.initialize("sim-p1");

      // Not served before install: the icon URL a Teleport tile would carry 404s.
      assert.equal(
        host.servedProjectFileSystem.exportSnapshot().get(TELEPORT_ICON_PATH),
        undefined,
        "the Teleport icon is absent before the add-on is installed"
      );

      await host.updateProjectExtensions({
        [SIM_LIB_COORDINATE]: SIM_LIB_REFERENCE,
        [ECOSIM_TELEPORT_EXT_COORDINATE]: TELEPORT_REFERENCE,
      });

      // The service worker reads `store.servedProjectFileSystem`; the vfs path of
      // the tile's `/vfs/.extensions/.../teleport.svg` icon URL resolves here.
      const icon = host.servedProjectFileSystem.exportSnapshot().get(TELEPORT_ICON_PATH);
      assert.ok(icon && icon.kind === "file", `the served snapshot carries ${TELEPORT_ICON_PATH}`);
      assert.equal(icon.content, TELEPORT_ICON_SVG, "the served icon is the bundled Teleport svg byte-for-byte");
      assert.equal(icon.isReadonly, true, "the materialized extension asset is read-only");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});
