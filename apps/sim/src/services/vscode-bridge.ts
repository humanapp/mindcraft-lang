import { Project } from "@mindcraft-lang/ts-authoring";
import { getAppSettings, onAppSettingsChange } from "./app-settings";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
type StatusListener = (status: ConnectionStatus) => void;

type JoinCodeListener = (joinCode: string | undefined) => void;

let project: Project | undefined;
let sessionUnsub: (() => void) | undefined;
let joinCodeUnsub: (() => void) | undefined;
let currentJoinCode: string | undefined;
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
  sessionUnsub?.();
  joinCodeUnsub?.();
  if (project) {
    sessionUnsub = project.session.addEventListener("status", notifyListeners);
    joinCodeUnsub = project.session.addEventListener("joinCode", notifyJoinCodeListeners);
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
  joinCodeUnsub?.();
  joinCodeUnsub = undefined;
  project.session.stop();
  project = undefined;
  notifyJoinCodeListeners(undefined);
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
