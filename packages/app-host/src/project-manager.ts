import type { LocalStorageWorkspaceOptions } from "./local-storage-workspace.js";
import { createLocalStorageWorkspace } from "./local-storage-workspace.js";
import type { ProjectLock, ProjectLockHandle } from "./project-lock.js";
import type { ProjectManifest } from "./project-manifest.js";
import type { ProjectStore } from "./project-store.js";
import type { WorkspaceAdapter } from "./workspace-adapter.js";

export interface ActiveProject {
  readonly manifest: ProjectManifest;
  readonly workspace: WorkspaceAdapter;
}

export interface ProjectManagerOptions {
  workspaceOptions?: Omit<LocalStorageWorkspaceOptions, "storageKey">;
  lock?: ProjectLock;
}

export class ProjectManager {
  private readonly store: ProjectStore;
  private readonly workspaceOptions: Omit<LocalStorageWorkspaceOptions, "storageKey">;
  private readonly lock: ProjectLock | undefined;
  private readonly activeProjectListeners = new Set<(project: ActiveProject | undefined) => void>();
  private readonly projectListListeners = new Set<(projects: ProjectManifest[]) => void>();
  private currentActive: ActiveProject | undefined;
  private currentLockHandle: ProjectLockHandle | undefined;

  constructor(store: ProjectStore, options?: ProjectManagerOptions) {
    this.store = store;
    this.workspaceOptions = options?.workspaceOptions ?? {};
    this.lock = options?.lock;
  }

  async init(): Promise<void> {
    const activeId = this.store.getActiveProjectId();
    if (activeId) {
      const manifest = this.store.getProject(activeId);
      if (manifest) {
        const handle = await this.acquireLock(manifest.id);
        if (handle) {
          this.currentLockHandle = handle;
          this.currentActive = this.openInternal(manifest);
        }
      }
    }
  }

  get projects(): ProjectManifest[] {
    return this.store.listProjects();
  }

  get activeProject(): ActiveProject | undefined {
    return this.currentActive;
  }

  async create(name: string): Promise<ProjectManifest> {
    const manifest = this.store.createProject(name);
    this.notifyProjectList();
    await this.open(manifest.id);
    return manifest;
  }

  async open(id: string): Promise<ActiveProject> {
    const result = await this.tryOpen(id);
    if (!result) {
      throw new Error("Project is already open in another tab");
    }
    return result;
  }

  private async tryOpen(id: string): Promise<ActiveProject | undefined> {
    const manifest = this.store.getProject(id);
    if (!manifest) {
      throw new Error(`Project not found: ${id}`);
    }

    const handle = await this.acquireLock(id);
    if (!handle) {
      return undefined;
    }

    if (this.currentActive) {
      this.closeInternal();
    }

    this.currentLockHandle = handle;
    const active = this.openInternal(manifest);
    this.currentActive = active;
    this.store.setActiveProjectId(id);
    this.notifyActiveProject();
    return active;
  }

  close(): void {
    if (!this.currentActive) {
      return;
    }
    this.closeInternal();
    this.currentActive = undefined;
    this.store.setActiveProjectId(undefined);
    this.notifyActiveProject();
  }

  delete(id: string): void {
    if (this.currentActive?.manifest.id === id) {
      throw new Error("Cannot delete the active project");
    }
    this.store.deleteProject(id);
    this.notifyProjectList();
  }

  duplicate(id: string, newName: string): ProjectManifest {
    const manifest = this.store.duplicateProject(id, newName);
    this.notifyProjectList();
    return manifest;
  }

  updateActive(updates: Partial<Pick<ProjectManifest, "name" | "description">>): void {
    if (!this.currentActive) {
      throw new Error("No active project");
    }
    const id = this.currentActive.manifest.id;
    this.store.updateProject(id, updates);
    const updated = this.store.getProject(id);
    if (updated) {
      this.currentActive = { manifest: updated, workspace: this.currentActive.workspace };
      this.notifyActiveProject();
      this.notifyProjectList();
    }
  }

  async ensureDefaultProject(defaultName: string): Promise<ActiveProject> {
    if (this.currentActive) {
      return this.currentActive;
    }
    const existing = this.store.listProjects();
    for (const project of existing) {
      const result = await this.tryOpen(project.id);
      if (result) {
        return result;
      }
    }
    await this.create(defaultName);
    return this.currentActive!;
  }

  saveAppData(key: string, data: string): void {
    if (!this.currentActive) {
      throw new Error("No active project");
    }
    this.store.saveAppData(this.currentActive.manifest.id, key, data);
  }

  loadAppData(key: string): string | undefined {
    if (!this.currentActive) {
      return undefined;
    }
    return this.store.loadAppData(this.currentActive.manifest.id, key);
  }

  deleteAppData(key: string): void {
    if (!this.currentActive) {
      throw new Error("No active project");
    }
    this.store.deleteAppData(this.currentActive.manifest.id, key);
  }

  onActiveProjectChange(listener: (project: ActiveProject | undefined) => void): () => void {
    this.activeProjectListeners.add(listener);
    return () => {
      this.activeProjectListeners.delete(listener);
    };
  }

  onProjectListChange(listener: (projects: ProjectManifest[]) => void): () => void {
    this.projectListListeners.add(listener);
    return () => {
      this.projectListListeners.delete(listener);
    };
  }

  private async acquireLock(id: string): Promise<ProjectLockHandle | undefined> {
    if (!this.lock) {
      return { release() {} };
    }
    return this.lock.tryAcquire(id);
  }

  private openInternal(manifest: ProjectManifest): ActiveProject {
    const snapshot = this.store.loadWorkspace(manifest.id);
    const workspace = createLocalStorageWorkspace({
      storageKey: `${this.store.keyPrefix}:project:${manifest.id}:workspace-live`,
      ...this.workspaceOptions,
    });

    if (snapshot) {
      workspace.applyRemoteChange({
        action: "import",
        entries: Array.from(snapshot),
      });
    }

    return { manifest, workspace };
  }

  private closeInternal(): void {
    if (!this.currentActive) {
      return;
    }
    const { manifest, workspace } = this.currentActive;
    workspace.flush();
    this.store.saveWorkspace(manifest.id, workspace.exportSnapshot());
    this.currentLockHandle?.release();
    this.currentLockHandle = undefined;
  }

  private notifyActiveProject(): void {
    for (const listener of this.activeProjectListeners) {
      listener(this.currentActive);
    }
  }

  private notifyProjectList(): void {
    const projects = this.store.listProjects();
    for (const listener of this.projectListListeners) {
      listener(projects);
    }
  }
}
