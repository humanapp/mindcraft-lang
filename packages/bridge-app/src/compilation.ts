import type { FileContent } from "@wendoo/app-host";
import { fileContentEquals } from "@wendoo/app-host";
import type { AppClientMessage, CompileDiagnosticEntry, FileSystemNotification } from "@wendoo/bridge-protocol";
import type { WendooEnvironment } from "@wendoo/core";
import {
  createWorkspaceCompiler,
  type DependencyMount,
  type Mount,
  type ProjectDependency,
  type WorkspaceCompiler as TsWorkspaceCompiler,
  type WorkspaceCompileResult,
} from "@wendoo/ts-compiler";
import type {
  AppBridge,
  AppBridgeFeature,
  AppBridgeFeatureContext,
  AppBridgeFeatureStatus,
  DiagnosticEntry,
  ProjectFileChange,
  ProjectFileSnapshot,
  ProjectFileSystem,
} from "./app-bridge.js";
import { createAppBridge } from "./app-bridge.js";

/** Latest compile diagnostics, keyed by file path. */
export interface DiagnosticSnapshot {
  files: ReadonlyMap<string, readonly DiagnosticEntry[]>;
}

/** Project file compiler that the {@link createCompilationFeature} drives. */
export interface ProjectFileCompiler {
  replaceProjectFiles(snapshot: ProjectFileSnapshot): void;
  applyProjectFileChange(change: ProjectFileChange): void;
  /** Run a compile pass and return the resulting diagnostics. */
  compile(): DiagnosticSnapshot;
  /** Subscribe to compile completions. Returns an unsubscribe function. */
  onDidCompile(listener: (snapshot: DiagnosticSnapshot) => void): () => void;
}

/** Options for {@link createCompilationFeature}. */
export interface CompilationFeatureOptions {
  compiler: ProjectFileCompiler;
  /** When `true` (the default), per-file pass/fail status is published alongside diagnostics. */
  publishStatus?: boolean;
}

/** Result of a compile pass driven by {@link CompilationManager}. */
export interface CompilationResult {
  files: Map<string, CompileDiagnosticEntry[]>;
}

/** Lower-level compile interface used by {@link CompilationManager}. */
export interface CompilationProvider {
  fileWritten(path: string, content: string): void;
  fileDeleted(path: string): void;
  fileRenamed(oldPath: string, newPath: string): void;
  /** Replace the provider's view of the project files with `files`. */
  fullSync(files: Iterable<[string, { kind: string; content?: string }]>): void;
  /** Compile every known file and return per-file diagnostics. */
  compileAll(): CompilationResult;
}

function buildFeatureStatus(file: string, diagnostics: readonly DiagnosticEntry[]): AppBridgeFeatureStatus {
  let errorCount = 0;
  let warningCount = 0;

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      errorCount++;
    } else if (diagnostic.severity === "warning") {
      warningCount++;
    }
  }

  return {
    file,
    success: errorCount === 0,
    diagnosticCount: {
      error: errorCount,
      warning: warningCount,
    },
  };
}

/**
 * Build an {@link AppBridgeFeature} that compiles project files on remote
 * changes and publishes diagnostics (and, by default, per-file status) to the
 * peer.
 */
export function createCompilationFeature(options: CompilationFeatureOptions): AppBridgeFeature {
  return {
    attach(context: AppBridgeFeatureContext): () => void {
      let lastSnapshot: DiagnosticSnapshot | undefined;
      const previousDiagnosticFiles = new Set<string>();
      const publishStatus = options.publishStatus ?? true;

      const publishSnapshot = (snapshot: DiagnosticSnapshot): void => {
        if (context.snapshot().status !== "connected") {
          return;
        }

        const currentFiles = new Set<string>();

        for (const [file, diagnostics] of snapshot.files) {
          currentFiles.add(file);

          if (diagnostics.length > 0 || previousDiagnosticFiles.has(file)) {
            context.publishDiagnostics(file, diagnostics);

            if (publishStatus) {
              context.publishStatus(buildFeatureStatus(file, diagnostics));
            }
          }
        }

        for (const file of previousDiagnosticFiles) {
          if (!currentFiles.has(file)) {
            context.publishDiagnostics(file, []);

            if (publishStatus) {
              context.publishStatus(buildFeatureStatus(file, []));
            }
          }
        }

        previousDiagnosticFiles.clear();
        for (const [file, diagnostics] of snapshot.files) {
          if (diagnostics.length > 0) {
            previousDiagnosticFiles.add(file);
          }
        }
      };

      const compileAndPublish = (): void => {
        const snapshot = options.compiler.compile();
        if (lastSnapshot !== snapshot) {
          lastSnapshot = snapshot;
          publishSnapshot(snapshot);
        }
      };

      const compileUnsub = options.compiler.onDidCompile((snapshot) => {
        lastSnapshot = snapshot;
        publishSnapshot(snapshot);
      });

      options.compiler.replaceProjectFiles(context.projectFileSnapshot());
      compileAndPublish();

      const remoteChangeUnsub = context.onRemoteChange((change) => {
        options.compiler.applyProjectFileChange(change);
        compileAndPublish();
      });

      const syncUnsub = context.onDidSync(() => {
        if (lastSnapshot) {
          publishSnapshot(lastSnapshot);
        }
      });

      return () => {
        syncUnsub();
        remoteChangeUnsub();
        compileUnsub();
      };
    },
  };
}

/**
 * Drives a {@link CompilationProvider} from incoming filesystem notifications
 * and emits diagnostics to the peer. Sends version-tagged `compile:diagnostics`
 * and `compile:status` messages when connected.
 */
export class CompilationManager {
  private readonly _provider: CompilationProvider;
  private readonly _send: (msg: AppClientMessage) => void;
  private readonly _isConnected: () => boolean;
  private readonly _versions = new Map<string, number>();
  private readonly _previousFiles = new Set<string>();
  private readonly _compilationListeners = new Set<(result: CompilationResult) => void>();
  private _lastResult: CompilationResult | undefined;
  private readonly _removalListeners = new Set<(path: string) => void>();

  constructor(provider: CompilationProvider, send: (msg: AppClientMessage) => void, isConnected: () => boolean) {
    this._provider = provider;
    this._send = send;
    this._isConnected = isConnected;
  }

  handleFileChange(ev: FileSystemNotification): void {
    switch (ev.action) {
      case "write":
        this._provider.fileWritten(ev.path, ev.content);
        break;
      case "delete":
        this._provider.fileDeleted(ev.path);
        break;
      case "rename":
        this._provider.fileRenamed(ev.oldPath, ev.newPath);
        break;
      case "import":
        this._provider.fullSync(ev.entries);
        break;
      case "mkdir":
      case "rmdir":
        return;
    }

    this.compileAndEmit();
  }

  onCompilation(fn: (result: CompilationResult) => void): () => void {
    this._compilationListeners.add(fn);
    return () => {
      this._compilationListeners.delete(fn);
    };
  }

  onRemoval(fn: (path: string) => void): () => void {
    this._removalListeners.add(fn);
    return () => {
      this._removalListeners.delete(fn);
    };
  }

  sendDiagnostics(): void {
    if (!this._lastResult || !this._isConnected()) return;

    for (const [file, diagnostics] of this._lastResult.files) {
      if (diagnostics.length > 0) {
        this.emitDiagnostics(file, diagnostics);
      }
    }
  }

  private compileAndEmit(): void {
    const result = this._provider.compileAll();
    this._lastResult = result;

    for (const fn of this._compilationListeners) {
      fn(result);
    }

    if (!this._isConnected()) return;

    const currentFiles = new Set<string>();

    for (const [file, diagnostics] of result.files) {
      currentFiles.add(file);
      if (diagnostics.length > 0 || this._previousFiles.has(file)) {
        this.emitDiagnostics(file, diagnostics);
      }
    }

    for (const file of this._previousFiles) {
      if (!currentFiles.has(file)) {
        this.emitDiagnostics(file, []);
        for (const fn of this._removalListeners) {
          fn(file);
        }
      }
    }

    this._previousFiles.clear();
    for (const [file, diagnostics] of result.files) {
      if (diagnostics.length > 0) {
        this._previousFiles.add(file);
      }
    }
  }

  private emitDiagnostics(file: string, diagnostics: CompileDiagnosticEntry[]): void {
    const version = (this._versions.get(file) ?? 0) + 1;
    this._versions.set(file, version);

    this._send({
      type: "compile:diagnostics",
      payload: { file, version, diagnostics },
    });

    let errorCount = 0;
    let warningCount = 0;
    for (const d of diagnostics) {
      if (d.severity === "error") errorCount++;
      else if (d.severity === "warning") warningCount++;
    }

    this._send({
      type: "compile:status",
      payload: {
        file,
        success: errorCount === 0,
        diagnosticCount: { error: errorCount, warning: warningCount },
      },
    });
  }
}

export type { WorkspaceCompileResult } from "@wendoo/ts-compiler";

/** Options for {@link createProjectCompiler}. */
export interface CreateProjectCompilerOptions {
  environment: WendooEnvironment;
  filesystem: ProjectFileSystem;
  /** Namespace of the project being compiled (its store id); prefixes every symbol key minted from the project's content. */
  projectNamespace: string;
  /** Read-only content mounts exposed to the compiler and remote VFS peers. */
  mounts: readonly Mount[];
  /** Extension dependencies of the project, each a `<owner>/<repo>` coordinate resolving its `@lib/<owner>/<repo>` imports. */
  dependencies?: readonly ProjectDependency[];
  /** Read-only content of each dependency, mounted for `@lib/<owner>/<repo>` resolution. */
  dependencyMounts?: readonly DependencyMount[];
  onDidCompile?: (result: WorkspaceCompileResult) => void;
}

/** Handle returned by {@link createProjectCompiler}. */
export interface ProjectCompilerHandle {
  readonly compiler: TsWorkspaceCompiler;
  /** Seed the compiler from the current project file snapshot and run an initial compile. */
  initialize(): void;
  /** Re-seed the compiler with the latest project file snapshot and recompile. */
  replaceProjectFiles(): void;
}

/** Wrap a {@link ProjectFileSystem} as a TS workspace compiler over the live project files. */
export function createProjectCompiler(options: CreateProjectCompilerOptions): ProjectCompilerHandle {
  const { mounts, environment, filesystem, projectNamespace, dependencies, dependencyMounts } = options;

  const compiler = createWorkspaceCompiler({
    projectNamespace,
    mounts,
    environment,
    dependencies,
    dependencyMounts,
  });

  if (options.onDidCompile) {
    compiler.onDidCompile(options.onDidCompile);
  }

  return {
    compiler,
    initialize() {
      compiler.replaceWorkspace(filesystem.exportSnapshot());
      compiler.compile();
    },
    replaceProjectFiles() {
      compiler.replaceWorkspace(filesystem.exportSnapshot());
      compiler.compile();
    },
  };
}

// ---------------------------------------------------------------------------
// BridgeProjectHandle -- bridge connection that uses a ProjectCompilerHandle
// ---------------------------------------------------------------------------

/** Options for {@link createBridgeProject}. */
export interface CreateBridgeProjectOptions {
  projectCompiler: ProjectCompilerHandle;
  /**
   * The served file system whose snapshot already carries the raw project
   * files plus the compiler-controlled files (produced by
   * {@link augmentProjectFileSystem}). The bridge exposes this to the remote
   * peer, so the peer and any local asset server read identical content.
   */
  servedFileSystem: ProjectFileSystem;
  bridgeUrl: string;
  bindingToken?: string;
  onBindingTokenChange?: (token: string) => void;
}

/** Handle returned by {@link createBridgeProject}. */
export interface BridgeProjectHandle {
  readonly bridge: AppBridge;
  /** Tear down the current bridge and create a new one pointing at `bridgeUrl`. */
  recreateBridge(bridgeUrl: string): void;
}

/**
 * Wire up an {@link AppBridge} that uses `projectCompiler` for diagnostics and
 * surfaces compiler-controlled files to the remote peer.
 */
export function createBridgeProject(options: CreateBridgeProjectOptions): BridgeProjectHandle {
  const { projectCompiler, servedFileSystem } = options;
  const compiler = projectCompiler.compiler;

  let latestBindingToken = options.bindingToken;
  const onBindingTokenChange = (token: string): void => {
    latestBindingToken = token;
    options.onBindingTokenChange?.(token);
  };

  let currentBridge = buildBridge(
    {
      bridgeUrl: options.bridgeUrl,
      filesystem: servedFileSystem,
      bindingToken: latestBindingToken,
      onBindingTokenChange,
    },
    compiler
  );

  return {
    get bridge() {
      return currentBridge;
    },
    recreateBridge(bridgeUrl: string) {
      currentBridge.stop();
      currentBridge = buildBridge(
        { bridgeUrl, filesystem: servedFileSystem, bindingToken: latestBindingToken, onBindingTokenChange },
        compiler
      );
    },
  };
}

/** The directory portion of `path` (empty for a root-level path). */
function parentDirectory(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "" : path.slice(0, idx);
}

/**
 * Ensure `dirPath` and each of its ancestors are present in `snapshot` as
 * directory entries, adding any that are missing shallowest-first. An empty
 * `dirPath` (a root-level path's parent) adds nothing.
 */
function ensureSnapshotDirectory(snapshot: ProjectFileSnapshot, dirPath: string): void {
  const segments = dirPath.split("/").filter((segment) => segment.length > 0);
  for (let i = 1; i <= segments.length; i++) {
    const ancestor = segments.slice(0, i).join("/");
    if (!snapshot.has(ancestor)) {
      snapshot.set(ancestor, { kind: "directory" });
    }
  }
}

/** True when the two compiler-controlled file maps carry a different set of paths or content. */
function compilerControlledFilesChanged(
  previous: ReadonlyMap<string, FileContent>,
  current: ReadonlyMap<string, FileContent>
): boolean {
  if (previous.size !== current.size) {
    return true;
  }
  for (const [path, content] of current) {
    const before = previous.get(path);
    if (before === undefined || !fileContentEquals(before, content)) {
      return true;
    }
  }
  return false;
}

/** Options for {@link augmentProjectFileSystem}. */
export interface AugmentProjectFileSystemOptions {
  /**
   * Invoked with the full compiler-controlled file set whenever a compile
   * changes that set.
   */
  onCompilerControlledFilesChanged?: (files: ReadonlyMap<string, FileContent>) => void;
}

/**
 * Wrap a {@link ProjectFileSystem} so its exported snapshot also carries the
 * compiler-controlled files (ambient declarations, `tsconfig.json`, and the
 * read-only installed-extensions tree), all marked read-only. Local and remote
 * changes targeting those augmented paths are filtered out, leaving them
 * read-only from the peer's side.
 *
 * When a compile changes the compiler-controlled file set (installing or
 * uninstalling an extension adds or removes its `.libraries/` subtree), the
 * wrapper emits one full-snapshot `import` local change and invokes the
 * options' change callback with the new set. The peer reconciles the whole
 * tree from the import: newly installed paths appear and uninstalled paths
 * are pruned. The read-only compiler-controlled paths cannot be updated by an
 * incremental write/delete notification, so the full-snapshot import is their
 * propagation channel.
 */
export function augmentProjectFileSystem(
  filesystem: ProjectFileSystem,
  compiler: TsWorkspaceCompiler,
  options?: AugmentProjectFileSystemOptions
): ProjectFileSystem {
  const isAugmentedPath = (path: string): boolean => compiler.getCompilerControlledFiles().has(path);
  const filterChange = (change: ProjectFileChange): ProjectFileChange | undefined => {
    switch (change.action) {
      case "write":
      case "delete":
      case "mkdir":
      case "rmdir":
        return isAugmentedPath(change.path) ? undefined : change;
      case "rename":
        return isAugmentedPath(change.oldPath) || isAugmentedPath(change.newPath) ? undefined : change;
      case "import":
        return { action: "import", entries: change.entries.filter(([path]) => !isAugmentedPath(path)) };
    }
  };

  const buildSnapshot = (): ProjectFileSnapshot => {
    const snapshot = filesystem.exportSnapshot();
    const controlledFiles = compiler.getCompilerControlledFiles();
    for (const [path, content] of controlledFiles) {
      ensureSnapshotDirectory(snapshot, parentDirectory(path));
      snapshot.set(path, { kind: "file", content, etag: "compiler-controlled", isReadonly: true });
    }
    return snapshot;
  };

  const localChangeListeners = new Set<(change: ProjectFileChange) => void>();
  let previousControlledFiles = new Map(compiler.getCompilerControlledFiles());
  compiler.onDidCompile(() => {
    const currentControlledFiles = compiler.getCompilerControlledFiles();
    if (!compilerControlledFilesChanged(previousControlledFiles, currentControlledFiles)) {
      return;
    }
    previousControlledFiles = new Map(currentControlledFiles);
    options?.onCompilerControlledFilesChanged?.(currentControlledFiles);
    const change: ProjectFileChange = { action: "import", entries: [...buildSnapshot()] };
    for (const listener of localChangeListeners) {
      listener(change);
    }
  });

  return {
    exportSnapshot(): ProjectFileSnapshot {
      return buildSnapshot();
    },
    applyRemoteChange(change: ProjectFileChange): void {
      const filtered = filterChange(change);
      if (filtered) {
        filesystem.applyRemoteChange(filtered);
      }
    },
    applyLocalChange(change: ProjectFileChange): void {
      const filtered = filterChange(change);
      if (filtered) {
        filesystem.applyLocalChange(filtered);
      }
    },
    onLocalChange(listener: (change: ProjectFileChange) => void): () => void {
      localChangeListeners.add(listener);
      const unsubscribeUnderlying = filesystem.onLocalChange(listener);
      return () => {
        localChangeListeners.delete(listener);
        unsubscribeUnderlying();
      };
    },
    onAnyChange(listener: () => void): () => void {
      return filesystem.onAnyChange(listener);
    },
    flush(): void {
      filesystem.flush();
    },
  };
}

function buildBridge(
  options: {
    bridgeUrl: string;
    filesystem: ProjectFileSystem;
    bindingToken?: string;
    onBindingTokenChange?: (token: string) => void;
  },
  compiler: TsWorkspaceCompiler
): AppBridge {
  return createAppBridge({
    bridgeUrl: options.bridgeUrl,
    filesystem: options.filesystem,
    features: [createCompilationFeature({ compiler: createProjectFileCompilerAdapter(compiler) })],
    bindingToken: options.bindingToken,
    onBindingTokenChange: options.onBindingTokenChange,
  });
}

function createProjectFileCompilerAdapter(compiler: TsWorkspaceCompiler): ProjectFileCompiler {
  return {
    replaceProjectFiles(snapshot: ProjectFileSnapshot): void {
      compiler.replaceWorkspace(snapshot);
    },
    applyProjectFileChange(change: ProjectFileChange): void {
      compiler.applyWorkspaceChange(change);
    },
    compile(): DiagnosticSnapshot {
      return compiler.compile();
    },
    onDidCompile(listener: (snapshot: DiagnosticSnapshot) => void): () => void {
      return compiler.onDidCompile((result) => listener(result));
    },
  };
}
