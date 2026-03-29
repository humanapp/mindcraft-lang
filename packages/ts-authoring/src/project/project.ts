import type {
  AppClientMessage,
  AppServerMessage,
  ExportedFileSystem,
  ExtensionClientMessage,
  ExtensionServerMessage,
  FileSystemNotification,
} from "@mindcraft-lang/ts-protocol";
import { AuthoringError, ErrorCode } from "./error-codes.js";
import { ProjectFiles, type ProjectFilesOptions } from "./files.js";
import { ProjectSession } from "./session.js";

export type ClientRole = "extension" | "app";

export type ClientMessageFor<R extends ClientRole> = R extends "app" ? AppClientMessage : ExtensionClientMessage;

export type ServerMessageFor<R extends ClientRole> = R extends "app" ? AppServerMessage : ExtensionServerMessage;

export interface ProjectOptions<R extends ClientRole = ClientRole> {
  appName: string;
  projectId: string;
  projectName: string;
  bridgeUrl: string;
  clientRole: R;
  filesystem: ExportedFileSystem;
}

export class Project<R extends ClientRole = ClientRole> {
  private _session: ProjectSession<ClientMessageFor<R>, ServerMessageFor<R>>;
  private _files: ProjectFiles;

  constructor(public readonly options: ProjectOptions<R>) {
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
    this._session = new ProjectSession<ClientMessageFor<R>, ServerMessageFor<R>>(options.clientRole, options.bridgeUrl);
    const filesOptions: ProjectFilesOptions = {
      entries: options.filesystem,
      toRemoteChange: this.toRemoteFileChange,
      fromRemoteChange: this.fromRemoteFileChange,
    };
    this._files = new ProjectFiles(filesOptions);
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

  get session(): ProjectSession<ClientMessageFor<R>, ServerMessageFor<R>> {
    return this._session;
  }

  get files(): ProjectFiles {
    return this._files;
  }

  toRemoteFileChange = (ev: FileSystemNotification) => {
    this._session.send({ type: "filesystem:change", payload: ev } as ClientMessageFor<R>);
  };

  fromRemoteFileChange = (ev: FileSystemNotification) => {
    // TODO: pass remote file changes to app
  };
}
