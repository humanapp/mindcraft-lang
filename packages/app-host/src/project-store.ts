import type { ProjectCollection } from "./project-collection.js";
import type { ProjectFileSnapshot } from "./project-file-snapshot.js";
import type { ProjectManifest } from "./project-manifest.js";

/** Tab-scoped project collection and project restore state. */
export interface ProjectCollectionTabSession {
  /** Project collection selected in the current tab. */
  readonly projectCollectionId: string;
  /** Project selected in the current tab, when one is open. */
  readonly activeProjectId?: string;
}

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
  /** Create a project collection with a trimmed, non-empty display name. */
  createProjectCollection(name: string): Promise<ProjectCollection>;
  /** Patch the mutable fields of a project collection. Names are trimmed and validated. */
  updateProjectCollection(
    projectCollectionId: string,
    updates: Partial<Pick<ProjectCollection, "name" | "pinVerifier">>
  ): Promise<void>;
  /** Tombstone a project collection. */
  deleteProjectCollection(projectCollectionId: string): Promise<void>;
  /** Return the bootstrap project collection, creating it when needed. */
  ensureDefaultProjectCollection(): Promise<ProjectCollection>;

  /** List all non-deleted project manifests in one project collection. */
  listProjects(projectCollectionId: string): Promise<ProjectManifest[]>;
  /** Count non-deleted projects for each non-deleted project collection. */
  countProjectsByCollection(): Promise<Map<string, number>>;
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
  /** Copy project content into another project collection under `newName`. */
  copyProjectToCollection(
    sourceProjectId: string,
    targetProjectCollectionId: string,
    newName: string
  ): Promise<ProjectManifest>;

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

  /** Read the current tab's selected project collection and project. */
  getProjectSession(): ProjectCollectionTabSession | undefined;
  /** Store or clear the current tab's selected project collection and project. */
  setProjectSession(session: ProjectCollectionTabSession | undefined): void;
}
