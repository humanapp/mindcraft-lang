import type { LocalStorageWorkspaceOptions } from "./local-storage-workspace.js";
import { createLocalStorageWorkspace } from "./local-storage-workspace.js";
import type { ProjectManifest } from "./project-manifest.js";
import type { ProjectStore } from "./project-store.js";
import type { WorkspaceAdapter } from "./workspace-adapter.js";

export interface ActiveProject {
  readonly manifest: ProjectManifest;
  readonly workspace: WorkspaceAdapter;
}

export class ProjectManager {
  private readonly store: ProjectStore;
  private readonly workspaceOptions: Omit<LocalStorageWorkspaceOptions, "storageKey">;
  private readonly activeProjectListeners = new Set<(project: ActiveProject | undefined) => void>();
  private readonly projectListListeners = new Set<(projects: ProjectManifest[]) => void>();
  private currentActive: ActiveProject | undefined;

  constructor(store: ProjectStore, workspaceOptions?: Omit<LocalStorageWorkspaceOptions, "storageKey">) {
    this.store = store;
    this.workspaceOptions = workspaceOptions ?? {};

    const activeId = store.getActiveProjectId();
    if (activeId) {
      const manifest = store.getProject(activeId);
      if (manifest) {
        this.currentActive = this.openInternal(manifest);
      }
    }
  }

  get projects(): ProjectManifest[] {
    return this.store.listProjects();
  }

  get activeProject(): ActiveProject | undefined {
    return this.currentActive;
  }

  create(name: string): ProjectManifest {
    const manifest = this.store.createProject(name);
    this.notifyProjectList();
    this.open(manifest.id);
    return manifest;
  }

  open(id: string): ActiveProject {
    const manifest = this.store.getProject(id);
    if (!manifest) {
      throw new Error(`Project not found: ${id}`);
    }

    if (this.currentActive) {
      this.closeInternal();
    }

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

  ensureDefaultProject(defaultName: string): ActiveProject {
    if (this.currentActive) {
      return this.currentActive;
    }
    const existing = this.store.listProjects();
    if (existing.length > 0) {
      return this.open(existing[0].id);
    }
    this.create(defaultName);
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
