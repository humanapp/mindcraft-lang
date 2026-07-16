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
  return withWorkspaceOnDisk(workspaceFiles, (root) => projectDiagnostics(root, "tsconfig.json", targets));
}

/** Materialize `workspaceFiles` into a temp directory, run `fn` against it, and clean up. */
function withWorkspaceOnDisk<T>(workspaceFiles: ReadonlyMap<string, string>, fn: (root: string) => T): T {
  const root = mkdtempSync(path.join(tmpdir(), "mc-editor-tsconfig-"));
  try {
    for (const [relative, content] of workspaceFiles) {
      const absolute = path.join(root, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The `tsconfig.json` TypeScript's upward config-file discovery -- the search
 * the editor's language service runs for an opened file -- finds for the file
 * at workspace-relative `target`, as a workspace-relative path.
 */
function discoveredConfigFor(root: string, target: string): string | undefined {
  const configPath = ts.findConfigFile(path.dirname(path.join(root, target)), ts.sys.fileExists);
  return configPath === undefined ? undefined : path.relative(root, configPath);
}

/**
 * Config-level and per-target diagnostics of the project defined by the
 * `tsconfig.json` at workspace-relative `configRelative` in the materialized
 * workspace at `root`. A target the project does not cover reports
 * `<not covered by the project>`.
 */
function projectDiagnostics(
  root: string,
  configRelative: string,
  targets: readonly string[]
): { config: string[]; byTarget: Map<string, string[]> } {
  const configPath = path.join(root, configRelative);
  const parseHost: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, parseHost);
  assert.ok(parsed, `${configRelative} parses`);

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
    const diagnostics = [...program.getSemanticDiagnostics(sourceFile), ...program.getSyntacticDiagnostics(sourceFile)];
    byTarget.set(
      target,
      diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
    );
  }
  return { config, byTarget };
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
  namespace: "mindcraft-lang/codal",
  files: new Map([
    [
      "/image.ts",
      `import type { Image } from "mindcraft";\nexport function image(width: number): Image {\n  return { width };\n}\n`,
    ],
    ["/index.ts", `export { image } from "./image";\n`],
  ]),
};

const wodalDependency: ProjectDependency = { coordinate: "mindcraft-lang/codal" };

/**
 * A tsconfig an extension could plausibly ship for its own authoring workflow,
 * hostile to a consumer: it relaxes strictness and remaps the `mindcraft`
 * module to a path that does not exist in the consumer's workspace.
 */
const extensionCarriedTsconfig = JSON.stringify(
  {
    compilerOptions: {
      strict: false,
      baseUrl: ".",
      paths: { mindcraft: ["./vendor/mindcraft"] },
    },
    include: ["**/*"],
  },
  undefined,
  2
);

const tsconfigCarryingMount: DependencyMount = {
  namespace: "acme/vendored",
  files: new Map([
    [
      "/image.ts",
      `import type { Image } from "mindcraft";\nexport function image(width: number): Image {\n  return { width };\n}\n`,
    ],
    ["/index.ts", `export { image } from "./image";\n`],
    ["/tsconfig.json", extensionCarriedTsconfig],
  ]),
};

const tsconfigCarryingDependency: ProjectDependency = { coordinate: "acme/vendored" };

describe("generated workspace tsconfig editor resolution", () => {
  test("the materialized extension source and @lib user imports resolve types with zero diagnostics", () => {
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
      controlled.has(".libraries/mindcraft-lang/codal/image.ts"),
      "the wodal dependency materializes image.ts under the installed-extensions tree"
    );

    const userMain = `import type { Image } from "mindcraft";\nimport { image } from "@lib/mindcraft-lang/codal";\nexport const heart: Image = image(5);\n`;
    const workspaceFiles = new Map(controlled);
    workspaceFiles.set("main.ts", userMain);

    const { config, byTarget } = editorDiagnostics(workspaceFiles, [
      ".libraries/mindcraft-lang/codal/image.ts",
      "main.ts",
    ]);

    assert.deepEqual(
      config,
      [],
      "the generated tsconfig.json produces no config-level diagnostics (parse, option, or global)"
    );
    assert.deepEqual(
      byTarget.get(".libraries/mindcraft-lang/codal/image.ts"),
      [],
      'the materialized image.ts resolves `import type { Image } from "mindcraft"`'
    );
    assert.deepEqual(
      byTarget.get("main.ts"),
      [],
      "user code resolves both the ambient `mindcraft` module and the `@lib/<owner>/<repo>` import"
    );
  });

  test("an extension-carried tsconfig.json shadows config discovery only inside its own read-only subtree", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const compiler = createWorkspaceCompiler({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      mounts: [declarationMount([platformAmbient])],
      environment,
      dependencies: [tsconfigCarryingDependency],
      dependencyMounts: [tsconfigCarryingMount],
    });

    const controlled = compiler.getCompilerControlledFiles();
    assert.equal(
      controlled.get(".libraries/acme/vendored/tsconfig.json"),
      extensionCarriedTsconfig,
      "the extension's tsconfig.json materializes verbatim under its installed-extensions subtree"
    );

    const userMain = `import type { Image } from "mindcraft";\nimport { image } from "@lib/acme/vendored";\nexport const heart: Image = image(5);\n`;
    const workspaceFiles = new Map(controlled);
    workspaceFiles.set("main.ts", userMain);

    const extensionImage = ".libraries/acme/vendored/image.ts";
    withWorkspaceOnDisk(workspaceFiles, (root) => {
      assert.equal(
        discoveredConfigFor(root, "main.ts"),
        "tsconfig.json",
        "the user's own files are still governed by the generated root tsconfig.json"
      );
      assert.equal(
        discoveredConfigFor(root, extensionImage),
        ".libraries/acme/vendored/tsconfig.json",
        "config discovery inside the extension subtree finds the extension's own tsconfig.json"
      );

      const rootProject = projectDiagnostics(root, "tsconfig.json", ["main.ts", extensionImage]);
      assert.deepEqual(rootProject.config, [], "the root project raises no config-level diagnostics");
      assert.deepEqual(
        rootProject.byTarget.get("main.ts"),
        [],
        "the user's diagnostics and `@lib` resolution into the subtree are unchanged by the nested tsconfig"
      );
      assert.deepEqual(
        rootProject.byTarget.get(extensionImage),
        [],
        "the root project still covers and cleanly checks the extension source"
      );

      const nestedProject = projectDiagnostics(root, ".libraries/acme/vendored/tsconfig.json", [extensionImage]);
      const nestedDiagnostics = nestedProject.byTarget.get(extensionImage) ?? [];
      assert.ok(
        nestedDiagnostics.length > 0,
        "accepted blast radius: viewed under its own tsconfig, the read-only extension source misresolves"
      );
    });
  });
});
