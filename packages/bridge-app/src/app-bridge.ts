import type { ConnectionStatus, ExportedFileSystem, FileSystemNotification } from "@mindcraft-lang/bridge-client";
import type { CompileDiagnosticEntry } from "@mindcraft-lang/bridge-protocol";

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
