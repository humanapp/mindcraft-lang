import { ErrorCode, type IFileSystem, ProtocolError } from "@mindcraft-lang/bridge-client";
import * as vscode from "vscode";

export const MINDCRAFT_SCHEME = "mindcraft";
export const EXAMPLES_FOLDER = "__examples__";
export const MINDCRAFT_JSON = "mindcraft.json";

export class MindcraftFileSystemProvider implements vscode.FileSystemProvider, vscode.FileDecorationProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private readonly _onDidChangeMindcraftJsonLock = new vscode.EventEmitter<void>();
  readonly onDidChangeMindcraftJsonLock = this._onDidChangeMindcraftJsonLock.event;

  private _mindcraftJsonUnlocked = false;

  get isMindcraftJsonUnlocked(): boolean {
    return this._mindcraftJsonUnlocked;
  }

  unlockMindcraftJson(): void {
    if (this._mindcraftJsonUnlocked) return;
    this._mindcraftJsonUnlocked = true;
    const uri = vscode.Uri.from({ scheme: MINDCRAFT_SCHEME, path: `/${MINDCRAFT_JSON}` });
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    this._onDidChangeFileDecorations.fire(uri);
    this._onDidChangeMindcraftJsonLock.fire();
  }

  // Read and write can target different FileSystem instances. This enables
  // routing reads from a local cache while writes go through the notifying FS
  // that triggers bridge synchronization.
  private _readFs: IFileSystem | undefined;
  private _writeFs: IFileSystem | undefined;

  setFileSystems(readFs: IFileSystem | undefined, writeFs: IFileSystem | undefined): void {
    this._readFs = readFs;
    this._writeFs = writeFs;
    this._mindcraftJsonUnlocked = false;
    this._onDidChangeFileDecorations.fire(undefined);
    this._onDidChangeMindcraftJsonLock.fire();
  }

  fireChanges(events: vscode.FileChangeEvent[]): void {
    if (events.length > 0) {
      this._onDidChangeFile.fire(events);
      this._onDidChangeFileDecorations.fire(events.map((e) => e.uri));
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
      const isReadonly = result.isReadonly || (path === MINDCRAFT_JSON && !this._mindcraftJsonUnlocked);
      return {
        type: vscode.FileType.File,
        ctime: 0,
        mtime: Date.now(),
        size: new TextEncoder().encode(content).byteLength,
        permissions: isReadonly ? vscode.FilePermission.Readonly : undefined,
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
      const isRoot = !path;
      return entries
        .filter((entry) => !isRoot || entry.name !== EXAMPLES_FOLDER)
        .map((entry) => [entry.name, entry.kind === "directory" ? vscode.FileType.Directory : vscode.FileType.File]);
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
        // Etag mismatch means another client modified the file since we last
        // read it. Show a user-facing error message with an invitation to resync.
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

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== MINDCRAFT_SCHEME || !this._readFs) {
      return undefined;
    }
    const path = toFsPath(uri);
    try {
      const result = this._readFs.stat(path);
      if (result.kind === "file" && (result.isReadonly || (path === MINDCRAFT_JSON && !this._mindcraftJsonUnlocked))) {
        return new vscode.FileDecoration(undefined, undefined, new vscode.ThemeColor("disabledForeground"));
      }
    } catch {
      // Ignore errors
    }
    return undefined;
  }

  dispose(): void {
    this._onDidChangeFile.dispose();
    this._onDidChangeFileDecorations.dispose();
    this._onDidChangeMindcraftJsonLock.dispose();
  }
}

function toFsPath(uri: vscode.Uri): string {
  return uri.path.replace(/^\//, "");
}
