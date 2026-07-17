import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createIdbProjectStore, ProjectManager } from "@mindcraft-lang/app-host";
import { AppEnvironmentHost } from "@mindcraft-lang/bridge-app";
import { BrainDef, coreModule } from "@mindcraft-lang/core/app";
import { name as simName } from "../../package.json";
import { createSimModule } from "../brain";
import type { Obstacle } from "../brain/vision";
import { buildSimExportDocument, type SimAppChunk } from "./project-io";

// The app-host reads localStorage/sessionStorage for app-side caches; provide an in-memory shim
// alongside fake-indexeddb so the host runs headlessly.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, String(value));
    },
  } as Storage;
}
const globalShim = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };
globalShim.localStorage ??= memoryStorage();
globalShim.sessionStorage ??= memoryStorage();

const TILE_PATH = "tiles/wander.ts";
const TILE_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "wander",
  async onExecute(ctx: Context): Promise<void> {
    ctx.self.rotation += 0.1;
  },
});
`;

const ASSET_PATH = "assets/logo.svg";
const ASSET_CONTENT = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>\n';

const OBSTACLES: readonly Obstacle[] = [{ x: 10, y: 20, width: 30, height: 40, rotation: 0.5 }];

describe("sim project export document", () => {
  it("carries the whole project: tile source, asset, brain, and the sim's app chunk", async () => {
    const host = new AppEnvironmentHost({
      projectManager: new ProjectManager(await createIdbProjectStore("sim-export-probe")),
      modules: [coreModule(), createSimModule()],
      mounts: [],
    });
    await host.initialize("Export Probe");

    host.projectFileSystem.applyLocalChange({
      action: "write",
      path: TILE_PATH,
      content: TILE_SOURCE,
      newEtag: "probe-tile",
    });
    host.projectFileSystem.applyLocalChange({
      action: "write",
      path: ASSET_PATH,
      content: ASSET_CONTENT,
      newEtag: "probe-asset",
    });

    // Sim brains are stored under their archetype key; the roster reads the same keys.
    const brain = host.env.withServices((services) => BrainDef.emptyBrainDef(services, "Herbivore"));
    await host.saveBrainForKey("herbivore", brain);

    const document = JSON.parse(await buildSimExportDocument(host.projectManager, { herbivore: 5 }, OBSTACLES)) as {
      manifest: {
        brains: Record<string, { name: string }>;
        app: Record<string, unknown>;
      };
      contents: Record<string, string>;
    };
    host.dispose();

    assert.equal(document.contents[TILE_PATH], TILE_SOURCE);
    assert.equal(document.contents[ASSET_PATH], ASSET_CONTENT);

    assert.equal(document.manifest.brains.herbivore?.name, "Herbivore");

    const app = document.manifest.app[simName] as SimAppChunk;
    const herbivore = app.actors.find((actor) => actor.archetype === "herbivore");
    assert.deepEqual(herbivore, { archetype: "herbivore", brain: "herbivore", desiredCount: 5 });
    assert.deepEqual(app.obstacles, OBSTACLES);
  });
});
