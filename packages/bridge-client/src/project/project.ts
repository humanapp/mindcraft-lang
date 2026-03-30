import type {
  FileSystemNotification,
  FilesystemChangeMessage,
  FilesystemSyncPayload,
  WsMessage,
} from "@mindcraft-lang/bridge-protocol";
import { ErrorCode, ProtocolError } from "../error-codes.js";
import type { ExportedFileSystem } from "../filesystem.js";
import { ProjectFiles, type ProjectFilesOptions } from "./files.js";
import { ProjectSession } from "./session.js";

export interface ProjectOptions<TClient extends WsMessage = WsMessage, TServer extends WsMessage = WsMessage> {
  appName: string;
  projectId: string;
  projectName: string;
  bridgeUrl: string;
  wsPath: string;
  filesystem: ExportedFileSystem;
  joinCode?: string;
}

export class Project<TClient extends WsMessage = WsMessage, TServer extends WsMessage = WsMessage> {
  private _session: ProjectSession<TClient, TServer>;
  private _files: ProjectFiles;

  constructor(public readonly options: ProjectOptions<TClient, TServer>) {
    if (!options.appName) {
      throw new ProtocolError(ErrorCode.APP_NAME_REQUIRED, "appName is required");
    }
    if (!options.projectId) {
      throw new ProtocolError(ErrorCode.PROJECT_ID_REQUIRED, "projectId is required");
    }
    if (!options.projectName) {
      throw new ProtocolError(ErrorCode.PROJECT_NAME_REQUIRED, "projectName is required");
    }
    if (!options.bridgeUrl) {
      throw new ProtocolError(ErrorCode.BRIDGE_URL_REQUIRED, "bridgeUrl is required");
    }
    if (!options.wsPath) {
      throw new ProtocolError(ErrorCode.INVALID_CLIENT_ROLE, "wsPath is required");
    }

    this._session = new ProjectSession<TClient, TServer>(options.wsPath, options.bridgeUrl, options.joinCode);
    const filesOptions: ProjectFilesOptions = {
      entries: options.filesystem,
      toRemoteChange: this.toRemoteFileChange,
      fromRemoteChange: (ev) => this.fromRemoteFileChange(ev),
    };
    this._files = new ProjectFiles(filesOptions);

    this._session.on("filesystem:change" as TServer["type"], (msg) => {
      this._files.fromRemote.applyNotification((msg as unknown as FilesystemChangeMessage).payload);
    });

    this._session.on("filesystem:sync" as TServer["type"], (msg) => {
      const wsMsg = msg as unknown as WsMessage;
      if (wsMsg.id && !wsMsg.payload) {
        const entries = [...this._files.raw.export()];
        this._session.send({ type: "filesystem:sync", id: wsMsg.id, payload: { entries } } as TClient);
      }
    });
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

  get session(): ProjectSession<TClient, TServer> {
    return this._session;
  }

  get files(): ProjectFiles {
    return this._files;
  }

  toRemoteFileChange = (ev: FileSystemNotification) => {
    this._session.send({ type: "filesystem:change", payload: ev } as TClient);
  };

  fromRemoteFileChange = (_ev: FileSystemNotification) => {};

  async requestSync(): Promise<void> {
    const response = await this._session.request("filesystem:sync");
    const payload = response.payload as FilesystemSyncPayload | undefined;
    if (payload?.entries) {
      this._files.fromRemote.applyNotification({ action: "import", entries: payload.entries });
    }
  }
}
