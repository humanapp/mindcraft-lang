import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core";
import ts from "typescript";
import type { DependencyMount, ProjectDependency } from "./compiler/extension-mounts.js";
import { declarationMount } from "./compiler/mounts.js";
import type { AmbientFile } from "./compiler/types.js";
import { TEST_PROJECT_NAMESPACE } from "./testing/index.js";
import { createWorkspaceCompiler } from "./workspace-compiler.js";

/**
 * Diagnostics the VS Code TypeScript language service would report for a
 * materialized workspace, split into two channels:
 *
 * - `config`: the config-level diagnostics of the generated `tsconfig.json`
 *   itself -- its parse errors plus the program's option and global
 *   diagnostics. A bad `compilerOptions` value (for example a non-relative
 *   `paths` substitution with no `baseUrl`) surfaces here, not on any user
 *   file.
 * - `byTarget`: the semantic and syntactic diagnostics for each requested
 *   target source file.
 *
 * The compiler-controlled files plus the given user sources are written to a
 * real workspace directory and compiled by the standard `typescript` program
 * driven by the generated `tsconfig.json`. Materializing to disk drives
 * TypeScript's own `include`/`exclude` glob expansion, including its
 * dot-directory handling.
 */
function editorDiagnostics(
  workspaceFiles: ReadonlyMap<string, string>,
  targets: readonly string[]
): { config: string[]; byTarget: Map<string, string[]> } {
  const root = mkdtempSync(path.join(tmpdir(), "mc-editor-tsconfig-"));
  try {
    for (const [relative, content] of workspaceFiles) {
      const absolute = path.join(root, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }

    const configPath = path.join(root, "tsconfig.json");
    const parseHost: ts.ParseConfigFileHost = {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    };
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, parseHost);
    assert.ok(parsed, "the generated tsconfig.json parses");

    const program = ts.createProgram(parsed.fileNames, parsed.options, ts.createCompilerHost(parsed.options));

    const config = [...parsed.errors, ...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()].map(
      (diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    );

    const byTarget = new Map<string, string[]>();
    for (const target of targets) {
      const absolute = path.join(root, target);
      const sourceFile = program.getSourceFile(absolute);
      if (!sourceFile) {
        byTarget.set(target, ["<not covered by the project>"]);
        continue;
      }
      const diagnostics = [
        ...program.getSemanticDiagnostics(sourceFile),
        ...program.getSyntacticDiagnostics(sourceFile),
      ];
      byTarget.set(
        target,
        diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      );
    }
    return { config, byTarget };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const platformAmbient: AmbientFile = {
  path: "mindcraft.microbit-v2.d.ts",
  content: `declare module "mindcraft" {
  export interface Image {
    readonly width: number;
  }
}
`,
};

const wodalMount: DependencyMount = {
  namespace: "mindcraft-lang/wodal",
  files: new Map([
    [
      "/image.ts",
      `import type { Image } from "mindcraft";\nexport function image(width: number): Image {\n  return { width };\n}\n`,
    ],
    ["/index.ts", `export { image } from "./image";\n`],
  ]),
};

const wodalDependency: ProjectDependency = { coordinate: "mindcraft-lang/wodal" };

describe("generated workspace tsconfig editor resolution", () => {
  test("the materialized extension source and @ext user imports resolve types with zero diagnostics", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: [declarationMount([platformAmbient])],
      environment,
      dependencies: [wodalDependency],
      dependencyMounts: [wodalMount],
    });

    const controlled = compiler.getCompilerControlledFiles();
    assert.ok(
      controlled.has(".extensions/mindcraft-lang/wodal/image.ts"),
      "the wodal dependency materializes image.ts under the installed-extensions tree"
    );

    const userMain = `import type { Image } from "mindcraft";\nimport { image } from "@ext/mindcraft-lang/wodal";\nexport const heart: Image = image(5);\n`;
    const workspaceFiles = new Map(controlled);
    workspaceFiles.set("main.ts", userMain);

    const { config, byTarget } = editorDiagnostics(workspaceFiles, [
      ".extensions/mindcraft-lang/wodal/image.ts",
      "main.ts",
    ]);

    assert.deepEqual(
      config,
      [],
      "the generated tsconfig.json produces no config-level diagnostics (parse, option, or global)"
    );
    assert.deepEqual(
      byTarget.get(".extensions/mindcraft-lang/wodal/image.ts"),
      [],
      'the materialized image.ts resolves `import type { Image } from "mindcraft"`'
    );
    assert.deepEqual(
      byTarget.get("main.ts"),
      [],
      "user code resolves both the ambient `mindcraft` module and the `@ext/<owner>/<repo>` import"
    );
  });
});
