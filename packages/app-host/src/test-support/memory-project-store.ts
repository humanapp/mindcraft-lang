import {
  AppHostErrorCode,
  appHostError,
  DEFAULT_PROJECT_COLLECTION_ID,
  DEFAULT_PROJECT_COLLECTION_NAME,
  normalizeProjectCollectionName,
  type ProjectCollection,
  type ProjectCollectionTabSession,
  type ProjectFileSnapshot,
  type ProjectManifest,
  type ProjectStore,
} from "@mindcraft-lang/app-host";

interface MemoryProjectStoreData {
  projectCollections: ProjectCollection[];
  projects: ProjectManifest[];
  projectFiles: Map<string, ProjectFileSnapshot>;
  appData: Map<string, string>;
}

function createMemoryProjectStoreData(): MemoryProjectStoreData {
  return {
    projectCollections: [],
    projects: [],
    projectFiles: new Map(),
    appData: new Map(),
  };
}

/** In-memory ProjectStore implementation for app-host specs. */
export class MemoryProjectStore implements ProjectStore {
  readonly keyPrefix: string;
  private readonly data: MemoryProjectStoreData;
  private projectSession: ProjectCollectionTabSession | undefined;

  constructor(keyPrefix = "test-app", data: MemoryProjectStoreData = createMemoryProjectStoreData()) {
    this.keyPrefix = keyPrefix;
    this.data = data;
  }

  /** Create another tab-scoped store instance over the same project data. */
  cloneForNewTab(): MemoryProjectStore {
    return new MemoryProjectStore(this.keyPrefix, this.data);
  }

  async listProjectCollections(): Promise<ProjectCollection[]> {
    return this.data.projectCollections.filter((collection) => collection.deleted !== true);
  }

  async getProjectCollection(projectCollectionId: string): Promise<ProjectCollection | undefined> {
    return this.data.projectCollections.find(
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
    this.data.projectCollections.push(collection);
    return collection;
  }

  async updateProjectCollection(
    projectCollectionId: string,
    updates: Partial<Pick<ProjectCollection, "name" | "pinVerifier">>
  ): Promise<void> {
    const collection = await this.requireLiveProjectCollection(projectCollectionId);
    const hasPinVerifierUpdate = Object.hasOwn(updates, "pinVerifier");
    const pinVerifier = hasPinVerifierUpdate ? updates.pinVerifier : collection.pinVerifier;
    Object.assign(collection, {
      ...updates,
      name: updates.name === undefined ? collection.name : normalizeProjectCollectionName(updates.name),
      updatedAt: Date.now(),
    });
    if (pinVerifier === undefined) {
      delete collection.pinVerifier;
    } else {
      collection.pinVerifier = pinVerifier;
    }
  }

  async deleteProjectCollection(projectCollectionId: string): Promise<void> {
    if (projectCollectionId === DEFAULT_PROJECT_COLLECTION_ID) {
      throw appHostError(
        AppHostErrorCode.DEFAULT_PROJECT_COLLECTION_DELETE_BLOCKED,
        "Cannot delete the default workspace"
      );
    }
    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) return;
    const now = Date.now();
    collection.deleted = true;
    collection.updatedAt = now;
    this.data.projects = this.data.projects.map((project) =>
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
    this.data.projectCollections.push(collection);
    return collection;
  }

  async listProjects(projectCollectionId: string): Promise<ProjectManifest[]> {
    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) return [];
    return this.data.projects.filter(
      (project) => project.projectCollectionId === projectCollectionId && project.deleted !== true
    );
  }

  async countProjectsByCollection(): Promise<Map<string, number>> {
    const liveCollectionIds = new Set(
      (await this.listProjectCollections()).map((collection) => collection.projectCollectionId)
    );
    const counts = new Map<string, number>();
    for (const project of this.data.projects) {
      if (project.deleted !== true && liveCollectionIds.has(project.projectCollectionId)) {
        counts.set(project.projectCollectionId, (counts.get(project.projectCollectionId) ?? 0) + 1);
      }
    }
    return counts;
  }

  private async requireLiveProjectCollection(projectCollectionId: string): Promise<ProjectCollection> {
    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) {
      throw appHostError(AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND, `Workspace not found: ${projectCollectionId}`);
    }
    return collection;
  }

  async getProject(id: string): Promise<ProjectManifest | undefined> {
    const project = this.data.projects.find((entry) => entry.id === id && entry.deleted !== true);
    if (!project) return undefined;
    const collection = await this.getProjectCollection(project.projectCollectionId);
    return collection ? project : undefined;
  }

  async createProject(projectCollectionId: string, name: string): Promise<ProjectManifest> {
    const collection = await this.getProjectCollection(projectCollectionId);
    if (!collection) {
      throw appHostError(AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND, `Workspace not found: ${projectCollectionId}`);
    }
    const manifest: ProjectManifest = {
      id: `id-${this.data.projects.length + 1}`,
      projectCollectionId,
      name,
      description: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.projects.push(manifest);
    return manifest;
  }

  async deleteProject(id: string): Promise<void> {
    const idx = this.data.projects.findIndex((project) => project.id === id);
    if (idx === -1) {
      throw appHostError(AppHostErrorCode.PROJECT_NOT_FOUND, `Project not found: ${id}`);
    }
    const project = this.data.projects[idx];
    if (project.deleted === true) return;
    const collection = await this.getProjectCollection(project.projectCollectionId);
    if (!collection) {
      throw appHostError(
        AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND,
        `Workspace not found: ${project.projectCollectionId}`
      );
    }
    this.data.projects[idx] = { ...project, deleted: true, updatedAt: Date.now() };
  }

  async updateProject(
    id: string,
    updates: Partial<Pick<ProjectManifest, "name" | "description" | "thumbnailUrl">>
  ): Promise<void> {
    await this.requireLiveProject(id);
    const idx = this.data.projects.findIndex((project) => project.id === id);
    this.data.projects[idx] = { ...this.data.projects[idx], ...updates, updatedAt: Date.now() };
  }

  async duplicateProject(id: string, newName: string): Promise<ProjectManifest> {
    const source = await this.getProject(id);
    if (!source) {
      throw appHostError(AppHostErrorCode.PROJECT_NOT_FOUND, `Project not found: ${id}`);
    }
    const dup = await this.createProjectFromSource(source, source.projectCollectionId, newName);
    this.copyProjectContent(id, dup.id);
    return dup;
  }

  async copyProjectToCollection(
    sourceProjectId: string,
    targetProjectCollectionId: string,
    newName: string
  ): Promise<ProjectManifest> {
    const source = await this.requireLiveProject(sourceProjectId);
    await this.requireLiveProjectCollection(targetProjectCollectionId);
    const copy = await this.createProjectFromSource(source, targetProjectCollectionId, newName);
    this.copyProjectContent(sourceProjectId, copy.id);
    return copy;
  }

  private async createProjectFromSource(
    source: ProjectManifest,
    targetProjectCollectionId: string,
    newName: string
  ): Promise<ProjectManifest> {
    const now = Date.now();
    const manifest: ProjectManifest = {
      id: `id-${this.data.projects.length + 1}`,
      projectCollectionId: targetProjectCollectionId,
      name: newName,
      description: source.description,
      ...(source.thumbnailUrl === undefined ? {} : { thumbnailUrl: source.thumbnailUrl }),
      createdAt: now,
      updatedAt: now,
    };
    this.data.projects.push(manifest);
    return manifest;
  }

  private copyProjectContent(sourceProjectId: string, targetProjectId: string): void {
    const snapshot = this.data.projectFiles.get(sourceProjectId);
    if (snapshot) this.data.projectFiles.set(targetProjectId, new Map(snapshot));
    for (const [key, value] of this.data.appData) {
      if (key.startsWith(`${sourceProjectId}:`)) {
        this.data.appData.set(`${targetProjectId}:${key.slice(sourceProjectId.length + 1)}`, value);
      }
    }
  }

  async loadProjectFiles(id: string): Promise<ProjectFileSnapshot | undefined> {
    return this.data.projectFiles.get(id);
  }

  async saveProjectFiles(id: string, snapshot: ProjectFileSnapshot): Promise<void> {
    await this.requireLiveProject(id);
    this.data.projectFiles.set(id, snapshot);
  }

  async loadAppData(id: string, key: string): Promise<string | undefined> {
    return this.data.appData.get(`${id}:${key}`);
  }

  async saveAppData(id: string, key: string, data: string): Promise<void> {
    await this.requireLiveProject(id);
    this.data.appData.set(`${id}:${key}`, data);
  }

  async deleteAppData(id: string, key: string): Promise<void> {
    this.data.appData.delete(`${id}:${key}`);
  }

  getProjectSession(): ProjectCollectionTabSession | undefined {
    return this.projectSession;
  }

  setProjectSession(session: ProjectCollectionTabSession | undefined): void {
    this.projectSession = session;
  }

  private async requireLiveProject(id: string): Promise<ProjectManifest> {
    const project = this.data.projects.find((entry) => entry.id === id);
    if (!project || project.deleted === true) {
      throw appHostError(AppHostErrorCode.PROJECT_NOT_FOUND, `Project not found: ${id}`);
    }
    const collection = await this.getProjectCollection(project.projectCollectionId);
    if (!collection) {
      throw appHostError(
        AppHostErrorCode.PROJECT_COLLECTION_NOT_FOUND,
        `Workspace not found: ${project.projectCollectionId}`
      );
    }
    return project;
  }
}
