import {
  type ActiveProject,
  createLocalStorageProjectStore,
  createWebLocksProjectLock,
  diffMindcraftJsonToManifest,
  MINDCRAFT_JSON_PATH,
  type MindcraftJsonHostInfo,
  ProjectManager,
  type ProjectManifest,
  syncManifestToMindcraftJson,
  type WorkspaceAdapter,
} from "@mindcraft-lang/app-host";
import type { AppBridge, AppBridgeState } from "@mindcraft-lang/bridge-app";
import { type BridgeProjectHandle, createBridgeProject } from "@mindcraft-lang/bridge-app/compilation";
import {
  type BrainDef,
  coreModule,
  createMindcraftEnvironment,
  logger,
  type MindcraftEnvironment,
} from "@mindcraft-lang/core/app";
import type { DocsTileEntry } from "@mindcraft-lang/docs";
import type { WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import { isCompilerControlledPath } from "@mindcraft-lang/ts-compiler";
import { createSimModule } from "@/brain";
import type { Archetype } from "@/brain/actor";
import { loadExamples } from "@/examples";
import { name as simName, version as simVersion } from "../../package.json";
import { clearBindingToken, loadBindingToken, saveBindingToken } from "./binding-token-persistence";
import { applyCompiledUserTiles, hydrateUserTilesAtStartup } from "./user-tile-registration";
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
  collapsedArchetypes: Record<string, boolean>;
  timeScale: number;
  bridgeEnabled: boolean;
  debugEnabled: boolean;
}

const DEFAULT_UI_PREFS: UiPreferences = {
  collapsedArchetypes: {},
  timeScale: 1,
  bridgeEnabled: false,
  debugEnabled: false,
};

function loadUiPreferences(projectId: string): UiPreferences {
  try {
    const raw = localStorage.getItem(`${UI_PREFS_KEY_PREFIX}${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UiPreferences>;
      return {
        collapsedArchetypes: parsed.collapsedArchetypes ?? DEFAULT_UI_PREFS.collapsedArchetypes,
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
  readonly env: MindcraftEnvironment;
  readonly projectManager: ProjectManager;

  userTileDocEntries: DocsTileEntry[] = [];

  private _docRevision = 0;
  private _vfsRevision = 0;
  private readonly docRevisionListeners = new Set<() => void>();
  private readonly vfsRevisionListeners = new Set<() => void>();

  private _pendingBrainRebuild = false;
  private readonly _defaultBrainCache = new Map<Archetype, BrainDef>();

  private _project: BridgeProjectHandle | undefined;
  private _bridgeStatus: AppBridgeState = "disconnected";
  private _bridgeJoinCode: string | undefined;
  private readonly _bridgeStatusListeners = new Set<() => void>();
  private readonly _bridgeJoinCodeListeners = new Set<() => void>();
  private _bridgeStateUnsub: (() => void) | undefined;
  private _remoteChangeUnsub: (() => void) | undefined;

  private _appSettings: AppSettings = loadAppSettings();
  private readonly _appSettingsListeners = new Set<AppSettingsListener>();

  private _uiPreferences: UiPreferences = { ...DEFAULT_UI_PREFS };

  private readonly _host: MindcraftJsonHostInfo = { name: simName, version: simVersion };

  constructor() {
    this.projectManager = new ProjectManager(createLocalStorageProjectStore(simName), {
      workspaceOptions: { shouldExclude: isCompilerControlledPath },
      lock: createWebLocksProjectLock(simName),
    });
    this.env = createMindcraftEnvironment({
      modules: [coreModule(), createSimModule()],
    });

    this.env.onBrainsInvalidated((event) => {
      if (event.invalidatedBrains.length > 0) {
        this._pendingBrainRebuild = true;
      }
    });
  }

  get workspace(): WorkspaceAdapter {
    return this.projectManager.activeProject!.workspace;
  }

  get activeProjectManifest(): ProjectManifest | undefined {
    return this.projectManager.activeProject?.manifest;
  }

  async initialize(): Promise<void> {
    await this.projectManager.init();
    await this.projectManager.ensureDefaultProject("Untitled Project");
    this._uiPreferences = loadUiPreferences(this.projectManager.activeProject!.manifest.id);
    this.loadBrainsFromProject();
    hydrateUserTilesAtStartup(this);
    initVfsServiceWorker(this);
    this.initBridge();
  }

  // -- Brain Persistence (project-scoped) --

  saveBrainForArchetype(archetype: Archetype, brainDef: BrainDef): void {
    this.saveAllBrains({ [archetype]: brainDef });
  }

  private saveAllBrains(overrides?: Partial<Record<Archetype, BrainDef>>): void {
    const brainsRecord: Record<string, unknown> = {};
    const archetypes: Archetype[] = ["carnivore", "herbivore", "plant"];
    for (const archetype of archetypes) {
      const brainDef = overrides?.[archetype] ?? this._defaultBrainCache.get(archetype);
      if (brainDef) {
        brainsRecord[archetype] = brainDef.toJson();
      }
    }
    this.projectManager.saveAppData("brains", JSON.stringify(brainsRecord));
  }

  loadBrainFromProject(archetype: Archetype): BrainDef | undefined {
    try {
      const raw = this.projectManager.loadAppData("brains");
      if (!raw) return undefined;
      const record = JSON.parse(raw) as Record<string, unknown>;
      const json = record[archetype];
      if (!json) return undefined;
      const brainDef = this.env.deserializeBrainJsonFromPlain(json) as BrainDef;
      if (brainDef.pages().size() === 0) {
        brainDef.appendNewPage();
      }
      return brainDef;
    } catch {
      return undefined;
    }
  }

  private loadBrainsFromProject(): void {
    const archetypes: Archetype[] = ["carnivore", "herbivore", "plant"];
    for (const archetype of archetypes) {
      const brainDef = this.loadBrainFromProject(archetype);
      if (brainDef) {
        this._defaultBrainCache.set(archetype, brainDef);
      }
    }
  }

  updateProjectMetadata(updates: Partial<Pick<ProjectManifest, "name" | "description">>): void {
    this.projectManager.updateActive(updates);
    syncManifestToMindcraftJson(this.workspace, this.projectManager.activeProject!.manifest, this._host);
  }

  // -- Project Switching --

  async switchProject(id: string): Promise<void> {
    this.saveAllBrains();
    const active = await this.projectManager.open(id);
    this._uiPreferences = loadUiPreferences(active.manifest.id);
    this._defaultBrainCache.clear();
    this.loadBrainsFromProject();

    if (this._project) {
      syncManifestToMindcraftJson(this.workspace, active.manifest, this._host);
      this._project.compiler.replaceWorkspace(active.workspace.exportSnapshot());
      this._project.compiler.compile();
    }
  }

  flushPendingBrainRebuilds(): void {
    if (!this._pendingBrainRebuild) {
      return;
    }
    this._pendingBrainRebuild = false;
    this.env.rebuildInvalidatedBrains();
  }

  setDefaultBrain(archetype: Archetype, brainDef: BrainDef): void {
    this._defaultBrainCache.set(archetype, brainDef);
  }

  getDefaultBrain(archetype: Archetype): BrainDef | undefined {
    return this._defaultBrainCache.get(archetype);
  }

  get docRevision(): number {
    return this._docRevision;
  }

  bumpDocRevision(): void {
    this._docRevision++;
    for (const listener of this.docRevisionListeners) {
      listener();
    }
  }

  bumpVfsRevision(): void {
    this._vfsRevision++;
    for (const listener of this.vfsRevisionListeners) {
      listener();
    }
  }

  subscribeToDocRevision = (listener: () => void): (() => void) => {
    this.docRevisionListeners.add(listener);
    return () => this.docRevisionListeners.delete(listener);
  };

  getDocRevisionSnapshot = (): number => {
    return this._docRevision;
  };

  subscribeToVfsRevision = (listener: () => void): (() => void) => {
    this.vfsRevisionListeners.add(listener);
    return () => this.vfsRevisionListeners.delete(listener);
  };

  getVfsRevisionSnapshot = (): number => {
    return this._vfsRevision;
  };

  // -- App Settings --

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

  // -- UI Preferences --

  getUiPreferences(): UiPreferences {
    return this._uiPreferences;
  }

  updateUiPreferences(patch: Partial<UiPreferences>): void {
    this._uiPreferences = { ...this._uiPreferences, ...patch };
    const projectId = this.projectManager.activeProject?.manifest.id;
    if (projectId) {
      persistUiPreferences(projectId, this._uiPreferences);
    }
  }

  // -- Bridge --

  initBridge(): void {
    this._project = createBridgeProject({
      environment: this.env,
      host: this._host,
      bridgeUrl: this._appSettings.vscodeBridgeUrl,
      workspace: this.workspace,
      bindingToken: loadBindingToken(),
      onBindingTokenChange(token) {
        saveBindingToken(token);
      },
      onDidCompile: (result) => {
        logWorkspaceCompile(result);
        applyCompiledUserTiles(this, result);
      },
    });

    this._project.injectExamples(loadExamples());
    syncManifestToMindcraftJson(this.workspace, this.projectManager.activeProject!.manifest, this._host);
    this._project.initialize();
    this.wireBridgeState(this._project.bridge);

    this.onAppSettingsChange((settings, prev) => {
      if (settings.vscodeBridgeUrl !== prev.vscodeBridgeUrl) {
        const shouldStart = this._uiPreferences.bridgeEnabled || this._bridgeStatus !== "disconnected";
        this.recreateBridge(shouldStart);
      }
    });
  }

  connectBridge(): void {
    if (!this._project) {
      this.initBridge();
    }

    if (!this._project || this._project.bridge.snapshot().status !== "disconnected") {
      return;
    }

    this._project.bridge.start();
  }

  disconnectBridge(): void {
    this._project?.bridge.stop();
  }

  subscribeToBridgeStatus = (listener: () => void): (() => void) => {
    this._bridgeStatusListeners.add(listener);
    return () => this._bridgeStatusListeners.delete(listener);
  };

  getBridgeStatusSnapshot = (): AppBridgeState => {
    return this._bridgeStatus;
  };

  subscribeToBridgeJoinCode = (listener: () => void): (() => void) => {
    this._bridgeJoinCodeListeners.add(listener);
    return () => this._bridgeJoinCodeListeners.delete(listener);
  };

  getBridgeJoinCodeSnapshot = (): string | undefined => {
    return this._bridgeJoinCode;
  };

  private wireBridgeState(bridge: AppBridge): void {
    this._bridgeStateUnsub?.();
    this._remoteChangeUnsub?.();
    this._bridgeStateUnsub = bridge.onStateChange(() => {
      this.applyBridgeSnapshot(bridge);
    });
    this._remoteChangeUnsub = bridge.onRemoteChange((change) => {
      this.bumpVfsRevision();
      if (change.action === "write" && change.path === MINDCRAFT_JSON_PATH && this.projectManager.activeProject) {
        const patch = diffMindcraftJsonToManifest(change.content, this.projectManager.activeProject.manifest);
        if (patch) {
          this.projectManager.updateActive(patch);
        }
      }
    });
    this.applyBridgeSnapshot(bridge);
  }

  private applyBridgeSnapshot(bridge: AppBridge): void {
    const snapshot = bridge.snapshot();

    if (snapshot.status !== this._bridgeStatus) {
      this._bridgeStatus = snapshot.status;
      for (const listener of this._bridgeStatusListeners) {
        listener();
      }
    }

    if (snapshot.joinCode !== this._bridgeJoinCode) {
      this._bridgeJoinCode = snapshot.joinCode;
      for (const listener of this._bridgeJoinCodeListeners) {
        listener();
      }
    }
  }

  private recreateBridge(shouldStart: boolean): void {
    if (!this._project) {
      return;
    }

    this._bridgeStateUnsub?.();
    this._bridgeStateUnsub = undefined;

    this._project.recreateBridge(this._appSettings.vscodeBridgeUrl);
    this.wireBridgeState(this._project.bridge);

    if (shouldStart) {
      this._project.bridge.start();
    }
  }
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
      logger.debug(`[user-tile-compiler] ${path}: compiled ${program.kind} "${program.name}"`);
    }
  }
}
