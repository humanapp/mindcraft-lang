import type { AppBridge, AppBridgeState } from "@mindcraft-lang/bridge-app";
import { type AppProjectHandle, createAppProject } from "@mindcraft-lang/bridge-app/compilation";
import { logger } from "@mindcraft-lang/core/app";
import type { WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import { getAppSettings, onAppSettingsChange } from "./app-settings";
import type { SimEnvironmentStore } from "./sim-environment-store";
import { getUiPreferences } from "./ui-preferences";
import { applyCompiledUserTiles } from "./user-tile-registration";

const BINDING_TOKEN_KEY = "bridge-binding-token";

type ConnectionStatus = AppBridgeState;
type StatusListener = (status: ConnectionStatus) => void;
type JoinCodeListener = (joinCode: string | undefined) => void;

let project: AppProjectHandle | undefined;
let projectStore: SimEnvironmentStore | undefined;
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

function wireBridgeState(activeBridge: AppBridge, store: SimEnvironmentStore): void {
  bridgeStateUnsub?.();
  remoteChangeUnsub?.();
  bridgeStateUnsub = activeBridge.onStateChange(() => {
    applyBridgeSnapshot(activeBridge);
  });
  remoteChangeUnsub = activeBridge.onRemoteChange(() => {
    store.bumpVfsRevision();
  });
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
  if (!project || !projectStore) {
    return;
  }

  bridgeStateUnsub?.();
  bridgeStateUnsub = undefined;

  project.recreateBridge(getAppSettings().vscodeBridgeUrl);
  wireBridgeState(project.bridge, projectStore);

  if (shouldStart) {
    project.bridge.start();
  }
}

export function initProject(store: SimEnvironmentStore): void {
  projectStore = store;
  project = createAppProject({
    environment: store.env,
    app: {
      id: "sim",
      name: "Sim",
      projectId: "sim-default",
      projectName: "Sim",
    },
    bridgeUrl: getAppSettings().vscodeBridgeUrl,
    workspace: store.workspace,
    bindingToken: loadBindingToken(),
    onBindingTokenChange(token) {
      saveBindingToken(token);
    },
    onDidCompile(result) {
      logWorkspaceCompile(result);
      applyCompiledUserTiles(store, result);
    },
  });

  project.initialize();
  wireBridgeState(project.bridge, store);
}

export function connectBridge(): void {
  if (!project) {
    if (!projectStore) {
      throw new Error("initProject() must be called before connectBridge()");
    }
    initProject(projectStore);
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

function loadBindingToken(): string | undefined {
  try {
    return localStorage.getItem(BINDING_TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveBindingToken(token: string): void {
  try {
    localStorage.setItem(BINDING_TOKEN_KEY, token);
  } catch {
    // storage full or unavailable
  }
}

export function clearBindingToken(): void {
  try {
    localStorage.removeItem(BINDING_TOKEN_KEY);
  } catch {
    // storage unavailable
  }
}

export function hasBindingToken(): boolean {
  try {
    return localStorage.getItem(BINDING_TOKEN_KEY) !== null;
  } catch {
    return false;
  }
}
