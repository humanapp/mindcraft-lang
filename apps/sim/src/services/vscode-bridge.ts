import { Project } from "@mindcraft-lang/bridge-client";
import { getAppSettings, onAppSettingsChange } from "./app-settings";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
type StatusListener = (status: ConnectionStatus) => void;

type JoinCodeListener = (joinCode: string | undefined) => void;

let project: Project<"app"> | undefined;
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

  unsubs.push(
    project.session.on("session:welcome", (msg) => {
      notifyJoinCodeListeners(msg.payload.joinCode);
    })
  );

  unsubs.push(
    project.session.on("session:joinCode", (msg) => {
      notifyJoinCodeListeners(msg.payload.joinCode);
    })
  );
}

function createProject(): Project<"app"> {
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

export function getProject(): Project<"app"> | undefined {
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
