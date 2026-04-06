import { type AppBridge, type AppBridgeState, createAppBridge } from "@mindcraft-lang/bridge-app";
import { createCompilationFeature } from "@mindcraft-lang/bridge-app/compilation";
import { getAppSettings, onAppSettingsChange } from "./app-settings";
import { getUiPreferences } from "./ui-preferences";
import { getWorkspaceCompiler, initUserTileCompiler } from "./user-tile-compiler";
import { getWorkspaceStore, initWorkspaceStore } from "./workspace-store";

type ConnectionStatus = AppBridgeState;
type StatusListener = (status: ConnectionStatus) => void;
type JoinCodeListener = (joinCode: string | undefined) => void;

let bridge: AppBridge | undefined;
let currentStatus: ConnectionStatus = "disconnected";
let currentJoinCode: string | undefined;

const listeners = new Set<StatusListener>();
const joinCodeListeners = new Set<JoinCodeListener>();

let bridgeStateUnsub: (() => void) | undefined;

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
  bridgeStateUnsub = activeBridge.onStateChange(() => {
    applyBridgeSnapshot(activeBridge);
  });
  applyBridgeSnapshot(activeBridge);
}

function createBridge(): AppBridge {
  return createAppBridge({
    app: {
      id: "sim",
      name: "Sim",
      projectId: "sim-default",
      projectName: "Sim",
    },
    bridgeUrl: getAppSettings().vscodeBridgeUrl,
    workspace: getWorkspaceStore(),
    features: [
      createCompilationFeature({
        compiler: getWorkspaceCompiler(),
      }),
    ],
  });
}

function recreateBridge(shouldStart: boolean): void {
  bridgeStateUnsub?.();
  bridgeStateUnsub = undefined;

  bridge?.stop();

  bridge = createBridge();
  wireBridgeState(bridge);

  if (shouldStart) {
    bridge.start();
  }
}

export function initProject(): void {
  const workspace = initWorkspaceStore();
  initUserTileCompiler(workspace.exportSnapshot());
  recreateBridge(false);
}

export function connectBridge(): void {
  if (!bridge) {
    initProject();
  }

  if (!bridge || bridge.snapshot().status !== "disconnected") {
    return;
  }

  bridge.start();
}

export function disconnectBridge(): void {
  bridge?.stop();
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
