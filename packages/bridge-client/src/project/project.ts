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
  bindingToken?: string;
}

export class Project<TClient extends WsMessage = WsMessage, TServer extends WsMessage = WsMessage> {
  private _session: ProjectSession<TClient, TServer>;
  private _files: ProjectFiles;
  private readonly _syncListeners = new Set<() => void>();
  // Sequence numbers for message deduplication. _outboundSeq increments on
  // every local change sent to the bridge. _peerSeq tracks the highest seq
  // received from the peer; incoming messages with seq <= _peerSeq are
  // silently dropped to handle duplicate deliveries after reconnection.
  private _outboundSeq = 0;
  private _peerSeq = 0;

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

    this._session = new ProjectSession<TClient, TServer>(
      options.wsPath,
      options.bridgeUrl,
      {
        appName: options.appName,
        projectId: options.projectId,
        projectName: options.projectName,
        bindingToken: options.bindingToken,
      },
      options.joinCode
    );
    const filesOptions: ProjectFilesOptions = {
      entries: options.filesystem,
      toRemoteChange: (ev) => this.toRemoteFileChange(ev),
      fromRemoteChange: (ev) => this.fromRemoteFileChange(ev),
    };
    this._files = new ProjectFiles(filesOptions);

    this._session.on("filesystem:change" as TServer["type"], (msg) => {
      const wsMsg = msg as unknown as WsMessage;
      if (!wsMsg.payload) return;
      if (wsMsg.seq !== undefined && wsMsg.seq <= this._peerSeq) return;
      const notification = (msg as unknown as FilesystemChangeMessage).payload!;
      if (wsMsg.id) {
        try {
          this._files.fromRemote.applyNotification(notification);
          this._session.send({ type: "filesystem:change", id: wsMsg.id } as TClient);
        } catch (e) {
          const message = e instanceof ProtocolError ? e.message : "apply failed";
          this._session.send({ type: "session:error", id: wsMsg.id, payload: { message } } as TClient);
        }
      } else {
        this._files.fromRemote.applyNotification(notification);
      }
    });

    this._session.on("filesystem:sync" as TServer["type"], (msg) => {
      const wsMsg = msg as unknown as WsMessage;
      // TODO: Fix this by making sync completion or sync direction a first-class bridge-client/session concept rather than inferring it from raw message shape.
      if (wsMsg.id && !wsMsg.payload) {
        if (wsMsg.seq !== undefined) this._peerSeq = wsMsg.seq;
        const entries = [...this._files.raw.export()];
        this._session.send({
          type: "filesystem:sync",
          id: wsMsg.id,
          payload: { entries },
          seq: this._outboundSeq,
        } as TClient);
        this.emitDidSync();
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

  onDidSync(listener: () => void): () => void {
    this._syncListeners.add(listener);
    return () => {
      this._syncListeners.delete(listener);
    };
  }

  toRemoteFileChange = (ev: FileSystemNotification) => {
    this._outboundSeq++;
    this._session.send({ type: "filesystem:change", payload: ev, seq: this._outboundSeq } as TClient);
  };

  fromRemoteFileChange = (_ev: FileSystemNotification) => {};

  async requestSync(): Promise<void> {
    const response = await this._session.request("filesystem:sync", undefined, this._outboundSeq);
    if (response.seq !== undefined) this._peerSeq = response.seq;
    const payload = response.payload as FilesystemSyncPayload | undefined;
    if (payload?.entries) {
      this._files.fromRemote.applyNotification({ action: "import", entries: payload.entries });
    }
    this.emitDidSync();
  }

  private emitDidSync(): void {
    for (const listener of this._syncListeners) {
      listener();
    }
  }
}
