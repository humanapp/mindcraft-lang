import type {
  ExtensionAddInputResolution,
  ExtensionFetchResult,
  ExtensionFetchTransport,
  ExtensionUpdateApplication,
  ExtensionUpdateCheck,
  ProjectCollectionProjectCommitResult,
  ProjectCollectionUnlockResult,
  ProjectFileSystem,
  ProjectManifest,
  UnstableDependency,
} from "@mindcraft-lang/app-host";
import {
  checkExtensionReferenceUpdate,
  collectUnstableDependencies,
  diffMindcraftJsonToManifest,
  ExtensionFetchErrorCode,
  fetchExtensionSnapshot,
  MINDCRAFT_JSON_PATH,
  type ProjectManager,
  parseExtensionAddInput,
  parseProjectContentManifest,
  resolveExtensionAddInput,
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
import type { EmbeddedExtension, FetchedExtensionContentMap, ResolvedExtensions } from "./embedded-extensions.js";
import { ExtensionResolutionCycleError, resolveProjectExtensions } from "./embedded-extensions.js";
import type { ExtensionFetchFailures } from "./extension-catalog.js";
import type { ExtensionInstallReport, ProjectDiagnosticsState } from "./extension-install.js";
import { collectExtensionFetchClosure, diffProjectDiagnostics, typecheckBrainProblems } from "./extension-install.js";
import type { ExtensionInstallLogEvent } from "./extension-install-log.js";
import {
  appendExtensionInstallLog,
  EXTENSION_INSTALL_LOG_APP_DATA_KEY,
  parseExtensionInstallLog,
} from "./extension-install-log.js";
import type { InstalledExtensionSnapshot, InstalledExtensionSnapshots } from "./fetched-extension-snapshots.js";
import {
  decodeInstalledSnapshotFiles,
  fetchedContentFromSnapshots,
  INSTALLED_EXTENSIONS_APP_DATA_KEY,
  parseInstalledExtensionSnapshots,
  serializeInstalledExtensionSnapshots,
} from "./fetched-extension-snapshots.js";
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
   * Transport used to fetch remote (`gh:`) extension content at install time.
   * When omitted, an install transaction needing a fetch refuses as
   * unreachable; already-installed fetched extensions still load from their
   * stored snapshots.
   */
  extensionFetchTransport?: ExtensionFetchTransport;

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
  private readonly extensionFetchTransport: ExtensionFetchTransport | undefined;
  private readonly onDidCompileCallback?: (
    result: WorkspaceCompileResult,
    tileResult: UserTileApplyResult | undefined
  ) => void;

  // -- Installed fetched-extension snapshots (persisted in the project store) --
  private _installedSnapshots: InstalledExtensionSnapshots = {};
  private _installedContent: FetchedExtensionContentMap = new Map();

  // -- Last recorded fetch failure per reference (seeded from the install log) --
  private _fetchFailures = new Map<string, { code: string; message: string }>();

  // -- Latest workspace compile result --
  private _lastCompileResult: WorkspaceCompileResult | undefined;

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
    this.extensionFetchTransport = options.extensionFetchTransport;
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
    await this.initCompiler();
    await this.loadBrainsFromProject();
  }

  // ---------------------------------------------------------------------------
  // Compilation (always available, independent of bridge)
  // ---------------------------------------------------------------------------

  /**
   * Resolve the active project's extension dependency graph against the host's
   * embed record and the project's stored fetched snapshots. Logs any conflict
   * warnings. On this load path a dependency cycle is logged and resolution
   * falls back to no extension dependencies, so the project still loads and
   * unresolved imports surface as ordinary compiler diagnostics; an install
   * transaction refuses on a cycle instead.
   */
  private resolveExtensions(): ResolvedExtensions {
    try {
      const resolved = resolveProjectExtensions(this.projectManager.activeProject!.manifest.extensions, {
        embedded: this.embeddedExtensions,
        fetched: this._installedContent,
      });
      for (const warning of resolved.warnings) {
        logger.warn(`[extension-resolution] ${warning.message}`);
      }
      return resolved;
    } catch (err) {
      if (err instanceof ExtensionResolutionCycleError) {
        logger.warn(`[extension-resolution] ${err.message}`);
        return { dependencies: [], dependencyMounts: [], origins: [], warnings: [] };
      }
      throw err;
    }
  }

  /** Replace the project's installed snapshot records, in memory and in the project store. */
  private async persistInstalledSnapshots(snapshots: InstalledExtensionSnapshots): Promise<void> {
    this._installedSnapshots = snapshots;
    this._installedContent = fetchedContentFromSnapshots(snapshots);
    await this.projectManager.saveAppData(
      INSTALLED_EXTENSIONS_APP_DATA_KEY,
      serializeInstalledExtensionSnapshots(snapshots)
    );
  }

  private async initCompiler(): Promise<void> {
    // The installed-extensions tree regenerates from the stored snapshots;
    // loading a project never reaches the network.
    this._installedSnapshots = parseInstalledExtensionSnapshots(
      await this.projectManager.loadAppData(INSTALLED_EXTENSIONS_APP_DATA_KEY)
    );
    this._installedContent = fetchedContentFromSnapshots(this._installedSnapshots);
    this._fetchFailures = new Map();
    for (const event of parseExtensionInstallLog(
      await this.projectManager.loadAppData(EXTENSION_INSTALL_LOG_APP_DATA_KEY)
    )) {
      if (event.kind === "fetch-refusal") {
        this._fetchFailures.set(event.reference, { code: event.code, message: event.message });
      }
    }
    const { dependencies, dependencyMounts } = this.resolveExtensions();
    this._compiler = createProjectCompiler({
      environment: this.env,
      filesystem: this.projectFileSystem,
      projectNamespace: this.projectManager.activeProject!.manifest.id,
      mounts: this.mounts,
      dependencies,
      dependencyMounts,
      onDidCompile: (result) => {
        this._lastCompileResult = result;
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

  /** The installed fetched-extension content available to the active project, keyed by reference. */
  get installedExtensionContent(): FetchedExtensionContentMap {
    return this._installedContent;
  }

  /** The last recorded fetch failure per reference, keyed by the reference string as written. */
  get extensionFetchFailures(): ExtensionFetchFailures {
    return this._fetchFailures;
  }

  /** Fetch one `gh:` reference's snapshot through the host's transport. */
  private fetchSnapshot(reference: string): Promise<ExtensionFetchResult> {
    if (!this.extensionFetchTransport) {
      return Promise.resolve({
        ok: false,
        error: {
          code: ExtensionFetchErrorCode.UNREACHABLE,
          reference,
          message: "The host application provides no extension fetch transport.",
        },
      });
    }
    return fetchExtensionSnapshot(reference, this.extensionFetchTransport);
  }

  /** Materialize a resolution: dependencies, `mindcraft.json`, and a recompile of the whole workspace. */
  private applyResolution(resolution: ResolvedExtensions): void {
    if (!this._compiler) {
      return;
    }
    this._compiler.compiler.setDependencies(resolution.dependencies, resolution.dependencyMounts);
    syncManifestToMindcraftJson(this.projectFileSystem, this.projectManager.activeProject!.manifest);
    this._compiler.replaceProjectFiles();
  }

  /** Rewrite `mindcraft.json` from the store manifest, restoring the file after a refused transaction. */
  private resyncManifestFile(): void {
    const active = this.projectManager.activeProject;
    if (active) {
      syncManifestToMindcraftJson(this.projectFileSystem, active.manifest);
    }
  }

  /**
   * The active project's diagnostic state: the latest workspace compile's
   * per-file diagnostics plus a fresh typecheck of every cached brain.
   */
  private captureProjectDiagnostics(): ProjectDiagnosticsState {
    const files = this._lastCompileResult?.files ?? new Map<string, never>();
    const brains = new Map<string, readonly string[]>();
    for (const [key, brain] of this._brainCache) {
      brains.set(key, typecheckBrainProblems(brain));
    }
    return { files, brains };
  }

  /** Append the transaction's events to the project's install log. */
  private async appendInstallLogEvents(events: readonly ExtensionInstallLogEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const raw = await this.projectManager.loadAppData(EXTENSION_INSTALL_LOG_APP_DATA_KEY);
    await this.projectManager.saveAppData(EXTENSION_INSTALL_LOG_APP_DATA_KEY, appendExtensionInstallLog(raw, events));
  }

  /**
   * The install and remove events between two resolved closures, plus the new
   * resolution's warnings. An origin present in both closures records an
   * install event when its winning reference or installed specifier changed
   * (an update).
   */
  private installLogEventsForChange(
    previous: ResolvedExtensions,
    next: ResolvedExtensions,
    previousSnapshots: InstalledExtensionSnapshots,
    nextSnapshots: InstalledExtensionSnapshots
  ): ExtensionInstallLogEvent[] {
    const at = Date.now();
    const previousByOrigin = new Map(previous.origins.map((origin) => [origin.origin, origin]));
    const nextOrigins = new Set(next.origins.map((origin) => origin.origin));
    const events: ExtensionInstallLogEvent[] = [];
    for (const origin of next.origins) {
      const specifier = nextSnapshots[origin.origin]?.specifier;
      const before = previousByOrigin.get(origin.origin);
      if (
        before !== undefined &&
        before.reference === origin.reference &&
        previousSnapshots[origin.origin]?.specifier === specifier
      ) {
        continue;
      }
      events.push({
        kind: "install",
        at,
        origin: origin.origin,
        reference: origin.reference,
        ...(specifier !== undefined ? { specifier } : {}),
      });
    }
    for (const origin of previous.origins) {
      if (!nextOrigins.has(origin.origin)) {
        events.push({ kind: "remove", at, origin: origin.origin });
      }
    }
    for (const warning of next.warnings) {
      events.push({ kind: "resolution-warning", at, warning });
    }
    return events;
  }

  /**
   * Apply an extensions-map change to the active project as one transaction:
   * fetch content for every newly reachable `gh:` reference, resolve the
   * transitive dependency graph, then commit -- persist the manifest entries
   * and the fetched snapshots, re-materialize the installed-extensions tree,
   * recompile the workspace, and re-typecheck the project's brains -- and
   * report the diagnostic difference against the pre-change baseline.
   *
   * Improved, unchanged, and worsened outcomes all commit; a worsened report
   * carries a one-step undo. The transaction refuses outright only on
   * mechanics failures -- an unreachable source, a missing or unparseable
   * manifest, a missing listed file, or a dependency cycle -- leaving the
   * project unchanged. Every commit appends its install, remove, and
   * resolution-warning events to the project's install log.
   *
   * @param extensions - The active project's next extensions map, keyed by coordinate.
   * @param options.refetchReferences - References fetched fresh even when a stored snapshot matches.
   */
  async updateProjectExtensions(
    extensions: Readonly<Record<string, string>>,
    options?: { refetchReferences?: ReadonlySet<string> }
  ): Promise<ExtensionInstallReport> {
    const previousExtensions = this.projectManager.activeProject!.manifest.extensions ?? {};
    const previousSnapshots = this._installedSnapshots;
    const previousResolution = this.resolveExtensions();
    const baseline = this.captureProjectDiagnostics();

    const closure = await collectExtensionFetchClosure({
      extensions,
      embedded: this.embeddedExtensions,
      stored: previousSnapshots,
      refetch: options?.refetchReferences,
      fetchSnapshot: (reference) => this.fetchSnapshot(reference),
    });
    if (!closure.ok) {
      this.resyncManifestFile();
      this._fetchFailures.set(closure.error.reference, {
        code: closure.error.code,
        message: closure.error.message,
      });
      await this.appendInstallLogEvents([
        {
          kind: "fetch-refusal",
          at: Date.now(),
          reference: closure.error.reference,
          code: closure.error.code,
          message: closure.error.message,
        },
      ]);
      return { committed: false, refusal: { kind: "fetch", error: closure.error } };
    }

    const fetchedContent = new Map<string, ReadonlyMap<string, string>>();
    for (const [reference, record] of closure.snapshotsByReference) {
      fetchedContent.set(reference, decodeInstalledSnapshotFiles(record));
    }
    let resolution: ResolvedExtensions;
    try {
      resolution = resolveProjectExtensions(extensions, {
        embedded: this.embeddedExtensions,
        fetched: fetchedContent,
      });
    } catch (err) {
      if (err instanceof ExtensionResolutionCycleError) {
        this.resyncManifestFile();
        return { committed: false, refusal: { kind: "cycle", cycle: err.cycle, message: err.message } };
      }
      throw err;
    }

    // Commit. Snapshot records persist for exactly the fetched origins in the
    // resolved closure; records for origins the change dropped are pruned.
    const nextSnapshots: Record<string, InstalledExtensionSnapshot> = {};
    for (const origin of resolution.origins) {
      const record = closure.snapshotsByReference.get(origin.reference);
      if (record) {
        nextSnapshots[origin.origin] = record;
      }
    }
    await this.projectManager.updateActive({ extensions });
    await this.persistInstalledSnapshots(nextSnapshots);
    for (const reference of closure.snapshotsByReference.keys()) {
      this._fetchFailures.delete(reference);
    }
    this.applyResolution(resolution);

    const outcome = diffProjectDiagnostics(baseline, this.captureProjectDiagnostics());
    await this.appendInstallLogEvents(
      this.installLogEventsForChange(previousResolution, resolution, previousSnapshots, nextSnapshots)
    );

    if (outcome.kind !== "worsened") {
      return { committed: true, outcome, warnings: resolution.warnings };
    }
    return {
      committed: true,
      outcome,
      warnings: resolution.warnings,
      undo: async () => {
        await this.projectManager.updateActive({ extensions: previousExtensions });
        await this.persistInstalledSnapshots(previousSnapshots);
        this.applyResolution(this.resolveExtensions());
        await this.appendInstallLogEvents([{ kind: "undo", at: Date.now() }]);
      },
    };
  }

  /**
   * Normalize add-by-reference input to an installable extension reference: a
   * complete reference, an `<owner>/<repo>` coordinate, or a GitHub repository
   * URL. Input naming a repository without a version resolves to the
   * repository's latest published version through the host's transport. Fails
   * with a stable code when the input is unrecognized, no version can be
   * resolved, or the host has no transport to resolve one through.
   *
   * @param input - The pasted add-field text.
   */
  async resolveExtensionInstallInput(input: string): Promise<ExtensionAddInputResolution> {
    if (this.extensionFetchTransport) {
      return resolveExtensionAddInput(input, this.extensionFetchTransport);
    }
    const parsed = parseExtensionAddInput(input);
    switch (parsed.kind) {
      case "reference":
        return { ok: true, reference: parsed.reference };
      case "coordinate":
        return {
          ok: false,
          code: ExtensionFetchErrorCode.UNREACHABLE,
          message: "The host application provides no extension fetch transport.",
        };
      case "invalid":
        return { ok: false, code: parsed.code, message: parsed.message };
    }
  }

  /**
   * Check one installed fetched dependency of the active project for a newer
   * version at its source: a `@<pin>` reference against the source's published
   * versions, a `#<branch>` reference against the branch's head commit. The
   * check runs on request, reaches the source through the host's transport,
   * and changes nothing.
   *
   * @param coordinate - The dependency's `<owner>/<repo>` coordinate in the project's extensions map.
   */
  async checkExtensionUpdate(coordinate: string): Promise<ExtensionUpdateCheck> {
    const reference = this.projectManager.activeProject!.manifest.extensions?.[coordinate];
    const record = this._installedSnapshots[coordinate];
    if (reference === undefined || record === undefined || record.reference !== reference) {
      return {
        ok: false,
        error: {
          code: ExtensionFetchErrorCode.INVALID_REFERENCE,
          reference: reference ?? coordinate,
          message: `"${coordinate}" is not an installed fetched dependency of the active project.`,
        },
      };
    }
    if (!this.extensionFetchTransport) {
      return {
        ok: false,
        error: {
          code: ExtensionFetchErrorCode.UNREACHABLE,
          reference,
          message: "The host application provides no extension fetch transport.",
        },
      };
    }
    const manifestContent = decodeInstalledSnapshotFiles(record).get(`/${MINDCRAFT_JSON_PATH}`);
    const parsed = manifestContent !== undefined ? parseProjectContentManifest(manifestContent) : undefined;
    return checkExtensionReferenceUpdate({
      reference,
      installedSpecifier: record.specifier,
      installedVersion: parsed?.ok ? parsed.manifest.version : "0.0.0",
      transport: this.extensionFetchTransport,
    });
  }

  /**
   * Apply one or more dependency updates to the active project as a single
   * install transaction with one outcome: each update's coordinate takes its
   * new reference in the extensions map, and each updated reference is fetched
   * fresh, never satisfied from its stored snapshot. The report, the
   * worsened-with-undo behavior, and the install log are those of
   * {@link updateProjectExtensions}.
   *
   * @param updates - The updates to apply, as returned by update checks.
   */
  async applyExtensionUpdates(updates: readonly ExtensionUpdateApplication[]): Promise<ExtensionInstallReport> {
    const next: Record<string, string> = { ...(this.projectManager.activeProject!.manifest.extensions ?? {}) };
    const refetchReferences = new Set<string>();
    for (const update of updates) {
      next[update.coordinate] = update.reference;
      refetchReferences.add(update.reference);
    }
    return this.updateProjectExtensions(next, { refetchReferences });
  }

  /**
   * Collect the active project's dependencies that are not stable for
   * consumers: branch references, and pinned references whose content the
   * project has no installed snapshot for. Exporting or publishing such a
   * project should ask for confirmation first.
   */
  async collectUnstableProjectDependencies(): Promise<readonly UnstableDependency[]> {
    const extensions = this.projectManager.activeProject!.manifest.extensions ?? {};
    return collectUnstableDependencies(extensions, async (owner, repo, pin) =>
      this._installedContent.has(`gh:${owner}/${repo}@${pin}`)
    );
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
    this._installedSnapshots = {};
    this._installedContent = new Map();
    this._fetchFailures = new Map();
    this._lastCompileResult = undefined;
    this.bumpDocRevision();
    this.teardownBridge();
  }

  private async completeProjectTransition(): Promise<void> {
    this.completeProjectUnload();
    await this.initCompiler();
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

  /**
   * Apply a project file change observed outside the app (a folder-session
   * external edit): applies it to the project file system and the workspace
   * compiler, recompiles, and absorbs any `mindcraft.json` manifest change.
   */
  applyExternalProjectFileChange(change: ProjectFileChange): void {
    this.projectFileSystem.applyRemoteChange(change);
    if (this._compiler) {
      this._compiler.compiler.applyWorkspaceChange(change);
      this._compiler.compiler.compile();
    }
    this.handleRemoteProjectFileChange(change);
  }

  /**
   * Absorb a project file change made by a remote peer: bumps the VFS
   * revision, and a `mindcraft.json` write is diffed against the active
   * manifest -- an extensions change runs through the install transaction and
   * the remaining synced fields patch the manifest. The change itself must
   * already be applied to the project file system.
   */
  handleRemoteProjectFileChange(change: ProjectFileChange): void {
    this.bumpVfsRevision();
    if (change.action === "write" && change.path === MINDCRAFT_JSON_PATH && this.projectManager.activeProject) {
      const patch = diffMindcraftJsonToManifest(change.content, this.projectManager.activeProject.manifest);
      if (patch) {
        // An extensions change flows through the install transaction, the
        // same pipeline the extension browser uses; the remaining synced
        // fields patch the manifest directly.
        const { extensions, ...rest } = patch;
        if (extensions !== undefined) {
          void this.updateProjectExtensions(extensions);
        }
        if (Object.keys(rest).length > 0) {
          void this.projectManager.updateActive(rest);
        }
      }
    }
  }

  private wireBridgeState(bridge: AppBridge): void {
    this._bridgeStateUnsub?.();
    this._remoteChangeUnsub?.();
    this._bridgeStateUnsub = bridge.onStateChange(() => {
      this.applyBridgeSnapshot(bridge);
    });
    this._remoteChangeUnsub = bridge.onRemoteChange((change: ProjectFileChange) => {
      this.handleRemoteProjectFileChange(change);
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
