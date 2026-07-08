import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import { buildCoreStdlibExtension, CORE_LIB_COORDINATE, resolveEmbeddedExtensions } from "@mindcraft-lang/bridge-app";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core/app";
import { createWorkspaceCompiler, type Mount, type WorkspaceSnapshot } from "@mindcraft-lang/ts-compiler";
import { createSimModule } from "@/brain";
import { SIM_LIB_COORDINATE, SIM_LIB_REFERENCE } from "./sim-extension-coordinates";

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/**
 * The two embedded layers built from their on-disk source and bundled
 * `mindcraft.json` edges (the app's `?raw` imports are Vite-only). Mirrors the
 * embed record the app ships: the shared core layer through the same seam the
 * app uses, plus the sim platform layer carrying its edge and ambient `.d.ts`.
 */
function embeddedLayers(): EmbeddedExtension[] {
  return [
    {
      canonicalOrigin: SIM_LIB_COORDINATE,
      files: [
        { path: "index.ts", content: readText("../../lib/index.ts") },
        { path: "mindcraft.sim.d.ts", content: readText("../../ambient/mindcraft.sim.d.ts") },
        { path: "mindcraft.json", content: readText("../../lib/mindcraft.json") },
      ],
    },
    buildCoreStdlibExtension({
      entry: readText("../../../../packages/core/lib/index.ts"),
      ambient: readText("../../../../packages/core/ambient/mindcraft.core.d.ts"),
      manifest: readText("../../../../packages/core/lib/mindcraft.json"),
    }),
  ];
}

describe("sim embedded layers -- transitive resolution of the core <- sim stack", () => {
  test("seeding the sim layer alone resolves both layers with their edges and ambient declarations", () => {
    const resolved = resolveEmbeddedExtensions({ [SIM_LIB_COORDINATE]: SIM_LIB_REFERENCE }, embeddedLayers());

    assert.deepEqual(resolved.dependencies, [{ coordinate: SIM_LIB_COORDINATE }]);
    const origins = resolved.dependencyMounts.map((m) => m.namespace).sort();
    assert.deepEqual(origins, [CORE_LIB_COORDINATE, SIM_LIB_COORDINATE]);

    const mountFor = (origin: string) => resolved.dependencyMounts.find((m) => m.namespace === origin)!;
    assert.deepEqual(mountFor(SIM_LIB_COORDINATE).dependencies, [{ coordinate: CORE_LIB_COORDINATE }]);
    assert.deepEqual(mountFor(CORE_LIB_COORDINATE).dependencies, []);

    // Each layer carries its own ambient `.d.ts` as extension content and declares it in its manifest.
    assert.deepEqual(mountFor(CORE_LIB_COORDINATE).ambient, ["mindcraft.core.d.ts"]);
    assert.deepEqual(mountFor(SIM_LIB_COORDINATE).ambient, ["mindcraft.sim.d.ts"]);
    assert.match(mountFor(CORE_LIB_COORDINATE).files.get("/mindcraft.core.d.ts") ?? "", /declare var Buffer/);
    assert.match(mountFor(SIM_LIB_COORDINATE).files.get("/mindcraft.sim.d.ts") ?? "", /interface Vector2/);
  });
});

describe("sim embedded layers -- ambient declarations arrive through the resolved extensions", () => {
  test("user code resolves types spanning both layers with no root ambient mount, and the .d.ts materialize under .extensions/", () => {
    const resolved = resolveEmbeddedExtensions({ [SIM_LIB_COORDINATE]: SIM_LIB_REFERENCE }, embeddedLayers());
    const environment = createMindcraftEnvironment({ modules: [coreModule(), createSimModule()] });

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

    const crossLayer = `import { type ActorRef, type Context, Sensor, type Vector2 } from "mindcraft";

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
    // each layer's `.extensions/<owner>/<repo>/` subtree.
    const controlled = compiler.getCompilerControlledFiles();
    assert.ok(
      controlled.has(".extensions/mindcraft-lang/core/mindcraft.core.d.ts"),
      "the core ambient materializes under .extensions/"
    );
    assert.ok(
      controlled.has(".extensions/mindcraft-lang/sim/mindcraft.sim.d.ts"),
      "the sim ambient materializes under .extensions/"
    );
  });
});
