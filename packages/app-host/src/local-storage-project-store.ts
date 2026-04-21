import { MINDCRAFT_JSON_PATH } from "./mindcraft-json.js";
import type { ProjectManifest } from "./project-manifest.js";
import type { ProjectStore } from "./project-store.js";
import type { WorkspaceEntry, WorkspaceSnapshot } from "./workspace-snapshot.js";

export function createLocalStorageProjectStore(keyPrefix: string): ProjectStore {
  return new LocalStorageProjectStore(keyPrefix);
}

class LocalStorageProjectStore implements ProjectStore {
  readonly keyPrefix: string;
  private readonly prefix: string;

  constructor(keyPrefix: string) {
    this.keyPrefix = keyPrefix;
    this.prefix = keyPrefix;
  }

  async listProjects(): Promise<ProjectManifest[]> {
    const ids = this.loadIndex();
    const manifests: ProjectManifest[] = [];
    for (const id of ids) {
      const manifest = this.loadMetadata(id);
      if (manifest) {
        manifests.push(manifest);
      }
    }
    return manifests;
  }

  async getProject(id: string): Promise<ProjectManifest | undefined> {
    if (!this.loadIndex().includes(id)) {
      return undefined;
    }
    return this.loadMetadata(id);
  }

  async createProject(name: string): Promise<ProjectManifest> {
    const manifest: ProjectManifest = {
      id: crypto.randomUUID(),
      name,
      description: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const ids = this.loadIndex();
    ids.push(manifest.id);
    this.saveIndex(ids);
    this.saveMetadata(manifest);
    return manifest;
  }

  async deleteProject(id: string): Promise<void> {
    const ids = this.loadIndex().filter((i) => i !== id);
    this.saveIndex(ids);
    localStorage.removeItem(this.key(`project:${id}:metadata`));
    localStorage.removeItem(this.key(`project:${id}:files`));
    localStorage.removeItem(this.key(`project:${id}:workspace`));
    this.removeAppDataKeys(id);

    const activeId = this.getActiveProjectId();
    if (activeId === id) {
      this.setActiveProjectId(undefined);
    }
  }

  async updateProject(id: string, updates: Partial<Pick<ProjectManifest, "name" | "description">>): Promise<void> {
    const manifest = this.loadMetadata(id);
    if (!manifest) {
      return;
    }
    this.saveMetadata({
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

    const appDataKeys = this.findAppDataKeys(id);
    for (const fullKey of appDataKeys) {
      const suffix = fullKey.slice(this.key(`project:${id}:app:`).length);
      const data = localStorage.getItem(fullKey);
      if (data !== null) {
        localStorage.setItem(this.key(`project:${newManifest.id}:app:${suffix}`), data);
      }
    }

    return newManifest;
  }

  async loadWorkspace(id: string): Promise<WorkspaceSnapshot | undefined> {
    let raw = localStorage.getItem(this.key(`project:${id}:files`));
    if (!raw) {
      const legacyKey = this.key(`project:${id}:workspace`);
      raw = localStorage.getItem(legacyKey);
      if (raw) {
        localStorage.setItem(this.key(`project:${id}:files`), raw);
        localStorage.removeItem(legacyKey);
      }
    }
    if (!raw) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as Array<[string, WorkspaceEntry]>;
      return new Map(parsed);
    } catch {
      return undefined;
    }
  }

  async saveWorkspace(id: string, snapshot: WorkspaceSnapshot): Promise<void> {
    snapshot.delete(MINDCRAFT_JSON_PATH);
    localStorage.setItem(this.key(`project:${id}:files`), JSON.stringify([...snapshot]));
    await this.touchProject(id);
  }

  async loadAppData(id: string, key: string): Promise<string | undefined> {
    return localStorage.getItem(this.key(`project:${id}:app:${key}`)) ?? undefined;
  }

  async saveAppData(id: string, key: string, data: string): Promise<void> {
    localStorage.setItem(this.key(`project:${id}:app:${key}`), data);
    await this.touchProject(id);
  }

  async deleteAppData(id: string, key: string): Promise<void> {
    localStorage.removeItem(this.key(`project:${id}:app:${key}`));
  }

  getActiveProjectId(): string | undefined {
    return (
      sessionStorage.getItem(this.key("active-project")) ??
      localStorage.getItem(this.key("active-project")) ??
      undefined
    );
  }

  setActiveProjectId(id: string | undefined): void {
    if (id === undefined) {
      sessionStorage.removeItem(this.key("active-project"));
      localStorage.removeItem(this.key("active-project"));
    } else {
      sessionStorage.setItem(this.key("active-project"), id);
      localStorage.setItem(this.key("active-project"), id);
    }
  }

  private key(suffix: string): string {
    return `${this.prefix}:${suffix}`;
  }

  private loadIndex(): string[] {
    const raw = localStorage.getItem(this.key("project-index"));
    if (!raw) {
      return [];
    }
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }

  private saveIndex(ids: string[]): void {
    localStorage.setItem(this.key("project-index"), JSON.stringify(ids));
  }

  private loadMetadata(id: string): ProjectManifest | undefined {
    const raw = localStorage.getItem(this.key(`project:${id}:metadata`));
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as ProjectManifest;
    } catch {
      return undefined;
    }
  }

  private saveMetadata(manifest: ProjectManifest): void {
    localStorage.setItem(this.key(`project:${manifest.id}:metadata`), JSON.stringify(manifest));
  }

  private async touchProject(id: string): Promise<void> {
    await this.updateProject(id, {});
  }

  private findAppDataKeys(projectId: string): string[] {
    const prefix = this.key(`project:${projectId}:app:`);
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) {
        keys.push(k);
      }
    }
    return keys;
  }

  private removeAppDataKeys(projectId: string): void {
    const keys = this.findAppDataKeys(projectId);
    for (const k of keys) {
      localStorage.removeItem(k);
    }
  }
}
