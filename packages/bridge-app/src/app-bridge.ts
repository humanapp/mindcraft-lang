import type { ConnectionStatus, ExportedFileSystem, FileSystemNotification } from "@mindcraft-lang/bridge-client";
import type { AppClientMessage, CompileDiagnosticEntry } from "@mindcraft-lang/bridge-protocol";
import { AppProject } from "./app-project.js";

export type WorkspaceSnapshot = ExportedFileSystem;
export type WorkspaceChange = FileSystemNotification;
export type AppBridgeState = ConnectionStatus;
export type DiagnosticEntry = CompileDiagnosticEntry;

export interface AppBridge {
  start(): void;
  stop(): void;
  requestSync(): Promise<void>;
  snapshot(): AppBridgeSnapshot;
  onStateChange(listener: (state: AppBridgeState) => void): () => void;
  onRemoteChange(listener: (change: WorkspaceChange) => void): () => void;
}

export interface AppBridgeSnapshot {
  status: AppBridgeState;
  joinCode?: string;
}

export interface AppBridgeOptions {
  app: {
    id: string;
    name: string;
    projectId: string;
    projectName: string;
  };
  bridgeUrl: string;
  workspace: WorkspaceAdapter;
  features?: readonly AppBridgeFeature[];
  bindingToken?: string;
  onBindingTokenChange?: (token: string) => void;
}

export interface WorkspaceAdapter {
  exportSnapshot(): WorkspaceSnapshot;
  applyRemoteChange(change: WorkspaceChange): void;
  onLocalChange(listener: (change: WorkspaceChange) => void): () => void;
}

export interface AppBridgeFeature {
  attach(context: AppBridgeFeatureContext): () => void;
}

export interface AppBridgeFeatureContext {
  snapshot(): AppBridgeSnapshot;
  workspaceSnapshot(): WorkspaceSnapshot;
  onStateChange(listener: (state: AppBridgeState) => void): () => void;
  onRemoteChange(listener: (change: WorkspaceChange) => void): () => void;
  onDidSync(listener: () => void): () => void;
  publishDiagnostics(file: string, diagnostics: readonly DiagnosticEntry[]): void;
  publishStatus(update: AppBridgeFeatureStatus): void;
}

export interface AppBridgeFeatureStatus {
  file: string;
  success: boolean;
  diagnosticCount: {
    error: number;
    warning: number;
  };
}

export function createAppBridge(options: AppBridgeOptions): AppBridge {
  return new AppBridgeController(options);
}

class AppBridgeController implements AppBridge {
  private readonly _options: AppBridgeOptions;
  private readonly _stateListeners = new Set<(state: AppBridgeState) => void>();
  private readonly _remoteChangeListeners = new Set<(change: WorkspaceChange) => void>();
  private readonly _syncListeners = new Set<() => void>();
  private readonly _diagnosticVersions = new Map<string, number>();
  private readonly _featureDisposers: (() => void)[] = [];
  private _project: AppProject | undefined;
  private _workspaceUnsub: (() => void) | undefined;
  private _projectUnsubs: (() => void)[] = [];
  private _status: AppBridgeState = "disconnected";
  private _joinCode: string | undefined;

  constructor(options: AppBridgeOptions) {
    this._options = options;
  }

  start(): void {
    if (this._project) {
      return;
    }

    this.attachFeatures();

    const project = new AppProject({
      appName: this._options.app.name,
      projectId: this._options.app.projectId,
      projectName: this._options.app.projectName,
      bridgeUrl: this._options.bridgeUrl,
      filesystem: this._options.workspace.exportSnapshot(),
      bindingToken: this._options.bindingToken,
    });

    this._project = project;
    this._workspaceUnsub = this._options.workspace.onLocalChange((change) => {
      project.files.toRemote.applyNotification(change);
    });
    this._projectUnsubs = [
      project.session.addEventListener("status", (status) => {
        this.setStatus(status);
      }),
      project.session.on("session:welcome", (msg) => {
        const token = (msg.payload as { bindingToken?: string } | undefined)?.bindingToken;
        if (token) {
          this._options.bindingToken = token;
          this._options.onBindingTokenChange?.(token);
        }
      }),
      project.onJoinCodeChange((joinCode) => {
        this.setJoinCode(joinCode);
      }),
      project.onRemoteFileChange((change) => {
        this._options.workspace.applyRemoteChange(change);
        this.emitRemoteChange(change);
      }),
      project.onDidSync(() => {
        this.emitDidSync();
      }),
    ];

    project.session.start();
  }

  stop(): void {
    const project = this._project;
    if (!project) {
      this.setJoinCode(undefined);
      this.setStatus("disconnected");
      return;
    }

    project.session.stop();
    this.disposeProjectBindings();
    this._project = undefined;
    this.setJoinCode(undefined);
    this.disposeFeatures();
  }

  async requestSync(): Promise<void> {
    const project = this.requireProject();
    await project.requestSync();
  }

  snapshot(): AppBridgeSnapshot {
    return {
      status: this._status,
      joinCode: this._joinCode,
    };
  }

  onStateChange(listener: (state: AppBridgeState) => void): () => void {
    this._stateListeners.add(listener);
    return () => {
      this._stateListeners.delete(listener);
    };
  }

  onRemoteChange(listener: (change: WorkspaceChange) => void): () => void {
    this._remoteChangeListeners.add(listener);
    return () => {
      this._remoteChangeListeners.delete(listener);
    };
  }

  private attachFeatures(): void {
    if (this._featureDisposers.length > 0) {
      return;
    }

    const features = this._options.features ?? [];
    const context: AppBridgeFeatureContext = {
      snapshot: () => this.snapshot(),
      workspaceSnapshot: () => this._options.workspace.exportSnapshot(),
      onStateChange: (listener) => this.onStateChange(listener),
      onRemoteChange: (listener) => this.onRemoteChange(listener),
      onDidSync: (listener) => this.onDidSync(listener),
      publishDiagnostics: (file, diagnostics) => {
        this.publishDiagnostics(file, diagnostics);
      },
      publishStatus: (update) => {
        this.publishStatus(update);
      },
    };

    for (const feature of features) {
      this._featureDisposers.push(feature.attach(context));
    }
  }

  private disposeFeatures(): void {
    for (const dispose of this._featureDisposers.splice(0)) {
      dispose();
    }
  }

  private onDidSync(listener: () => void): () => void {
    this._syncListeners.add(listener);
    return () => {
      this._syncListeners.delete(listener);
    };
  }

  private emitDidSync(): void {
    for (const listener of this._syncListeners) {
      listener();
    }
  }

  private emitRemoteChange(change: WorkspaceChange): void {
    for (const listener of this._remoteChangeListeners) {
      listener(change);
    }
  }

  private publishDiagnostics(file: string, diagnostics: readonly DiagnosticEntry[]): void {
    const project = this._project;
    if (!project || this._status !== "connected") {
      return;
    }

    const version = (this._diagnosticVersions.get(file) ?? 0) + 1;
    this._diagnosticVersions.set(file, version);

    const message: AppClientMessage = {
      type: "compile:diagnostics",
      payload: {
        file,
        version,
        diagnostics: [...diagnostics],
      },
    };

    project.session.send(message);
  }

  private publishStatus(update: AppBridgeFeatureStatus): void {
    const project = this._project;
    if (!project || this._status !== "connected") {
      return;
    }

    const message: AppClientMessage = {
      type: "compile:status",
      payload: {
        file: update.file,
        success: update.success,
        diagnosticCount: {
          error: update.diagnosticCount.error,
          warning: update.diagnosticCount.warning,
        },
      },
    };

    project.session.send(message);
  }

  private setStatus(status: AppBridgeState): void {
    if (this._status === status) {
      return;
    }

    this._status = status;
    for (const listener of this._stateListeners) {
      listener(status);
    }
  }

  private setJoinCode(joinCode: string | undefined): void {
    if (this._joinCode === joinCode) {
      return;
    }

    this._joinCode = joinCode;
    for (const listener of this._stateListeners) {
      listener(this._status);
    }
  }

  private disposeProjectBindings(): void {
    this._workspaceUnsub?.();
    this._workspaceUnsub = undefined;

    for (const unsub of this._projectUnsubs.splice(0)) {
      unsub();
    }
  }

  private requireProject(): AppProject {
    if (!this._project) {
      throw new Error("Bridge not started");
    }

    return this._project;
  }
}
