import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { coreModule, createMindcraftEnvironment, List, type MindcraftModule } from "@mindcraft-lang/core";
import { type EnumTypeDef, mkTypeId, NativeType } from "@mindcraft-lang/core/runtime";
import { buildAmbientDeclarations } from "./compiler/ambient.js";
import { declarationMount, type Mount } from "./compiler/mounts.js";
import type { AmbientFile } from "./compiler/types.js";
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
});
