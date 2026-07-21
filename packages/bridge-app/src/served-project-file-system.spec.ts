import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type ActiveProject,
  createInMemoryProjectFileSystem,
  type ProjectCollection,
  type ProjectFileSystem,
  type ProjectManager,
} from "@mindcraft-lang/app-host";
import { coreModule } from "@mindcraft-lang/core/app";
import { declarationMount, isCompilerControlledPath } from "@mindcraft-lang/ts-compiler";
import { AppEnvironmentHost } from "./app-environment-host.js";
import type { EmbeddedExtension } from "./embedded-extensions.js";

const CORE_AMBIENT = readFileSync(
  fileURLToPath(new URL("../../core/lib/mindcraft.core.d.ts", import.meta.url)),
  "utf8"
);

const BEAM_REPO = "beam-lib";
const BEAM_COORDINATE = `mindcraft-lang/${BEAM_REPO}`;
const BEAM_REFERENCE = `embedded:${BEAM_COORDINATE}`;
const BEAM_ICON_PATH = `.libraries/${BEAM_COORDINATE}/beam.svg`;
const BEAM_DOCS_PATH = `.libraries/${BEAM_COORDINATE}/beam.md`;
const BEAM_ICON_SVG = '<svg id="beam"></svg>';
const BEAM_DOCS_MD = "# Beam\nDocs.";

/** The extension's default-exported tile references its own bundled icon and docs assets. */
const BEAM_EXTENSION_ENTRY = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "beamSensor000001",
  name: "beam",
  icon: "./beam.svg",
  docs: "./beam.md",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;

const BEAM_EXTENSION: EmbeddedExtension = {
  canonicalOrigin: BEAM_COORDINATE,
  files: [
    { path: "beam.ts", content: BEAM_EXTENSION_ENTRY },
    { path: "beam.svg", content: BEAM_ICON_SVG },
    { path: "beam.md", content: BEAM_DOCS_MD },
    {
      path: "mindcraft.json",
      content: JSON.stringify({ name: "Beam", version: "0.1.0", entry: "beam.ts" }),
    },
  ],
};

/** A plain host-project asset stored at an ordinary path in the raw file system. */
const HOST_ICON_PATH = "tiles/host-icon.svg";
const HOST_ICON_SVG = '<svg id="host"></svg>';

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

function stubProjectManagerWithLiveExtensions(
  filesystem: ProjectFileSystem,
  initialExtensions: Record<string, string>
): ProjectManager {
  const collection: ProjectCollection = {
    projectCollectionId: "collection-1",
    name: "Collection",
    createdAt: 1,
    updatedAt: 1,
  };
  let activeProject: ActiveProject = {
    manifest: {
      id: "p1",
      projectCollectionId: "collection-1",
      name: "p1",
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

function createHost(filesystem: ProjectFileSystem): AppEnvironmentHost {
  return new AppEnvironmentHost({
    projectManager: stubProjectManagerWithLiveExtensions(filesystem, {}),
    modules: [coreModule()],
    mounts: [declarationMount([{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }])],
    embeddedExtensions: [BEAM_EXTENSION],
  });
}

describe("AppEnvironmentHost served file system", () => {
  it("serves an installed extension's icon and docs assets that the raw project file system does not carry", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem({
      shouldExclude: (path) => isCompilerControlledPath(path, []),
    });
    filesystem.applyLocalChange({ action: "write", path: HOST_ICON_PATH, content: HOST_ICON_SVG, newEtag: "e0" });
    const host = createHost(filesystem);

    try {
      await host.initialize("p1");
      await host.updateProjectExtensions({ [BEAM_COORDINATE]: BEAM_REFERENCE });

      // The served file system -- what the vfs asset-url provider reads --
      // carries the compiler-controlled extension assets.
      const served = host.servedProjectFileSystem.exportSnapshot();
      const icon = served.get(BEAM_ICON_PATH);
      assert.ok(icon && icon.kind === "file", `served snapshot must carry ${BEAM_ICON_PATH}`);
      assert.equal(icon.content, BEAM_ICON_SVG);
      const docs = served.get(BEAM_DOCS_PATH);
      assert.ok(docs && docs.kind === "file", `served snapshot must carry ${BEAM_DOCS_PATH}`);
      assert.equal(docs.content, BEAM_DOCS_MD);

      // The raw project file system does not: extension assets are
      // compiler-controlled. Serving from the raw fs is the 404 this fix closes.
      const raw = host.projectFileSystem.exportSnapshot();
      assert.equal(raw.get(BEAM_ICON_PATH), undefined, "the raw fs does not carry the extension icon");
      assert.equal(raw.get(BEAM_DOCS_PATH), undefined, "the raw fs does not carry the extension docs");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("serves a plain host-project asset from both the raw and served file systems (host neutrality)", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem({
      shouldExclude: (path) => isCompilerControlledPath(path, []),
    });
    filesystem.applyLocalChange({ action: "write", path: HOST_ICON_PATH, content: HOST_ICON_SVG, newEtag: "e0" });
    const host = createHost(filesystem);

    try {
      await host.initialize("p1");

      const raw = host.projectFileSystem.exportSnapshot().get(HOST_ICON_PATH);
      assert.ok(raw && raw.kind === "file", "the raw fs carries the plain host asset");
      assert.equal(raw.content, HOST_ICON_SVG);

      const served = host.servedProjectFileSystem.exportSnapshot().get(HOST_ICON_PATH);
      assert.ok(served && served.kind === "file", "the served fs still carries the plain host asset");
      assert.equal(served.content, HOST_ICON_SVG);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("drops the extension's served assets when the extension is uninstalled", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem({
      shouldExclude: (path) => isCompilerControlledPath(path, []),
    });
    const host = createHost(filesystem);

    try {
      await host.initialize("p1");
      await host.updateProjectExtensions({ [BEAM_COORDINATE]: BEAM_REFERENCE });
      assert.ok(
        host.servedProjectFileSystem.exportSnapshot().get(BEAM_ICON_PATH),
        "the icon is served while the extension is installed"
      );

      await host.updateProjectExtensions({});
      assert.equal(
        host.servedProjectFileSystem.exportSnapshot().get(BEAM_ICON_PATH),
        undefined,
        "the icon is gone from the served snapshot once the extension is uninstalled"
      );
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("notifies compiler-controlled file set subscribers with the full set on install and uninstall", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem({
      shouldExclude: (path) => isCompilerControlledPath(path, []),
    });
    const host = createHost(filesystem);

    try {
      await host.initialize("p1");
      const sets: ReadonlyMap<string, string>[] = [];
      const unsubscribe = host.onCompilerControlledFilesChanged((files) => {
        sets.push(new Map(files));
      });
      try {
        await host.updateProjectExtensions({ [BEAM_COORDINATE]: BEAM_REFERENCE });
        assert.equal(sets.length, 1, "installing fires one change with the new set");
        assert.equal(sets[0].get(BEAM_ICON_PATH), BEAM_ICON_SVG);
        assert.ok(sets[0].has("tsconfig.json"), "the full set carries the generated tsconfig");
        assert.deepStrictEqual(sets[0], new Map(host.getCompilerControlledFiles()));

        await host.updateProjectExtensions({});
        assert.equal(sets.length, 2, "uninstalling fires a second change");
        assert.equal(sets[1].get(BEAM_ICON_PATH), undefined, "the uninstalled subtree is gone from the set");
      } finally {
        unsubscribe();
      }
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("fires a local file-system change on install, driving the vfs revision bump the app subscribes to", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem({
      shouldExclude: (path) => isCompilerControlledPath(path, []),
    });
    const host = createHost(filesystem);

    try {
      await host.initialize("p1");

      // The app wires `projectFileSystem.onLocalChange` to `bumpVfsRevision`,
      // which starts a fresh asset-url generation. Installing an extension
      // rewrites mindcraft.json through the raw fs; that write fires the
      // listener, and the newly materialized icon resolves without a reload.
      let localChanges = 0;
      const unsubscribe = host.projectFileSystem.onLocalChange(() => {
        localChanges++;
      });
      try {
        await host.updateProjectExtensions({ [BEAM_COORDINATE]: BEAM_REFERENCE });
      } finally {
        unsubscribe();
      }

      assert.ok(localChanges > 0, "installing an extension fires a local change that bumps the vfs revision");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});
