import {
  appHostError,
  DEFAULT_PROJECT_COLLECTION_ID,
  DEFAULT_PROJECT_COLLECTION_NAME,
  normalizeProjectCollectionName,
  type ProjectCollection,
  type ProjectFileSnapshot,
  type ProjectManifest,
  type ProjectStore,
} from "@mindcraft-lang/app-host";

/** In-memory ProjectStore implementation for app-host specs. */
export class MemoryProjectStore implements ProjectStore {
  readonly keyPrefix = "test-app";
  private projectCollections: ProjectCollection[] = [];
  private projects: ProjectManifest[] = [];
  private projectFiles = new Map<string, ProjectFileSnapshot>();
  private appData = new Map<string, string>();
  private activeId: string | undefined;

  async listProjectCollections(): Promise<ProjectCollection[]> {
    return this.projectCollections.filter((collection) => collection.deleted !== true);
  }

  async getProjectCollection(projectCollectionId: string): Promise<ProjectCollection | undefined> {
    return this.projectCollections.find(
      (collection) => collection.projectCollectionId === projectCollectionId && collection.deleted !== true
    );
  }

  async createProjectCollection(name: string): Promise<ProjectCollection> {
    const now = Date.now();
    const collection: ProjectCollection = {
      projectCollectionId: crypto.randomUUID(),
      name: normalizeProjectCollectionName(name),
      createdAt: now,
      updatedAt: now,
    };
    this.projectCollections.push(collection);
    return collection;
  }

  async updateProjectCollection(
    projectCollectionId: string,
    updates: Partial<Pick<ProjectCollection, "name">>
  ): Promise<void> {
    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) return;
    Object.assign(collection, {
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
    if (!collection) return;
    const now = Date.now();
    collection.deleted = true;
    collection.updatedAt = now;
    this.projects = this.projects.map((project) =>
      project.projectCollectionId === projectCollectionId && project.deleted !== true
        ? { ...project, deleted: true, updatedAt: now }
        : project
    );
  }

  async ensureDefaultProjectCollection(): Promise<ProjectCollection> {
    const existing = await this.getProjectCollection(DEFAULT_PROJECT_COLLECTION_ID);
    if (existing) return existing;
    const now = Date.now();
    const collection: ProjectCollection = {
      projectCollectionId: DEFAULT_PROJECT_COLLECTION_ID,
      name: DEFAULT_PROJECT_COLLECTION_NAME,
      createdAt: now,
      updatedAt: now,
    };
    this.projectCollections.push(collection);
    return collection;
  }

  async listProjects(projectCollectionId: string): Promise<ProjectManifest[]> {
    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) return [];
    return this.projects.filter(
      (project) => project.projectCollectionId === projectCollectionId && project.deleted !== true
    );
  }

  async getProject(id: string): Promise<ProjectManifest | undefined> {
    const project = this.projects.find((entry) => entry.id === id && entry.deleted !== true);
    if (!project) return undefined;
    const collection = await this.getProjectCollection(project.projectCollectionId);
    return collection ? project : undefined;
  }

  async createProject(projectCollectionId: string, name: string): Promise<ProjectManifest> {
    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) {
      throw appHostError("PROJECT_COLLECTION_NOT_FOUND", `Project collection not found: ${projectCollectionId}`);
    }
    const manifest: ProjectManifest = {
      id: `id-${this.projects.length + 1}`,
      projectCollectionId,
      name,
      description: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.projects.push(manifest);
    return manifest;
  }

  async deleteProject(id: string): Promise<void> {
    const idx = this.projects.findIndex((project) => project.id === id);
    if (idx === -1) {
      throw appHostError("PROJECT_NOT_FOUND", `Project not found: ${id}`);
    }
    const project = this.projects[idx];
    if (project.deleted === true) return;
    const collection = await this.getProjectCollection(project.projectCollectionId);
    if (!collection) {
      throw appHostError(
        "PROJECT_COLLECTION_NOT_FOUND",
        `Project collection not found: ${project.projectCollectionId}`
      );
    }
    this.projects[idx] = { ...project, deleted: true, updatedAt: Date.now() };
  }

  async updateProject(
    id: string,
    updates: Partial<Pick<ProjectManifest, "name" | "description" | "thumbnailUrl">>
  ): Promise<void> {
    const idx = this.projects.findIndex((project) => project.id === id);
    if (idx === -1) return;
    this.projects[idx] = { ...this.projects[idx], ...updates, updatedAt: Date.now() };
  }

  async duplicateProject(id: string, newName: string): Promise<ProjectManifest> {
    const source = await this.getProject(id);
    if (!source) {
      throw appHostError("PROJECT_NOT_FOUND", `Project not found: ${id}`);
    }
    const dup = await this.createProject(source.projectCollectionId, newName);
    const snapshot = this.projectFiles.get(id);
    if (snapshot) this.projectFiles.set(dup.id, new Map(snapshot));
    for (const [key, value] of this.appData) {
      if (key.startsWith(`${id}:`)) {
        this.appData.set(`${dup.id}:${key.slice(id.length + 1)}`, value);
      }
    }
    return dup;
  }

  async loadProjectFiles(id: string): Promise<ProjectFileSnapshot | undefined> {
    return this.projectFiles.get(id);
  }

  async saveProjectFiles(id: string, snapshot: ProjectFileSnapshot): Promise<void> {
    this.projectFiles.set(id, snapshot);
  }

  async loadAppData(id: string, key: string): Promise<string | undefined> {
    return this.appData.get(`${id}:${key}`);
  }

  async saveAppData(id: string, key: string, data: string): Promise<void> {
    this.appData.set(`${id}:${key}`, data);
  }

  async deleteAppData(id: string, key: string): Promise<void> {
    this.appData.delete(`${id}:${key}`);
  }

  getActiveProjectId(): string | undefined {
    return this.activeId;
  }

  setActiveProjectId(id: string | undefined): void {
    this.activeId = id;
  }
}
