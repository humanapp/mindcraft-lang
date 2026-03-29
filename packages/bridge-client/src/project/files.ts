import {
  type ExportedFileSystemEntry,
  FileSystem,
  type FileSystemNotification,
  NotifyingFileSystem,
} from "../filesystem.js";

export interface ProjectFilesOptions {
  entries: Map<string, ExportedFileSystemEntry>;
  toRemoteChange: (notification: FileSystemNotification) => void;
  fromRemoteChange: (notification: FileSystemNotification) => void;
}

export class ProjectFiles {
  private _fs = new FileSystem();
  private _toRemote: NotifyingFileSystem;
  private _fromRemote: NotifyingFileSystem;

  constructor(options: ProjectFilesOptions) {
    this._toRemote = new NotifyingFileSystem(this._fs, options.toRemoteChange);
    this._fromRemote = new NotifyingFileSystem(this._fs, options.fromRemoteChange);
    if (options.entries) {
      this._fs.import(options.entries);
    }
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
