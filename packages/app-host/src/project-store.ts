import type { ProjectCollection } from "./project-collection.js";
import type { ProjectFileSnapshot } from "./project-file-snapshot.js";
import type { ProjectManifest } from "./project-manifest.js";

/**
 * Persistence layer for project collections, project manifests, project file
 * snapshots, and app-specific data.
 */
export interface ProjectStore {
  /** Prefix used to scope this store's underlying storage keys. */
  readonly keyPrefix: string;

  /** List all non-deleted project collections. */
  listProjectCollections(): Promise<ProjectCollection[]>;
  /** Look up a non-deleted project collection by id. */
  getProjectCollection(projectCollectionId: string): Promise<ProjectCollection | undefined>;
  /** Create a project collection with the given display name. */
  createProjectCollection(name: string): Promise<ProjectCollection>;
  /** Patch the mutable fields of a project collection. */
  updateProjectCollection(
    projectCollectionId: string,
    updates: Partial<Pick<ProjectCollection, "name">>
  ): Promise<void>;
  /** Tombstone a project collection. */
  deleteProjectCollection(projectCollectionId: string): Promise<void>;
  /** Return the bootstrap project collection, creating it when needed. */
  ensureDefaultProjectCollection(): Promise<ProjectCollection>;

  /** List all non-deleted project manifests in one project collection. */
  listProjects(projectCollectionId: string): Promise<ProjectManifest[]>;
  /** Look up a single non-deleted manifest by id. */
  getProject(id: string): Promise<ProjectManifest | undefined>;
  /** Create a new, empty project in the given project collection. */
  createProject(projectCollectionId: string, name: string): Promise<ProjectManifest>;
  /** Tombstone the project manifest while preserving project files and app data. */
  deleteProject(id: string): Promise<void>;
  /** Patch the mutable fields of a project's manifest. */
  updateProject(
    id: string,
    updates: Partial<Pick<ProjectManifest, "name" | "description" | "thumbnailUrl">>
  ): Promise<void>;
  /** Create a copy of `id` (project files and app data) under `newName`. */
  duplicateProject(id: string, newName: string): Promise<ProjectManifest>;

  /** Load the persisted project file snapshot for `id`, or `undefined` if none. */
  loadProjectFiles(id: string): Promise<ProjectFileSnapshot | undefined>;
  /** Persist `snapshot` as the project file contents of `id`. */
  saveProjectFiles(id: string, snapshot: ProjectFileSnapshot): Promise<void>;

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
