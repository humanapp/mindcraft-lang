import type { ExampleDefinition } from "@mindcraft-lang/app-host";
import { EXAMPLES_FOLDER } from "@mindcraft-lang/app-host";
import type { AppClientMessage, CompileDiagnosticEntry, FileSystemNotification } from "@mindcraft-lang/bridge-protocol";
import type { MindcraftEnvironment } from "@mindcraft-lang/core";
import {
  createWorkspaceCompiler,
  type WorkspaceCompiler as TsWorkspaceCompiler,
  type WorkspaceCompileResult,
} from "@mindcraft-lang/ts-compiler";
import type {
  AppBridge,
  AppBridgeFeature,
  AppBridgeFeatureContext,
  AppBridgeFeatureStatus,
  DiagnosticEntry,
  WorkspaceAdapter,
  WorkspaceChange,
  WorkspaceSnapshot,
} from "./app-bridge.js";
import { createAppBridge } from "./app-bridge.js";

export interface DiagnosticSnapshot {
  files: ReadonlyMap<string, readonly DiagnosticEntry[]>;
}

export interface WorkspaceCompiler {
  replaceWorkspace(snapshot: WorkspaceSnapshot): void;
  applyWorkspaceChange(change: WorkspaceChange): void;
  compile(): DiagnosticSnapshot;
  onDidCompile(listener: (snapshot: DiagnosticSnapshot) => void): () => void;
}

export interface CompilationFeatureOptions {
  compiler: WorkspaceCompiler;
  publishStatus?: boolean;
}

export interface CompilationResult {
  files: Map<string, CompileDiagnosticEntry[]>;
}

export interface CompilationProvider {
  fileWritten(path: string, content: string): void;
  fileDeleted(path: string): void;
  fileRenamed(oldPath: string, newPath: string): void;
  fullSync(files: Iterable<[string, { kind: string; content?: string }]>): void;
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

      options.compiler.replaceWorkspace(context.workspaceSnapshot());
      compileAndPublish();

      const remoteChangeUnsub = context.onRemoteChange((change) => {
        options.compiler.applyWorkspaceChange(change);
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

export interface CreateProjectCompilerOptions {
  environment: MindcraftEnvironment;
  workspace: WorkspaceAdapter;
  examples?: readonly ExampleDefinition[];
  onDidCompile?: (result: WorkspaceCompileResult) => void;
}

export interface ProjectCompilerHandle {
  readonly compiler: TsWorkspaceCompiler;
  initialize(): void;
  replaceWorkspace(): void;
  injectExamples(examples: ExampleDefinition[]): void;
  getExamples(): ExampleDefinition[];
}

export function createProjectCompiler(options: CreateProjectCompilerOptions): ProjectCompilerHandle {
  const { environment, workspace } = options;

  const compiler = createWorkspaceCompiler({ environment });

  if (options.onDidCompile) {
    compiler.onDidCompile(options.onDidCompile);
  }

  let injectedExamples: ExampleDefinition[] = options.examples ? [...options.examples] : [];

  function buildSnapshot(): WorkspaceSnapshot {
    const snapshot = new Map(workspace.exportSnapshot());
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
    replaceWorkspace() {
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

export interface CreateBridgeProjectOptions {
  projectCompiler: ProjectCompilerHandle;
  workspace: WorkspaceAdapter;
  bridgeUrl: string;
  bindingToken?: string;
  onBindingTokenChange?: (token: string) => void;
}

export interface BridgeProjectHandle {
  readonly bridge: AppBridge;
  recreateBridge(bridgeUrl: string): void;
}

export function createBridgeProject(options: CreateBridgeProjectOptions): BridgeProjectHandle {
  const { projectCompiler, workspace } = options;
  const compiler = projectCompiler.compiler;

  let latestBindingToken = options.bindingToken;
  const onBindingTokenChange = (token: string): void => {
    latestBindingToken = token;
    options.onBindingTokenChange?.(token);
  };

  const augmented = augmentWorkspace(workspace, compiler, () => projectCompiler.getExamples());
  let currentBridge = buildBridge(
    { ...options, workspace: augmented, bindingToken: latestBindingToken, onBindingTokenChange },
    compiler
  );

  return {
    get bridge() {
      return currentBridge;
    },
    recreateBridge(bridgeUrl: string) {
      currentBridge.stop();
      currentBridge = buildBridge(
        { ...options, bridgeUrl, workspace: augmented, bindingToken: latestBindingToken, onBindingTokenChange },
        compiler
      );
    },
  };
}

function augmentWorkspace(
  workspace: WorkspaceAdapter,
  compiler: TsWorkspaceCompiler,
  getExamples: () => ExampleDefinition[]
): WorkspaceAdapter {
  return {
    exportSnapshot(): WorkspaceSnapshot {
      const snapshot = workspace.exportSnapshot();
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
    applyRemoteChange(change: WorkspaceChange): void {
      workspace.applyRemoteChange(change);
    },
    applyLocalChange(change: WorkspaceChange): void {
      workspace.applyLocalChange(change);
    },
    onLocalChange(listener: (change: WorkspaceChange) => void): () => void {
      return workspace.onLocalChange(listener);
    },
    onAnyChange(listener: () => void): () => void {
      return workspace.onAnyChange(listener);
    },
    flush(): void {
      workspace.flush();
    },
  };
}

function buildBridge(
  options: Pick<CreateBridgeProjectOptions, "bridgeUrl" | "workspace" | "bindingToken" | "onBindingTokenChange">,
  compiler: TsWorkspaceCompiler
): AppBridge {
  return createAppBridge({
    bridgeUrl: options.bridgeUrl,
    workspace: options.workspace,
    features: [createCompilationFeature({ compiler })],
    bindingToken: options.bindingToken,
    onBindingTokenChange: options.onBindingTokenChange,
  });
}
