import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { appHostError } from "./app-host-error.js";
import { MINDCRAFT_JSON_PATH } from "./mindcraft-json.js";
import {
  DEFAULT_PROJECT_COLLECTION_ID,
  DEFAULT_PROJECT_COLLECTION_NAME,
  normalizeProjectCollectionName,
  type ProjectCollection,
} from "./project-collection.js";
import type { ProjectFileSnapshot, ProjectFileSystemEntry } from "./project-file-snapshot.js";
import type { ProjectManifest } from "./project-manifest.js";
import type { ProjectCollectionTabSession, ProjectStore } from "./project-store.js";

interface ProjectDbSchema extends DBSchema {
  projectCollections: {
    key: string;
    value: ProjectCollection;
  };
  projects: {
    key: string;
    value: ProjectManifest;
  };
  files: {
    key: string;
    value: Array<[string, ProjectFileSystemEntry]>;
  };
  appData: {
    key: string;
    value: string;
  };
}

type LegacyProjectManifest = Omit<ProjectManifest, "projectCollectionId"> & {
  projectCollectionId?: string;
};

const DB_VERSION = 4;

function dbName(keyPrefix: string): string {
  return `${keyPrefix}-projects`;
}

function appDataKey(projectId: string, key: string): string {
  return `${projectId}:${key}`;
}

function isLiveProjectCollection(collection: ProjectCollection): boolean {
  return collection.deleted !== true;
}

function isLiveProject(project: ProjectManifest): boolean {
  return project.deleted !== true;
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && error.name === "ConstraintError";
}

/**
 * Create a {@link ProjectStore} backed by IndexedDB.
 *
 * @param keyPrefix - Used to derive the IndexedDB database name and the
 *   `sessionStorage` key that tracks the current tab's project session.
 */
export async function createIdbProjectStore(keyPrefix: string): Promise<ProjectStore> {
  let migrateWorkspacesToFiles: Map<string, Array<[string, ProjectFileSystemEntry]>> | undefined;

  const db = await openDB<ProjectDbSchema>(dbName(keyPrefix), DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore("projects", { keyPath: "id" });
        db.createObjectStore("files");
        db.createObjectStore("appData");
      }
      if (oldVersion >= 1 && oldVersion < 2) {
        const oldStore = tx.objectStore("workspaces" as never);
        const allKeys = await oldStore.getAllKeys();
        const pending = new Map<string, Array<[string, ProjectFileSystemEntry]>>();
        for (const key of allKeys) {
          const value = await oldStore.get(key);
          if (value) pending.set(key as string, value as Array<[string, ProjectFileSystemEntry]>);
        }
        migrateWorkspacesToFiles = pending;
        db.deleteObjectStore("workspaces" as never);
        db.createObjectStore("files");
      }
      if (oldVersion < 3) {
        db.createObjectStore("projectCollections", { keyPath: "projectCollectionId" });
      }
      if (oldVersion < 4) {
        const projectStore = tx.objectStore("projects");
        const projects = (await projectStore.getAll()) as LegacyProjectManifest[];
        const projectsWithoutCollection = projects.filter((project) => project.projectCollectionId === undefined);

        if (projectsWithoutCollection.length > 0) {
          const collectionStore = tx.objectStore("projectCollections");
          const existingDefault = await collectionStore.get(DEFAULT_PROJECT_COLLECTION_ID);
          if (!existingDefault) {
            const now = Date.now();
            await collectionStore.add({
              projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
              name: DEFAULT_PROJECT_COLLECTION_NAME,
              createdAt: now,
              updatedAt: now,
            });
          }

          for (const project of projectsWithoutCollection) {
            await projectStore.put({
              ...project,
              projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
            });
          }
        }
      }
    },
  });

  if (migrateWorkspacesToFiles) {
    const tx = db.transaction("files", "readwrite");
    for (const [key, value] of migrateWorkspacesToFiles) {
      await tx.store.put(value, key);
    }
    await tx.done;
  }

  return new IdbProjectStore(keyPrefix, db);
}

class IdbProjectStore implements ProjectStore {
  readonly keyPrefix: string;
  private readonly db: IDBPDatabase<ProjectDbSchema>;

  constructor(keyPrefix: string, db: IDBPDatabase<ProjectDbSchema>) {
    this.keyPrefix = keyPrefix;
    this.db = db;
  }

  async listProjectCollections(): Promise<ProjectCollection[]> {
    return this.listLiveProjectCollections();
  }

  async getProjectCollection(projectCollectionId: string): Promise<ProjectCollection | undefined> {
    const collection = await this.db.get("projectCollections", projectCollectionId);
    if (!collection || !isLiveProjectCollection(collection)) {
      return undefined;
    }
    return collection;
  }

  async createProjectCollection(name: string): Promise<ProjectCollection> {
    const now = Date.now();
    const collection: ProjectCollection = {
      projectCollectionId: crypto.randomUUID(),
      name: normalizeProjectCollectionName(name),
      createdAt: now,
      updatedAt: now,
    };
    await this.db.add("projectCollections", collection);
    return collection;
  }

  async updateProjectCollection(
    projectCollectionId: string,
    updates: Partial<Pick<ProjectCollection, "name" | "pinVerifier">>
  ): Promise<void> {
    const collection = await this.requireLiveProjectCollection(projectCollectionId);
    const hasPinVerifierUpdate = Object.hasOwn(updates, "pinVerifier");
    const pinVerifier = hasPinVerifierUpdate ? updates.pinVerifier : collection.pinVerifier;
    const updatedCollection: ProjectCollection = {
      ...collection,
      ...updates,
      name: updates.name === undefined ? collection.name : normalizeProjectCollectionName(updates.name),
      updatedAt: Date.now(),
    };
    if (pinVerifier === undefined) {
      delete updatedCollection.pinVerifier;
    } else {
      updatedCollection.pinVerifier = pinVerifier;
    }
    await this.db.put("projectCollections", updatedCollection);
  }

  async deleteProjectCollection(projectCollectionId: string): Promise<void> {
    if (projectCollectionId === DEFAULT_PROJECT_COLLECTION_ID) {
      throw appHostError("DEFAULT_PROJECT_COLLECTION_DELETE_BLOCKED", "Cannot delete the default workspace");
    }

    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) {
      return;
    }
    const now = Date.now();
    const tx = this.db.transaction(["projectCollections", "projects"], "readwrite");
    await tx.objectStore("projectCollections").put({
      ...collection,
      deleted: true,
      updatedAt: now,
    });

    const projectStore = tx.objectStore("projects");
    const projects = await projectStore.getAll();
    for (const project of projects) {
      if (project.projectCollectionId === projectCollectionId && isLiveProject(project)) {
        await projectStore.put({
          ...project,
          deleted: true,
          updatedAt: now,
        });
      }
    }
    await tx.done;
  }

  async ensureDefaultProjectCollection(): Promise<ProjectCollection> {
    const existing = await this.getProjectCollection(DEFAULT_PROJECT_COLLECTION_ID);
    if (existing) {
      return existing;
    }

    const now = Date.now();
    const collection: ProjectCollection = {
      projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
      name: DEFAULT_PROJECT_COLLECTION_NAME,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.db.add("projectCollections", collection);
      return collection;
    } catch (error) {
      if (!isConstraintError(error)) {
        throw error;
      }
      const inserted = await this.getProjectCollection(DEFAULT_PROJECT_COLLECTION_ID);
      if (inserted) {
        return inserted;
      }
      throw error;
    }
  }

  async listProjects(projectCollectionId: string): Promise<ProjectManifest[]> {
    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) {
      return [];
    }
    const projects = await this.db.getAll("projects");
    return projects.filter((project) => project.projectCollectionId === projectCollectionId && isLiveProject(project));
  }

  async countProjectsByCollection(): Promise<Map<string, number>> {
    const liveCollectionIds = new Set(
      (await this.listLiveProjectCollections()).map((collection) => collection.projectCollectionId)
    );
    const counts = new Map<string, number>();
    for (const project of await this.db.getAll("projects")) {
      if (isLiveProject(project) && liveCollectionIds.has(project.projectCollectionId)) {
        counts.set(project.projectCollectionId, (counts.get(project.projectCollectionId) ?? 0) + 1);
      }
    }
    return counts;
  }

  private async requireLiveProjectCollection(projectCollectionId: string): Promise<ProjectCollection> {
    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) {
      throw appHostError("PROJECT_COLLECTION_NOT_FOUND", `Workspace not found: ${projectCollectionId}`);
    }
    return collection;
  }

  async getProject(id: string): Promise<ProjectManifest | undefined> {
    const project = await this.db.get("projects", id);
    if (!project || !isLiveProject(project)) {
      return undefined;
    }
    const collection = await this.getProjectCollection(project.projectCollectionId);
    if (!collection) {
      return undefined;
    }
    return project;
  }

  async createProject(projectCollectionId: string, name: string): Promise<ProjectManifest> {
    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) {
      throw appHostError("PROJECT_COLLECTION_NOT_FOUND", `Workspace not found: ${projectCollectionId}`);
    }

    const now = Date.now();
    const manifest: ProjectManifest = {
      id: crypto.randomUUID(),
      projectCollectionId,
      name,
      description: "",
      createdAt: now,
      updatedAt: now,
    };
    await this.db.put("projects", manifest);
    return manifest;
  }

  async deleteProject(id: string): Promise<void> {
    const project = await this.db.get("projects", id);
    if (!project) {
      throw appHostError("PROJECT_NOT_FOUND", `Project not found: ${id}`);
    }
    if (!isLiveProject(project)) {
      return;
    }
    const collection = await this.getProjectCollection(project.projectCollectionId);
    if (!collection) {
      throw appHostError("PROJECT_COLLECTION_NOT_FOUND", `Workspace not found: ${project.projectCollectionId}`);
    }

    await this.db.put("projects", {
      ...project,
      deleted: true,
      updatedAt: Date.now(),
    });
  }

  async updateProject(
    id: string,
    updates: Partial<Pick<ProjectManifest, "name" | "description" | "thumbnailUrl">>
  ): Promise<void> {
    const manifest = await this.requireLiveProject(id);
    await this.db.put("projects", {
      ...manifest,
      ...updates,
      updatedAt: Date.now(),
    });
  }

  private async requireLiveProject(id: string): Promise<ProjectManifest> {
    const manifest = await this.db.get("projects", id);
    if (!manifest) {
      throw appHostError("PROJECT_NOT_FOUND", `Project not found: ${id}`);
    }
    if (!isLiveProject(manifest)) {
      throw appHostError("PROJECT_NOT_FOUND", `Project not found: ${id}`);
    }
    const collection = await this.getProjectCollection(manifest.projectCollectionId);
    if (!collection) {
      throw appHostError("PROJECT_COLLECTION_NOT_FOUND", `Workspace not found: ${manifest.projectCollectionId}`);
    }
    return manifest;
  }

  async duplicateProject(id: string, newName: string): Promise<ProjectManifest> {
    const source = await this.getProject(id);
    if (!source) {
      throw appHostError("PROJECT_NOT_FOUND", `Project not found: ${id}`);
    }

    const newManifest = await this.createProject(source.projectCollectionId, newName);

    const projectFiles = await this.loadProjectFiles(id);
    if (projectFiles) {
      await this.saveProjectFiles(newManifest.id, projectFiles);
    }

    const allKeys = await this.db.getAllKeys("appData");
    const prefix = `${id}:`;
    for (const key of allKeys) {
      if (typeof key === "string" && key.startsWith(prefix)) {
        const suffix = key.slice(prefix.length);
        const data = await this.db.get("appData", key);
        if (data !== undefined) {
          await this.db.put("appData", data, appDataKey(newManifest.id, suffix));
        }
      }
    }

    return newManifest;
  }

  async loadProjectFiles(id: string): Promise<ProjectFileSnapshot | undefined> {
    const entries = await this.db.get("files", id);
    if (!entries) {
      return undefined;
    }
    return new Map(entries);
  }

  async saveProjectFiles(id: string, snapshot: ProjectFileSnapshot): Promise<void> {
    await this.requireLiveProject(id);
    snapshot.delete(MINDCRAFT_JSON_PATH);
    await this.db.put("files", [...snapshot], id);
    await this.updateProject(id, {});
  }

  async loadAppData(id: string, key: string): Promise<string | undefined> {
    return this.db.get("appData", appDataKey(id, key));
  }

  async saveAppData(id: string, key: string, data: string): Promise<void> {
    await this.requireLiveProject(id);
    await this.db.put("appData", data, appDataKey(id, key));
    await this.updateProject(id, {});
  }

  async deleteAppData(id: string, key: string): Promise<void> {
    await this.db.delete("appData", appDataKey(id, key));
  }

  getProjectSession(): ProjectCollectionTabSession | undefined {
    if (typeof sessionStorage === "undefined") {
      return undefined;
    }
    const raw = sessionStorage.getItem(`${this.keyPrefix}:project-session`);
    if (!raw) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<ProjectCollectionTabSession>;
      if (
        typeof parsed.projectCollectionId === "string" &&
        (parsed.activeProjectId === undefined || typeof parsed.activeProjectId === "string")
      ) {
        return {
          projectCollectionId: parsed.projectCollectionId,
          ...(parsed.activeProjectId === undefined ? {} : { activeProjectId: parsed.activeProjectId }),
        };
      }
    } catch {
      sessionStorage.removeItem(`${this.keyPrefix}:project-session`);
    }
    return undefined;
  }

  setProjectSession(session: ProjectCollectionTabSession | undefined): void {
    if (typeof sessionStorage === "undefined") {
      return;
    }
    const key = `${this.keyPrefix}:project-session`;
    if (session === undefined) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, JSON.stringify(session));
  }

  private async listLiveProjectCollections(): Promise<ProjectCollection[]> {
    const collections = await this.db.getAll("projectCollections");
    return collections.filter(isLiveProjectCollection);
  }
}
