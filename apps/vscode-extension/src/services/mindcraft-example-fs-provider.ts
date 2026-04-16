import { type IFileSystem, ProtocolError } from "@mindcraft-lang/bridge-client";
import * as vscode from "vscode";
import { EXAMPLES_FOLDER } from "./mindcraft-fs-provider";

export const MINDCRAFT_EXAMPLE_SCHEME = "mindcraft-example";

export class MindcraftExampleFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private _readFs: IFileSystem | undefined;

  setFileSystem(readFs: IFileSystem | undefined): void {
    this._readFs = readFs;
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
    const path = toExampleFsPath(uri);

    if (path === "") {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    const fs = this.requireFs();

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
        permissions: vscode.FilePermission.Readonly,
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
    const path = toExampleFsPath(uri);
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
    const fs = this.requireFs();
    try {
      return new TextEncoder().encode(fs.read(toExampleFsPath(uri)));
    } catch (e) {
      if (e instanceof ProtocolError) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw e;
    }
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions("Examples are read-only");
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions("Examples are read-only");
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions("Examples are read-only");
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("Examples are read-only");
  }

  private requireFs(): IFileSystem {
    if (!this._readFs) {
      throw vscode.FileSystemError.Unavailable("Not connected");
    }
    return this._readFs;
  }

  dispose(): void {
    this._onDidChangeFile.dispose();
  }
}

function toExampleFsPath(uri: vscode.Uri): string {
  const path = uri.path.replace(/^\//, "");
  if (!path) {
    return EXAMPLES_FOLDER;
  }
  return `${EXAMPLES_FOLDER}/${path}`;
}
