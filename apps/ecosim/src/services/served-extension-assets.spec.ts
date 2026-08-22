import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type ActiveProject,
  createInMemoryProjectFileSystem,
  type ProjectCollection,
  type ProjectFileSystem,
  type ProjectManager,
} from "@wendoo/app-host";
import {
  AppEnvironmentHost,
  CORE_LIB_COORDINATE,
  createVfsAssetUrlProvider,
  type EmbeddedExtension,
} from "@wendoo/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@wendoo/bridge-app/node";
import { coreModule, mkActuatorTileId, mkSensorTileId } from "@wendoo/core/app";
import type { IBrainTileDef } from "@wendoo/core/brain";
import { isCompilerControlledPath, type Mount } from "@wendoo/ts-compiler";
import { createEcosimModule } from "../brain";
import { createVfsAwareVisualProvider } from "../brain/editor/visual-provider";
import {
  ECOSIM_LIB_COORDINATE,
  ECOSIM_LIB_REFERENCE,
  ECOSIM_TELEPORT_EXT_COORDINATE,
} from "./ecosim-extension-coordinates";

const TELEPORT_ICON_PATH = `.libraries/${ECOSIM_TELEPORT_EXT_COORDINATE}/teleport.svg`;
const TELEPORT_REFERENCE = `embedded:${ECOSIM_TELEPORT_EXT_COORDINATE}`;

const SIM_MOUNTS: readonly Mount[] = [];

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

const TELEPORT_ICON_SVG = readText("../../extensions/lib-ecosim-teleport/teleport.svg");

/**
 * The sim embed record assembled from each extension's own `wendoo.json`
 * `files` list through the shared loader -- the single content-assembly path the
 * app's Vite provider also uses.
 */
function ecosimEmbedRecord(): EmbeddedExtension[] {
  return [
    buildEmbeddedExtensionFromDir(extensionDir("../../lib"), ECOSIM_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../../../packages/core/lib"), CORE_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/lib-ecosim-teleport"), ECOSIM_TELEPORT_EXT_COORDINATE),
  ];
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

describe("sim served extension assets", () => {
  test("the served file system serves the Teleport tile icon once the add-on is installed", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem({
      shouldExclude: (path) => isCompilerControlledPath(path, SIM_MOUNTS),
    });
    const host = new AppEnvironmentHost({
      projectManager: stubProjectManager(filesystem, { [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE }),
      modules: [coreModule(), createEcosimModule()],
      mounts: SIM_MOUNTS,
      embeddedExtensions: ecosimEmbedRecord(),
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
        [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE,
        [ECOSIM_TELEPORT_EXT_COORDINATE]: TELEPORT_REFERENCE,
      });

      // The vfs asset-url provider reads `store.servedProjectFileSystem`; the vfs
      // path of the tile's `/vfs/.libraries/.../teleport.svg` icon URL resolves here.
      const icon = host.servedProjectFileSystem.exportSnapshot().get(TELEPORT_ICON_PATH);
      assert.ok(icon && icon.kind === "file", `the served snapshot carries ${TELEPORT_ICON_PATH}`);
      assert.equal(icon.content, TELEPORT_ICON_SVG, "the served icon is the bundled Teleport svg byte-for-byte");
      assert.equal(icon.isReadonly, true, "the materialized extension asset is read-only");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  test("the Teleport tile's icon resolves through the editor's visual seam, re-minting per VFS revision", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem({
      shouldExclude: (path) => isCompilerControlledPath(path, SIM_MOUNTS),
    });
    const host = new AppEnvironmentHost({
      projectManager: stubProjectManager(filesystem, { [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE }),
      modules: [coreModule(), createEcosimModule()],
      mounts: SIM_MOUNTS,
      embeddedExtensions: ecosimEmbedRecord(),
    });

    try {
      await host.initialize("sim-p1");
      await host.updateProjectExtensions({
        [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE,
        [ECOSIM_TELEPORT_EXT_COORDINATE]: TELEPORT_REFERENCE,
      });

      // The same provider-over-store shape the app wires: served snapshot as
      // content source, host VFS revision as the re-mint trigger.
      const provider = createVfsAssetUrlProvider({
        getProjectFileSystem: () => host.servedProjectFileSystem,
        getVfsRevision: host.getVfsRevisionSnapshot,
      });
      const resolveTileVisual = createVfsAwareVisualProvider((url) => provider.resolveAssetUrl(url));

      const teleportMeta = host.lastUserTileMetadata?.find((m) => m.namespace === ECOSIM_TELEPORT_EXT_COORDINATE);
      assert.ok(teleportMeta, "the installed Teleport tile registers user-tile metadata");
      const tileId =
        teleportMeta.kind === "sensor" ? mkSensorTileId(teleportMeta.key) : mkActuatorTileId(teleportMeta.key);
      let tileDef: IBrainTileDef | undefined;
      for (const catalog of host.env.tileCatalogs()) {
        tileDef ??= catalog.get(tileId);
      }
      assert.ok(tileDef, "the Teleport tile is registered in a tile catalog");

      const mintedIconUrl = resolveTileVisual(tileDef).iconUrl ?? "";
      assert.ok(mintedIconUrl.startsWith("blob:"), "the compiled /vfs/ icon URL resolves to an object URL");
      const blob = resolveObjectURL(mintedIconUrl);
      assert.ok(blob, "the resolved object URL is loadable");
      assert.equal(await blob.text(), TELEPORT_ICON_SVG, "the resolved URL carries the bundled icon bytes");

      // A revision bump re-mints and revokes the superseded generation.
      host.bumpVfsRevision();
      const fresh = resolveTileVisual(tileDef);
      assert.notEqual(fresh.iconUrl, mintedIconUrl, "the new generation mints a new URL");
      assert.equal(resolveObjectURL(mintedIconUrl), undefined, "the superseded URL is revoked");

      // A changed raw-fs asset resolves to its fresh content after the bump
      // the app's onLocalChange wiring drives.
      filesystem.applyLocalChange({ action: "write", path: "tiles/host.svg", content: "<svg id='a'/>", newEtag: "h0" });
      host.bumpVfsRevision();
      const before = provider.resolveAssetUrl("/vfs/tiles/host.svg");
      assert.equal(await resolveObjectURL(before)?.text(), "<svg id='a'/>");
      filesystem.applyLocalChange({ action: "write", path: "tiles/host.svg", content: "<svg id='b'/>", newEtag: "h1" });
      host.bumpVfsRevision();
      const after = provider.resolveAssetUrl("/vfs/tiles/host.svg");
      assert.equal(await resolveObjectURL(after)?.text(), "<svg id='b'/>", "re-resolution yields the fresh content");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});
