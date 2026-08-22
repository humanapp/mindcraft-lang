import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fileContentText } from "@wendoo-lang/app-host";
import type { EmbeddedExtension } from "@wendoo-lang/bridge-app";
import { CORE_LIB_COORDINATE, resolveProjectExtensions } from "@wendoo-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@wendoo-lang/bridge-app/node";
import { coreModule, createWendooEnvironment } from "@wendoo-lang/core/app";
import { createWorkspaceCompiler, type Mount, type WorkspaceSnapshot } from "@wendoo-lang/ts-compiler";
import { createEcosimModule } from "../brain";
import { ECOSIM_LIB_COORDINATE, ECOSIM_LIB_REFERENCE } from "./ecosim-extension-coordinates";

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/**
 * The two embedded layers assembled from each extension's own `wendoo.json`
 * `files` list through the shared loader -- the single content-assembly path the
 * app's Vite provider also uses. The layer stack is core <- sim.
 */
function embeddedLayers(): EmbeddedExtension[] {
  return [
    buildEmbeddedExtensionFromDir(extensionDir("../../lib"), ECOSIM_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../../../packages/core/lib"), CORE_LIB_COORDINATE),
  ];
}

describe("sim embedded layers -- transitive resolution of the core <- sim stack", () => {
  test("seeding the sim layer alone resolves both layers with their edges and ambient declarations", () => {
    const resolved = resolveProjectExtensions(
      { [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE },
      { embedded: embeddedLayers() }
    );

    // The seeded layer plus the core layer its target edge recurses to are
    // both importable dependencies of the project.
    assert.deepEqual(resolved.dependencies.map((dependency) => dependency.coordinate).sort(), [
      CORE_LIB_COORDINATE,
      ECOSIM_LIB_COORDINATE,
    ]);
    const origins = resolved.dependencyMounts.map((m) => m.namespace).sort();
    assert.deepEqual(origins, [CORE_LIB_COORDINATE, ECOSIM_LIB_COORDINATE]);

    const mountFor = (origin: string) => resolved.dependencyMounts.find((m) => m.namespace === origin)!;
    assert.deepEqual(mountFor(ECOSIM_LIB_COORDINATE).dependencies, [{ coordinate: CORE_LIB_COORDINATE }]);
    assert.deepEqual(mountFor(CORE_LIB_COORDINATE).dependencies, []);

    // Each layer carries its own ambient `.d.ts` as extension content and declares it in its manifest.
    assert.deepEqual(mountFor(CORE_LIB_COORDINATE).ambient, ["wendoo.core.d.ts"]);
    assert.deepEqual(mountFor(ECOSIM_LIB_COORDINATE).ambient, ["wendoo.ecosim.d.ts"]);
    assert.match(
      fileContentText(mountFor(CORE_LIB_COORDINATE).files.get("/wendoo.core.d.ts") ?? "") ?? "",
      /declare var Buffer/
    );
    assert.match(
      fileContentText(mountFor(ECOSIM_LIB_COORDINATE).files.get("/wendoo.ecosim.d.ts") ?? "") ?? "",
      /interface Vector2/
    );
  });
});

describe("sim embedded layers -- ambient declarations arrive through the resolved extensions", () => {
  test("user code resolves types spanning both layers with no root ambient mount, and the .d.ts materialize under .libraries/", () => {
    const resolved = resolveProjectExtensions(
      { [ECOSIM_LIB_COORDINATE]: ECOSIM_LIB_REFERENCE },
      { embedded: embeddedLayers() }
    );
    const environment = createWendooEnvironment({ modules: [coreModule(), createEcosimModule()] });

    // No root ambient mounts; platform types resolve entirely through the
    // resolved layer extensions' ambient `.d.ts`.
    const mounts: readonly Mount[] = [];
    const compiler = createWorkspaceCompiler({
      projectNamespace: "probe-project",
      mounts,
      environment,
      dependencies: resolved.dependencies,
      dependencyMounts: resolved.dependencyMounts,
    });

    const crossLayer = `import { type ActorRef, type Context, Sensor, type Vector2 } from "wendoo";

export default Sensor({
  name: "cross layer",
  onExecute(ctx: Context): boolean {
    const self: ActorRef = ctx.self;
    const position: Vector2 = self.position;
    const isBuffer: boolean = Buffer.isBuffer(position);
    return isBuffer || position.x > 0;
  },
});
`;

    const snapshot: WorkspaceSnapshot = new Map([
      ["cross-layer.ts", { kind: "file", content: crossLayer, etag: "e0", isReadonly: false }],
    ]);
    compiler.replaceWorkspace(snapshot);
    const result = compiler.compile();

    assert.equal(
      result.projectResult.tsErrors.size,
      0,
      `types spanning core (Buffer) and sim (Context/ActorRef/Vector2) must resolve: ${JSON.stringify([
        ...result.projectResult.tsErrors,
      ])}`
    );

    // The layer ambient `.d.ts` are inspectable in the project file tree under
    // each layer's `.libraries/<owner>/<repo>/` subtree.
    const controlled = compiler.getCompilerControlledFiles();
    assert.ok(
      controlled.has(".libraries/wendoo-lang/lib-core/wendoo.core.d.ts"),
      "the core ambient materializes under .libraries/"
    );
    assert.ok(
      controlled.has(".libraries/wendoo-lang/lib-ecosim/wendoo.ecosim.d.ts"),
      "the sim ambient materializes under .libraries/"
    );
  });
});

describe("sim embedded layers -- the manifest-driven bundle matches the hand-assembled one", () => {
  test("the core layer's manifest-driven path->content set equals its hand-assembled set", () => {
    const built = buildEmbeddedExtensionFromDir(extensionDir("../../../../packages/core/lib"), CORE_LIB_COORDINATE);
    const read = (rel: string) => readFileSync(extensionDir(rel), "utf8");
    const handAssembled = new Map([
      ["index.ts", read("../../../../packages/core/lib/index.ts")],
      ["wendoo.core.d.ts", read("../../../../packages/core/lib/wendoo.core.d.ts")],
      ["wendoo.json", read("../../../../packages/core/lib/wendoo.json")],
    ]);
    const builtByPath = new Map(built.files.map((f) => [f.path, f.content]));
    assert.deepEqual(builtByPath, handAssembled);
  });
});
