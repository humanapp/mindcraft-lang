import type { ExampleDefinition } from "@mindcraft-lang/app-host";
import { EXAMPLES_FOLDER } from "@mindcraft-lang/app-host";
import type { AppClientMessage, CompileDiagnosticEntry, FileSystemNotification } from "@mindcraft-lang/bridge-protocol";
import type { MindcraftEnvironment } from "@mindcraft-lang/core";
import {
  createWorkspaceCompiler,
  type DependencyMount,
  type Mount,
  type ProjectDependency,
  type WorkspaceCompiler as TsWorkspaceCompiler,
  type WorkspaceCompileResult,
} from "@mindcraft-lang/ts-compiler";
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

export type { WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";

/** Options for {@link createProjectCompiler}. */
export interface CreateProjectCompilerOptions {
  environment: MindcraftEnvironment;
  filesystem: ProjectFileSystem;
  /** Namespace of the project being compiled (its store id); prefixes every symbol key minted from the project's content. */
  projectNamespace: string;
  /** Read-only content mounts exposed to the compiler and remote VFS peers. */
  mounts: readonly Mount[];
  /** Extension dependencies of the project, each a `<owner>/<repo>` coordinate resolving its `@ext/<owner>/<repo>` imports. */
  dependencies?: readonly ProjectDependency[];
  /** Read-only content of each dependency, mounted for `@ext/<owner>/<repo>` resolution. */
  dependencyMounts?: readonly DependencyMount[];
  /** Read-only example projects materialized under the examples folder. */
  examples?: readonly ExampleDefinition[];
  onDidCompile?: (result: WorkspaceCompileResult) => void;
}

/** Handle returned by {@link createProjectCompiler}. */
export interface ProjectCompilerHandle {
  readonly compiler: TsWorkspaceCompiler;
  /** Seed the compiler from the current project file snapshot and run an initial compile. */
  initialize(): void;
  /** Re-seed the compiler with the latest project file snapshot and recompile. */
  replaceProjectFiles(): void;
  /** Replace the set of injected example projects. */
  injectExamples(examples: ExampleDefinition[]): void;
  /** Read the currently injected example projects. */
  getExamples(): ExampleDefinition[];
}

/**
 * Wrap a {@link ProjectFileSystem} as a TS workspace compiler. The compiler's
 * input includes the live project files plus any injected examples.
 */
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

  let injectedExamples: ExampleDefinition[] = options.examples ? [...options.examples] : [];

  function buildSnapshot(): ProjectFileSnapshot {
    const snapshot = new Map(filesystem.exportSnapshot());
    for (const example of injectedExamples) {
      snapshot.set(`${EXAMPLES_FOLDER}/${example.folder}`, { kind: "directory" });
      for (const file of example.files) {
        snapshot.set(`${EXAMPLES_FOLDER}/${example.folder}/${file.path}`, {
          kind: "file",
          content: file.content,
          etag: "example",
          isReadonly: true,
        });
      }
    }
    return snapshot;
  }

  return {
    compiler,
    initialize() {
      compiler.replaceWorkspace(buildSnapshot());
      compiler.compile();
    },
    replaceProjectFiles() {
      compiler.replaceWorkspace(buildSnapshot());
      compiler.compile();
    },
    injectExamples(examples: ExampleDefinition[]) {
      injectedExamples = examples;
    },
    getExamples() {
      return injectedExamples;
    },
  };
}

// ---------------------------------------------------------------------------
// BridgeProjectHandle -- bridge connection that uses a ProjectCompilerHandle
// ---------------------------------------------------------------------------

/** Options for {@link createBridgeProject}. */
export interface CreateBridgeProjectOptions {
  projectCompiler: ProjectCompilerHandle;
  filesystem: ProjectFileSystem;
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
 * surfaces compiler-controlled and example files to the remote peer.
 */
export function createBridgeProject(options: CreateBridgeProjectOptions): BridgeProjectHandle {
  const { projectCompiler, filesystem } = options;
  const compiler = projectCompiler.compiler;

  let latestBindingToken = options.bindingToken;
  const onBindingTokenChange = (token: string): void => {
    latestBindingToken = token;
    options.onBindingTokenChange?.(token);
  };

  const augmented = augmentProjectFileSystem(filesystem, compiler, () => projectCompiler.getExamples());
  let currentBridge = buildBridge(
    { ...options, filesystem: augmented, bindingToken: latestBindingToken, onBindingTokenChange },
    compiler
  );

  return {
    get bridge() {
      return currentBridge;
    },
    recreateBridge(bridgeUrl: string) {
      currentBridge.stop();
      currentBridge = buildBridge(
        { ...options, bridgeUrl, filesystem: augmented, bindingToken: latestBindingToken, onBindingTokenChange },
        compiler
      );
    },
  };
}

function augmentProjectFileSystem(
  filesystem: ProjectFileSystem,
  compiler: TsWorkspaceCompiler,
  getExamples: () => ExampleDefinition[]
): ProjectFileSystem {
  const isAugmentedPath = (path: string): boolean => {
    if (compiler.getCompilerControlledFiles().has(path)) {
      return true;
    }
    for (const example of getExamples()) {
      const root = `${EXAMPLES_FOLDER}/${example.folder}`;
      if (path === root || path.startsWith(`${root}/`)) {
        return true;
      }
    }
    return false;
  };
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

  return {
    exportSnapshot(): ProjectFileSnapshot {
      const snapshot = filesystem.exportSnapshot();
      const controlledFiles = compiler.getCompilerControlledFiles();
      for (const [path, content] of controlledFiles) {
        snapshot.set(path, { kind: "file", content, etag: "compiler-controlled", isReadonly: true });
      }
      for (const example of getExamples()) {
        snapshot.set(`${EXAMPLES_FOLDER}/${example.folder}`, { kind: "directory" });
        for (const file of example.files) {
          snapshot.set(`${EXAMPLES_FOLDER}/${example.folder}/${file.path}`, {
            kind: "file",
            content: file.content,
            etag: "example",
            isReadonly: true,
          });
        }
      }
      return snapshot;
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
      return filesystem.onLocalChange(listener);
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
  options: Pick<CreateBridgeProjectOptions, "bridgeUrl" | "filesystem" | "bindingToken" | "onBindingTokenChange">,
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
