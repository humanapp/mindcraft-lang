import { AppProject, type AppProjectOptions } from "@mindcraft-lang/bridge-app";
import { buildAmbientDeclarations } from "@mindcraft-lang/typescript";
import { getAppSettings, onAppSettingsChange } from "./app-settings";
import {
  createCompilationProvider,
  getAllCompileResults,
  handleCompilationResult,
  lastCompilationHadTsErrors,
} from "./user-tile-compiler";
import { handleRecompilation } from "./user-tile-registration";

const LS_FS_KEY = "sim:vscode-bridge:filesystem";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
type StatusListener = (status: ConnectionStatus) => void;

type JoinCodeListener = (joinCode: string | undefined) => void;

let project: AppProject;
let currentJoinCode: string | undefined;
const unsubs: (() => void)[] = [];
const listeners = new Set<StatusListener>();
const joinCodeListeners = new Set<JoinCodeListener>();

let saveTimer: ReturnType<typeof setTimeout> | undefined;

const TS_CONFIG = `{
  "compilerOptions": {
    "target": "ES2016",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "strict": true,
    "noLib": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts", "**/*.d.ts"]
}`;

function saveFilesystem(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const exported = project.files.raw.export();
    localStorage.setItem(LS_FS_KEY, JSON.stringify([...exported]));
  }, 500);
}

function loadFilesystem(): AppProjectOptions["filesystem"] {
  const json = localStorage.getItem(LS_FS_KEY);
  if (!json) return new Map();
  try {
    return new Map(JSON.parse(json));
  } catch {
    return new Map();
  }
}

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

  unsubs.push(project.session.addEventListener("status", notifyListeners));
  unsubs.push(project.onJoinCodeChange(notifyJoinCodeListeners));
}

const AMBIENT_PATH = "mindcraft.d.ts";

function createProject(): AppProject {
  const { vscodeBridgeUrl } = getAppSettings();
  const filesystem = loadFilesystem();
  filesystem.set(AMBIENT_PATH, {
    kind: "file",
    content: buildAmbientDeclarations(),
    etag: `ambient-${Date.now()}`,
    isReadonly: true,
  });
  filesystem.set("tsconfig.json", {
    kind: "file",
    content: TS_CONFIG,
    etag: `tsconfig-${Date.now()}`,
    isReadonly: true,
  });
  return new AppProject({
    appName: "sim",
    projectId: "sim-default",
    projectName: "Sim",
    bridgeUrl: vscodeBridgeUrl,
    filesystem,
    compilationProvider: createCompilationProvider(),
  });
}

export function initProject(): void {
  project = createProject();
  project.onRemoteFileChange(() => {
    saveFilesystem();
  });
  project.compilation?.onCompilation(handleCompilationResult);
  project.compilation?.handleFileChange({
    action: "import",
    entries: [...project.files.raw.export()],
  });
  project.compilation?.onCompilation((result) => {
    const compileResults = getAllCompileResults();
    handleRecompilation(compileResults, lastCompilationHadTsErrors());
  });
}

export function connectBridge(): void {
  if (project.session.status !== "disconnected") return;
  wireSession();
  project.session.start();
}

export function disconnectBridge(): void {
  for (const unsub of unsubs) unsub();
  unsubs.length = 0;
  project.session.stop();
  notifyJoinCodeListeners(undefined);
  notifyListeners("disconnected");
}

export function getBridgeStatus(): ConnectionStatus {
  return project.session.status;
}

export function getProject(): AppProject {
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
  if (settings.vscodeBridgeUrl !== prev.vscodeBridgeUrl) {
    disconnectBridge();
    connectBridge();
  }
});
