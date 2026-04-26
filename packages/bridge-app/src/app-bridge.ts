import type { WorkspaceAdapter, WorkspaceChange, WorkspaceSnapshot } from "@mindcraft-lang/app-host";
import type { ConnectionStatus } from "@mindcraft-lang/bridge-client";
import type { AppClientMessage, CompileDiagnosticEntry } from "@mindcraft-lang/bridge-protocol";
import { BridgeProject } from "./bridge-project.js";

export type { WorkspaceAdapter, WorkspaceChange, WorkspaceSnapshot };
/** Connection status of the underlying bridge session. */
export type AppBridgeState = ConnectionStatus;
/** A single compiler diagnostic entry surfaced through the bridge. */
export type DiagnosticEntry = CompileDiagnosticEntry;

/**
 * App-side handle for a Mindcraft bridge session. Owns the lifecycle of the
 * underlying connection and forwards local workspace edits to and from the
 * remote peer.
 */
export interface AppBridge {
  /** Open the bridge connection. No-op if already started. */
  start(): void;
  /** Close the bridge connection and release resources. */
  stop(): void;
  /** Request a full workspace resync from the peer. */
  requestSync(): Promise<void>;
  /** Read the current connection state. */
  snapshot(): AppBridgeSnapshot;
  /** Subscribe to connection-state changes. Returns an unsubscribe function. */
  onStateChange(listener: (state: AppBridgeState) => void): () => void;
  /** Subscribe to workspace changes pushed by the remote peer. */
  onRemoteChange(listener: (change: WorkspaceChange) => void): () => void;
}

/** Snapshot of the bridge connection state. */
export interface AppBridgeSnapshot {
  status: AppBridgeState;
  /** Code the user pastes into the peer to bind the session, when available. */
  joinCode?: string;
}

/** Options for {@link createAppBridge}. */
export interface AppBridgeOptions {
  bridgeUrl: string;
  workspace: WorkspaceAdapter;
  /** Optional features attached to the bridge for the duration of each session. */
  features?: readonly AppBridgeFeature[];
  /** Persisted token used to rebind to a previously established session. */
  bindingToken?: string;
  /** Callback invoked whenever the server issues an updated binding token. */
  onBindingTokenChange?: (token: string) => void;
}

/**
 * Pluggable extension to {@link AppBridge}. `attach` is invoked when the bridge
 * starts and must return a disposer that cleans up when the bridge stops.
 */
export interface AppBridgeFeature {
  attach(context: AppBridgeFeatureContext): () => void;
}

/** Context passed to an {@link AppBridgeFeature} on attach. */
export interface AppBridgeFeatureContext {
  snapshot(): AppBridgeSnapshot;
  workspaceSnapshot(): WorkspaceSnapshot;
  onStateChange(listener: (state: AppBridgeState) => void): () => void;
  onRemoteChange(listener: (change: WorkspaceChange) => void): () => void;
  /** Subscribe to full-workspace sync completions from the peer. */
  onDidSync(listener: () => void): () => void;
  /** Send the diagnostics for `file` to the peer. */
  publishDiagnostics(file: string, diagnostics: readonly DiagnosticEntry[]): void;
  /** Send a compile pass/fail status update for `file` to the peer. */
  publishStatus(update: AppBridgeFeatureStatus): void;
}

/** Per-file compile status published by features through {@link AppBridgeFeatureContext}. */
export interface AppBridgeFeatureStatus {
  file: string;
  /** `true` when the file compiled with no errors. */
  success: boolean;
  diagnosticCount: {
    error: number;
    warning: number;
  };
}

/** Create an {@link AppBridge}. */
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
  private _project: BridgeProject | undefined;
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

    const project = new BridgeProject({
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

  private requireProject(): BridgeProject {
    if (!this._project) {
      throw new Error("Bridge not started");
    }

    return this._project;
  }
}
