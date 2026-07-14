import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { coreModule, createMindcraftEnvironment, List, type MindcraftModule } from "@mindcraft-lang/core";
import { type EnumTypeDef, mkTypeId, NativeType } from "@mindcraft-lang/core/runtime";
import { buildAmbientDeclarations } from "./compiler/ambient.js";
import type { DependencyMount, ProjectDependency } from "./compiler/extension-mounts.js";
import { declarationMount, type Mount } from "./compiler/mounts.js";
import { qualifiedClassName } from "./compiler/symbol-keys.js";
import type { AmbientFile } from "./compiler/types.js";
import { buildCompiledActionBundle, buildMultiRootActionBundle } from "./runtime/action-bundle.js";
import { TEST_PROJECT_NAMESPACE } from "./testing/index.js";
import { createWorkspaceCompiler, type WorkspaceCompileResult } from "./workspace-compiler.js";

const noopCodec = {
  encode(): void {},
  decode(): undefined {
    return undefined;
  },
  stringify(): string {
    return "noop";
  },
};

function createFacingModule(): MindcraftModule {
  return {
    id: "facing-module",
    install(api): void {
      const definition: EnumTypeDef = {
        coreType: NativeType.Enum,
        typeId: mkTypeId(NativeType.Enum, "Facing"),
        codec: noopCodec,
        name: "Facing",
        atomId: 1024,
        symbols: List.from([
          { key: "north", label: "North", value: "north" },
          { key: "south", label: "South", value: "south" },
        ]),
        defaultKey: "north",
      };
      api.defineType(definition);
    },
  };
}

function ambientFilesFor(environment: ReturnType<typeof createMindcraftEnvironment>): readonly AmbientFile[] {
  return [
    {
      path: "mindcraft.core.d.ts",
      content: buildAmbientDeclarations(environment.brainServices.runtime.types),
    },
    {
      path: "mindcraft.sim.d.ts",
      content: "",
    },
  ];
}

function mountsFor(environment: ReturnType<typeof createMindcraftEnvironment>): readonly Mount[] {
  return [declarationMount(ambientFilesFor(environment))];
}

describe("createWorkspaceCompiler", () => {
  test("binds ambient generation and bundle output to the provided environment", () => {
    const environment = createMindcraftEnvironment({
      modules: [coreModule(), createFacingModule()],
    });
    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: mountsFor(environment),
      environment,
    });
    let heardResult: WorkspaceCompileResult | undefined;

    compiler.onDidCompile((result: WorkspaceCompileResult) => {
      heardResult = result;
    });

    compiler.replaceWorkspace(
      new Map([
        [
          "sensors/look.ts",
          {
            kind: "file",
            content: `
import { Sensor, type Context, type Facing } from "mindcraft";

export default Sensor({
  name: "look",
  onExecute(ctx: Context): Facing {
    return "north";
  },
});
`,
            etag: "etag-1",
            isReadonly: false,
          },
        ],
      ])
    );

    const result = compiler.compile();

    assert.equal(heardResult, result);
    assert.deepEqual(result.files.get("sensors/look.ts") ?? [], []);
    assert.ok(result.bundle, "expected a compiled action bundle");
  });

  test("treats ambient declarations and tsconfig as compiler-owned system files", () => {
    const environment = createMindcraftEnvironment({
      modules: [coreModule(), createFacingModule()],
    });
    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: mountsFor(environment),
      environment,
    });

    compiler.replaceWorkspace(
      new Map([
        [
          "mindcraft.core.d.ts",
          {
            kind: "file",
            content: 'declare module "mindcraft" { export type Broken = ; }',
            etag: "etag-ambient",
            isReadonly: true,
          },
        ],
        [
          "mindcraft.sim.d.ts",
          {
            kind: "file",
            content: 'declare module "mindcraft" { export type AlsoBroken = ; }',
            etag: "etag-sim-ambient",
            isReadonly: true,
          },
        ],
        [
          "tsconfig.json",
          {
            kind: "file",
            content: JSON.stringify({ compilerOptions: { strict: false } }),
            etag: "etag-tsconfig",
            isReadonly: true,
          },
        ],
        [
          "sensors/look.ts",
          {
            kind: "file",
            content: `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "look",
  onExecute(ctx: Context): number {
    const identity = (value) => value;
    return identity(1);
  },
});
`,
            etag: "etag-source",
            isReadonly: false,
          },
        ],
      ])
    );

    const result = compiler.compile();
    const sourceDiagnostics = result.files.get("sensors/look.ts") ?? [];

    assert.equal(result.files.get("mindcraft.core.d.ts"), undefined);
    assert.equal(result.files.get("mindcraft.sim.d.ts"), undefined);
    assert.equal(result.files.get("tsconfig.json"), undefined);
    assert.ok(
      sourceDiagnostics.some((diagnostic) => diagnostic.message.includes("implicitly has an 'any' type")),
      `Expected strict-mode implicit any diagnostic, got ${JSON.stringify(sourceDiagnostics)}`
    );
  });

  test("returns host ambient files and tsconfig as compiler-controlled files", () => {
    const environment = createMindcraftEnvironment({
      modules: [coreModule(), createFacingModule()],
    });
    const ambientFiles = ambientFilesFor(environment);
    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: [declarationMount(ambientFiles)],
      environment,
    });
    const controlledFiles = compiler.getCompilerControlledFiles();

    assert.equal(controlledFiles.get("mindcraft.core.d.ts"), ambientFiles[0]!.content);
    assert.equal(controlledFiles.get("mindcraft.sim.d.ts"), ambientFiles[1]!.content);
    assert.ok(controlledFiles.get("tsconfig.json")?.includes('"strict": true'));
  });

  test("re-resolving to drop a dependency clears the dropped origin's type registrations", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const types = environment.brainServices.runtime.types;

    const posSource = `import { NumberType, StructType, type StructOf } from "mindcraft";
export const Position = StructType({ name: "position", fields: { x: NumberType, y: NumberType } });
export type Position = StructOf<typeof Position>;
`;
    const posEntry = "export { Position } from './position';\n";
    const vecSource = `import { NumberType, StructType, type StructOf } from "mindcraft";
export const Vec = StructType({ name: "vec", fields: { a: NumberType } });
export type Vec = StructOf<typeof Vec>;
`;
    const vecEntry = "export { Vec } from './vec';\n";

    const posMount: DependencyMount = {
      namespace: "acme/position",
      files: new Map([
        ["/position.ts", posSource],
        ["/index.ts", posEntry],
      ]),
    };
    const vecMount: DependencyMount = {
      namespace: "acme/vec",
      files: new Map([
        ["/vec.ts", vecSource],
        ["/index.ts", vecEntry],
      ]),
    };
    const bothDeps: ProjectDependency[] = [{ coordinate: "acme/position" }, { coordinate: "acme/vec" }];

    const hostBoth = `import { Sensor, type Context } from "mindcraft";
import { Position } from "@ext/acme/position";
import { Vec } from "@ext/acme/vec";
export default Sensor({
  name: "read", id: "readBothTypes01", returnType: Position,
  onExecute(ctx: Context): Position { const v: Vec = Vec({ a: 1 }); return Position({ x: v.a, y: 2 }); },
});
`;

    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: mountsFor(environment),
      environment,
      dependencies: bothDeps,
      dependencyMounts: [posMount, vecMount],
    });
    compiler.replaceWorkspace(
      new Map([["main.ts", { kind: "file", content: hostBoth, etag: "e1", isReadonly: false }]])
    );
    const first = compiler.compile();
    assert.deepEqual(first.files.get("main.ts") ?? [], [], "the two-dependency compile is clean");

    const posId = types.resolveByName(qualifiedClassName("acme/position", "/position.ts", "Position"));
    const vecId = types.resolveByName(qualifiedClassName("acme/vec", "/vec.ts", "Vec"));
    assert.ok(posId, "position registers under its origin");
    assert.ok(vecId, "vec registers under its origin");

    // Re-resolve to {position}: drop the vec dependency and its import.
    const hostPosOnly = `import { Sensor, type Context } from "mindcraft";
import { Position } from "@ext/acme/position";
export default Sensor({
  name: "read", id: "readBothTypes01", returnType: Position,
  onExecute(ctx: Context): Position { return Position({ x: 1, y: 2 }); },
});
`;
    compiler.setDependencies([{ coordinate: "acme/position" }], [posMount]);
    compiler.applyWorkspaceChange({ action: "write", path: "main.ts", content: hostPosOnly, newEtag: "e2" });
    const second = compiler.compile();
    assert.deepEqual(second.files.get("main.ts") ?? [], [], "the reduced compile is clean");

    assert.ok(
      types.resolveByName(qualifiedClassName("acme/position", "/position.ts", "Position")),
      "the retained origin keeps its registration"
    );
    assert.equal(
      types.resolveByName(qualifiedClassName("acme/vec", "/vec.ts", "Vec")),
      undefined,
      "the dropped origin's registration is gone -- no residue survives the re-resolve"
    );
    assert.equal(types.get(vecId), undefined, "the dropped origin's type id no longer resolves");
  });

  test("a diamond of extension mounts unifies a shared origin's published type to one id", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const types = environment.brainServices.runtime.types;

    const pointSource = `import { NumberType, StructType, type StructOf } from "mindcraft";
export const Point = StructType({ name: "point", fields: { x: NumberType, y: NumberType } });
export type Point = StructOf<typeof Point>;
`;
    const pointEntry = "export { Point } from './point';\n";
    const pointMount: DependencyMount = {
      namespace: "acme/point",
      files: new Map([
        ["/point.ts", pointSource],
        ["/index.ts", pointEntry],
      ]),
    };

    // A and B each depend on the shared point origin and re-publish its type.
    const aEntry = `export { Point } from "@ext/acme/point";\n`;
    const bEntry = `export { Point } from "@ext/acme/point";\n`;
    const aMount: DependencyMount = {
      namespace: "acme/a",
      files: new Map([["/index.ts", aEntry]]),
      dependencies: [{ coordinate: "acme/point" }],
    };
    const bMount: DependencyMount = {
      namespace: "acme/b",
      files: new Map([["/index.ts", bEntry]]),
      dependencies: [{ coordinate: "acme/point" }],
    };

    const host = `import { Sensor, type Context } from "mindcraft";
import { Point as PointA } from "@ext/acme/a";
import { Point as PointB } from "@ext/acme/b";
export default Sensor({
  name: "read", id: "readDiamond00001", returnType: PointA,
  onExecute(ctx: Context): PointA { const b: PointB = { x: 5, y: 6 }; return PointA({ x: b.x, y: b.y }); },
});
`;

    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: mountsFor(environment),
      environment,
      dependencies: [{ coordinate: "acme/a" }, { coordinate: "acme/b" }],
      dependencyMounts: [pointMount, aMount, bMount],
    });
    compiler.replaceWorkspace(new Map([["main.ts", { kind: "file", content: host, etag: "e1", isReadonly: false }]]));
    const result = compiler.compile();
    assert.deepEqual(result.files.get("main.ts") ?? [], [], "the diamond compiles clean");

    const pointId = types.resolveByName(qualifiedClassName("acme/point", "/point.ts", "Point"));
    assert.ok(pointId, "the shared origin's struct registers once under its own origin");
    // Neither dependent registers a parallel copy under its own namespace.
    assert.equal(types.resolveByName(qualifiedClassName("acme/a", "/point.ts", "Point")), undefined);
    assert.equal(types.resolveByName(qualifiedClassName("acme/b", "/point.ts", "Point")), undefined);

    // Each resolved origin materializes as compiler-controlled source under its
    // own `.extensions/<owner>/<repo>/` subtree.
    const controlled = compiler.getCompilerControlledFiles();
    assert.equal(controlled.get(".extensions/acme/point/point.ts"), pointSource);
    assert.equal(controlled.get(".extensions/acme/a/index.ts"), aEntry);
    assert.equal(controlled.get(".extensions/acme/b/index.ts"), bEntry);
  });

  const BEEP_SOURCE = `import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "ext beep",
  id: "extBeep000000001",
  onExecute(ctx: Context): number { return 1; },
});
`;
  const HOST_SENSOR = `import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "host thing",
  id: "hostThing0000001",
  onExecute(ctx: Context): number { return 2; },
});
`;
  const EXT_ACTION_KEY = "acme/beeper:user.sensor.extBeep000000001";
  const HOST_ACTION_KEY = `${TEST_PROJECT_NAMESPACE}:user.sensor.hostThing0000001`;

  test("an installed extension's tiles enter the combined bundle; uninstalling removes them", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const beepMount: DependencyMount = {
      namespace: "acme/beeper",
      files: new Map([["/index.ts", BEEP_SOURCE]]),
    };
    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: mountsFor(environment),
      environment,
      dependencies: [{ coordinate: "acme/beeper" }],
      dependencyMounts: [beepMount],
    });
    compiler.replaceWorkspace(
      new Map([["main.ts", { kind: "file", content: HOST_SENSOR, etag: "e1", isReadonly: false }]])
    );

    const installed = compiler.compile();
    assert.ok(installed.bundle, "expected a bundle with the extension installed");
    assert.ok(installed.bundle.actions.get(EXT_ACTION_KEY), "the extension's tile action is in the bundle");
    assert.ok(installed.bundle.actions.get(HOST_ACTION_KEY), "the host's tile action is in the bundle");
    assert.equal(installed.rootResults.length, 2, "the host and the one extension are both compilation roots");

    // Uninstall: re-resolve to no extensions.
    compiler.setDependencies([], []);
    const uninstalled = compiler.compile();
    assert.ok(uninstalled.bundle, "expected a bundle after uninstall");
    assert.equal(
      uninstalled.bundle.actions.get(EXT_ACTION_KEY),
      undefined,
      "the extension's tile action is gone once uninstalled"
    );
    assert.ok(uninstalled.bundle.actions.get(HOST_ACTION_KEY), "the host's own tile survives the uninstall");
    assert.equal(uninstalled.rootResults.length, 1, "only the host remains a compilation root");
  });

  test("the combined bundle merges host and extension actions into one action table", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const beepMount: DependencyMount = {
      namespace: "acme/beeper",
      files: new Map([["/index.ts", BEEP_SOURCE]]),
    };
    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: mountsFor(environment),
      environment,
      dependencies: [{ coordinate: "acme/beeper" }],
      dependencyMounts: [beepMount],
    });
    compiler.replaceWorkspace(
      new Map([["main.ts", { kind: "file", content: HOST_SENSOR, etag: "e1", isReadonly: false }]])
    );
    const result = compiler.compile();
    assert.ok(result.bundle);

    // The whole-program downstream (brain-link, treeshake, constant-dedup)
    // consumes exactly one CompiledActionBundle: rebuilding it over all roots
    // with the shared builder reproduces the same combined shape.
    const rebuilt = buildMultiRootActionBundle(result.rootResults, {
      services: environment.brainServices,
    });
    assert.ok(rebuilt);
    assert.equal(rebuilt.revision, result.bundle.revision);
    assert.deepEqual(
      rebuilt.actions.keys().toArray().sort(),
      result.bundle.actions.keys().toArray().sort(),
      "one action table holds host and extension actions alike"
    );
    assert.deepEqual(
      [EXT_ACTION_KEY, HOST_ACTION_KEY].filter((key) => result.bundle!.actions.get(key)),
      [EXT_ACTION_KEY, HOST_ACTION_KEY],
      "both origins share the single downstream action table"
    );
  });

  const MISSING_ID_SOURCE = `import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "ext beep",
  onExecute(ctx: Context): number { return 1; },
});
`;

  test("an installed extension's missing-id diagnostic surfaces on its .extensions path", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const malformedMount: DependencyMount = {
      namespace: "acme/beeper",
      files: new Map([["/index.ts", MISSING_ID_SOURCE]]),
    };
    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: mountsFor(environment),
      environment,
      dependencies: [{ coordinate: "acme/beeper" }],
      dependencyMounts: [malformedMount],
    });
    compiler.replaceWorkspace(
      new Map([["main.ts", { kind: "file", content: HOST_SENSOR, etag: "e1", isReadonly: false }]])
    );
    const result = compiler.compile();

    const extPath = ".extensions/acme/beeper/index.ts";
    const extDiagnostics = result.files.get(extPath) ?? [];
    assert.ok(
      extDiagnostics.some((d) => d.code === "MC5022"),
      `expected the extension's missing-id diagnostic on ${extPath}, got ${JSON.stringify([...result.files])}`
    );

    // The host's own file is unaffected.
    assert.deepEqual(result.files.get("main.ts") ?? [], [], "the host program compiles clean");
  });

  test("an extension-carried tsconfig.json is inert to compilation and extension content cannot collide at the workspace root", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const ambientFiles = ambientFilesFor(environment);
    // A tsconfig that would break both compilation roots if it were ever read:
    // it remaps the `mindcraft` module to a path that does not exist.
    const carriedTsconfig = JSON.stringify({
      compilerOptions: { strict: false, baseUrl: ".", paths: { mindcraft: ["./vendor/mindcraft"] } },
      include: ["**/*"],
    });
    const beeperMount: DependencyMount = {
      namespace: "acme/beeper",
      files: new Map([
        ["/index.ts", BEEP_SOURCE],
        ["/tsconfig.json", carriedTsconfig],
        ["/mindcraft.core.d.ts", "export {};\n"],
      ]),
    };
    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: [declarationMount(ambientFiles)],
      environment,
      dependencies: [{ coordinate: "acme/beeper" }],
      dependencyMounts: [beeperMount],
    });
    compiler.replaceWorkspace(
      new Map([["main.ts", { kind: "file", content: HOST_SENSOR, etag: "e1", isReadonly: false }]])
    );

    const result = compiler.compile();
    assert.deepEqual(
      [...result.files].filter(([, diagnostics]) => diagnostics.length > 0),
      [],
      "neither the host root nor the extension root reads the carried tsconfig: both compile clean"
    );
    assert.ok(result.bundle?.actions.get(EXT_ACTION_KEY), "the extension's tile action is in the bundle");
    assert.ok(result.bundle?.actions.get(HOST_ACTION_KEY), "the host's tile action is in the bundle");

    const controlled = compiler.getCompilerControlledFiles();
    assert.equal(
      controlled.get(".extensions/acme/beeper/tsconfig.json"),
      carriedTsconfig,
      "the carried tsconfig.json materializes verbatim under the extension subtree"
    );
    assert.ok(
      controlled.get("tsconfig.json")?.includes('"strict": true'),
      "the workspace-root tsconfig.json stays the generated one"
    );
    // Extension content keys under `.extensions/<owner>/<repo>/` unconditionally,
    // so a file named like a host ambient cannot land at the workspace root.
    assert.equal(controlled.get(".extensions/acme/beeper/mindcraft.core.d.ts"), "export {};\n");
    assert.equal(controlled.get("mindcraft.core.d.ts"), ambientFiles[0]!.content);
  });

  test("a project without extensions produces the single-root bundle unchanged", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: mountsFor(environment),
      environment,
    });
    compiler.replaceWorkspace(
      new Map([["main.ts", { kind: "file", content: HOST_SENSOR, etag: "e1", isReadonly: false }]])
    );
    const result = compiler.compile();
    assert.ok(result.bundle);
    assert.equal(result.rootResults.length, 1, "the host is the only compilation root");

    const singleRoot = buildCompiledActionBundle(result.projectResult, {
      services: environment.brainServices,
    });
    assert.ok(singleRoot);
    assert.equal(
      result.bundle.revision,
      singleRoot.revision,
      "the bundle revision is identical to the single-root path"
    );
    assert.deepEqual(result.bundle.actions.keys().toArray().sort(), singleRoot.actions.keys().toArray().sort());
    assert.deepEqual(
      result.bundle.tiles.map((tile) => tile.tileId).sort(),
      singleRoot.tiles.map((tile) => tile.tileId).sort(),
      "the tiles are identical to the single-root path"
    );
  });
});
