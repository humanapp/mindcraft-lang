import type { CompiledActionBundle, MindcraftEnvironment } from "@mindcraft-lang/core";
import type { DiagnosticSeverity } from "@mindcraft-lang/core/brain";
import type { ProjectCompileResult } from "./compiler/compile.js";
import { type DependencyMount, extensionWorkspacePath, type ProjectDependency } from "./compiler/extension-mounts.js";
import { declarationMounts, type Mount, mountedFiles, sourceMounts } from "./compiler/mounts.js";
import { COMPILER_CONTROLLED_TSCONFIG_PATH, UserTileProject } from "./compiler/project.js";
import { MultiRootSession, type ProjectRoot } from "./compiler/project-set.js";
import type { CompileDiagnostic } from "./compiler/types.js";
import { buildMultiRootActionBundle } from "./runtime/action-bundle.js";

/** A file in a {@link WorkspaceSnapshot}: `content` plus the `etag` used for optimistic concurrency. */
export type WorkspaceFileEntry = {
  kind: "file";
  content: string;
  etag: string;
  isReadonly: boolean;
};

/** A directory entry in a {@link WorkspaceSnapshot}. */
export type WorkspaceDirectoryEntry = {
  kind: "directory";
};

/** Tagged union of file and directory entries that may appear in a {@link WorkspaceSnapshot}. */
export type WorkspaceSnapshotEntry = WorkspaceFileEntry | WorkspaceDirectoryEntry;

/** Read-only snapshot of every file and directory in the workspace, keyed by path. */
export type WorkspaceSnapshot = ReadonlyMap<string, WorkspaceSnapshotEntry>;

/**
 * Tagged-union of incremental edits accepted by
 * {@link WorkspaceCompiler.applyWorkspaceChange}.
 */
export type WorkspaceChange =
  | {
      action: "write";
      path: string;
      content: string;
      isReadonly?: boolean;
      newEtag: string;
      expectedEtag?: string;
    }
  | {
      action: "delete";
      path: string;
      expectedEtag?: string;
    }
  | {
      action: "rename";
      oldPath: string;
      newPath: string;
      expectedEtag?: string;
    }
  | {
      action: "mkdir";
      path: string;
    }
  | {
      action: "rmdir";
      path: string;
    }
  | {
      action: "import";
      entries: Iterable<[string, WorkspaceSnapshotEntry]>;
    };

/** Source range for a workspace diagnostic. Lines and columns are 1-based. */
export interface WorkspaceDiagnosticRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** A single diagnostic for a workspace file. `code` is the namespaced compiler diagnostic code (e.g. `MC1004`). */
export interface WorkspaceDiagnosticEntry {
  severity: DiagnosticSeverity;
  message: string;
  code: string;
  range: WorkspaceDiagnosticRange;
}

/** Result of a {@link WorkspaceCompiler.compile} call. */
export interface WorkspaceCompileResult {
  /** Diagnostics keyed by workspace path. Files with no diagnostics are absent. */
  files: ReadonlyMap<string, readonly WorkspaceDiagnosticEntry[]>;
  /** The host project's compile result. Diagnostics surfaced to the user come from here only. */
  projectResult: ProjectCompileResult;
  /**
   * Every compilation root whose tiles enter {@link bundle}: the host project
   * followed by one result per installed extension. Equals `[projectResult]`
   * when the project has no extensions.
   */
  rootResults: readonly ProjectCompileResult[];
  /** Compiled action bundle. Absent when the project has blocking diagnostics. */
  bundle?: CompiledActionBundle;
}

/** Options for {@link createWorkspaceCompiler}. */
export interface CreateWorkspaceCompilerOptions {
  environment: MindcraftEnvironment;
  /** Namespace of the project being compiled (its store id, or an extension origin); prefixes every symbol key minted from the project's content. */
  projectNamespace: string;
  /**
   * Read-only content mounts available to the TypeScript compiler and remote
   * VFS peers. Declaration mounts are always in scope; source mounts are
   * resolvable by user import.
   */
  mounts: readonly Mount[];
  /**
   * Extension dependencies of the project being compiled, each pairing a
   * dependency's `@ext/<owner>/<repo>` coordinate with its namespace. Empty
   * when the project has no extensions.
   */
  dependencies?: readonly ProjectDependency[];
  /**
   * Read-only content of each dependency named in {@link dependencies},
   * including the transitive closure, mounted for `@ext/<owner>/<repo>`
   * resolution.
   */
  dependencyMounts?: readonly DependencyMount[];
}

/** Driver for incremental workspace compilation. Receives snapshot/change inputs and emits diagnostics and a bundle. */
export interface WorkspaceCompiler {
  replaceWorkspace(snapshot: WorkspaceSnapshot): void;
  applyWorkspaceChange(change: WorkspaceChange): void;
  /**
   * Replace the project's extension dependencies and their mounted content.
   * A subsequent compile registers the new mounts and tears down the type
   * registrations of any origin dropped since the previous compile.
   */
  setDependencies(dependencies: readonly ProjectDependency[], dependencyMounts: readonly DependencyMount[]): void;
  compile(): WorkspaceCompileResult;
  /** Subscribe to compile results. Returns a disposer. */
  onDidCompile(listener: (result: WorkspaceCompileResult) => void): () => void;
  /**
   * Files the compiler controls: ambient declarations, `tsconfig.json`, and the
   * read-only installed-extensions tree (`.extensions/<owner>/<repo>/...`)
   * materialized from the resolved extension set. The host should keep these in
   * sync with the workspace and exclude them from the project's saved bytes.
   */
  getCompilerControlledFiles(): ReadonlyMap<string, string>;
}

function mapDiagnostic(diagnostic: CompileDiagnostic): WorkspaceDiagnosticEntry {
  return {
    severity: diagnostic.severity,
    message: diagnostic.message,
    code: `MC${diagnostic.code}`,
    range: {
      startLine: diagnostic.line ?? 1,
      startColumn: diagnostic.column ?? 1,
      endLine: diagnostic.endLine ?? diagnostic.line ?? 1,
      endColumn: diagnostic.endColumn ?? diagnostic.column ?? 1,
    },
  };
}

/**
 * Fold one compile root's diagnostics into `files`, mapping each root-relative
 * path to its workspace path with `toWorkspacePath`. Diagnostics on a path
 * already present are appended, so a host path carrying both TypeScript and
 * descriptor diagnostics accumulates both.
 */
function foldRootDiagnostics(
  files: Map<string, readonly WorkspaceDiagnosticEntry[]>,
  projectResult: ProjectCompileResult,
  toWorkspacePath: (path: string) => string
): void {
  const add = (path: string, diagnostics: readonly CompileDiagnostic[]): void => {
    const key = toWorkspacePath(path);
    const entries = diagnostics.map(mapDiagnostic);
    const existing = files.get(key);
    files.set(key, existing ? existing.concat(entries) : entries);
  };

  for (const [path, diagnostics] of projectResult.tsErrors) {
    add(path, diagnostics);
  }

  for (const [path, compileResult] of projectResult.results) {
    add(path, compileResult.diagnostics);
  }
}

function snapshotToProjectFiles(snapshot: WorkspaceSnapshot): Map<string, string> {
  const files = new Map<string, string>();

  for (const [path, entry] of snapshot) {
    if (entry.kind === "file") {
      files.set(path, entry.content);
    }
  }

  return files;
}

class WorkspaceCompilerController implements WorkspaceCompiler {
  private readonly project: UserTileProject;
  private readonly compileListeners = new Set<(result: WorkspaceCompileResult) => void>();
  /** The dependency mounts materialized into the installed-extensions tree at the latest compile. */
  private _dependencyMounts: readonly DependencyMount[];
  /**
   * Session that compiles each installed extension under its own namespace
   * scope. Present once the project has at least one extension; undefined
   * otherwise.
   */
  private _extensionSession?: MultiRootSession;
  /** The latest per-extension compile results paired with their coordinate namespace, in dependency order; reused across host-only recompiles. */
  private _extensionResults: readonly (readonly [string, ProjectCompileResult])[] = [];
  /** Set when the resolved extension set changed since the last extension compile. */
  private _extensionsDirty = true;

  constructor(private readonly options: CreateWorkspaceCompilerOptions) {
    this._dependencyMounts = options.dependencyMounts ?? [];
    this.project = new UserTileProject({
      projectNamespace: options.projectNamespace,
      ambientFiles: mountedFiles(declarationMounts(options.mounts)),
      stdlibFiles: mountedFiles(sourceMounts(options.mounts)),
      services: options.environment.brainServices,
      dependencies: options.dependencies,
      dependencyMounts: options.dependencyMounts,
    });
  }

  replaceWorkspace(snapshot: WorkspaceSnapshot): void {
    this.project.setFiles(snapshotToProjectFiles(snapshot));
  }

  applyWorkspaceChange(change: WorkspaceChange): void {
    switch (change.action) {
      case "write":
        this.project.updateFile(change.path, change.content);
        break;
      case "delete":
        this.project.deleteFile(change.path);
        break;
      case "rename":
        this.project.renameFile(change.oldPath, change.newPath);
        break;
      case "import":
        this.project.setFiles(snapshotToProjectFiles(new Map(change.entries)));
        break;
      case "mkdir":
      case "rmdir":
        break;
    }
  }

  setDependencies(dependencies: readonly ProjectDependency[], dependencyMounts: readonly DependencyMount[]): void {
    this._dependencyMounts = dependencyMounts;
    this._extensionsDirty = true;
    this.project.setDependencies(dependencies, dependencyMounts);
  }

  compile(): WorkspaceCompileResult {
    // Extensions must be compiled before the host: the host's on-demand type
    // resolution reads their registered tiles.
    this.refreshExtensions();

    const projectResult = this.project.compileAll();
    const rootResults = [projectResult, ...this._extensionResults.map(([, result]) => result)];

    // Host diagnostics key on their project-relative workspace path; each
    // extension root's diagnostics key under its installed-extensions path
    // (`.extensions/<owner>/<repo>/...`), the path space the VFS and extension
    // tree serve from. Host paths and extension paths never overlap: the host
    // compile skips the `.extensions/` tree, and each extension keys under its
    // own coordinate. Diagnostics on a shared key accumulate, never overwrite.
    const files = new Map<string, readonly WorkspaceDiagnosticEntry[]>();
    foldRootDiagnostics(files, projectResult, (path) => path);
    for (const [namespace, extensionResult] of this._extensionResults) {
      foldRootDiagnostics(files, extensionResult, (path) => extensionWorkspacePath(namespace, path));
    }
    const bundle = buildMultiRootActionBundle(rootResults, {
      services: this.options.environment.brainServices,
    });

    const result: WorkspaceCompileResult = {
      files,
      projectResult,
      rootResults,
      bundle,
    };

    for (const listener of this.compileListeners) {
      listener(result);
    }

    return result;
  }

  /** The resolved extension set as compilation roots, one per dependency mount. */
  private extensionRoots(): ProjectRoot[] {
    return this._dependencyMounts.map((mount) => ({
      namespace: mount.namespace,
      files: mount.files,
      dependencies: mount.dependencies,
      readOnlySource: true,
    }));
  }

  /**
   * Recompile the extension scopes when the resolved set changed. Dropping the
   * last extension tears down every scope's registrations; an intermediate
   * change tears down only the origins no longer present.
   */
  private refreshExtensions(): void {
    if (!this._extensionsDirty) return;
    this._extensionsDirty = false;

    const roots = this.extensionRoots();
    if (roots.length === 0) {
      this._extensionSession?.setRoots([]);
      this._extensionResults = [];
      return;
    }

    if (!this._extensionSession) {
      this._extensionSession = new MultiRootSession({ services: this.options.environment.brainServices });
    }
    this._extensionSession.setRoots(roots);
    const { roots: results } = this._extensionSession.compile();
    this._extensionResults = [...results];
  }

  onDidCompile(listener: (result: WorkspaceCompileResult) => void): () => void {
    this.compileListeners.add(listener);
    return () => {
      this.compileListeners.delete(listener);
    };
  }

  getCompilerControlledFiles(): ReadonlyMap<string, string> {
    const files = new Map<string, string>();
    for (const file of mountedFiles(this.options.mounts)) {
      files.set(file.path, file.content);
    }
    files.set(COMPILER_CONTROLLED_TSCONFIG_PATH, TSCONFIG_CONTENT);
    // The resolved extensions materialize as read-only source under the
    // installed-extensions tree, one subtree per `<owner>/<repo>` coordinate.
    for (const mount of this._dependencyMounts) {
      for (const [path, content] of mount.files) {
        files.set(extensionWorkspacePath(mount.namespace, path), content);
      }
    }
    return files;
  }
}

const TSCONFIG_CONTENT = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2016",
      module: "ES2020",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      paths: {
        "@ext/*": ["./.extensions/*"],
      },
    },
    // TypeScript's default `**/*` include skips dot-directories; the
    // materialized installed-extensions tree is listed explicitly to cover it.
    include: ["**/*", ".extensions/**/*"],
  },
  undefined,
  2
);

/** Construct a {@link WorkspaceCompiler} bound to the given environment and (optional) ambient declarations. */
export function createWorkspaceCompiler(options: CreateWorkspaceCompilerOptions): WorkspaceCompiler {
  return new WorkspaceCompilerController(options);
}
