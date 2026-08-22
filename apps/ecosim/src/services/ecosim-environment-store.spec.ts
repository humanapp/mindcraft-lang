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
} from "@wendoo/app-host";
import {
  AppEnvironmentHost,
  collectBrainErrorDiagnostics,
  collectBrainTileCompileDiagnostics,
  type EmbeddedExtension,
  type TileCompileDiagnosticsLookup,
} from "@wendoo/bridge-app";
import { BrainDef, coreModule } from "@wendoo/core/app";
import type { IBrainActionTileDef, IBrainTileDef } from "@wendoo/core/brain";
import { type CompileDiagnostic, declarationMount, type WorkspaceCompileResult } from "@wendoo/ts-compiler";
import { createEcosimModule } from "../brain";

// `EcosimEnvironmentStore` cannot be value-imported in this test process: the
// module unconditionally imports `ecosim-embedded-extensions.ts`, which imports
// the Vite-only `virtual:wendoo-embedded-extensions` module. That import
// throws under the plain node:test runner (confirmed: `ERR_UNSUPPORTED_ESM_URL_SCHEME`
// on the `virtual:` protocol), so every other spec that needs the class's shape
// (see `engine-recompile-brains.spec.ts`) uses a type-only import and a fake
// object instead. This spec exercises the same composition
// `getBrainDiagnostics` applies -- `collectBrainErrorDiagnostics` followed by
// `collectBrainTileCompileDiagnostics` -- directly against a real
// `AppEnvironmentHost`, a real compile, and a real broken user tile.

const CORE_AMBIENT = readFileSync(
  fileURLToPath(new URL("../../../../packages/core/lib/wendoo.core.d.ts", import.meta.url)),
  "utf8"
);

const DEMO_COORDINATE = "wendoo-lang/demo-lib";

/** A minimal embedded extension whose entry re-exports a pure helper. */
const DEMO_EXTENSION: EmbeddedExtension = {
  canonicalOrigin: DEMO_COORDINATE,
  files: [
    { path: "index.ts", content: 'export { level } from "./level";\n' },
    { path: "level.ts", content: "export function level(): number {\n  return 7;\n}\n" },
  ],
};

const BROKEN_TILE_PATH = "tiles/broken.ts";
/** A sensor whose value comes from the embedded extension's helper, imported via `@lib`, uninstalled here. */
const BROKEN_TILE_SOURCE = `import { Sensor, type Context } from "wendoo";
import { level } from "@lib/wendoo-lang/demo-lib";

export default Sensor({
  id: "brokenSensor0001",
  name: "broken",
  onExecute(ctx: Context): number {
    return level();
  },
});
`;

/** `BROKEN_TILE_SOURCE` rewritten without the `@lib` import, so it compiles cleanly. */
const FIXED_TILE_SOURCE = `import { Sensor, type Context } from "wendoo";

export default Sensor({
  id: "brokenSensor0001",
  name: "broken",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;

function createProjectCollection(): ProjectCollection {
  return { projectCollectionId: "collection-1", name: "Collection", createdAt: 1, updatedAt: 1 };
}

/** A `ProjectManager` double whose active project carries a live, mutable `extensions` map. */
function stubProjectManager(filesystem: ProjectFileSystem): ProjectManager {
  const activeProject: ActiveProject = {
    manifest: {
      id: "p1",
      projectCollectionId: "collection-1",
      name: "p1",
      version: "0.1.0",
      description: "",
      createdAt: 1,
      updatedAt: 1,
      extensions: {},
    },
    filesystem,
  } as ActiveProject;
  return {
    activeProject,
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

function installEmptyLocalStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage: Storage = {
    get length(): number {
      return 0;
    },
    clear(): void {},
    getItem: () => null,
    key: () => null,
    removeItem: () => {},
    setItem: () => {},
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

/** Compose the source location string a feed entry carries for one diagnostic, mirroring the collector. */
function expectedLocation(path: string, diagnostic: CompileDiagnostic): string {
  if (diagnostic.line === undefined) {
    return path;
  }
  if (diagnostic.column === undefined) {
    return `${path}:${diagnostic.line}`;
  }
  return `${path}:${diagnostic.line}:${diagnostic.column}`;
}

/** The placeable action tile registered for `key` in the latest compile's bundle. */
function bundleActionTile(latest: WorkspaceCompileResult | undefined, key: string): IBrainTileDef {
  for (const tile of latest?.bundle?.tiles ?? []) {
    if ("action" in tile && (tile as IBrainActionTileDef).action.key === key) {
      return tile;
    }
  }
  assert.fail(`the broken tile ${key} is placeable in the compiled bundle`);
}

/** apps/ecosim's `getBrainDiagnostics` composition: brain error diagnostics, then broken-tile compile diagnostics. */
function ecosimBrainDiagnostics(brain: BrainDef, lookup: TileCompileDiagnosticsLookup) {
  return [...collectBrainErrorDiagnostics(brain), ...collectBrainTileCompileDiagnostics(brain, lookup)];
}

describe("sim per-brain diagnostics feed: broken user-tile compile diagnostics", () => {
  it("surfaces a used broken tile's verbatim diagnostics, deduped, and clears/repopulates on recompile", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem();
    filesystem.applyLocalChange({
      action: "write",
      path: BROKEN_TILE_PATH,
      content: BROKEN_TILE_SOURCE,
      newEtag: "e1",
    });

    let latest: WorkspaceCompileResult | undefined;
    const host = new AppEnvironmentHost({
      projectManager: stubProjectManager(filesystem),
      modules: [coreModule(), createEcosimModule()],
      mounts: [declarationMount([{ path: "wendoo.core.d.ts", content: CORE_AMBIENT }])],
      embeddedExtensions: [DEMO_EXTENSION],
      onDidCompile: (result) => {
        latest = result;
      },
    });

    try {
      await host.initialize("p1");

      const metadata = host.lastUserTileMetadata ?? [];
      assert.equal(metadata.length, 1, "the broken tile still registers a placeable surface");
      const key = metadata[0]!.key;
      const lookup: TileCompileDiagnosticsLookup = (k) => host.getTileCompileDiagnostics(k);

      const source = host.getTileCompileDiagnostics(key);
      assert.ok(source && source.diagnostics.length > 0, "the tile carries real compile-error diagnostics");

      const brokenTile = bundleActionTile(latest, key);

      // A brain that uses the broken tile in a single rule.
      const brainUsing = BrainDef.emptyBrainDef(host.env.brainServices, "carnivore");
      brainUsing.pages().get(0)!.children().get(0)!.when().appendTile(brokenTile);
      await host.saveBrainForKey("carnivore", brainUsing);

      const feed = ecosimBrainDiagnostics(brainUsing, lookup);
      assert.equal(feed.length, source.diagnostics.length, "one feed entry per source error, the badge count");
      feed.forEach((entry, index) => {
        const diagnostic = source.diagnostics[index]!;
        assert.equal(entry.message, diagnostic.message, "the feed message equals the source diagnostic verbatim");
        assert.equal(
          entry.location,
          expectedLocation(source.path, diagnostic),
          "location composed from the source path and position"
        );
      });

      // A brain that uses no broken tile carries no such entry.
      const brainClean = BrainDef.emptyBrainDef(host.env.brainServices, "herbivore");
      assert.deepEqual(
        ecosimBrainDiagnostics(brainClean, lookup),
        [],
        "a brain not using the broken tile gets no entry"
      );

      // The same broken tile used in two rules contributes its diagnostics once.
      const brainDup = BrainDef.emptyBrainDef(host.env.brainServices, "plant");
      const firstPage = brainDup.pages().get(0)!;
      firstPage.children().get(0)!.when().appendTile(brokenTile);
      const secondRule = firstPage.appendNewRule();
      assert.ok(secondRule, "a second rule was appended");
      secondRule.when().appendTile(brokenTile);
      assert.equal(
        ecosimBrainDiagnostics(brainDup, lookup).length,
        source.diagnostics.length,
        "a tile used in two rules contributes its diagnostics once"
      );

      // Recompiling to a clean tile clears the entry and bumps the revision.
      const revBroken = host.getBrainDiagnosticsRevision();
      host.applyExternalProjectFileChange({
        action: "write",
        path: BROKEN_TILE_PATH,
        content: FIXED_TILE_SOURCE,
        newEtag: "e2",
      });
      assert.ok(host.getBrainDiagnosticsRevision() > revBroken, "the fixing compile bumped the revision");
      assert.equal(host.getTileCompileDiagnostics(key), undefined, "the fixed tile drops out of the compile map");
      assert.deepEqual(
        ecosimBrainDiagnostics(brainUsing, lookup),
        [],
        "the feed clears once the tile compiles cleanly"
      );

      // Recompiling back to broken repopulates the entry and bumps the revision again.
      const revFixed = host.getBrainDiagnosticsRevision();
      host.applyExternalProjectFileChange({
        action: "write",
        path: BROKEN_TILE_PATH,
        content: BROKEN_TILE_SOURCE,
        newEtag: "e3",
      });
      assert.ok(host.getBrainDiagnosticsRevision() > revFixed, "the re-breaking compile bumped the revision again");
      const reBroken = host.getTileCompileDiagnostics(key);
      assert.ok(reBroken && reBroken.diagnostics.length > 0, "the tile is broken again");
      assert.equal(
        ecosimBrainDiagnostics(brainUsing, lookup).length,
        reBroken.diagnostics.length,
        "the feed repopulates with the newest compile's diagnostics"
      );
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});
