import { ErrorCode, type IFileSystem, ProtocolError } from "@mindcraft-lang/bridge-client";
import * as vscode from "vscode";

export const MINDCRAFT_SCHEME = "mindcraft";

export class MindcraftFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private _readFs: IFileSystem | undefined;
  private _writeFs: IFileSystem | undefined;

  setFileSystems(readFs: IFileSystem | undefined, writeFs: IFileSystem | undefined): void {
    this._readFs = readFs;
    this._writeFs = writeFs;
  }

  fireChanges(events: vscode.FileChangeEvent[]): void {
    if (events.length > 0) {
      this._onDidChangeFile.fire(events);
    }
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const path = toFsPath(uri);

    if (path === "") {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    const fs = this.requireReadFs();

    try {
      const result = fs.stat(path);
      if (result.kind === "directory") {
        return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
      }
      const content = fs.read(path);
      return {
        type: vscode.FileType.File,
        ctime: 0,
        mtime: Date.now(),
        size: new TextEncoder().encode(content).byteLength,
        permissions: result.isReadonly ? vscode.FilePermission.Readonly : undefined,
      };
    } catch (e) {
      if (e instanceof ProtocolError) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw e;
    }
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    if (!this._readFs) {
      return [];
    }
    const fs = this._readFs;
    const path = toFsPath(uri);
    try {
      const entries = fs.list(path || undefined);
      return entries.map((entry) => [
        entry.name,
        entry.kind === "directory" ? vscode.FileType.Directory : vscode.FileType.File,
      ]);
    } catch (e) {
      if (e instanceof ProtocolError) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw e;
    }
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const fs = this.requireReadFs();
    try {
      return new TextEncoder().encode(fs.read(toFsPath(uri)));
    } catch (e) {
      if (e instanceof ProtocolError) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw e;
    }
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    const fs = this.requireWriteFs();
    const path = toFsPath(uri);
    try {
      fs.write(path, new TextDecoder().decode(content));
    } catch (e) {
      if (e instanceof ProtocolError) {
        if (e.code === ErrorCode.ETAG_MISMATCH) {
          vscode.window
            .showErrorMessage(
              "This file was modified by another client. Run Mindcraft: Sync to re-sync your files.",
              "Sync Now"
            )
            .then((choice) => {
              if (choice === "Sync Now") {
                vscode.commands.executeCommand("mindcraft.sync");
              }
            });
          throw new vscode.FileSystemError("File was modified by another client");
        }
        throw vscode.FileSystemError.NoPermissions(uri);
      }
      throw e;
    }
  }

  createDirectory(uri: vscode.Uri): void {
    const fs = this.requireWriteFs();
    try {
      fs.mkdir(toFsPath(uri));
    } catch (e) {
      if (e instanceof ProtocolError) {
        throw vscode.FileSystemError.FileExists(uri);
      }
      throw e;
    }
  }

  delete(uri: vscode.Uri): void {
    const fs = this.requireWriteFs();
    const path = toFsPath(uri);
    try {
      const result = fs.stat(path);
      if (result.kind === "directory") {
        fs.rmdir(path);
      } else {
        fs.delete(path);
      }
    } catch (e) {
      if (e instanceof ProtocolError) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw e;
    }
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    const fs = this.requireWriteFs();
    try {
      fs.rename(toFsPath(oldUri), toFsPath(newUri));
    } catch (e) {
      if (e instanceof ProtocolError) {
        throw vscode.FileSystemError.FileNotFound(oldUri);
      }
      throw e;
    }
  }

  private requireReadFs(): IFileSystem {
    if (!this._readFs) {
      throw vscode.FileSystemError.Unavailable("Not connected");
    }
    return this._readFs;
  }

  private requireWriteFs(): IFileSystem {
    if (!this._writeFs) {
      throw vscode.FileSystemError.Unavailable("Not connected");
    }
    return this._writeFs;
  }

  dispose(): void {
    this._onDidChangeFile.dispose();
  }
}

function toFsPath(uri: vscode.Uri): string {
  return uri.path.replace(/^\//, "");
}
