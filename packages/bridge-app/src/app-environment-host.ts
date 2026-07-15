import type {
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
import { createMindcraftEnvironment, Dict, encodePersistedBrainJson, logger } from "@mindcraft-lang/core/app";
import type { PersistedBrainJson } from "@mindcraft-lang/core/brain/model";
import type { IRngServices, ProfileNumerics } from "@mindcraft-lang/core/runtime";
import type { Mount, WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import type { AppBridge, AppBridgeState, ProjectFileChange } from "./app-bridge.js";
import type { BridgeProjectHandle, ProjectCompilerHandle } from "./compilation.js";
import { augmentProjectFileSystem, createBridgeProject, createProjectCompiler } from "./compilation.js";
import type { EmbeddedExtension, ResolvedExtensions } from "./embedded-extensions.js";
import { ExtensionResolutionCycleError, resolveEmbeddedExtensions } from "./embedded-extensions.js";
import type { UserTileApplyResult, UserTileMetadata } from "./user-tile-registration.js";
import { applyCompiledUserTiles } from "./user-tile-registration.js";

// Project app-data keys.
const BRAINS_APP_DATA_KEY = "brains";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link AppEnvironmentHost}. */
export interface AppEnvironmentHostOptions {
  projectManager: ProjectManager;
  /** Mindcraft modules to register with the environment. */
  modules: readonly MindcraftModule[];
  /** Read-only content mounts supplied to the project compiler and remote VFS. */
  mounts: readonly Mount[];
  /**
   * Extensions bundled with the host application. A project's `embedded:<repo>`
   * dependency resolves against this record by the origin's repository segment,
   * delivering the extension's content to the compiler as a mounted dependency
   * keyed by its `<owner>/<repo>` coordinate. Empty when the app bundles none.
   */
  embeddedExtensions?: readonly EmbeddedExtension[];

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

  private readonly mounts: readonly Mount[];
  private readonly embeddedExtensions: readonly EmbeddedExtension[];
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

  // -- User tile metadata (last known) --
  private _lastUserTileMetadata: readonly UserTileMetadata[] | undefined;

  // -- Compilation --
  private _compiler: ProjectCompilerHandle | undefined;

  // -- Served file system (raw project files plus compiler-controlled files) --
  private _servedFileSystem: ProjectFileSystem | undefined;

  constructor(options: AppEnvironmentHostOptions) {
    this.projectManager = options.projectManager;
    this.mounts = options.mounts;
    this.embeddedExtensions = options.embeddedExtensions ?? [];
    this.onDidCompileCallback = options.onDidCompile;
    this._bridgeUrl = options.bridgeUrl;
    this._loadBindingToken = options.loadBindingToken ?? (() => undefined);
    this._saveBindingToken = options.saveBindingToken ?? (() => {});

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

  /**
   * The file system whose exported snapshot carries both the raw project files
   * and the compiler-controlled files (ambient declarations, `tsconfig.json`,
   * and the installed-extensions tree), including extension-owned assets such
   * as tile icons. Each `exportSnapshot()` reads the live compiler, so
   * installing or uninstalling an extension is reflected without a rebuild.
   * Falls back to the raw project file system until the compiler is wired.
   */
  get servedProjectFileSystem(): ProjectFileSystem {
    return this._servedFileSystem ?? this.projectFileSystem;
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

  async initialize(defaultProjectName: string): Promise<void> {
    await this.projectManager.init();
    const state = await this.projectManager.getProjectCollectionState();
    if (state.access === "locked") {
      return;
    }
    await this.projectManager.ensureDefaultProject(defaultProjectName);
    this.initCompiler();
    await this.loadBrainsFromProject();
  }

  // ---------------------------------------------------------------------------
  // Compilation (always available, independent of bridge)
  // ---------------------------------------------------------------------------

  /**
   * Resolve the active project's extension dependency graph against the host's
   * embed record. Logs any conflict warnings. A dependency cycle is a mechanics
   * failure: it is logged and resolution falls back to no extension
   * dependencies, so the project still loads and unresolved imports surface as
   * ordinary compiler diagnostics.
   */
  private resolveExtensions(): ResolvedExtensions {
    try {
      const resolved = resolveEmbeddedExtensions(
        this.projectManager.activeProject!.manifest.extensions,
        this.embeddedExtensions
      );
      for (const warning of resolved.warnings) {
        logger.warn(`[extension-resolution] ${warning.message}`);
      }
      return resolved;
    } catch (err) {
      if (err instanceof ExtensionResolutionCycleError) {
        logger.warn(`[extension-resolution] ${err.message}`);
        return { dependencies: [], dependencyMounts: [], warnings: [] };
      }
      throw err;
    }
  }

  private initCompiler(): void {
    const { dependencies, dependencyMounts } = this.resolveExtensions();
    this._compiler = createProjectCompiler({
      environment: this.env,
      filesystem: this.projectFileSystem,
      projectNamespace: this.projectManager.activeProject!.manifest.id,
      mounts: this.mounts,
      dependencies,
      dependencyMounts,
      onDidCompile: (result) => {
        this.persistMintedActionIds(result.projectResult.sourceRewrites);
        logWorkspaceCompile(result);
        const tileResult = applyCompiledUserTiles(this.env, result);
        if (tileResult) {
          this._lastUserTileMetadata = tileResult.metadata;
          this.bumpDocRevision();
          if (tileResult.changedActionKeys.length > 0) {
            // A changed action bundle can make a previously unbuildable brain
            // buildable, including one born invalidated because its action was
            // missing at creation. Schedule the rebuild flush to retry the
            // invalidated set even when this compile invalidated no live brain.
            this._pendingBrainRebuild = true;
          }
        }
        this.onDidCompileCallback?.(result, tileResult);
      },
    });
    this._servedFileSystem = augmentProjectFileSystem(this.projectFileSystem, this._compiler.compiler);
    syncManifestToMindcraftJson(this.projectFileSystem, this.projectManager.activeProject!.manifest);
    this._compiler.initialize();
  }

  /**
   * Persist source files whose user-action declaration had a stable `id` minted
   * during compilation. Writes the updated text to the project file system and
   * to the compiler's in-memory view.
   */
  private persistMintedActionIds(sourceRewrites: ReadonlyMap<string, string>): void {
    if (sourceRewrites.size === 0) {
      return;
    }
    for (const [path, content] of sourceRewrites) {
      const newEtag = `idgen-${Date.now()}`;
      this.projectFileSystem.applyLocalChange({ action: "write", path, content, newEtag });
      this._compiler?.compiler.applyWorkspaceChange({ action: "write", path, content, newEtag });
    }
  }

  // ---------------------------------------------------------------------------
  // Brain persistence (keyed by app-defined string)
  // ---------------------------------------------------------------------------

  async saveBrainForKey(key: string, brainDef: IBrainDef): Promise<void> {
    this._brainCache.set(key, brainDef);
    const record = await this.loadBrainRecord();
    record[key] = this.serializeBrainForStorage(brainDef);
    await this.projectManager.saveAppData(BRAINS_APP_DATA_KEY, JSON.stringify(record));
  }

  /**
   * Serialize a brain into its persisted form: identifiers qualified by the
   * active project's namespace are stored with the namespace absent.
   */
  serializeBrainForStorage(brainDef: IBrainDef): PersistedBrainJson {
    return encodePersistedBrainJson(brainDef, this.projectManager.activeProject!.manifest.id);
  }

  async removeBrain(key: string): Promise<void> {
    this._brainCache.delete(key);
    const record = await this.loadBrainRecord();
    delete record[key];
    await this.projectManager.saveAppData(BRAINS_APP_DATA_KEY, JSON.stringify(record));
  }

  async loadBrainFromProject(key: string): Promise<IBrainDef | undefined> {
    const record = await this.loadBrainRecord();
    const json = record[key];
    if (!json) return undefined;
    return this.deserializeBrainForKey(key, json);
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
    // Overlay the cache onto the stored record: an entry that failed to
    // deserialize on load has no cache slot, and its stored bytes must survive.
    const record = await this.loadBrainRecord();
    for (const [key, def] of this._brainCache) {
      record[key] = this.serializeBrainForStorage(def);
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
    for (const [key, json] of Object.entries(record)) {
      const def = this.deserializeBrainForKey(key, json);
      if (def) {
        this._brainCache.set(key, def);
      }
    }
  }

  private deserializeBrainForKey(key: string, json: unknown): IBrainDef | undefined {
    try {
      const brainDef = this.env.deserializeBrainJsonFromPlain(json, this.projectManager.activeProject!.manifest.id);
      if (brainDef.pages().size() === 0) {
        brainDef.appendNewPage();
      }
      return brainDef;
    } catch (err) {
      logger.warn(`Failed to load brain "${key}":`, err);
      return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Project metadata
  // ---------------------------------------------------------------------------

  async updateProjectMetadata(updates: Partial<Pick<ProjectManifest, "name" | "description">>): Promise<void> {
    await this.projectManager.updateActive(updates);
    syncManifestToMindcraftJson(this.projectFileSystem, this.projectManager.activeProject!.manifest);
  }

  /**
   * Apply an extensions-map change to the active project: persist the new map,
   * then re-resolve the project's extension dependency graph and re-materialize
   * the installed-extensions tree off the updated manifest, registering any
   * newly-reachable origin and tearing down any origin the change dropped.
   *
   * @param extensions - The active project's next extensions map, keyed by coordinate.
   */
  async updateProjectExtensions(extensions: Readonly<Record<string, string>>): Promise<void> {
    await this.projectManager.updateActive({ extensions });
    if (!this._compiler) {
      return;
    }
    const { dependencies, dependencyMounts } = this.resolveExtensions();
    this._compiler.compiler.setDependencies(dependencies, dependencyMounts);
    syncManifestToMindcraftJson(this.projectFileSystem, this.projectManager.activeProject!.manifest);
    this._compiler.replaceProjectFiles();
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
    // Compiles invalidate types per project namespace, so the outgoing
    // project's registrations must be cleared here or they outlive it.
    this.env.brainServices.runtime.types.removeUserTypes();
    this._lastUserTileMetadata = undefined;
    this.bumpDocRevision();
    this.teardownBridge();
  }

  private async completeProjectTransition(): Promise<void> {
    this.completeProjectUnload();
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
      servedFileSystem: this.servedProjectFileSystem,
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
