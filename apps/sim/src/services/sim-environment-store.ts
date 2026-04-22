import {
  buildExportCommon,
  createIdbProjectStore,
  createWebLocksProjectLock,
  DEFAULT_PROJECT_NAME,
  type ImportResult,
  importProject as importProjectCommon,
  type MindcraftExportDocument,
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
import { ARCHETYPES } from "@/brain/archetypes";
import type { Obstacle } from "@/brain/vision";
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

function defaultDesiredCounts(): Record<Archetype, number> {
  return {
    carnivore: ARCHETYPES.carnivore.initialSpawnCount,
    herbivore: ARCHETYPES.herbivore.initialSpawnCount,
    plant: ARCHETYPES.plant.initialSpawnCount,
  };
}

function parseObstacles(value: unknown): Obstacle[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: Obstacle[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Partial<Obstacle>;
    if (
      typeof o.x === "number" &&
      typeof o.y === "number" &&
      typeof o.width === "number" &&
      typeof o.height === "number" &&
      Number.isFinite(o.x) &&
      Number.isFinite(o.y) &&
      Number.isFinite(o.width) &&
      Number.isFinite(o.height) &&
      o.width > 0 &&
      o.height > 0
    ) {
      const rotation = typeof o.rotation === "number" && Number.isFinite(o.rotation) ? o.rotation : undefined;
      result.push({ x: o.x, y: o.y, width: o.width, height: o.height, rotation });
    }
  }
  return result;
}

const DESIRED_COUNTS_DEBOUNCE_MS = 200;

export class SimEnvironmentStore {
  readonly host: AppEnvironmentHost;

  userTileDocEntries: DocsTileEntry[] = [];

  private _appSettings: AppSettings = loadAppSettings();
  private readonly _appSettingsListeners = new Set<AppSettingsListener>();

  private _uiPreferences: UiPreferences = { ...DEFAULT_UI_PREFS };
  private _collapsedArchetypes: Record<string, boolean> = loadCollapsedArchetypes();

  private _desiredCounts: Record<Archetype, number> = defaultDesiredCounts();
  private readonly _desiredCountsListeners = new Set<() => void>();
  private _desiredCountsSaveTimer: ReturnType<typeof setTimeout> | undefined;

  private _obstacles: Obstacle[] | undefined;
  private _projectDataReloadPromise: Promise<void> = Promise.resolve();

  private _isSwitchingProject = false;

  private constructor(host: AppEnvironmentHost) {
    this.host = host;

    this.host.onProjectLoaded(() => {
      const prefs = loadUiPreferences(this.host.projectManager.activeProject!.manifest.id);
      this._uiPreferences = this._isSwitchingProject ? { ...prefs, bridgeEnabled: false } : prefs;
      this.userTileDocEntries = [];
      this._projectDataReloadPromise = this.reloadProjectData();
    });
  }

  private async reloadProjectData(): Promise<void> {
    await Promise.all([this.reloadDesiredCountsFromProject(), this.reloadObstaclesFromProject()]);
  }

  /**
   * Resolves once the most recent project-load reload of cached app data
   * (desired counts, obstacles) has finished. Consumers that depend on
   * cached project data after a project switch should await this before
   * reading {@link getObstacles} or {@link getDesiredCounts}.
   */
  waitForProjectDataReload(): Promise<void> {
    return this._projectDataReloadPromise;
  }

  private async reloadObstaclesFromProject(): Promise<void> {
    let next: Obstacle[] | undefined;
    try {
      const raw = await this.host.projectManager.loadAppData("obstacles");
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        next = parseObstacles(parsed);
      }
    } catch {
      // corrupted or missing data -- leave undefined so the scene reseeds
    }
    this._obstacles = next;
  }

  private async reloadDesiredCountsFromProject(): Promise<void> {
    if (this._desiredCountsSaveTimer !== undefined) {
      clearTimeout(this._desiredCountsSaveTimer);
      this._desiredCountsSaveTimer = undefined;
    }
    const next = defaultDesiredCounts();
    try {
      const raw = await this.host.projectManager.loadAppData("actors");
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<Archetype, number>>;
        for (const key of Object.keys(next) as Archetype[]) {
          const value = parsed[key];
          if (typeof value === "number" && Number.isFinite(value)) {
            next[key] = Math.max(0, Math.min(100, Math.round(value)));
          }
        }
      }
    } catch {
      // corrupted or missing data -- fall back to defaults
    }
    this._desiredCounts = next;
    for (const fn of this._desiredCountsListeners) {
      fn();
    }
  }

  static async create(): Promise<SimEnvironmentStore> {
    const appSettings = loadAppSettings();
    const projectStore = await createIdbProjectStore(simName);
    let instanceRef: SimEnvironmentStore | undefined;
    const host = new AppEnvironmentHost({
      projectManager: new ProjectManager(projectStore, {
        workspaceOptions: { shouldExclude: isCompilerControlledPath },
        lock: createWebLocksProjectLock(simName),
      }),
      modules: [coreModule(), createSimModule()],
      host: { name: simName, version: simVersion },
      userTileStorageKey: "sim:user-tile-metadata",
      bridgeUrl: appSettings.vscodeBridgeUrl,
      loadBindingToken,
      saveBindingToken,
      examples: loadExamples(),
      onDidCompile: (_result, tileResult) => {
        if (tileResult && instanceRef) {
          instanceRef.userTileDocEntries = buildDocEntries(tileResult.metadata);
        }
      },
    });
    const instance = new SimEnvironmentStore(host);
    instanceRef = instance;
    instance._appSettings = appSettings;
    return instance;
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
    await this.host.initialize(DEFAULT_PROJECT_NAME);
    this._uiPreferences = loadUiPreferences(this.host.projectManager.activeProject!.manifest.id);
    const metadata = this.host.lastUserTileMetadata;
    if (metadata) {
      this.userTileDocEntries = buildDocEntries(metadata);
    }
    this._projectDataReloadPromise = this.reloadProjectData();
    await this._projectDataReloadPromise;
    initVfsServiceWorker(this);
    this.host.initBridge();

    this.onAppSettingsChange((settings, prev) => {
      if (settings.vscodeBridgeUrl !== prev.vscodeBridgeUrl) {
        this.host.updateBridgeUrl(settings.vscodeBridgeUrl);
      }
    });
  }

  // -- Brain Persistence (archetype-typed wrappers) --

  async saveBrainForArchetype(archetype: Archetype, brainDef: BrainDef): Promise<void> {
    await this.host.saveBrainForKey(archetype, brainDef);
  }

  async loadBrainFromProject(archetype: Archetype): Promise<BrainDef | undefined> {
    return this.host.loadBrainFromProject(archetype) as Promise<BrainDef | undefined>;
  }

  setDefaultBrain(archetype: Archetype, brainDef: BrainDef): void {
    this.host.setDefaultBrain(archetype, brainDef);
  }

  getDefaultBrain(archetype: Archetype): BrainDef | undefined {
    return this.host.getDefaultBrain(archetype) as BrainDef | undefined;
  }

  // -- Project metadata --

  async updateProjectMetadata(updates: Partial<Pick<ProjectManifest, "name" | "description">>): Promise<void> {
    await this.host.updateProjectMetadata(updates);
  }

  // -- Project lifecycle (delegate) --

  onProjectUnloading(listener: () => void): () => void {
    return this.host.onProjectUnloading(listener);
  }

  onProjectLoaded(listener: () => void): () => void {
    return this.host.onProjectLoaded(listener);
  }

  // -- Project switching / creation --

  async createProject(name: string): Promise<ProjectManifest> {
    this._isSwitchingProject = true;
    const manifest = await this.host.createProject(name);
    this._isSwitchingProject = false;
    return manifest;
  }

  async switchProject(id: string): Promise<void> {
    this._isSwitchingProject = true;
    await this.host.switchProject(id);
    this._isSwitchingProject = false;
  }

  // -- Project export / import --

  async exportProject(): Promise<string> {
    const manifest = this.host.activeProjectManifest!;
    const workspace = this.host.workspace;
    const pm = this.host.projectManager;

    const common = await buildExportCommon({ name: simName, version: simVersion }, manifest, workspace, (key) =>
      pm.loadAppData(key)
    );

    const counts = this.getDesiredCounts();
    const actors: { archetype: string; brain: string | null; desiredCount: number }[] = [];
    for (const archetype of Object.keys(ARCHETYPES)) {
      const hasBrain = archetype in (common.brains as Record<string, unknown>);
      actors.push({
        archetype,
        brain: hasBrain ? archetype : null,
        desiredCount: counts[archetype as Archetype] ?? 0,
      });
    }

    const app: { actors: typeof actors; obstacles?: Obstacle[] } = { actors };
    const obstacles = this._obstacles;
    if (obstacles && obstacles.length > 0) {
      app.obstacles = obstacles.map((o) => ({
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
        ...(o.rotation !== undefined ? { rotation: o.rotation } : {}),
      }));
    }

    const doc: MindcraftExportDocument = { ...common, app };
    return JSON.stringify(doc, null, 2);
  }

  async importProject(file: File): Promise<ImportResult> {
    const pm = this.host.projectManager;

    return importProjectCommon(file, simName, simVersion, pm, {
      appLayerCallback: (app) => {
        const diagnostics: { severity: "error" | "warning"; message: string }[] = [];
        const appData = app as { actors?: unknown[]; obstacles?: unknown } | null;
        if (!appData?.actors || !Array.isArray(appData.actors) || appData.actors.length === 0) {
          return {
            diagnostics: [{ severity: "error", message: "No actor data found in app layer." }],
          };
        }

        const counts: Record<string, number> = {};
        for (const entry of appData.actors) {
          const actorEntry = entry as { archetype?: string; desiredCount?: number } | null;
          if (!actorEntry?.archetype || !(actorEntry.archetype in ARCHETYPES)) {
            diagnostics.push({
              severity: "warning",
              message: `Skipped unknown archetype: "${actorEntry?.archetype ?? "(none)"}".`,
            });
            continue;
          }
          if (typeof actorEntry.desiredCount === "number") {
            counts[actorEntry.archetype] = Math.max(0, Math.min(100, Math.round(actorEntry.desiredCount)));
          }
        }

        const importedAppData: Record<string, string> = { actors: JSON.stringify(counts) };
        if (appData.obstacles !== undefined) {
          const obstacles = parseObstacles(appData.obstacles);
          if (obstacles) {
            importedAppData.obstacles = JSON.stringify(obstacles);
          } else {
            diagnostics.push({
              severity: "warning",
              message: "Ignored malformed obstacle data in app layer.",
            });
          }
        }

        return {
          diagnostics,
          appData: importedAppData,
        };
      },
    });
  }

  async loadAppData(key: string): Promise<string | undefined> {
    return this.host.projectManager.loadAppData(key);
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

  // -- Desired population counts (per-project, debounced auto-save) --

  getDesiredCounts(): Record<Archetype, number> {
    return this._desiredCounts;
  }

  setDesiredCount(archetype: Archetype, count: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(count)));
    this._desiredCounts = { ...this._desiredCounts, [archetype]: clamped };
    if (this._desiredCountsSaveTimer !== undefined) {
      clearTimeout(this._desiredCountsSaveTimer);
    }
    this._desiredCountsSaveTimer = setTimeout(() => {
      this._desiredCountsSaveTimer = undefined;
      void this.host.projectManager.saveAppData("actors", JSON.stringify(this._desiredCounts));
    }, DESIRED_COUNTS_DEBOUNCE_MS);
  }

  onDesiredCountsReloaded(listener: () => void): () => void {
    this._desiredCountsListeners.add(listener);
    return () => {
      this._desiredCountsListeners.delete(listener);
    };
  }

  // -- Obstacles (per-project, persisted on first generation) --

  /**
   * Returns the cached obstacles for the active project. `undefined` means
   * no obstacles have been persisted yet -- the scene should generate a
   * fresh set and call {@link setObstacles}.
   */
  getObstacles(): Obstacle[] | undefined {
    return this._obstacles;
  }

  setObstacles(obstacles: ReadonlyArray<Obstacle>): void {
    const next = obstacles.map((o) => ({
      x: o.x,
      y: o.y,
      width: o.width,
      height: o.height,
      ...(o.rotation !== undefined ? { rotation: o.rotation } : {}),
    }));
    this._obstacles = next;
    void this.host.projectManager.saveAppData("obstacles", JSON.stringify(next));
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
