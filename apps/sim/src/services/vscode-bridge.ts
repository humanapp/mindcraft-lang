import { Project } from "@mindcraft-lang/ts-authoring";
import { getAppSettings, onAppSettingsChange } from "./app-settings";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
type StatusListener = (status: ConnectionStatus) => void;

let project: Project | undefined;
let sessionUnsub: (() => void) | undefined;
const listeners = new Set<StatusListener>();

function notifyListeners(status: ConnectionStatus): void {
  for (const fn of listeners) {
    fn(status);
  }
}

function wireSession(): void {
  sessionUnsub?.();
  if (project) {
    sessionUnsub = project.session.addEventListener("status", notifyListeners);
  }
}

function createProject(): Project {
  const { vscodeBridgeUrl } = getAppSettings();
  return new Project({
    appName: "sim",
    projectId: "sim-default",
    projectName: "Sim",
    bridgeUrl: vscodeBridgeUrl,
    clientRole: "app",
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
  sessionUnsub?.();
  sessionUnsub = undefined;
  project.session.stop();
  project = undefined;
  notifyListeners("disconnected");
}

export function getBridgeStatus(): ConnectionStatus {
  if (!project) return "disconnected";
  return project.session.status;
}

export function getProject(): Project | undefined {
  return project;
}

export function onBridgeStatusChange(fn: StatusListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

onAppSettingsChange((settings, prev) => {
  if (settings.vscodeBridgeUrl !== prev.vscodeBridgeUrl && project) {
    disconnectBridge();
    connectBridge();
  }
});
