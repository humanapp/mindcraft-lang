import {
  createLocalStorageProjectStore,
  createWebLocksProjectLock,
  ProjectManager,
  type ProjectManifest,
  type WorkspaceAdapter,
} from "@mindcraft-lang/app-host";
import { type AppBridgeState, AppEnvironmentHost, type UserTileMetadata } from "@mindcraft-lang/bridge-app";
import {
  type BrainDef,
  coreModule,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import type { DocsTileEntry } from "@mindcraft-lang/docs";
import { isCompilerControlledPath } from "@mindcraft-lang/ts-compiler";
import { createSimModule } from "@/brain";
import type { Archetype } from "@/brain/actor";
import { loadExamples } from "@/examples";
import { name as simName, version as simVersion } from "../../package.json";
import { loadBindingToken, saveBindingToken } from "./binding-token-persistence";
import { initVfsServiceWorker } from "./vfs-service-worker";

// -- AppSettings --

const APP_SETTINGS_STORAGE_KEY = "app-settings";

export interface AppSettings {
  vscodeBridgeUrl: string;
  showBridgePanel: boolean;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  vscodeBridgeUrl: "vscode-bridge.mindcraft-lang.org",
  showBridgePanel: true,
};

type AppSettingsListener = (settings: AppSettings, prev: AppSettings) => void;

function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return { ...DEFAULT_APP_SETTINGS, ...parsed };
    }
  } catch {
    // corrupted data -- fall through to defaults
  }
  return { ...DEFAULT_APP_SETTINGS };
}

function persistAppSettings(settings: AppSettings): void {
  localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

// -- UiPreferences (per-project, non-portable) --

const UI_PREFS_KEY_PREFIX = `${simName}:project-ui:`;

export interface UiPreferences {
  timeScale: number;
  bridgeEnabled: boolean;
  debugEnabled: boolean;
}

const DEFAULT_UI_PREFS: UiPreferences = {
  timeScale: 1,
  bridgeEnabled: false,
  debugEnabled: false,
};

// -- Collapsed archetypes (global, not per-project) --

const COLLAPSED_ARCHETYPES_KEY = `${simName}:collapsed-archetypes`;

function loadCollapsedArchetypes(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_ARCHETYPES_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    // corrupted data
  }
  return {};
}

function persistCollapsedArchetypes(value: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLLAPSED_ARCHETYPES_KEY, JSON.stringify(value));
  } catch {
    // storage full or unavailable
  }
}

function loadUiPreferences(projectId: string): UiPreferences {
  try {
    const raw = localStorage.getItem(`${UI_PREFS_KEY_PREFIX}${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UiPreferences>;
      return {
        timeScale: typeof parsed.timeScale === "number" ? parsed.timeScale : DEFAULT_UI_PREFS.timeScale,
        bridgeEnabled: parsed.bridgeEnabled === true,
        debugEnabled: parsed.debugEnabled === true,
      };
    }
  } catch {
    // corrupted data -- fall through to defaults
  }
  return { ...DEFAULT_UI_PREFS };
}

function persistUiPreferences(projectId: string, prefs: UiPreferences): void {
  try {
    localStorage.setItem(`${UI_PREFS_KEY_PREFIX}${projectId}`, JSON.stringify(prefs));
  } catch {
    // storage full or unavailable
  }
}

export class SimEnvironmentStore {
  readonly host: AppEnvironmentHost;

  userTileDocEntries: DocsTileEntry[] = [];

  private _appSettings: AppSettings = loadAppSettings();
  private readonly _appSettingsListeners = new Set<AppSettingsListener>();

  private _uiPreferences: UiPreferences = { ...DEFAULT_UI_PREFS };
  private _collapsedArchetypes: Record<string, boolean> = loadCollapsedArchetypes();

  private _isSwitchingProject = false;

  constructor() {
    this.host = new AppEnvironmentHost({
      projectManager: new ProjectManager(createLocalStorageProjectStore(simName), {
        workspaceOptions: { shouldExclude: isCompilerControlledPath },
        lock: createWebLocksProjectLock(simName),
      }),
      modules: [coreModule(), createSimModule()],
      host: { name: simName, version: simVersion },
      userTileStorageKey: "sim:user-tile-metadata",
      bridgeUrl: this._appSettings.vscodeBridgeUrl,
      loadBindingToken,
      saveBindingToken,
      examples: loadExamples(),
      onDidCompile: (_result, tileResult) => {
        if (tileResult) {
          this.userTileDocEntries = buildDocEntries(tileResult.metadata);
        }
      },
    });

    this.host.onProjectLoaded(() => {
      const prefs = loadUiPreferences(this.host.projectManager.activeProject!.manifest.id);
      this._uiPreferences = this._isSwitchingProject ? { ...prefs, bridgeEnabled: false } : prefs;
      this.userTileDocEntries = [];
    });
  }

  get env(): MindcraftEnvironment {
    return this.host.env;
  }

  get projectManager(): ProjectManager {
    return this.host.projectManager;
  }

  get workspace(): WorkspaceAdapter {
    return this.host.workspace;
  }

  get activeProjectManifest(): ProjectManifest | undefined {
    return this.host.activeProjectManifest;
  }

  async initialize(): Promise<void> {
    await this.host.initialize("Untitled Project");
    this._uiPreferences = loadUiPreferences(this.host.projectManager.activeProject!.manifest.id);
    const metadata = this.host.lastUserTileMetadata;
    if (metadata) {
      this.userTileDocEntries = buildDocEntries(metadata);
    }
    initVfsServiceWorker(this);
    this.host.initBridge();

    this.onAppSettingsChange((settings, prev) => {
      if (settings.vscodeBridgeUrl !== prev.vscodeBridgeUrl) {
        this.host.updateBridgeUrl(settings.vscodeBridgeUrl);
      }
    });
  }

  // -- Brain Persistence (archetype-typed wrappers) --

  saveBrainForArchetype(archetype: Archetype, brainDef: BrainDef): void {
    this.host.saveBrainForKey(archetype, brainDef);
  }

  loadBrainFromProject(archetype: Archetype): BrainDef | undefined {
    return this.host.loadBrainFromProject(archetype) as BrainDef | undefined;
  }

  setDefaultBrain(archetype: Archetype, brainDef: BrainDef): void {
    this.host.setDefaultBrain(archetype, brainDef);
  }

  getDefaultBrain(archetype: Archetype): BrainDef | undefined {
    return this.host.getDefaultBrain(archetype) as BrainDef | undefined;
  }

  // -- Project metadata --

  updateProjectMetadata(updates: Partial<Pick<ProjectManifest, "name" | "description">>): void {
    this.host.updateProjectMetadata(updates);
  }

  // -- Project lifecycle (delegate) --

  onProjectUnloading(listener: () => void): () => void {
    return this.host.onProjectUnloading(listener);
  }

  onProjectLoaded(listener: () => void): () => void {
    return this.host.onProjectLoaded(listener);
  }

  // -- Project switching --

  async switchProject(id: string): Promise<void> {
    this._isSwitchingProject = true;
    await this.host.switchProject(id);
    this._isSwitchingProject = false;
  }

  flushPendingBrainRebuilds(): void {
    this.host.flushPendingBrainRebuilds();
  }

  // -- Doc / VFS revision (delegate) --

  get docRevision(): number {
    return this.host.docRevision;
  }

  bumpDocRevision(): void {
    this.host.bumpDocRevision();
  }

  bumpVfsRevision(): void {
    this.host.bumpVfsRevision();
  }

  subscribeToDocRevision = (listener: () => void): (() => void) => {
    return this.host.subscribeToDocRevision(listener);
  };

  getDocRevisionSnapshot = (): number => {
    return this.host.getDocRevisionSnapshot();
  };

  subscribeToVfsRevision = (listener: () => void): (() => void) => {
    return this.host.subscribeToVfsRevision(listener);
  };

  getVfsRevisionSnapshot = (): number => {
    return this.host.getVfsRevisionSnapshot();
  };

  // -- App Settings (sim-specific) --

  getAppSettings(): AppSettings {
    return this._appSettings;
  }

  updateAppSettings(patch: Partial<AppSettings>): void {
    const prev = this._appSettings;
    const merged = { ...this._appSettings, ...patch };
    if (!merged.vscodeBridgeUrl.trim()) {
      merged.vscodeBridgeUrl = DEFAULT_APP_SETTINGS.vscodeBridgeUrl;
    }
    this._appSettings = merged;
    persistAppSettings(this._appSettings);
    for (const fn of this._appSettingsListeners) {
      fn(this._appSettings, prev);
    }
  }

  onAppSettingsChange(fn: AppSettingsListener): () => void {
    this._appSettingsListeners.add(fn);
    return () => {
      this._appSettingsListeners.delete(fn);
    };
  }

  // -- UI Preferences (sim-specific) --

  getUiPreferences(): UiPreferences {
    return this._uiPreferences;
  }

  updateUiPreferences(patch: Partial<UiPreferences>): void {
    this._uiPreferences = { ...this._uiPreferences, ...patch };
    const projectId = this.host.projectManager.activeProject?.manifest.id;
    if (projectId) {
      persistUiPreferences(projectId, this._uiPreferences);
    }
  }

  // -- Collapsed archetypes (global) --

  getCollapsedArchetypes(): Record<string, boolean> {
    return this._collapsedArchetypes;
  }

  updateCollapsedArchetypes(value: Record<string, boolean>): void {
    this._collapsedArchetypes = value;
    persistCollapsedArchetypes(value);
  }

  // -- Bridge (delegate) --

  connectBridge(): void {
    this.host.connectBridge();
  }

  disconnectBridge(): void {
    this.host.disconnectBridge();
  }

  subscribeToBridgeStatus = (listener: () => void): (() => void) => {
    return this.host.subscribeToBridgeStatus(listener);
  };

  getBridgeStatusSnapshot = (): AppBridgeState => {
    return this.host.getBridgeStatusSnapshot();
  };

  subscribeToBridgeJoinCode = (listener: () => void): (() => void) => {
    return this.host.subscribeToBridgeJoinCode(listener);
  };

  getBridgeJoinCodeSnapshot = (): string | undefined => {
    return this.host.getBridgeJoinCodeSnapshot();
  };
}

function buildDocEntries(metadata: readonly UserTileMetadata[]): DocsTileEntry[] {
  const entries: DocsTileEntry[] = [];
  for (const entry of metadata) {
    const tileId = entry.kind === "sensor" ? mkSensorTileId(entry.key) : mkActuatorTileId(entry.key);
    entries.push({
      tileId,
      tags: entry.tags ? [...entry.tags] : [],
      category: entry.kind === "sensor" ? "Sensors" : "Actuators",
      content: entry.docsMarkdown ?? "",
    });
  }
  return entries;
}
