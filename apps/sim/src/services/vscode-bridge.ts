import { AppProject } from "@mindcraft-lang/bridge-app";
import { getAppSettings, onAppSettingsChange } from "./app-settings";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
type StatusListener = (status: ConnectionStatus) => void;

type JoinCodeListener = (joinCode: string | undefined) => void;

let project: AppProject | undefined;
let currentJoinCode: string | undefined;
const unsubs: (() => void)[] = [];
const listeners = new Set<StatusListener>();
const joinCodeListeners = new Set<JoinCodeListener>();

function notifyListeners(status: ConnectionStatus): void {
  for (const fn of listeners) {
    fn(status);
  }
}

function notifyJoinCodeListeners(joinCode: string | undefined): void {
  currentJoinCode = joinCode;
  for (const fn of joinCodeListeners) {
    fn(joinCode);
  }
}

function wireSession(): void {
  for (const unsub of unsubs) unsub();
  unsubs.length = 0;
  if (!project) return;

  unsubs.push(project.session.addEventListener("status", notifyListeners));
  unsubs.push(project.onJoinCodeChange(notifyJoinCodeListeners));
}

function createProject(): AppProject {
  const { vscodeBridgeUrl } = getAppSettings();
  return new AppProject({
    appName: "sim",
    projectId: "sim-default",
    projectName: "Sim",
    bridgeUrl: vscodeBridgeUrl,
    filesystem: new Map(),
  });
}

export function connectBridge(): void {
  if (project) return;
  project = createProject();
  wireSession();
  project.session.start();
}

export function disconnectBridge(): void {
  if (!project) return;
  for (const unsub of unsubs) unsub();
  unsubs.length = 0;
  project.session.stop();
  project = undefined;
  notifyJoinCodeListeners(undefined);
  notifyListeners("disconnected");
}

export function getBridgeStatus(): ConnectionStatus {
  if (!project) return "disconnected";
  return project.session.status;
}

export function getProject(): AppProject | undefined {
  return project;
}

export function onBridgeStatusChange(fn: StatusListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getBridgeJoinCode(): string | undefined {
  return currentJoinCode;
}

export function onBridgeJoinCodeChange(fn: JoinCodeListener): () => void {
  joinCodeListeners.add(fn);
  return () => {
    joinCodeListeners.delete(fn);
  };
}

onAppSettingsChange((settings, prev) => {
  if (settings.vscodeBridgeUrl !== prev.vscodeBridgeUrl && project) {
    disconnectBridge();
    connectBridge();
  }
});
