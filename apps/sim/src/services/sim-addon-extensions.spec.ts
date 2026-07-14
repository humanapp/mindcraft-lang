import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import {
  buildExtensionCatalog,
  CORE_LIB_COORDINATE,
  collectMetadataFromCompile,
  findEmbeddedExtensionsMissingStableIds,
  formatEmbeddedExtensionIdViolations,
  resolveEmbeddedExtensions,
} from "@mindcraft-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@mindcraft-lang/bridge-app/node";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core/app";
import { createWorkspaceCompiler, type Mount, type WorkspaceSnapshot } from "@mindcraft-lang/ts-compiler";
import { createSimModule } from "@/brain";
import { buildSimExtensionEntries } from "./sim-extension-browser";
import {
  ECOSIM_DETECT_EXT_COORDINATE,
  ECOSIM_TELEPORT_EXT_COORDINATE,
  SIM_LIB_COORDINATE,
  SIM_LIB_REFERENCE,
} from "./sim-extension-coordinates";

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/**
 * The sim app's embed record -- the two layers plus the two add-ons -- assembled
 * from each extension's own `mindcraft.json` `files` list through the shared
 * loader, the single content-assembly path the app's Vite provider also uses.
 */
function simEmbedRecord(): EmbeddedExtension[] {
  return [
    buildEmbeddedExtensionFromDir(extensionDir("../../lib"), SIM_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../../../packages/core/lib"), CORE_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/ecosim-teleport-ext"), ECOSIM_TELEPORT_EXT_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/ecosim-detect-ext"), ECOSIM_DETECT_EXT_COORDINATE),
  ];
}

/** The stable actuator id baked into the Teleport extension's source def. */
const TELEPORT_ID = "4vllyby14afcZtYY";
/** The stable sensor id baked into the Detect extension's source def. */
const DETECT_ID = "qqCSFiDwg0oiEVAw";

describe("sim add-on extensions -- every declaration ships a stable id", () => {
  test("no embedded extension declares a tile without an explicit stable id", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule(), createSimModule()] });
    const violations = findEmbeddedExtensionsMissingStableIds(simEmbedRecord(), environment.brainServices);
    assert.deepEqual(violations, [], formatEmbeddedExtensionIdViolations(violations));
  });
});

describe("sim add-on extensions -- browser catalog compatibility", () => {
  test("a sim project lists Teleport and Detect as installable, unlocked add-ons", () => {
    const entries = buildSimExtensionEntries({ [SIM_LIB_COORDINATE]: SIM_LIB_REFERENCE }, simEmbedRecord());

    const teleport = entries.find((e) => e.coordinate === ECOSIM_TELEPORT_EXT_COORDINATE);
    const detect = entries.find((e) => e.coordinate === ECOSIM_DETECT_EXT_COORDINATE);
    assert.ok(teleport, "Teleport is in the sim project catalog");
    assert.ok(detect, "Detect is in the sim project catalog");
    for (const entry of [teleport, detect]) {
      assert.equal(entry.locked, false, "an add-on is not a locked layer library");
      assert.equal(entry.installed, false, "an add-on is not installed by default");
    }
    assert.equal(teleport.name, "Teleport");
    assert.equal(detect.name, "Detect");
  });

  test("a microbit-shaped project's catalog excludes the sim-targeted add-ons", () => {
    const MICROBIT_COORDINATE = "mindcraft-lang/microbit-v2";
    const microbitLayer: EmbeddedExtension = {
      canonicalOrigin: MICROBIT_COORDINATE,
      files: [
        {
          path: "mindcraft.json",
          content: JSON.stringify({
            name: "Microbit v2",
            version: "0.2.0",
            extensions: { [CORE_LIB_COORDINATE]: `embedded:${CORE_LIB_COORDINATE}` },
          }),
        },
      ],
    };
    const coreLib = buildEmbeddedExtensionFromDir(extensionDir("../../../../packages/core/lib"), CORE_LIB_COORDINATE);
    const teleportAddon = buildEmbeddedExtensionFromDir(
      extensionDir("../../extensions/ecosim-teleport-ext"),
      ECOSIM_TELEPORT_EXT_COORDINATE
    );
    const detectAddon = buildEmbeddedExtensionFromDir(
      extensionDir("../../extensions/ecosim-detect-ext"),
      ECOSIM_DETECT_EXT_COORDINATE
    );
    const embedRecord = [microbitLayer, coreLib, teleportAddon, detectAddon];
    const microbitLayerCoordinates = new Set([CORE_LIB_COORDINATE, "mindcraft-lang/codal", MICROBIT_COORDINATE]);

    const catalog = buildExtensionCatalog(
      { [MICROBIT_COORDINATE]: `embedded:${MICROBIT_COORDINATE}` },
      embedRecord,
      microbitLayerCoordinates
    );
    const coordinates = catalog.map((e) => e.coordinate);
    assert.equal(coordinates.includes(ECOSIM_TELEPORT_EXT_COORDINATE), false, "Teleport is hidden off the sim stack");
    assert.equal(coordinates.includes(ECOSIM_DETECT_EXT_COORDINATE), false, "Detect is hidden off the sim stack");
  });
});

describe("sim add-on extensions -- install materializes usable tiles", () => {
  const HOST_PROGRAM = `import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "host probe",
  onExecute(ctx: Context): boolean {
    return ctx.self.rotation > 0;
  },
});
`;

  /** Compile a sim project with the given installed extension coordinates. */
  function compileWith(coordinates: readonly string[]) {
    const embedRecord = simEmbedRecord();
    const extensions: Record<string, string> = { [SIM_LIB_COORDINATE]: SIM_LIB_REFERENCE };
    for (const coordinate of coordinates) {
      extensions[coordinate] = `embedded:${coordinate}`;
    }
    const resolved = resolveEmbeddedExtensions(extensions, embedRecord);
    const environment = createMindcraftEnvironment({ modules: [coreModule(), createSimModule()] });
    const mounts: readonly Mount[] = [];
    const compiler = createWorkspaceCompiler({
      projectNamespace: "sim-addon-probe",
      mounts,
      environment,
      dependencies: resolved.dependencies,
      dependencyMounts: resolved.dependencyMounts,
    });
    const snapshot: WorkspaceSnapshot = new Map([
      ["main.ts", { kind: "file", content: HOST_PROGRAM, etag: "e0", isReadonly: false }],
    ]);
    compiler.replaceWorkspace(snapshot);
    return { compiler, resolved };
  }

  test("installing Teleport and Detect registers their tiles under their own namespaces, typechecked and lowered", () => {
    const { compiler } = compileWith([ECOSIM_TELEPORT_EXT_COORDINATE, ECOSIM_DETECT_EXT_COORDINATE]);
    const result = compiler.compile();

    assert.equal(result.projectResult.tsErrors.size, 0, "the host program compiles clean over the sim ambient");

    // The extension roots materialize under their `.extensions/<owner>/<repo>/` subtrees.
    const controlled = compiler.getCompilerControlledFiles();
    assert.ok(
      controlled.has(`.extensions/${ECOSIM_TELEPORT_EXT_COORDINATE}/teleport.ts`),
      "Teleport source materializes"
    );
    assert.ok(controlled.has(`.extensions/${ECOSIM_DETECT_EXT_COORDINATE}/detect.ts`), "Detect source materializes");

    // Each add-on's def enters the picker as a tile keyed under the add-on's namespace.
    const tiles = collectMetadataFromCompile(result);
    const teleportTile = tiles.find((t) => t.namespace === ECOSIM_TELEPORT_EXT_COORDINATE);
    const detectTile = tiles.find((t) => t.namespace === ECOSIM_DETECT_EXT_COORDINATE);
    assert.ok(teleportTile, "the Teleport tile is offered from its own namespace");
    assert.ok(detectTile, "the Detect tile is offered from its own namespace");
    assert.equal(teleportTile.kind, "actuator");
    assert.equal(teleportTile.name, "teleport");
    assert.equal(detectTile.kind, "sensor");
    assert.equal(detectTile.name, "detect");

    // The installed tiles carry the pre-assigned stable ids baked into their
    // extension source; the compiler does not mint fresh ones for read-only,
    // regenerated extension content.
    assert.equal(teleportTile.id, TELEPORT_ID, "the Teleport tile keeps its source-declared stable id");
    assert.equal(detectTile.id, DETECT_ID, "the Detect tile keeps its source-declared stable id");
    assert.equal(teleportTile.key, `${ECOSIM_TELEPORT_EXT_COORDINATE}:user.actuator.${TELEPORT_ID}`);
    assert.equal(detectTile.key, `${ECOSIM_DETECT_EXT_COORDINATE}:user.sensor.${DETECT_ID}`);

    // Each tile's icon URL is namespace-aware, pointing into the add-on's
    // materialized `.extensions/<owner>/<repo>/` subtree the vfs asset-url
    // provider resolves, and its docs are inlined from the bundled markdown.
    assert.equal(teleportTile.iconUrl, `/vfs/.extensions/${ECOSIM_TELEPORT_EXT_COORDINATE}/teleport.svg`);
    assert.equal(detectTile.iconUrl, `/vfs/.extensions/${ECOSIM_DETECT_EXT_COORDINATE}/detect.svg`);
    assert.ok(teleportTile.docsMarkdown?.includes("# Teleport"), "the Teleport docs markdown is resolved");
    assert.ok(detectTile.docsMarkdown?.includes("# Detect"), "the Detect docs markdown is resolved");

    // The materialized subtree carries the icon and docs assets the URLs resolve to.
    assert.ok(
      controlled.has(`.extensions/${ECOSIM_TELEPORT_EXT_COORDINATE}/teleport.svg`),
      "Teleport icon materializes"
    );
    assert.ok(controlled.has(`.extensions/${ECOSIM_DETECT_EXT_COORDINATE}/detect.svg`), "Detect icon materializes");

    // No duplicate-stable-id diagnostic (5014) is raised across the resolved set.
    for (const rootResult of result.rootResults) {
      for (const [, compileResult] of rootResult.results) {
        for (const diag of compileResult.diagnostics) {
          assert.notEqual(diag.code, 5014, "no duplicate-stable-id diagnostic is raised");
        }
      }
    }

    // Detect exposes no declared outputs and no private-named params: it writes
    // its target through `ctx.rule.setVariable`, and its args are the anonymous
    // kind/distance modifier choices.
    assert.equal(detectTile.outputs, undefined, "Detect declares no named outputs");

    // Both actuator and sensor bodies lower into the one combined action bundle,
    // keyed by the tile's own stable action key.
    assert.ok(result.bundle, "a compiled bundle is produced");
    assert.ok(result.bundle.actions.get(teleportTile.key), "the Teleport actuator action is lowered into the bundle");
    assert.ok(result.bundle.actions.get(detectTile.key), "the Detect sensor action is lowered into the bundle");
  });

  test("uninstalling an add-on tears down its tile and action", () => {
    const { compiler } = compileWith([ECOSIM_TELEPORT_EXT_COORDINATE, ECOSIM_DETECT_EXT_COORDINATE]);
    const before = compiler.compile();
    const beforeTiles = collectMetadataFromCompile(before);
    const teleportKey = beforeTiles.find((t) => t.namespace === ECOSIM_TELEPORT_EXT_COORDINATE)?.key;
    const detectKey = beforeTiles.find((t) => t.namespace === ECOSIM_DETECT_EXT_COORDINATE)?.key;
    assert.ok(teleportKey, "the Teleport tile has an action key while installed");
    assert.ok(detectKey, "the Detect tile has an action key while installed");

    // Re-resolve to a project with only Detect installed (Teleport uninstalled).
    const embedRecord = simEmbedRecord();
    const reduced = resolveEmbeddedExtensions(
      {
        [SIM_LIB_COORDINATE]: SIM_LIB_REFERENCE,
        [ECOSIM_DETECT_EXT_COORDINATE]: `embedded:${ECOSIM_DETECT_EXT_COORDINATE}`,
      },
      embedRecord
    );
    compiler.setDependencies(reduced.dependencies, reduced.dependencyMounts);
    const after = compiler.compile();

    assert.ok(after.bundle, "a bundle is produced after uninstall");
    assert.equal(
      after.bundle.actions.get(teleportKey),
      undefined,
      "the Teleport action is gone once its add-on is uninstalled"
    );
    assert.ok(after.bundle.actions.get(detectKey), "the still-installed Detect action survives");

    const tiles = collectMetadataFromCompile(after);
    assert.equal(
      tiles.some((t) => t.namespace === ECOSIM_TELEPORT_EXT_COORDINATE),
      false,
      "the Teleport tile is no longer offered"
    );
    assert.ok(
      tiles.some((t) => t.namespace === ECOSIM_DETECT_EXT_COORDINATE),
      "the Detect tile is still offered"
    );
  });
});
