import type {
  ExampleDefinition,
  MindcraftJsonHostInfo,
  ProjectCollectionProjectCommitResult,
  ProjectCollectionUnlockResult,
  ProjectFileSystem,
  ProjectManifest,
} from "@mindcraft-lang/app-host";
import {
  diffMindcraftJsonToManifest,
  MINDCRAFT_JSON_PATH,
  type ProjectManager,
  syncManifestToMindcraftJson,
} from "@mindcraft-lang/app-host";
import type { IBrainDef, MindcraftEnvironment, MindcraftModule } from "@mindcraft-lang/core/app";
import { createMindcraftEnvironment, Dict, logger } from "@mindcraft-lang/core/app";
import type { IRngServices, ProfileNumerics } from "@mindcraft-lang/core/runtime";
import type { AmbientFile, StdlibSourceFile, WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import type { AppBridge, AppBridgeState, ProjectFileChange } from "./app-bridge.js";
import type { BridgeProjectHandle, ProjectCompilerHandle } from "./compilation.js";
import { createBridgeProject, createProjectCompiler } from "./compilation.js";
import type { UserTileApplyResult, UserTileMetadata, UserTileRegistrationOptions } from "./user-tile-registration.js";
import { applyCompiledUserTiles, hydrateUserTilesFromCache } from "./user-tile-registration.js";

// Project app-data keys.
const BRAINS_APP_DATA_KEY = "brains";
const USER_TILE_METADATA_APP_DATA_KEY = "user-tile-metadata";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link AppEnvironmentHost}. */
export interface AppEnvironmentHostOptions {
  projectManager: ProjectManager;
  /** Mindcraft modules to register with the environment. */
  modules: readonly MindcraftModule[];
  /** Ordered ambient declaration files supplied to the project compiler and remote VFS. */
  ambientFiles: readonly AmbientFile[];
  /** Compilable stdlib source modules supplied to the project compiler and remote VFS. */
  stdlibFiles?: readonly StdlibSourceFile[];
  /** Identifies the host application when writing `mindcraft.json`. */
  host: MindcraftJsonHostInfo;
  /** Read-only example projects materialized under the examples folder. */
  examples?: readonly ExampleDefinition[];

  /**
   * Host-supplied RNG. The bridge app forwards this to
   * {@link createMindcraftEnvironment} so brains pull randomness from the host
   * (e.g. the simulator's seeded RNG). When omitted, the environment falls back
   * to a `Math.random()`-backed default.
   */
  rng?: IRngServices;

  /**
   * Brain-observable numeric semantics for the host's device profile,
   * forwarded to {@link createMindcraftEnvironment}. When omitted, the
   * environment falls back to the f64 (native double-precision) default.
   */
  numerics?: ProfileNumerics;

  /** When set, enables the optional bridge connection to a remote peer. */
  bridgeUrl?: string;
  /** Loads a previously persisted bridge binding token. */
  loadBindingToken?: () => string | undefined;
  /** Persists an updated bridge binding token. */
  saveBindingToken?: (token: string) => void;

  /** Invoked after every successful project compile. */
  onDidCompile?: (result: WorkspaceCompileResult, tileResult: UserTileApplyResult | undefined) => void;
}

// ---------------------------------------------------------------------------
// AppEnvironmentHost
// ---------------------------------------------------------------------------

/**
 * Glue layer that wires a {@link ProjectManager}, a {@link MindcraftEnvironment},
 * the project compiler, user-tile registration, and (optionally) the bridge
 * into a single host an app UI can drive.
 */
export class AppEnvironmentHost {
  readonly env: MindcraftEnvironment;
  readonly projectManager: ProjectManager;

  private readonly host: MindcraftJsonHostInfo;
  private readonly ambientFiles: readonly AmbientFile[];
  private readonly stdlibFiles: readonly StdlibSourceFile[];
  private readonly onDidCompileCallback?: (
    result: WorkspaceCompileResult,
    tileResult: UserTileApplyResult | undefined
  ) => void;

  // -- Brain cache --
  private readonly _brainCache = new Map<string, IBrainDef>();
  private readonly _defaultBrainCache = new Map<string, IBrainDef>();

  // -- Brain rebuild coordination --
  private _pendingBrainRebuild = false;

  // -- Doc / VFS revision counters (useSyncExternalStore pattern) --
  private _docRevision = 0;
  private _vfsRevision = 0;
  private readonly _docRevisionListeners = new Set<() => void>();
  private readonly _vfsRevisionListeners = new Set<() => void>();

  // -- Project lifecycle --
  private readonly _projectUnloadingListeners = new Set<() => void>();
  private readonly _projectLoadedListeners = new Set<() => void>();

  // -- Bridge --
  private _bridge: BridgeProjectHandle | undefined;
  private _bridgeUrl: string | undefined;
  private _bridgeStatus: AppBridgeState = "disconnected";
  private _bridgeJoinCode: string | undefined;
  private readonly _bridgeStatusListeners = new Set<() => void>();
  private readonly _bridgeJoinCodeListeners = new Set<() => void>();
  private _bridgeStateUnsub: (() => void) | undefined;
  private _remoteChangeUnsub: (() => void) | undefined;

  private readonly _loadBindingToken: () => string | undefined;
  private readonly _saveBindingToken: (token: string) => void;
  private readonly _examples: readonly ExampleDefinition[];

  // -- User tile metadata (last known) --
  private _lastUserTileMetadata: readonly UserTileMetadata[] | undefined;

  // -- Compilation --
  private _compiler: ProjectCompilerHandle | undefined;

  constructor(options: AppEnvironmentHostOptions) {
    this.projectManager = options.projectManager;
    this.host = options.host;
    this.ambientFiles = options.ambientFiles;
    this.stdlibFiles = options.stdlibFiles ?? [];
    this.onDidCompileCallback = options.onDidCompile;
    this._bridgeUrl = options.bridgeUrl;
    this._loadBindingToken = options.loadBindingToken ?? (() => undefined);
    this._saveBindingToken = options.saveBindingToken ?? (() => {});
    this._examples = options.examples ?? [];

    this.env = createMindcraftEnvironment({
      modules: [...options.modules],
      rng: options.rng,
      numerics: options.numerics,
    });

    this.env.onBrainsInvalidated((event) => {
      if (event.invalidatedBrains.length > 0) {
        this._pendingBrainRebuild = true;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Project file system
  // ---------------------------------------------------------------------------

  get projectFileSystem(): ProjectFileSystem {
    return this.projectManager.activeProject!.filesystem;
  }

  get activeProjectManifest(): ProjectManifest | undefined {
    return this.projectManager.activeProject?.manifest;
  }

  /** Release bridge and project-manager resources owned by this host. */
  dispose(): void {
    this.teardownBridge();
    this.projectManager.dispose();
  }

  // ---------------------------------------------------------------------------
  // Initialize
  // ---------------------------------------------------------------------------

  /**
   * Storage hooks binding the user-tile metadata cache to the active project's
   * durable app-data, so the cache is project-scoped rather than global.
   */
  private userTileStorageOptions(): UserTileRegistrationOptions {
    return {
      loadMetadata: () => this.projectManager.loadAppData(USER_TILE_METADATA_APP_DATA_KEY),
      saveMetadata: (json) => {
        const op =
          json === undefined
            ? this.projectManager.deleteAppData(USER_TILE_METADATA_APP_DATA_KEY)
            : this.projectManager.saveAppData(USER_TILE_METADATA_APP_DATA_KEY, json);
        op.catch((err: unknown) => {
          logger.warn("[app-environment-host] failed to persist user-tile metadata cache:", err);
        });
      },
    };
  }

  async initialize(defaultProjectName: string): Promise<void> {
    await this.projectManager.init();
    const state = await this.projectManager.getProjectCollectionState();
    if (state.access === "locked") {
      return;
    }
    await this.projectManager.ensureDefaultProject(defaultProjectName);
    this._lastUserTileMetadata =
      (await hydrateUserTilesFromCache(this.env, this.userTileStorageOptions())) ?? undefined;
    this.initCompiler();
    await this.loadBrainsFromProject();
  }

  // ---------------------------------------------------------------------------
  // Compilation (always available, independent of bridge)
  // ---------------------------------------------------------------------------

  private initCompiler(): void {
    this._compiler = createProjectCompiler({
      environment: this.env,
      filesystem: this.projectFileSystem,
      ambientFiles: this.ambientFiles,
      stdlibFiles: this.stdlibFiles,
      examples: [...this._examples],
      onDidCompile: (result) => {
        logWorkspaceCompile(result);
        const tileResult = applyCompiledUserTiles(this.env, result, this.userTileStorageOptions());
        if (tileResult) {
          this._lastUserTileMetadata = tileResult.metadata;
          this.bumpDocRevision();
        }
        this.onDidCompileCallback?.(result, tileResult);
      },
    });
    syncManifestToMindcraftJson(this.projectFileSystem, this.projectManager.activeProject!.manifest, this.host);
    this._compiler.initialize();
  }

  // ---------------------------------------------------------------------------
  // Brain persistence (keyed by app-defined string)
  // ---------------------------------------------------------------------------

  async saveBrainForKey(key: string, brainDef: IBrainDef): Promise<void> {
    this._brainCache.set(key, brainDef);
    const record = await this.loadBrainRecord();
    record[key] = brainDef.toJson();
    await this.projectManager.saveAppData(BRAINS_APP_DATA_KEY, JSON.stringify(record));
  }

  async removeBrain(key: string): Promise<void> {
    this._brainCache.delete(key);
    const record = await this.loadBrainRecord();
    delete record[key];
    await this.projectManager.saveAppData(BRAINS_APP_DATA_KEY, JSON.stringify(record));
  }

  async loadBrainFromProject(key: string): Promise<IBrainDef | undefined> {
    try {
      const raw = await this.projectManager.loadAppData(BRAINS_APP_DATA_KEY);
      if (!raw) return undefined;
      const record = JSON.parse(raw) as Record<string, unknown>;
      const json = record[key];
      if (!json) return undefined;
      const brainDef = this.env.deserializeBrainJsonFromPlain(json);
      if (brainDef.pages().size() === 0) {
        brainDef.appendNewPage();
      }
      return brainDef;
    } catch (err) {
      logger.warn(`Failed to load brain "${key}":`, err);
      return undefined;
    }
  }

  /**
   * Returns the active project's in-memory brain for `key`, or undefined when none is cached. The
   * cache is loaded on project load and updated by `saveBrainForKey` and `removeBrain`.
   */
  getCachedBrain(key: string): IBrainDef | undefined {
    return this._brainCache.get(key);
  }

  /** Returns the keys of the active project's cached brains, in cache order. */
  getCachedBrainKeys(): readonly string[] {
    return [...this._brainCache.keys()];
  }

  setDefaultBrain(key: string, brainDef: IBrainDef): void {
    this._defaultBrainCache.set(key, brainDef);
  }

  getDefaultBrain(key: string): IBrainDef | undefined {
    return this._defaultBrainCache.get(key);
  }

  private async saveAllBrains(): Promise<void> {
    const record: Record<string, unknown> = {};
    for (const [key, def] of this._brainCache) {
      record[key] = def.toJson();
    }
    await this.projectManager.saveAppData(BRAINS_APP_DATA_KEY, JSON.stringify(record));
  }

  private async loadBrainRecord(): Promise<Record<string, unknown>> {
    try {
      const raw = await this.projectManager.loadAppData(BRAINS_APP_DATA_KEY);
      if (raw) return JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      logger.warn("Failed to load brain record:", err);
    }
    return {};
  }

  private async loadBrainsFromProject(): Promise<void> {
    const record = await this.loadBrainRecord();
    for (const key of Object.keys(record)) {
      const def = await this.loadBrainFromProject(key);
      if (def) {
        this._brainCache.set(key, def);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Project metadata
  // ---------------------------------------------------------------------------

  async updateProjectMetadata(updates: Partial<Pick<ProjectManifest, "name" | "description">>): Promise<void> {
    await this.projectManager.updateActive(updates);
    syncManifestToMindcraftJson(this.projectFileSystem, this.projectManager.activeProject!.manifest, this.host);
  }

  // ---------------------------------------------------------------------------
  // Project lifecycle events
  // ---------------------------------------------------------------------------

  onProjectUnloading(listener: () => void): () => void {
    this._projectUnloadingListeners.add(listener);
    return () => this._projectUnloadingListeners.delete(listener);
  }

  onProjectLoaded(listener: () => void): () => void {
    this._projectLoadedListeners.add(listener);
    return () => this._projectLoadedListeners.delete(listener);
  }

  // ---------------------------------------------------------------------------
  // Project switching / creation
  // ---------------------------------------------------------------------------

  async createProject(name: string): Promise<ProjectManifest> {
    await this.prepareProjectTransition();
    const manifest = await this.projectManager.create(name, {
      beforeActiveProjectChange: () => this.notifyProjectUnloading(),
    });
    await this.completeProjectTransition();
    return manifest;
  }

  async switchProject(id: string): Promise<void> {
    if (this.projectManager.activeProject?.manifest.id === id) {
      return;
    }
    await this.prepareProjectTransition();
    await this.projectManager.open(id, {
      beforeActiveProjectChange: () => this.notifyProjectUnloading(),
    });
    await this.completeProjectTransition();
  }

  async switchProjectCollectionAndOpenProject(
    projectCollectionId: string,
    projectId: string
  ): Promise<ProjectCollectionProjectCommitResult> {
    if (
      this.projectManager.activeProjectCollection?.projectCollectionId === projectCollectionId &&
      this.projectManager.activeProject?.manifest.id === projectId
    ) {
      return {
        collection: this.projectManager.activeProjectCollection,
        project: this.projectManager.activeProject.manifest,
        access: "ready",
      };
    }
    await this.prepareProjectTransition();
    const result = await this.projectManager.switchProjectCollectionAndOpenProject(projectCollectionId, projectId, {
      beforeActiveProjectChange: () => this.notifyProjectUnloading(),
    });
    await this.completeProjectTransition();
    return result;
  }

  async switchProjectCollectionAndCreateProject(
    projectCollectionId: string,
    name: string
  ): Promise<ProjectCollectionProjectCommitResult> {
    await this.prepareProjectTransition();
    const result = await this.projectManager.switchProjectCollectionAndCreateProject(projectCollectionId, name, {
      beforeActiveProjectChange: () => this.notifyProjectUnloading(),
    });
    await this.completeProjectTransition();
    return result;
  }

  /**
   * Unlock a project collection and initialize the project environment when
   * unlocking restores the active project.
   *
   * @param projectCollectionId - Project collection to unlock.
   * @param pin - User-entered PIN or phrase.
   * @returns The unlocked project collection and its ready access status.
   */
  async unlockProjectCollection(projectCollectionId: string, pin: string): Promise<ProjectCollectionUnlockResult> {
    const result = await this.projectManager.unlockProjectCollection(projectCollectionId, pin);
    if (
      this.projectManager.activeProjectCollection?.projectCollectionId === projectCollectionId &&
      this.projectManager.activeProject
    ) {
      await this.completeProjectTransition();
    }
    return result;
  }

  /**
   * Lock a project collection after flushing app-owned project state.
   *
   * @param projectCollectionId - Project collection to lock.
   */
  async lockProjectCollection(projectCollectionId: string): Promise<void> {
    const locksActiveProject =
      this.projectManager.activeProjectCollection?.projectCollectionId === projectCollectionId &&
      this.projectManager.activeProject !== undefined;
    if (locksActiveProject) {
      await this.prepareProjectTransition();
    }
    await this.projectManager.lockProjectCollection(projectCollectionId, {
      beforeActiveProjectChange: () => this.notifyProjectUnloading(),
    });
    if (locksActiveProject) {
      this.completeProjectUnload();
    }
  }

  private async prepareProjectTransition(): Promise<void> {
    if (this.projectManager.activeProject) {
      await this.saveAllBrains();
    }
  }

  private notifyProjectUnloading(): void {
    for (const listener of this._projectUnloadingListeners) {
      listener();
    }
  }

  private completeProjectUnload(): void {
    this._brainCache.clear();
    this._pendingBrainRebuild = false;
    this.env.replaceActionBundle({ revision: "", tiles: [], actions: Dict.empty() });
    this._lastUserTileMetadata = undefined;
    this.bumpDocRevision();
    this.teardownBridge();
  }

  private async completeProjectTransition(): Promise<void> {
    this.completeProjectUnload();
    this._lastUserTileMetadata =
      (await hydrateUserTilesFromCache(this.env, this.userTileStorageOptions())) ?? undefined;
    this.initCompiler();
    await this.loadBrainsFromProject();

    for (const listener of this._projectLoadedListeners) {
      listener();
    }
  }

  // ---------------------------------------------------------------------------
  // Brain rebuild flush
  // ---------------------------------------------------------------------------

  flushPendingBrainRebuilds(): void {
    if (!this._pendingBrainRebuild) {
      return;
    }
    this._pendingBrainRebuild = false;
    try {
      this.env.rebuildInvalidatedBrains();
    } catch (err) {
      logger.warn("Failed to rebuild invalidated brains:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // User tile metadata
  // ---------------------------------------------------------------------------

  get lastUserTileMetadata(): readonly UserTileMetadata[] | undefined {
    return this._lastUserTileMetadata;
  }

  // ---------------------------------------------------------------------------
  // Doc / VFS revision (useSyncExternalStore pattern)
  // ---------------------------------------------------------------------------

  get docRevision(): number {
    return this._docRevision;
  }

  bumpDocRevision(): void {
    this._docRevision++;
    for (const listener of this._docRevisionListeners) {
      listener();
    }
  }

  bumpVfsRevision(): void {
    this._vfsRevision++;
    for (const listener of this._vfsRevisionListeners) {
      listener();
    }
  }

  subscribeToDocRevision = (listener: () => void): (() => void) => {
    this._docRevisionListeners.add(listener);
    return () => this._docRevisionListeners.delete(listener);
  };

  getDocRevisionSnapshot = (): number => {
    return this._docRevision;
  };

  subscribeToVfsRevision = (listener: () => void): (() => void) => {
    this._vfsRevisionListeners.add(listener);
    return () => this._vfsRevisionListeners.delete(listener);
  };

  getVfsRevisionSnapshot = (): number => {
    return this._vfsRevision;
  };

  // ---------------------------------------------------------------------------
  // Bridge (optional -- only available if bridgeUrl was provided)
  // ---------------------------------------------------------------------------

  initBridge(): void {
    if (!this._bridgeUrl || !this._compiler) {
      return;
    }

    this.teardownBridge();

    this._bridge = createBridgeProject({
      projectCompiler: this._compiler,
      filesystem: this.projectFileSystem,
      bridgeUrl: this._bridgeUrl,
      bindingToken: this._loadBindingToken(),
      onBindingTokenChange: (token) => {
        this._saveBindingToken(token);
      },
    });

    this.wireBridgeState(this._bridge.bridge);
  }

  connectBridge(): void {
    if (!this._bridge) {
      this.initBridge();
    }

    if (!this._bridge || this._bridge.bridge.snapshot().status !== "disconnected") {
      return;
    }

    this._bridge.bridge.start();
  }

  disconnectBridge(): void {
    this._bridge?.bridge.stop();
  }

  private teardownBridge(): void {
    this._bridgeStateUnsub?.();
    this._bridgeStateUnsub = undefined;
    this._remoteChangeUnsub?.();
    this._remoteChangeUnsub = undefined;
    this._bridge?.bridge.stop();
    this._bridge = undefined;

    if (this._bridgeStatus !== "disconnected") {
      this._bridgeStatus = "disconnected";
      for (const listener of this._bridgeStatusListeners) {
        listener();
      }
    }

    if (this._bridgeJoinCode !== undefined) {
      this._bridgeJoinCode = undefined;
      for (const listener of this._bridgeJoinCodeListeners) {
        listener();
      }
    }
  }

  updateBridgeUrl(bridgeUrl: string): void {
    this._bridgeUrl = bridgeUrl;
    if (!this._bridge) {
      return;
    }
    const shouldStart = this._bridgeStatus !== "disconnected";
    this._bridgeStateUnsub?.();
    this._bridgeStateUnsub = undefined;
    this._bridge.recreateBridge(bridgeUrl);
    this.wireBridgeState(this._bridge.bridge);
    if (shouldStart) {
      this._bridge.bridge.start();
    }
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
    this._remoteChangeUnsub = bridge.onRemoteChange((change: ProjectFileChange) => {
      this.bumpVfsRevision();
      if (change.action === "write" && change.path === MINDCRAFT_JSON_PATH && this.projectManager.activeProject) {
        const patch = diffMindcraftJsonToManifest(change.content, this.projectManager.activeProject.manifest);
        if (patch) {
          void this.projectManager.updateActive(patch);
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
