import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createInMemoryProjectFileSystem } from "@wendoo/app-host";
import { FileSystem } from "@wendoo/bridge-client";
import { coreModule, createWendooEnvironment } from "@wendoo/core";
import {
  buildAmbientDeclarations,
  createWorkspaceCompiler,
  type DependencyMount,
  declarationMount,
  isCompilerControlledPath,
  type Mount,
} from "@wendoo/ts-compiler";
import { augmentProjectFileSystem } from "./compilation.js";
import { toFileSystemSnapshot } from "./project-file-bridge.js";

const STDLIB_MOUNT: DependencyMount = {
  namespace: "wendoo-lang/codal",
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

const TILE_EXTENSION_DEF = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "probe-detect",
  id: "probeDetect00001",
  icon: "./probe.svg",
  docs: "./probe.md",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;

/** An extension mount carrying a tile def alongside its per-capability icon and docs assets. */
const TILE_ASSET_MOUNT: DependencyMount = {
  namespace: "acme/detector",
  files: new Map([
    ["/detect.ts", TILE_EXTENSION_DEF],
    ["/probe.svg", '<svg id="probe"></svg>'],
    ["/probe.md", "# Probe\nDocs."],
  ]),
  dependencies: [],
};

/** The served-snapshot key a `/vfs/...` asset URL names: the prefix stripped. */
const VFS_PREFIX = "/vfs/";
function vfsAssetPath(vfsUrl: string): string {
  return vfsUrl.slice(VFS_PREFIX.length);
}

/**
 * Build the peer-facing augmented file system the way the real host does:
 * an in-memory project FS that excludes compiler-controlled paths, wrapped
 * over a workspace compiler whose resolved dependency mounts materialize the
 * `.libraries/<owner>/<repo>/` tree.
 */
function buildAugmented(dependencyMounts: readonly DependencyMount[]) {
  const environment = createWendooEnvironment({ modules: [coreModule()] });
  const ambient = buildAmbientDeclarations(environment.brainServices.runtime.types);
  const mounts: Mount[] = [declarationMount([{ path: "wendoo.core.d.ts", content: ambient }])];
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
  filesystem.applyLocalChange({ action: "write", path: "wendoo.json", content: "{}", newEtag: "e0" });
  filesystem.applyLocalChange({ action: "write", path: "src/main.ts", content: "export {};", newEtag: "e1" });
  compiler.replaceWorkspace(
    new Map([["src/main.ts", { kind: "file", content: "export {};", etag: "e1", isReadonly: false }]])
  );
  compiler.compile();
  return augmentProjectFileSystem(filesystem, compiler);
}

/**
 * Build the workspace compiler and its peer-facing augmented file system,
 * returning both so a test can read the compiler's emitted tile metadata and
 * the snapshot the vfs asset-url provider resolves from.
 */
function buildWorkspace(dependencyMounts: readonly DependencyMount[]) {
  const environment = createWendooEnvironment({ modules: [coreModule()] });
  const ambient = buildAmbientDeclarations(environment.brainServices.runtime.types);
  const mounts: Mount[] = [declarationMount([{ path: "wendoo.core.d.ts", content: ambient }])];
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
  filesystem.applyLocalChange({ action: "write", path: "wendoo.json", content: "{}", newEtag: "e0" });
  filesystem.applyLocalChange({ action: "write", path: "src/main.ts", content: "export {};", newEtag: "e1" });
  compiler.replaceWorkspace(
    new Map([["src/main.ts", { kind: "file", content: "export {};", etag: "e1", isReadonly: false }]])
  );
  const result = compiler.compile();
  const augmented = augmentProjectFileSystem(filesystem, compiler);
  return { compiler, augmented, result };
}

describe("augmentProjectFileSystem -- installed-extensions tree surfacing", () => {
  test("the exported snapshot carries the .libraries files read-only and every ancestor directory entry", () => {
    const snapshot = buildAugmented([STDLIB_MOUNT]).exportSnapshot();

    // (a) The compiler-controlled extension source is present, read-only.
    const indexEntry = snapshot.get(".libraries/wendoo-lang/codal/index.ts");
    assert.ok(indexEntry && indexEntry.kind === "file", "the stdlib entry file is present");
    assert.equal(indexEntry.isReadonly, true, "materialized extension source is read-only");
    const imageEntry = snapshot.get(".libraries/wendoo-lang/codal/image.ts");
    assert.ok(imageEntry && imageEntry.kind === "file");
    assert.equal(imageEntry.isReadonly, true);

    // (b) Every ancestor of the extension files is present as a directory entry,
    // the same invariant the base project file system upholds for its own files.
    for (const dir of [".libraries", ".libraries/wendoo-lang", ".libraries/wendoo-lang/codal"]) {
      const entry = snapshot.get(dir);
      assert.ok(entry && entry.kind === "directory", `${dir} is present as a directory entry`);
    }

    // The root-level ambient declaration remains a plain root file (no parent to emit).
    const ambient = snapshot.get("wendoo.core.d.ts");
    assert.ok(ambient && ambient.kind === "file", "the root ambient declaration is present");
  });

  test("the .libraries tree is walkable to the stdlib files through the peer sync chain", () => {
    const augmented = buildAugmented([STDLIB_MOUNT]);
    const initial = toFileSystemSnapshot(augmented.exportSnapshot());

    // App side: the bridge imports the augmented snapshot; sync re-exports it;
    // the peer imports the sync payload into its own read file system.
    const appFs = new FileSystem();
    appFs.import(initial);
    const peerFs = new FileSystem();
    peerFs.import(appFs.export());

    const rootNames = peerFs.list().map((e) => e.name);
    assert.ok(rootNames.includes("wendoo.core.d.ts"), "root ambient declaration surfaces");
    const ext = peerFs.list().find((e) => e.name === ".libraries");
    assert.ok(ext && ext.kind === "directory", ".libraries surfaces at the peer root");

    // Walk .libraries -> wendoo-lang -> codal -> files.
    const owner = peerFs.list(".libraries");
    assert.deepEqual(
      owner.map((e) => [e.name, e.kind]),
      [["wendoo-lang", "directory"]]
    );
    const repo = peerFs.list(".libraries/wendoo-lang");
    assert.deepEqual(
      repo.map((e) => [e.name, e.kind]),
      [["codal", "directory"]]
    );
    const files = peerFs.list(".libraries/wendoo-lang/codal");
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
      .list(".libraries")
      .map((e) => e.name)
      .sort();
    assert.deepEqual(owners, ["acme", "wendoo-lang"]);

    const codal = peerFs
      .list(".libraries/wendoo-lang/codal")
      .map((e) => e.name)
      .sort();
    assert.deepEqual(codal, ["image.ts", "index.ts"]);
    const widgets = peerFs
      .list(".libraries/acme/widgets")
      .map((e) => e.name)
      .sort();
    assert.deepEqual(widgets, ["index.ts"]);
  });

  test("an extension tile's compiled icon URL resolves to the materialized asset in the served snapshot", () => {
    const { augmented, result } = buildWorkspace([TILE_ASSET_MOUNT]);

    // The extension tile compiles without a blocking diagnostic and yields a bundle.
    assert.ok(result.bundle, "extension tile with icon/docs produces a bundle");

    // The compiler emits a namespace-aware icon URL for the extension tile.
    let iconUrl: string | undefined;
    let docsMarkdown: string | undefined;
    for (const rootResult of result.rootResults) {
      for (const compileResult of rootResult.results.values()) {
        if (compileResult.program?.iconUrl) {
          iconUrl = compileResult.program.iconUrl;
          docsMarkdown = compileResult.program.docsMarkdown;
        }
      }
    }
    assert.equal(iconUrl, "/vfs/.libraries/acme/detector/probe.svg");
    assert.equal(docsMarkdown, "# Probe\nDocs.");

    // The asset-url provider resolves that URL from the augmented snapshot: the
    // URL's vfs path is a key present in the snapshot, resolving to the asset bytes.
    const vfsPath = vfsAssetPath(iconUrl);
    assert.equal(vfsPath, ".libraries/acme/detector/probe.svg");
    const entry = augmented.exportSnapshot().get(vfsPath);
    assert.ok(entry && entry.kind === "file", "the icon URL resolves to a file in the served snapshot");
    assert.equal(entry.content, '<svg id="probe"></svg>');
    assert.equal(entry.isReadonly, true);
  });
});
