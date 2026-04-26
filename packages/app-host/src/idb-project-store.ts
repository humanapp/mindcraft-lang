import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { MINDCRAFT_JSON_PATH } from "./mindcraft-json.js";
import type { ProjectManifest } from "./project-manifest.js";
import type { ProjectStore } from "./project-store.js";
import type { WorkspaceEntry, WorkspaceSnapshot } from "./workspace-snapshot.js";

interface ProjectDbSchema extends DBSchema {
  projects: {
    key: string;
    value: ProjectManifest;
  };
  files: {
    key: string;
    value: Array<[string, WorkspaceEntry]>;
  };
  appData: {
    key: string;
    value: string;
  };
}

const DB_VERSION = 2;

function dbName(keyPrefix: string): string {
  return `${keyPrefix}-projects`;
}

function appDataKey(projectId: string, key: string): string {
  return `${projectId}:${key}`;
}

/**
 * Create a {@link ProjectStore} backed by IndexedDB.
 *
 * @param keyPrefix - Used to derive the IndexedDB database name and the
 *   `localStorage`/`sessionStorage` keys that track the active project.
 */
export async function createIdbProjectStore(keyPrefix: string): Promise<ProjectStore> {
  let migrateWorkspacesToFiles: Map<string, Array<[string, WorkspaceEntry]>> | undefined;

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
        const pending = new Map<string, Array<[string, WorkspaceEntry]>>();
        for (const key of allKeys) {
          const value = await oldStore.get(key);
          if (value) pending.set(key as string, value as Array<[string, WorkspaceEntry]>);
        }
        migrateWorkspacesToFiles = pending;
        db.deleteObjectStore("workspaces" as never);
        db.createObjectStore("files");
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

  async listProjects(): Promise<ProjectManifest[]> {
    return this.db.getAll("projects");
  }

  async getProject(id: string): Promise<ProjectManifest | undefined> {
    return this.db.get("projects", id);
  }

  async createProject(name: string): Promise<ProjectManifest> {
    const manifest: ProjectManifest = {
      id: crypto.randomUUID(),
      name,
      description: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.db.put("projects", manifest);
    return manifest;
  }

  async deleteProject(id: string): Promise<void> {
    const tx = this.db.transaction(["projects", "files", "appData"], "readwrite");
    await tx.objectStore("projects").delete(id);
    await tx.objectStore("files").delete(id);

    const appStore = tx.objectStore("appData");
    const allKeys = await appStore.getAllKeys();
    const prefix = `${id}:`;
    for (const key of allKeys) {
      if (typeof key === "string" && key.startsWith(prefix)) {
        await appStore.delete(key);
      }
    }
    await tx.done;

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
      throw new Error(`Project not found: ${id}`);
    }

    const newManifest = await this.createProject(newName);

    const workspace = await this.loadWorkspace(id);
    if (workspace) {
      await this.saveWorkspace(newManifest.id, workspace);
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

  async loadWorkspace(id: string): Promise<WorkspaceSnapshot | undefined> {
    const entries = await this.db.get("files", id);
    if (!entries) {
      return undefined;
    }
    return new Map(entries);
  }

  async saveWorkspace(id: string, snapshot: WorkspaceSnapshot): Promise<void> {
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
      sessionStorage.getItem(`${this.keyPrefix}:active-project`) ??
      localStorage.getItem(`${this.keyPrefix}:active-project`) ??
      undefined
    );
  }

  setActiveProjectId(id: string | undefined): void {
    if (id === undefined) {
      sessionStorage.removeItem(`${this.keyPrefix}:active-project`);
      localStorage.removeItem(`${this.keyPrefix}:active-project`);
    } else {
      sessionStorage.setItem(`${this.keyPrefix}:active-project`, id);
      localStorage.setItem(`${this.keyPrefix}:active-project`, id);
    }
  }
}
