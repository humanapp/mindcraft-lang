import type { ProjectManifest } from "./project-manifest.js";
import type { WorkspaceSnapshot } from "./workspace-snapshot.js";

/**
 * Persistence layer for projects: their manifests, workspace snapshots, and
 * app-specific data. Implementations may be backed by IndexedDB, localStorage,
 * the file system, etc.
 */
export interface ProjectStore {
  /** Prefix used to scope this store's underlying storage keys. */
  readonly keyPrefix: string;

  /** List all known project manifests. */
  listProjects(): Promise<ProjectManifest[]>;
  /** Look up a single manifest by id. */
  getProject(id: string): Promise<ProjectManifest | undefined>;
  /** Create a new, empty project with the given display name. */
  createProject(name: string): Promise<ProjectManifest>;
  /** Delete the project, its workspace, and all associated app data. */
  deleteProject(id: string): Promise<void>;
  /** Patch the mutable fields of a project's manifest. */
  updateProject(
    id: string,
    updates: Partial<Pick<ProjectManifest, "name" | "description" | "thumbnailUrl">>
  ): Promise<void>;
  /** Create a copy of `id` (workspace and app data) under `newName`. */
  duplicateProject(id: string, newName: string): Promise<ProjectManifest>;

  /** Load the persisted workspace snapshot for `id`, or `undefined` if none. */
  loadWorkspace(id: string): Promise<WorkspaceSnapshot | undefined>;
  /** Persist `snapshot` as the workspace contents of `id`. */
  saveWorkspace(id: string, snapshot: WorkspaceSnapshot): Promise<void>;

  /** Load a per-project app-data value by key. */
  loadAppData(id: string, key: string): Promise<string | undefined>;
  /** Persist a per-project app-data value. */
  saveAppData(id: string, key: string, data: string): Promise<void>;
  /** Remove a per-project app-data entry. */
  deleteAppData(id: string, key: string): Promise<void>;

  /** Get the id of the project most recently marked active in this browser. */
  getActiveProjectId(): string | undefined;
  /** Record (or clear, when `id` is `undefined`) the active project. */
  setActiveProjectId(id: string | undefined): void;
}
