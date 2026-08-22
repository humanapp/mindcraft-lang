import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { EmbeddedExtension } from "@wendoo-lang/bridge-app";
import {
  CORE_LIB_COORDINATE,
  collectMetadataFromCompile,
  findEmbeddedExtensionsMissingStableIds,
  formatEmbeddedExtensionIdViolations,
  resolveProjectExtensions,
} from "@wendoo-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@wendoo-lang/bridge-app/node";
import { coreModule, createWendooEnvironment } from "@wendoo-lang/core/app";
import { createWorkspaceCompiler, type Mount, type WorkspaceSnapshot } from "@wendoo-lang/ts-compiler";
import { createEcosimModule } from "../brain";
import { buildEcosimExtensionEntries } from "./ecosim-extension-browser";
import {
  ECOSIM_DETECT_EXT_COORDINATE,
  ECOSIM_LIB_COORDINATE,
  ECOSIM_LIB_REFERENCE,
  ECOSIM_TELEPORT_EXT_COORDINATE,
} from "./ecosim-extension-coordinates";

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/**
 * The sim app's embed record -- the two layers plus the two add-ons -- assembled
 * from each extension's own `wendoo.json` `files` list through the shared
 * loader, the single content-assembly path the app's Vite provider also uses.
 */
function ecosimEmbedRecord(): EmbeddedExtension[] {
  return [
    buildEmbeddedExtensionFromDir(extensionDir("../../lib"), ECOSIM_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../../../packages/core/lib"), CORE_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/lib-ecosim-teleport"), ECOSIM_TELEPORT_EXT_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/lib-ecosim-detect"), ECOSIM_DETECT_EXT_COORDINATE),
  ];
}

/** The stable actuator id baked into the Teleport extension's source def. */
const TELEPORT_ID = "4vllyby14afcZtYY";
/** The stable sensor id baked into the Detect extension's source def. */
const DETECT_ID = "qqCSFiDwg0oiEVAw";

describe("sim add-on extensions -- every declaration ships a stable id", () => {
  test("no embedded extension declares a tile without an explicit stable id", () => {
    const environment = createWendooEnvironment({ modules: [coreModule(), createEcosimModule()] });
    const violations = findEmbeddedExtensionsMissingStableIds(ecosimEmbedRecord(), environment.brainServices);
    assert.deepEqual(violations, [], formatEmbeddedExtensionIdViolations(violations));
  });
});

describe("sim add-on extensions -- browser entries list direct dependencies only", () => {
  test("a fresh sim project does not list the bundled Teleport/Detect add-ons it does not directly reference", () => {
    const entries = buildEcosimExtensionEntries({ [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE }, ecosimEmbedRecord());

    // Teleport and Detect are bundled add-ons surfaced through the catalog
    // offers, not entry cards, until the project directly references them.
    assert.equal(
      entries.find((e) => e.coordinate === ECOSIM_TELEPORT_EXT_COORDINATE),
      undefined
    );
    assert.equal(
      entries.find((e) => e.coordinate === ECOSIM_DETECT_EXT_COORDINATE),
      undefined
    );
  });

  test("a directly-installed add-on lists as an installed entry", () => {
    const project = {
      [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE,
      [ECOSIM_TELEPORT_EXT_COORDINATE]: `embedded:${ECOSIM_TELEPORT_EXT_COORDINATE}`,
    };
    const entries = buildEcosimExtensionEntries(project, ecosimEmbedRecord());

    const teleport = entries.find((e) => e.coordinate === ECOSIM_TELEPORT_EXT_COORDINATE);
    assert.ok(teleport, "a directly-referenced add-on is an entry card");
    assert.equal(teleport.installed, true);
    assert.equal(teleport.name, "Teleport");
  });
});

describe("sim add-on extensions -- install materializes usable tiles", () => {
  const HOST_PROGRAM = `import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "host probe",
  onExecute(ctx: Context): boolean {
    return ctx.self.rotation > 0;
  },
});
`;

  /** Compile a sim project with the given installed extension coordinates. */
  function compileWith(coordinates: readonly string[]) {
    const embedRecord = ecosimEmbedRecord();
    const extensions: Record<string, string> = { [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE };
    for (const coordinate of coordinates) {
      extensions[coordinate] = `embedded:${coordinate}`;
    }
    const resolved = resolveProjectExtensions(extensions, { embedded: embedRecord });
    const environment = createWendooEnvironment({ modules: [coreModule(), createEcosimModule()] });
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

    // The extension roots materialize under their `.libraries/<owner>/<repo>/` subtrees.
    const controlled = compiler.getCompilerControlledFiles();
    assert.ok(
      controlled.has(`.libraries/${ECOSIM_TELEPORT_EXT_COORDINATE}/teleport.ts`),
      "Teleport source materializes"
    );
    assert.ok(controlled.has(`.libraries/${ECOSIM_DETECT_EXT_COORDINATE}/detect.ts`), "Detect source materializes");

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
    // materialized `.libraries/<owner>/<repo>/` subtree the vfs asset-url
    // provider resolves, and its docs are inlined from the bundled markdown.
    assert.equal(teleportTile.iconUrl, `/vfs/.libraries/${ECOSIM_TELEPORT_EXT_COORDINATE}/teleport.svg`);
    assert.equal(detectTile.iconUrl, `/vfs/.libraries/${ECOSIM_DETECT_EXT_COORDINATE}/detect.svg`);
    assert.ok(teleportTile.docsMarkdown?.includes("# Teleport"), "the Teleport docs markdown is resolved");
    assert.ok(detectTile.docsMarkdown?.includes("# Detect"), "the Detect docs markdown is resolved");

    // The materialized subtree carries the icon and docs assets the URLs resolve to.
    assert.ok(
      controlled.has(`.libraries/${ECOSIM_TELEPORT_EXT_COORDINATE}/teleport.svg`),
      "Teleport icon materializes"
    );
    assert.ok(controlled.has(`.libraries/${ECOSIM_DETECT_EXT_COORDINATE}/detect.svg`), "Detect icon materializes");

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
    const embedRecord = ecosimEmbedRecord();
    const reduced = resolveProjectExtensions(
      {
        [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE,
        [ECOSIM_DETECT_EXT_COORDINATE]: `embedded:${ECOSIM_DETECT_EXT_COORDINATE}`,
      },
      { embedded: embedRecord }
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
