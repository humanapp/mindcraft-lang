import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createInMemoryProjectFileSystem, type ExampleDefinition } from "@mindcraft-lang/app-host";
import { FileSystem } from "@mindcraft-lang/bridge-client";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core";
import {
  buildAmbientDeclarations,
  createWorkspaceCompiler,
  type DependencyMount,
  declarationMount,
  isCompilerControlledPath,
  type Mount,
} from "@mindcraft-lang/ts-compiler";
import { augmentProjectFileSystem } from "./compilation.js";
import { toFileSystemSnapshot } from "./project-file-bridge.js";

const STDLIB_MOUNT: DependencyMount = {
  namespace: "mindcraft-lang/wodal",
  files: new Map([
    ["/index.ts", "export {} from './image';"],
    ["/image.ts", "export const image = 1;"],
  ]),
  dependencies: [],
};

const SECOND_MOUNT: DependencyMount = {
  namespace: "acme/widgets",
  files: new Map([["/index.ts", "export const widget = 2;"]]),
  dependencies: [],
};

const EXAMPLES: ExampleDefinition[] = [{ folder: "blink", files: [{ path: "main.ts", content: "export {};" }] }];

/**
 * Build the peer-facing augmented file system the way the real host does:
 * an in-memory project FS that excludes compiler-controlled paths, wrapped
 * over a workspace compiler whose resolved dependency mounts materialize the
 * `.extensions/<owner>/<repo>/` tree.
 */
function buildAugmented(dependencyMounts: readonly DependencyMount[]) {
  const environment = createMindcraftEnvironment({ modules: [coreModule()] });
  const ambient = buildAmbientDeclarations(environment.brainServices.runtime.types);
  const mounts: Mount[] = [declarationMount([{ path: "mindcraft.core.d.ts", content: ambient }])];
  const compiler = createWorkspaceCompiler({
    projectNamespace: "probe",
    mounts,
    environment,
    dependencies: dependencyMounts.map((m) => ({ coordinate: m.namespace })),
    dependencyMounts,
  });
  const filesystem = createInMemoryProjectFileSystem({
    shouldExclude: (path) => isCompilerControlledPath(path, mounts),
  });
  filesystem.applyLocalChange({ action: "write", path: "mindcraft.json", content: "{}", newEtag: "e0" });
  filesystem.applyLocalChange({ action: "write", path: "src/main.ts", content: "export {};", newEtag: "e1" });
  compiler.replaceWorkspace(
    new Map([["src/main.ts", { kind: "file", content: "export {};", etag: "e1", isReadonly: false }]])
  );
  compiler.compile();
  return augmentProjectFileSystem(filesystem, compiler, () => EXAMPLES);
}

describe("augmentProjectFileSystem -- installed-extensions tree surfacing", () => {
  test("the exported snapshot carries the .extensions files read-only and every ancestor directory entry", () => {
    const snapshot = buildAugmented([STDLIB_MOUNT]).exportSnapshot();

    // (a) The compiler-controlled extension source is present, read-only.
    const indexEntry = snapshot.get(".extensions/mindcraft-lang/wodal/index.ts");
    assert.ok(indexEntry && indexEntry.kind === "file", "the stdlib entry file is present");
    assert.equal(indexEntry.isReadonly, true, "materialized extension source is read-only");
    const imageEntry = snapshot.get(".extensions/mindcraft-lang/wodal/image.ts");
    assert.ok(imageEntry && imageEntry.kind === "file");
    assert.equal(imageEntry.isReadonly, true);

    // (b) Every ancestor of the extension files is present as a directory entry,
    // the same invariant the base project file system upholds for its own files.
    for (const dir of [".extensions", ".extensions/mindcraft-lang", ".extensions/mindcraft-lang/wodal"]) {
      const entry = snapshot.get(dir);
      assert.ok(entry && entry.kind === "directory", `${dir} is present as a directory entry`);
    }

    // The root-level ambient declaration remains a plain root file (no parent to emit).
    const ambient = snapshot.get("mindcraft.core.d.ts");
    assert.ok(ambient && ambient.kind === "file", "the root ambient declaration is present");
  });

  test("the .extensions tree is walkable to the stdlib files through the peer sync chain", () => {
    const augmented = buildAugmented([STDLIB_MOUNT]);
    const initial = toFileSystemSnapshot(augmented.exportSnapshot());

    // App side: the bridge imports the augmented snapshot; sync re-exports it;
    // the peer imports the sync payload into its own read file system.
    const appFs = new FileSystem();
    appFs.import(initial);
    const peerFs = new FileSystem();
    peerFs.import(appFs.export());

    const rootNames = peerFs.list().map((e) => e.name);
    assert.ok(rootNames.includes("mindcraft.core.d.ts"), "root ambient declaration surfaces");
    const ext = peerFs.list().find((e) => e.name === ".extensions");
    assert.ok(ext && ext.kind === "directory", ".extensions surfaces at the peer root");

    // Walk .extensions -> mindcraft-lang -> wodal -> files.
    const owner = peerFs.list(".extensions");
    assert.deepEqual(
      owner.map((e) => [e.name, e.kind]),
      [["mindcraft-lang", "directory"]]
    );
    const repo = peerFs.list(".extensions/mindcraft-lang");
    assert.deepEqual(
      repo.map((e) => [e.name, e.kind]),
      [["wodal", "directory"]]
    );
    const files = peerFs.list(".extensions/mindcraft-lang/wodal");
    const fileNames = files.map((e) => e.name).sort();
    assert.deepEqual(fileNames, ["image.ts", "index.ts"]);
    for (const f of files) {
      assert.equal(f.kind, "file");
      if (f.kind === "file") {
        assert.equal(f.isReadonly, true, "peer sees materialized extension source as read-only");
      }
    }
  });

  test("two resolved coordinates each surface an independent, walkable subtree", () => {
    const augmented = buildAugmented([STDLIB_MOUNT, SECOND_MOUNT]);
    const peerFs = new FileSystem();
    peerFs.import(toFileSystemSnapshot(augmented.exportSnapshot()));

    const owners = peerFs
      .list(".extensions")
      .map((e) => e.name)
      .sort();
    assert.deepEqual(owners, ["acme", "mindcraft-lang"]);

    const wodal = peerFs
      .list(".extensions/mindcraft-lang/wodal")
      .map((e) => e.name)
      .sort();
    assert.deepEqual(wodal, ["image.ts", "index.ts"]);
    const widgets = peerFs
      .list(".extensions/acme/widgets")
      .map((e) => e.name)
      .sort();
    assert.deepEqual(widgets, ["index.ts"]);
  });
});
