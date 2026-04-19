import type { ProjectManifest } from "./project-manifest.js";
import type { WorkspaceSnapshot } from "./workspace-snapshot.js";

export interface ProjectStore {
  readonly keyPrefix: string;

  listProjects(): ProjectManifest[];
  getProject(id: string): ProjectManifest | undefined;
  createProject(name: string): ProjectManifest;
  deleteProject(id: string): void;
  updateProject(id: string, updates: Partial<Pick<ProjectManifest, "name" | "description">>): void;
  duplicateProject(id: string, newName: string): ProjectManifest;

  loadWorkspace(id: string): WorkspaceSnapshot | undefined;
  saveWorkspace(id: string, snapshot: WorkspaceSnapshot): void;

  loadAppData(id: string, key: string): string | undefined;
  saveAppData(id: string, key: string, data: string): void;
  deleteAppData(id: string, key: string): void;

  getActiveProjectId(): string | undefined;
  setActiveProjectId(id: string | undefined): void;
}
