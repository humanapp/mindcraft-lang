import type { AppBridge, AppBridgeState } from "@mindcraft-lang/bridge-app";
import { invalidateVfsCache } from "@mindcraft-lang/bridge-app";
import { type AppProjectHandle, createAppProject } from "@mindcraft-lang/bridge-app/compilation";
import { logger } from "@mindcraft-lang/core/app";
import type { WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import { getAppSettings, onAppSettingsChange } from "./app-settings";
import { getMindcraftEnvironment } from "./mindcraft-environment";
import { getUiPreferences } from "./ui-preferences";
import { applyCompiledUserTiles } from "./user-tile-registration";
import { initWorkspaceStore } from "./workspace-store";

type ConnectionStatus = AppBridgeState;
type StatusListener = (status: ConnectionStatus) => void;
type JoinCodeListener = (joinCode: string | undefined) => void;

let project: AppProjectHandle | undefined;
let currentStatus: ConnectionStatus = "disconnected";
let currentJoinCode: string | undefined;

const listeners = new Set<StatusListener>();
const joinCodeListeners = new Set<JoinCodeListener>();

let bridgeStateUnsub: (() => void) | undefined;
let remoteChangeUnsub: (() => void) | undefined;

function notifyStatusListeners(status: ConnectionStatus): void {
  for (const listener of listeners) {
    listener(status);
  }
}

function notifyJoinCodeListeners(joinCode: string | undefined): void {
  for (const listener of joinCodeListeners) {
    listener(joinCode);
  }
}

function applyBridgeSnapshot(activeBridge: AppBridge): void {
  const snapshot = activeBridge.snapshot();

  if (snapshot.status !== currentStatus) {
    currentStatus = snapshot.status;
    notifyStatusListeners(currentStatus);
  }

  if (snapshot.joinCode !== currentJoinCode) {
    currentJoinCode = snapshot.joinCode;
    notifyJoinCodeListeners(currentJoinCode);
  }
}

function wireBridgeState(activeBridge: AppBridge): void {
  bridgeStateUnsub?.();
  remoteChangeUnsub?.();
  bridgeStateUnsub = activeBridge.onStateChange(() => {
    applyBridgeSnapshot(activeBridge);
  });
  remoteChangeUnsub = activeBridge.onRemoteChange(invalidateVfsCache);
  applyBridgeSnapshot(activeBridge);
}

function logWorkspaceCompile(result: WorkspaceCompileResult): void {
  const resultsByPath = result.projectResult.results;

  for (const [path, diagnostics] of result.files) {
    if (diagnostics.length > 0) {
      logger.warn(`[user-tile-compiler] ${path}: ${diagnostics.length} diagnostic(s)`);
      for (const diagnostic of diagnostics) {
        const range = diagnostic.range;
        logger.warn(`  ${path}:${range.startLine}:${range.startColumn} - ${diagnostic.message}`);
      }
      continue;
    }

    const program = resultsByPath.get(path)?.program;
    if (program) {
      logger.info(`[user-tile-compiler] ${path}: compiled ${program.kind} "${program.name}"`);
    }
  }
}

function recreateBridge(shouldStart: boolean): void {
  if (!project) {
    return;
  }

  bridgeStateUnsub?.();
  bridgeStateUnsub = undefined;

  project.recreateBridge(getAppSettings().vscodeBridgeUrl);
  wireBridgeState(project.bridge);

  if (shouldStart) {
    project.bridge.start();
  }
}

export function initProject(): void {
  const workspace = initWorkspaceStore();

  project = createAppProject({
    environment: getMindcraftEnvironment(),
    app: {
      id: "sim",
      name: "Sim",
      projectId: "sim-default",
      projectName: "Sim",
    },
    bridgeUrl: getAppSettings().vscodeBridgeUrl,
    workspace,
    onDidCompile(result) {
      logWorkspaceCompile(result);
      applyCompiledUserTiles(result);
    },
  });

  project.initialize();
  wireBridgeState(project.bridge);
}

export function connectBridge(): void {
  if (!project) {
    initProject();
  }

  if (!project || project.bridge.snapshot().status !== "disconnected") {
    return;
  }

  project.bridge.start();
}

export function disconnectBridge(): void {
  project?.bridge.stop();
}

export function getBridgeStatus(): ConnectionStatus {
  return currentStatus;
}

export function onBridgeStatusChange(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBridgeJoinCode(): string | undefined {
  return currentJoinCode;
}

export function onBridgeJoinCodeChange(listener: JoinCodeListener): () => void {
  joinCodeListeners.add(listener);
  return () => {
    joinCodeListeners.delete(listener);
  };
}

onAppSettingsChange((settings, prev) => {
  if (settings.vscodeBridgeUrl !== prev.vscodeBridgeUrl) {
    const shouldStart = getUiPreferences().bridgeEnabled || currentStatus !== "disconnected";
    recreateBridge(shouldStart);
  }
});
