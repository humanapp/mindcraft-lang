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
import type { ProjectStore } from "./project-store.js";

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
 *   `localStorage`/`sessionStorage` keys that track the active project.
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
    updates: Partial<Pick<ProjectCollection, "name">>
  ): Promise<void> {
    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) {
      return;
    }
    await this.db.put("projectCollections", {
      ...collection,
      ...updates,
      name: updates.name === undefined ? collection.name : normalizeProjectCollectionName(updates.name),
      updatedAt: Date.now(),
    });
  }

  async deleteProjectCollection(projectCollectionId: string): Promise<void> {
    if (projectCollectionId === DEFAULT_PROJECT_COLLECTION_ID) {
      throw appHostError("DEFAULT_PROJECT_COLLECTION_DELETE_BLOCKED", "Cannot delete the default project collection");
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
      throw appHostError("PROJECT_COLLECTION_NOT_FOUND", `Project collection not found: ${projectCollectionId}`);
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
      throw appHostError(
        "PROJECT_COLLECTION_NOT_FOUND",
        `Project collection not found: ${project.projectCollectionId}`
      );
    }

    await this.db.put("projects", {
      ...project,
      deleted: true,
      updatedAt: Date.now(),
    });

    const activeId = this.getActiveProjectId();
    if (activeId === id) {
      this.setActiveProjectId(undefined);
    }
  }

  async updateProject(
    id: string,
    updates: Partial<Pick<ProjectManifest, "name" | "description" | "thumbnailUrl">>
  ): Promise<void> {
    const manifest = await this.db.get("projects", id);
    if (!manifest) {
      return;
    }
    await this.db.put("projects", {
      ...manifest,
      ...updates,
      updatedAt: Date.now(),
    });
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
    snapshot.delete(MINDCRAFT_JSON_PATH);
    await this.db.put("files", [...snapshot], id);
    await this.updateProject(id, {});
  }

  async loadAppData(id: string, key: string): Promise<string | undefined> {
    return this.db.get("appData", appDataKey(id, key));
  }

  async saveAppData(id: string, key: string, data: string): Promise<void> {
    await this.db.put("appData", data, appDataKey(id, key));
    await this.updateProject(id, {});
  }

  async deleteAppData(id: string, key: string): Promise<void> {
    await this.db.delete("appData", appDataKey(id, key));
  }

  getActiveProjectId(): string | undefined {
    return (
      (typeof sessionStorage === "undefined"
        ? undefined
        : sessionStorage.getItem(`${this.keyPrefix}:active-project`)) ??
      (typeof localStorage === "undefined" ? undefined : localStorage.getItem(`${this.keyPrefix}:active-project`)) ??
      undefined
    );
  }

  setActiveProjectId(id: string | undefined): void {
    if (id === undefined) {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(`${this.keyPrefix}:active-project`);
      }
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(`${this.keyPrefix}:active-project`);
      }
    } else {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(`${this.keyPrefix}:active-project`, id);
      }
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(`${this.keyPrefix}:active-project`, id);
      }
    }
  }

  private async listLiveProjectCollections(): Promise<ProjectCollection[]> {
    const collections = await this.db.getAll("projectCollections");
    return collections.filter(isLiveProjectCollection);
  }
}
