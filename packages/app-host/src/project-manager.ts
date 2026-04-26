import type { InMemoryWorkspaceOptions } from "./in-memory-workspace.js";
import { createInMemoryWorkspace } from "./in-memory-workspace.js";
import type { ProjectLock, ProjectLockHandle } from "./project-lock.js";
import type { ProjectManifest } from "./project-manifest.js";
import type { ProjectStore } from "./project-store.js";
import type { WorkspaceAdapter } from "./workspace-adapter.js";
import type { WorkspaceSnapshot } from "./workspace-snapshot.js";

/** Display name used when a project is created without an explicit name. */
export const DEFAULT_PROJECT_NAME = "Untitled Project";

/** The currently open project together with its in-memory workspace. */
export interface ActiveProject {
  readonly manifest: ProjectManifest;
  readonly workspace: WorkspaceAdapter;
}

/** Options for {@link ProjectManager}. */
export interface ProjectManagerOptions {
  /** Options forwarded to the in-memory workspace created for the active project. */
  workspaceOptions?: InMemoryWorkspaceOptions;
  /** Cross-tab lock used to ensure a project is only open in one tab. */
  lock?: ProjectLock;
  /** Debounce delay before persisting the workspace after a change. Defaults to 2000 ms. */
  autoSaveDelayMs?: number;
}

/**
 * Coordinates project lifecycle on top of a {@link ProjectStore}: opening,
 * closing, creating, deleting, duplicating, and auto-saving the active
 * project's workspace and app data.
 */
export class ProjectManager {
  private readonly store: ProjectStore;
  private readonly workspaceOptions: InMemoryWorkspaceOptions;
  private readonly lock: ProjectLock | undefined;
  private readonly autoSaveDelayMs: number;
  private readonly activeProjectListeners = new Set<(project: ActiveProject | undefined) => void>();
  private readonly projectListListeners = new Set<(projects: ProjectManifest[]) => void>();
  private currentActive: ActiveProject | undefined;
  private currentLockHandle: ProjectLockHandle | undefined;
  private autoSaveUnsub: (() => void) | undefined;
  private autoSaveTimerId: ReturnType<typeof setTimeout> | undefined;

  constructor(store: ProjectStore, options?: ProjectManagerOptions) {
    this.store = store;
    this.workspaceOptions = options?.workspaceOptions ?? {};
    this.lock = options?.lock;
    this.autoSaveDelayMs = options?.autoSaveDelayMs ?? 2000;
  }

  async init(): Promise<void> {
    const activeId = this.store.getActiveProjectId();
    if (activeId) {
      const manifest = await this.store.getProject(activeId);
      if (manifest) {
        const handle = await this.acquireLock(manifest.id);
        if (handle) {
          this.currentLockHandle = handle;
          this.currentActive = await this.openInternal(manifest);
          this.startAutoSave(this.currentActive.workspace);
        }
      }
    }
  }

  async listProjects(): Promise<ProjectManifest[]> {
    return this.store.listProjects();
  }

  get activeProject(): ActiveProject | undefined {
    return this.currentActive;
  }

  async create(name: string): Promise<ProjectManifest> {
    const manifest = await this.store.createProject(name);
    await this.notifyProjectList();
    await this.open(manifest.id);
    return manifest;
  }

  async createFromSnapshot(
    name: string,
    description: string,
    snapshot: WorkspaceSnapshot,
    appData?: Record<string, string>,
    thumbnailUrl?: string
  ): Promise<ProjectManifest> {
    const manifest = await this.store.createProject(name);
    await this.store.updateProject(manifest.id, { description, thumbnailUrl });
    await this.store.saveWorkspace(manifest.id, snapshot);
    if (appData) {
      for (const [key, value] of Object.entries(appData)) {
        await this.store.saveAppData(manifest.id, key, value);
      }
    }
    await this.notifyProjectList();
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
    const manifest = await this.store.getProject(id);
    if (!manifest) {
      throw new Error(`Project not found: ${id}`);
    }

    const handle = await this.acquireLock(id);
    if (!handle) {
      return undefined;
    }

    if (this.currentActive) {
      await this.closeInternal();
    }

    this.currentLockHandle = handle;
    const active = await this.openInternal(manifest);
    this.currentActive = active;
    this.startAutoSave(active.workspace);
    this.store.setActiveProjectId(id);
    this.notifyActiveProject();
    return active;
  }

  async close(): Promise<void> {
    if (!this.currentActive) {
      return;
    }
    await this.closeInternal();
    this.currentActive = undefined;
    this.store.setActiveProjectId(undefined);
    this.notifyActiveProject();
  }

  async delete(id: string): Promise<void> {
    if (this.currentActive?.manifest.id === id) {
      throw new Error("Cannot delete the active project");
    }
    await this.store.deleteProject(id);
    await this.notifyProjectList();
  }

  async duplicate(id: string, newName: string): Promise<ProjectManifest> {
    const manifest = await this.store.duplicateProject(id, newName);
    await this.notifyProjectList();
    return manifest;
  }

  async updateActive(updates: Partial<Pick<ProjectManifest, "name" | "description" | "thumbnailUrl">>): Promise<void> {
    if (!this.currentActive) {
      throw new Error("No active project");
    }
    if (updates.name !== undefined && !updates.name.trim()) {
      return;
    }
    const id = this.currentActive.manifest.id;
    await this.store.updateProject(id, updates);
    const updated = await this.store.getProject(id);
    if (updated) {
      this.currentActive = { manifest: updated, workspace: this.currentActive.workspace };
      this.notifyActiveProject();
      await this.notifyProjectList();
    }
  }

  async ensureDefaultProject(defaultName: string): Promise<ActiveProject> {
    if (this.currentActive) {
      return this.currentActive;
    }
    const existing = await this.store.listProjects();
    for (const project of existing) {
      const result = await this.tryOpen(project.id);
      if (result) {
        return result;
      }
    }
    await this.create(defaultName);
    return this.currentActive!;
  }

  async saveAppData(key: string, data: string): Promise<void> {
    if (!this.currentActive) {
      throw new Error("No active project");
    }
    await this.store.saveAppData(this.currentActive.manifest.id, key, data);
  }

  async loadAppData(key: string): Promise<string | undefined> {
    if (!this.currentActive) {
      return undefined;
    }
    return this.store.loadAppData(this.currentActive.manifest.id, key);
  }

  async deleteAppData(key: string): Promise<void> {
    if (!this.currentActive) {
      throw new Error("No active project");
    }
    await this.store.deleteAppData(this.currentActive.manifest.id, key);
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

  private async openInternal(manifest: ProjectManifest): Promise<ActiveProject> {
    if (!manifest.name.trim()) {
      manifest = { ...manifest, name: DEFAULT_PROJECT_NAME };
      await this.store.updateProject(manifest.id, { name: DEFAULT_PROJECT_NAME });
    }
    const snapshot = await this.store.loadWorkspace(manifest.id);
    const workspace = createInMemoryWorkspace(this.workspaceOptions);

    if (snapshot) {
      workspace.applyRemoteChange({
        action: "import",
        entries: Array.from(snapshot),
      });
    }

    return { manifest, workspace };
  }

  private async closeInternal(): Promise<void> {
    if (!this.currentActive) {
      return;
    }
    this.stopAutoSave();
    const { manifest, workspace } = this.currentActive;
    workspace.flush();
    await this.store.saveWorkspace(manifest.id, workspace.exportSnapshot());
    this.currentLockHandle?.release();
    this.currentLockHandle = undefined;
  }

  private startAutoSave(workspace: WorkspaceAdapter): void {
    this.autoSaveUnsub = workspace.onAnyChange(() => {
      this.scheduleAutoSave();
    });
  }

  private stopAutoSave(): void {
    if (this.autoSaveTimerId !== undefined) {
      clearTimeout(this.autoSaveTimerId);
      this.autoSaveTimerId = undefined;
    }
    this.autoSaveUnsub?.();
    this.autoSaveUnsub = undefined;
  }

  private scheduleAutoSave(): void {
    if (this.autoSaveTimerId !== undefined) {
      clearTimeout(this.autoSaveTimerId);
    }
    this.autoSaveTimerId = setTimeout(() => {
      this.autoSaveTimerId = undefined;
      if (this.currentActive) {
        const { manifest, workspace } = this.currentActive;
        this.store.saveWorkspace(manifest.id, workspace.exportSnapshot());
      }
    }, this.autoSaveDelayMs);
  }

  private notifyActiveProject(): void {
    for (const listener of this.activeProjectListeners) {
      listener(this.currentActive);
    }
  }

  private async notifyProjectList(): Promise<void> {
    const projects = await this.store.listProjects();
    for (const listener of this.projectListListeners) {
      listener(projects);
    }
  }
}
