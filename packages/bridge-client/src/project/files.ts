import {
  FileSystem,
  type FileSystemNotification,
  type FileSystemSnapshotEntry,
  NotifyingFileSystem,
} from "../filesystem.js";

export interface ProjectFilesOptions {
  initialFileSnapshot: Map<string, FileSystemSnapshotEntry>;
  toRemoteChange: (notification: FileSystemNotification) => void;
  fromRemoteChange: (notification: FileSystemNotification) => void;
}

export class ProjectFiles {
  private _fs = new FileSystem();
  // The same underlying FileSystem is wrapped twice with different notification
  // callbacks. `_toRemote` fires when local code writes (outbound changes),
  // while `_fromRemote` fires when the bridge applies remote changes (inbound).
  // This lets the Project distinguish change direction.
  private _toRemote: NotifyingFileSystem;
  private _fromRemote: NotifyingFileSystem;

  constructor(options: ProjectFilesOptions) {
    this._toRemote = new NotifyingFileSystem(this._fs, options.toRemoteChange);
    this._fromRemote = new NotifyingFileSystem(this._fs, options.fromRemoteChange);
    this._fs.import(options.initialFileSnapshot);
  }

  get raw() {
    return this._fs;
  }

  get toRemote() {
    return this._toRemote;
  }

  get fromRemote() {
    return this._fromRemote;
  }
}
