import type { ProjectManifest } from "./project-manifest.js";
import type { WorkspaceSnapshot } from "./workspace-snapshot.js";

export interface ProjectStore {
  readonly keyPrefix: string;

  listProjects(): Promise<ProjectManifest[]>;
  getProject(id: string): Promise<ProjectManifest | undefined>;
  createProject(name: string): Promise<ProjectManifest>;
  deleteProject(id: string): Promise<void>;
  updateProject(id: string, updates: Partial<Pick<ProjectManifest, "name" | "description">>): Promise<void>;
  duplicateProject(id: string, newName: string): Promise<ProjectManifest>;

  loadWorkspace(id: string): Promise<WorkspaceSnapshot | undefined>;
  saveWorkspace(id: string, snapshot: WorkspaceSnapshot): Promise<void>;

  loadAppData(id: string, key: string): Promise<string | undefined>;
  saveAppData(id: string, key: string, data: string): Promise<void>;
  deleteAppData(id: string, key: string): Promise<void>;

  getActiveProjectId(): string | undefined;
  setActiveProjectId(id: string | undefined): void;
}
