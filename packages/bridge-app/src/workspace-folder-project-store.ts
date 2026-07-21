import type {
  ProjectCollection,
  ProjectCollectionTabSession,
  ProjectContentManifest,
  ProjectFileChange,
  ProjectFileSnapshot,
  ProjectManifest,
  ProjectStore,
} from "@mindcraft-lang/app-host";
import {
  AppHostErrorCode,
  appHostError,
  applyProjectFileChangeToSnapshot,
  MINDCRAFT_JSON_PATH,
  parseProjectContentManifest,
  serializeProjectContentManifest,
} from "@mindcraft-lang/app-host";
import type { FileSystemNotification } from "@mindcraft-lang/bridge-protocol";
import type { InstalledExtensionSnapshots } from "./fetched-extension-snapshots.js";
import {
  INSTALLED_EXTENSIONS_APP_DATA_KEY,
  serializeInstalledExtensionSnapshots,
} from "./fetched-extension-snapshots.js";
import { toFileSystemNotification, toProjectFileChange } from "./project-file-bridge.js";

/** Project collection id of the single collection a workspace-folder store exposes. */
export const WORKSPACE_FOLDER_PROJECT_COLLECTION_ID = "workspace-folder";

/** Stable identifiers for workspace-folder store errors. */
export const WorkspaceFolderStoreErrorCode = {
  /** The host-provided `mindcraft.json` failed content-manifest validation. */
  INVALID_MANIFEST: "WORKSPACE_FOLDER_INVALID_MANIFEST",
  /** A multi-project or collection-management operation was invoked; a workspace folder holds exactly one project. */
  UNSUPPORTED_OPERATION: "WORKSPACE_FOLDER_UNSUPPORTED_OPERATION",
} as const;

/** Union of all {@link WorkspaceFolderStoreErrorCode} values. */
export type WorkspaceFolderStoreErrorCode =
  (typeof WorkspaceFolderStoreErrorCode)[keyof typeof WorkspaceFolderStoreErrorCode];

/** Error thrown by {@link WorkspaceFolderProjectStore}. */
export class WorkspaceFolderStoreError extends Error {
  /** Stable machine-readable error code. */
  readonly code: WorkspaceFolderStoreErrorCode;

  constructor(code: WorkspaceFolderStoreErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceFolderStoreError";
    this.code = code;
  }
}

/**
 * Translates between per-project app-data entries and the owning app's session
 * chunk stored in the manifest's `app` map.
 */
export interface FolderAppDataCodec {
  /**
   * Build the app chunk from the current app-data entries. Returns `undefined`
   * when the entries carry no chunk-worthy state; the chunk is then absent
   * from the manifest.
   */
  chunkFromAppData(appData: ReadonlyMap<string, string>): unknown;
  /** Translate an app chunk into app-data entries keyed by app-data key. */
  appDataFromChunk(chunk: unknown): Record<string, string>;
}

/** File operations the store issues against the host-owned project folder. */
export interface WorkspaceFolderRpc {
  /** Apply one file change to the project folder. Resolves when written. */
  sendChange(change: FileSystemNotification): Promise<void>;
  /** Replace the project's `mindcraft.json` with `content`. */
  writeManifest(content: string): Promise<void>;
  /** Read the project's file snapshot entries, excluding `mindcraft.json`. */
  loadFiles(): Promise<ProjectFileSnapshot>;
}

/** Options for {@link WorkspaceFolderProjectStore}. */
export interface WorkspaceFolderProjectStoreOptions {
  /** Transport performing the actual folder I/O. */
  rpc: WorkspaceFolderRpc;
  /** Stable opaque id of the host-provided project. */
  projectId: string;
  /** JSON text of the project's `mindcraft.json` as read from disk. */
  manifestContent: string;
  /** App name keying this app's chunk in the manifest's `app` map. */
  appName: string;
  /** Translator between app-data entries and this app's manifest chunk. */
  appDataCodec?: FolderAppDataCodec;
  /**
   * Installed fetched-extension snapshot records seeding the store's
   * installed-extensions app data, keyed by `<owner>/<repo>` origin. Loading
   * the project then regenerates the installed-extensions tree from these
   * records without reaching the network.
   */
  installedExtensionSnapshots?: InstalledExtensionSnapshots;
}

/** App-data key whose entries are stored as the manifest's `brains` chunk. */
const BRAINS_APP_DATA_KEY = "brains";

/** App-chunk map key inside the manifest's pass-through section. */
const APP_CHUNKS_EXTRA_KEY = "app";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRecord(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A {@link ProjectStore} over a host-owned workspace folder: the folder is the
 * single project of the store's single collection. File writes are
 * change-granular; the project manifest and its app data are stored inside the
 * folder's `mindcraft.json` (brains and app chunks in the pass-through
 * section, unknown fields preserved). Multi-project and collection-management
 * operations throw {@link WorkspaceFolderStoreError}.
 */
export class WorkspaceFolderProjectStore implements ProjectStore {
  readonly keyPrefix: string;

  private readonly rpc: WorkspaceFolderRpc;
  private readonly projectId: string;
  private readonly appName: string;
  private readonly appDataCodec: FolderAppDataCodec | undefined;
  private readonly collection: ProjectCollection;

  private base: ProjectContentManifest;
  private manifest: ProjectManifest;
  private readonly appData = new Map<string, string>();
  private chunkAppDataKeys: ReadonlySet<string> = new Set();
  private lastManifestContent: string;
  private mirror: ProjectFileSnapshot = new Map();

  constructor(options: WorkspaceFolderProjectStoreOptions) {
    this.keyPrefix = options.appName;
    this.rpc = options.rpc;
    this.projectId = options.projectId;
    this.appName = options.appName;
    this.appDataCodec = options.appDataCodec;
    this.lastManifestContent = options.manifestContent;

    const parsed = parseProjectContentManifest(options.manifestContent);
    if (!parsed.ok) {
      throw new WorkspaceFolderStoreError(
        WorkspaceFolderStoreErrorCode.INVALID_MANIFEST,
        `mindcraft.json is not a valid project manifest: ${parsed.errors[0]?.message ?? "unknown error"}`
      );
    }
    this.base = parsed.manifest;

    const now = Date.now();
    this.collection = {
      projectCollectionId: WORKSPACE_FOLDER_PROJECT_COLLECTION_ID,
      name: parsed.manifest.name,
      createdAt: now,
      updatedAt: now,
    };
    this.manifest = {
      id: this.projectId,
      projectCollectionId: WORKSPACE_FOLDER_PROJECT_COLLECTION_ID,
      name: parsed.manifest.name,
      version: parsed.manifest.version,
      description: parsed.manifest.description ?? "",
      ...(parsed.manifest.thumbnailUrl !== undefined ? { thumbnailUrl: parsed.manifest.thumbnailUrl } : {}),
      ...(Object.keys(parsed.manifest.extensions).length > 0 ? { extensions: parsed.manifest.extensions } : {}),
      ...(parsed.manifest.targets !== undefined ? { targets: parsed.manifest.targets } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.seedAppDataFromBase();
    if (options.installedExtensionSnapshots && Object.keys(options.installedExtensionSnapshots).length > 0) {
      this.appData.set(
        INSTALLED_EXTENSIONS_APP_DATA_KEY,
        serializeInstalledExtensionSnapshots(options.installedExtensionSnapshots)
      );
    }
  }

  /**
   * Absorb a change observed on disk outside the app: a `mindcraft.json`
   * write replaces the store's manifest and app-data state; any other change
   * updates the store's view of the folder. Returns the change in project
   * file form for the caller to apply to the live project file system.
   */
  absorbExternalChange(change: FileSystemNotification): ProjectFileChange {
    if (change.action === "write" && change.path === MINDCRAFT_JSON_PATH) {
      this.lastManifestContent = change.content;
      const parsed = parseProjectContentManifest(change.content);
      if (parsed.ok) {
        this.base = parsed.manifest;
        this.manifest = {
          id: this.manifest.id,
          projectCollectionId: this.manifest.projectCollectionId,
          name: parsed.manifest.name,
          version: parsed.manifest.version,
          description: parsed.manifest.description ?? "",
          ...(parsed.manifest.thumbnailUrl !== undefined ? { thumbnailUrl: parsed.manifest.thumbnailUrl } : {}),
          ...(Object.keys(parsed.manifest.extensions).length > 0 ? { extensions: parsed.manifest.extensions } : {}),
          ...(parsed.manifest.targets !== undefined ? { targets: parsed.manifest.targets } : {}),
          createdAt: this.manifest.createdAt,
          updatedAt: Date.now(),
        };
        this.seedAppDataFromBase();
      }
    } else {
      applyProjectFileChangeToSnapshot(this.mirror, toProjectFileChange(change));
    }
    return toProjectFileChange(change);
  }

  // -- Project collections (single fixed collection) --

  async listProjectCollections(): Promise<ProjectCollection[]> {
    return [this.collection];
  }

  async getProjectCollection(projectCollectionId: string): Promise<ProjectCollection | undefined> {
    return projectCollectionId === this.collection.projectCollectionId ? this.collection : undefined;
  }

  async createProjectCollection(): Promise<ProjectCollection> {
    throw this.unsupported("createProjectCollection");
  }

  async updateProjectCollection(): Promise<void> {
    throw this.unsupported("updateProjectCollection");
  }

  async deleteProjectCollection(): Promise<void> {
    throw this.unsupported("deleteProjectCollection");
  }

  async ensureDefaultProjectCollection(): Promise<ProjectCollection> {
    return this.collection;
  }

  // -- Projects (single fixed project) --

  async listProjects(projectCollectionId: string): Promise<ProjectManifest[]> {
    return projectCollectionId === this.collection.projectCollectionId ? [{ ...this.manifest }] : [];
  }

  async countProjectsByCollection(): Promise<Map<string, number>> {
    return new Map([[this.collection.projectCollectionId, 1]]);
  }

  async getProject(id: string): Promise<ProjectManifest | undefined> {
    return id === this.projectId ? { ...this.manifest } : undefined;
  }

  async createProject(): Promise<ProjectManifest> {
    throw this.unsupported("createProject");
  }

  async deleteProject(): Promise<void> {
    throw this.unsupported("deleteProject");
  }

  async updateProject(
    id: string,
    updates: Partial<
      Pick<ProjectManifest, "name" | "version" | "description" | "thumbnailUrl" | "extensions" | "targets">
    >
  ): Promise<void> {
    this.requireProject(id);
    this.manifest = { ...this.manifest, ...updates, updatedAt: Date.now() };
    await this.writeManifestIfChanged();
  }

  async duplicateProject(): Promise<ProjectManifest> {
    throw this.unsupported("duplicateProject");
  }

  async copyProjectToCollection(): Promise<ProjectManifest> {
    throw this.unsupported("copyProjectToCollection");
  }

  // -- Project files --

  async loadProjectFiles(id: string): Promise<ProjectFileSnapshot | undefined> {
    this.requireProject(id);
    const snapshot = await this.rpc.loadFiles();
    snapshot.delete(MINDCRAFT_JSON_PATH);
    this.mirror = new Map(snapshot);
    return new Map(snapshot);
  }

  async saveProjectFiles(id: string, snapshot: ProjectFileSnapshot): Promise<void> {
    this.requireProject(id);
    await this.writeSnapshotDiff(snapshot);
  }

  async applyProjectFileChanges(id: string, changes: readonly ProjectFileChange[]): Promise<void> {
    this.requireProject(id);
    for (const change of changes) {
      if (touchesManifestFile(change)) {
        continue;
      }
      if (change.action === "import") {
        const target: ProjectFileSnapshot = new Map(change.entries);
        await this.writeSnapshotDiff(target);
        continue;
      }
      await this.rpc.sendChange(toFileSystemNotification(change));
      applyProjectFileChangeToSnapshot(this.mirror, change);
    }
  }

  // -- App data (carried in the manifest's pass-through section) --

  async loadAppData(id: string, key: string): Promise<string | undefined> {
    this.requireProject(id);
    return this.appData.get(key);
  }

  async saveAppData(id: string, key: string, data: string): Promise<void> {
    this.requireProject(id);
    this.appData.set(key, data);
    await this.writeManifestIfChanged();
  }

  async deleteAppData(id: string, key: string): Promise<void> {
    this.requireProject(id);
    this.appData.delete(key);
    await this.writeManifestIfChanged();
  }

  // -- Tab session (fixed: the single folder project is always active) --

  getProjectSession(): ProjectCollectionTabSession | undefined {
    return {
      projectCollectionId: this.collection.projectCollectionId,
      activeProjectId: this.projectId,
    };
  }

  setProjectSession(): void {
    // The folder project is the session; there is nothing to persist.
  }

  // -- Internals --

  private unsupported(operation: string): WorkspaceFolderStoreError {
    return new WorkspaceFolderStoreError(
      WorkspaceFolderStoreErrorCode.UNSUPPORTED_OPERATION,
      `${operation} is not available for a workspace-folder project`
    );
  }

  private requireProject(id: string): void {
    if (id !== this.projectId) {
      throw appHostError(AppHostErrorCode.PROJECT_NOT_FOUND, `Project not found: ${id}`);
    }
  }

  private seedAppDataFromBase(): void {
    for (const key of this.chunkAppDataKeys) {
      this.appData.delete(key);
    }
    const brains = this.base.extras?.brains;
    if (isRecord(brains) && Object.keys(brains).length > 0) {
      this.appData.set(BRAINS_APP_DATA_KEY, JSON.stringify(brains));
    } else {
      this.appData.delete(BRAINS_APP_DATA_KEY);
    }
    if (!this.appDataCodec) {
      this.chunkAppDataKeys = new Set();
      return;
    }
    const appChunks = this.base.extras?.[APP_CHUNKS_EXTRA_KEY];
    const ownChunk = isRecord(appChunks) ? appChunks[this.appName] : undefined;
    const entries = ownChunk !== undefined ? this.appDataCodec.appDataFromChunk(ownChunk) : {};
    for (const [key, value] of Object.entries(entries)) {
      this.appData.set(key, value);
    }
    this.chunkAppDataKeys = new Set(Object.keys(entries));
  }

  private composeManifestContent(): string {
    const extras: Record<string, unknown> = { ...(this.base.extras ?? {}) };

    const brains = parseRecord(this.appData.get(BRAINS_APP_DATA_KEY));
    if (brains && Object.keys(brains).length > 0) {
      extras.brains = brains;
    } else {
      delete extras.brains;
    }

    const appChunks: Record<string, unknown> = isRecord(extras[APP_CHUNKS_EXTRA_KEY])
      ? { ...(extras[APP_CHUNKS_EXTRA_KEY] as Record<string, unknown>) }
      : {};
    const ownChunk = this.appDataCodec?.chunkFromAppData(this.appData);
    if (ownChunk !== undefined) {
      appChunks[this.appName] = ownChunk;
    } else {
      delete appChunks[this.appName];
    }
    if (Object.keys(appChunks).length > 0) {
      extras[APP_CHUNKS_EXTRA_KEY] = appChunks;
    } else {
      delete extras[APP_CHUNKS_EXTRA_KEY];
    }

    const content: ProjectContentManifest = {
      name: this.manifest.name,
      version: this.manifest.version,
      ...(this.base.identity !== undefined ? { identity: this.base.identity } : {}),
      description: this.manifest.description,
      ...(this.manifest.thumbnailUrl !== undefined ? { thumbnailUrl: this.manifest.thumbnailUrl } : {}),
      extensions: this.manifest.extensions ?? {},
      ...(this.base.files !== undefined ? { files: this.base.files } : {}),
      ...(this.base.ambient !== undefined ? { ambient: this.base.ambient } : {}),
      ...(this.base.targets !== undefined ? { targets: this.base.targets } : {}),
      ...(Object.keys(extras).length > 0 ? { extras } : {}),
    };
    return serializeProjectContentManifest(content);
  }

  private async writeManifestIfChanged(): Promise<void> {
    const content = this.composeManifestContent();
    if (content === this.lastManifestContent) {
      return;
    }
    await this.rpc.writeManifest(content);
    this.lastManifestContent = content;
  }

  private async writeSnapshotDiff(target: ProjectFileSnapshot): Promise<void> {
    const changes = diffSnapshotChanges(this.mirror, target);
    for (const change of changes) {
      await this.rpc.sendChange(change);
    }
    const next: ProjectFileSnapshot = new Map();
    for (const [path, entry] of target) {
      if (path !== MINDCRAFT_JSON_PATH) {
        next.set(path, entry);
      }
    }
    this.mirror = next;
  }
}

function touchesManifestFile(change: ProjectFileChange): boolean {
  switch (change.action) {
    case "write":
    case "delete":
    case "mkdir":
    case "rmdir":
      return change.path === MINDCRAFT_JSON_PATH;
    case "rename":
      return change.oldPath === MINDCRAFT_JSON_PATH || change.newPath === MINDCRAFT_JSON_PATH;
    case "import":
      return false;
  }
}

/**
 * Compute the change-granular writes that bring `mirror` (the store's view of
 * the folder) to `target`. The `mindcraft.json` entry is ignored on both
 * sides; removals under a removed directory are covered by its `rmdir`.
 */
function diffSnapshotChanges(mirror: ProjectFileSnapshot, target: ProjectFileSnapshot): FileSystemNotification[] {
  const changes: FileSystemNotification[] = [];

  for (const [path, entry] of target) {
    if (path === MINDCRAFT_JSON_PATH) {
      continue;
    }
    const current = mirror.get(path);
    if (entry.kind === "directory") {
      if (!current) {
        changes.push({ action: "mkdir", path });
      }
      continue;
    }
    if (!current || current.kind !== "file" || current.content !== entry.content) {
      changes.push({
        action: "write",
        path,
        content: entry.content,
        newEtag: entry.etag,
        ...(current?.kind === "file" ? { expectedEtag: current.etag } : {}),
      });
    }
  }

  const removedPaths = [...mirror.keys()].filter((path) => path !== MINDCRAFT_JSON_PATH && !target.has(path)).sort();
  const removedDirectories: string[] = [];
  for (const path of removedPaths) {
    if (removedDirectories.some((directory) => path.startsWith(`${directory}/`))) {
      continue;
    }
    const entry = mirror.get(path);
    if (entry?.kind === "directory") {
      // A directory absent from the target as an entry may still parent
      // target files; only an empty subtree is removed.
      const prefix = `${path}/`;
      let hasTargetDescendant = false;
      for (const targetPath of target.keys()) {
        if (targetPath.startsWith(prefix)) {
          hasTargetDescendant = true;
          break;
        }
      }
      if (hasTargetDescendant) {
        continue;
      }
      changes.push({ action: "rmdir", path });
      removedDirectories.push(path);
    } else if (entry) {
      changes.push({ action: "delete", path, expectedEtag: entry.etag });
    }
  }

  return changes;
}
