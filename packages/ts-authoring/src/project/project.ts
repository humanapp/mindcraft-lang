import { AuthoringError, ErrorCode } from "./error-codes.js";
import { type ExportedFileSystem, ProjectFiles, type ProjectFilesOptions } from "./files.js";
import { ProjectSession } from "./session.js";

export type ClientRole = "extension" | "app";

export interface ProjectOptions {
  appName: string;
  projectId: string;
  projectName: string;
  bridgeUrl: string;
  clientRole: ClientRole;
  filesystem: ExportedFileSystem;
}

export class Project {
  private _session: ProjectSession;
  private _files: ProjectFiles;

  constructor(public readonly options: ProjectOptions) {
    // Validate options
    if (!options.appName) {
      throw new AuthoringError(ErrorCode.APP_NAME_REQUIRED, "appName is required");
    }
    if (!options.projectId) {
      throw new AuthoringError(ErrorCode.PROJECT_ID_REQUIRED, "projectId is required");
    }
    if (!options.projectName) {
      throw new AuthoringError(ErrorCode.PROJECT_NAME_REQUIRED, "projectName is required");
    }
    if (!options.bridgeUrl) {
      throw new AuthoringError(ErrorCode.BRIDGE_URL_REQUIRED, "bridgeUrl is required");
    }
    if (options.clientRole !== "extension" && options.clientRole !== "app") {
      throw new AuthoringError(ErrorCode.INVALID_CLIENT_ROLE, "clientRole must be 'extension' or 'app'");
    }

    // Initialize subsystems
    this._session = new ProjectSession(this);
    const filesOptions: ProjectFilesOptions = {
      entries: options.filesystem,
    };
    this._files = new ProjectFiles(this, filesOptions);
  }

  get appName(): string {
    return this.options.appName;
  }

  get projectId(): string {
    return this.options.projectId;
  }

  get projectName(): string {
    return this.options.projectName;
  }

  get session(): ProjectSession {
    return this._session;
  }

  get files(): ProjectFiles {
    return this._files;
  }
}
