import { ErrorCode, ProtocolError } from "./error-codes.js";

export interface IFileSystem {
  list(path?: string): FileTreeEntry[];
  read(path: string): string;
  write(path: string, content: string, isReadonly?: boolean, etag?: string): string;
  delete(path: string): void;
  rename(oldPath: string, newPath: string): void;
  stat(path: string): StatResult;
  mkdir(path: string): void;
  rmdir(path: string): void;
  export(): ExportedFileSystem;
  import(entries: ExportedFileSystem): void;
}

export type FileSystemNotification =
  | { action: "write"; path: string; content: string; isReadonly: boolean | undefined; newEtag: string }
  | { action: "delete"; path: string }
  | { action: "rename"; oldPath: string; newPath: string }
  | { action: "mkdir"; path: string }
  | { action: "rmdir"; path: string };

export class NotifyingFileSystem implements IFileSystem {
  constructor(
    private _fs: IFileSystem,
    private _onChange: (notification: FileSystemNotification) => void
  ) {}

  list(path?: string): FileTreeEntry[] {
    return this._fs.list(path);
  }

  read(path: string): string {
    return this._fs.read(path);
  }

  write(path: string, content: string, isReadonly?: boolean, expectedEtag?: string): string {
    const newEtag = this._fs.write(path, content, isReadonly, expectedEtag);
    this._onChange({ action: "write", path, content, isReadonly, newEtag });
    return newEtag;
  }

  delete(path: string): void {
    this._fs.delete(path);
    this._onChange({ action: "delete", path });
  }

  rename(oldPath: string, newPath: string): void {
    this._fs.rename(oldPath, newPath);
    this._onChange({ action: "rename", oldPath, newPath });
  }

  stat(path: string): StatResult {
    return this._fs.stat(path);
  }

  mkdir(path: string): void {
    this._fs.mkdir(path);
    this._onChange({ action: "mkdir", path });
  }

  rmdir(path: string): void {
    this._fs.rmdir(path);
    this._onChange({ action: "rmdir", path });
  }

  export(): ExportedFileSystem {
    return this._fs.export();
  }

  import(entries: ExportedFileSystem): void {
    this._fs.import(entries);
  }
}

export class FileSystem implements IFileSystem {
  private _root = new FileTree("", "");

  list(path?: string): FileTreeEntry[] {
    path = normalizePath(path);
    return this._root.list(path);
  }

  read(path: string): string {
    return this._root.read(path);
  }

  write(path: string, content: string, isReadonly?: boolean, expectedEtag?: string): string {
    return this._root.write(path, content, isReadonly, expectedEtag);
  }

  delete(path: string): void {
    this._root.delete(path);
  }

  rename(oldPath: string, newPath: string): void {
    this._root.rename(oldPath, newPath);
  }

  stat(path: string): StatResult {
    return this._root.stat(path);
  }

  mkdir(path: string): void {
    this._root.mkdir(path);
  }

  rmdir(path: string): void {
    this._root.rmdir(path);
  }

  export(): ExportedFileSystem {
    const result: ExportedFileSystem = new Map();
    this._root.flatten(result);
    return result;
  }

  import(entries: ExportedFileSystem): void {
    for (const [path, entry] of entries) {
      if (entry.kind === "directory") {
        this._root.mkdir(path);
      } else {
        const segs = normalizePath(path)
          .split("/")
          .filter((s) => s.length > 0);
        for (let i = 1; i < segs.length; i++) {
          const dirPath = segs.slice(0, i).join("/");
          try {
            this._root.mkdir(dirPath);
          } catch {
            // directory already exists
          }
        }
        this._root.writeRestore(path, entry.content, entry.isReadonly, entry.etag);
      }
    }
  }
}

export type ExportedFileEntry = {
  kind: "file";
  content: string;
  etag: string;
  isReadonly: boolean;
};

export type ExportedDirectoryEntry = {
  kind: "directory";
};

export type ExportedFileSystemEntry = ExportedFileEntry | ExportedDirectoryEntry;

export type ExportedFileSystem = Map<string, ExportedFileSystemEntry>;

export type StatResult =
  | { kind: "file"; path: string; name: string; etag: string; isReadonly: boolean }
  | { kind: "directory"; path: string; name: string };

export type TreeFileEntry = {
  kind: "file";
  path: string;
  name: string;
  etag: string;
  isReadonly: boolean;
};

export type TreeFileEntryWithContent = TreeFileEntry & {
  content: string;
};

export type TreeDirectoryEntry = {
  kind: "directory";
  path: string;
  name: string;
};

export type FileTreeEntry = TreeFileEntry | TreeDirectoryEntry;

class FileTree {
  private _dirs = new Map<string, FileTree>();
  private _files = new Map<string, TreeFileEntryWithContent>();

  constructor(
    public readonly path: string,
    public readonly name: string
  ) {}

  read(fullPath: string): string {
    fullPath = normalizePath(fullPath);
    const segs = fullPath.split("/").filter((s) => s.length > 0);
    if (segs.length === 0) {
      throw new ProtocolError(ErrorCode.INVALID_PATH, `Invalid file path: "${fullPath}"`);
    }
    const name = segs[segs.length - 1];
    const dirSegs = segs.slice(0, -1);
    return this.readInternal(dirSegs, fullPath, name);
  }

  write(fullPath: string, content: string, isReadonly?: boolean, expectedEtag?: string): string {
    fullPath = normalizePath(fullPath);
    const segs = fullPath.split("/").filter((s) => s.length > 0);
    if (segs.length === 0) {
      throw new ProtocolError(ErrorCode.INVALID_PATH, `Invalid file path: "${fullPath}"`);
    }
    const name = segs[segs.length - 1];
    const dirSegs = segs.slice(0, -1);
    const newEtag = generateEtag();
    this.writeInternal(dirSegs, fullPath, name, content, isReadonly ?? false, newEtag, expectedEtag);
    return newEtag;
  }

  writeRestore(fullPath: string, content: string, isReadonly: boolean, etag: string): void {
    fullPath = normalizePath(fullPath);
    const segs = fullPath.split("/").filter((s) => s.length > 0);
    if (segs.length === 0) {
      throw new ProtocolError(ErrorCode.INVALID_PATH, `Invalid file path: "${fullPath}"`);
    }
    const name = segs[segs.length - 1];
    const dirSegs = segs.slice(0, -1);
    this.writeInternal(dirSegs, fullPath, name, content, isReadonly, etag);
  }

  delete(fullPath: string): void {
    fullPath = normalizePath(fullPath);
    const segs = fullPath.split("/").filter((s) => s.length > 0);
    if (segs.length === 0) {
      throw new ProtocolError(ErrorCode.INVALID_PATH, `Invalid file path: "${fullPath}"`);
    }
    const name = segs[segs.length - 1];
    const dirSegs = segs.slice(0, -1);
    this.deleteInternal(dirSegs, fullPath, name);
  }

  rename(oldFullPath: string, newFullPath: string): void {
    oldFullPath = normalizePath(oldFullPath);
    newFullPath = normalizePath(newFullPath);
    if (oldFullPath === newFullPath) {
      throw new ProtocolError(ErrorCode.RENAME_SAME_PATH, "Old path and new path are the same");
    }
    let oldSegs = oldFullPath.split("/").filter((s) => s.length > 0);
    let newSegs = newFullPath.split("/").filter((s) => s.length > 0);
    if (oldSegs.length === 0 || newSegs.length === 0) {
      throw new ProtocolError(ErrorCode.INVALID_PATH, `Invalid file path: "${oldFullPath}" or "${newFullPath}"`);
    }
    const oldName = oldSegs[oldSegs.length - 1];
    const newName = newSegs[newSegs.length - 1];
    oldSegs = oldSegs.slice(0, -1);
    newSegs = newSegs.slice(0, -1);
    const oldEntry = this.readEntryInternal(oldSegs, oldFullPath, oldName);
    if (oldEntry.isReadonly) {
      throw new ProtocolError(ErrorCode.FILE_READ_ONLY, `File is read-only: ${oldFullPath}`);
    }
    this.writeInternal(newSegs, newFullPath, newName, oldEntry.content, oldEntry.isReadonly, oldEntry.etag);
    this.deleteInternal(oldSegs, oldFullPath, oldName);
  }

  stat(fullPath: string): StatResult {
    fullPath = normalizePath(fullPath);
    const segs = fullPath.split("/").filter((s) => s.length > 0);
    if (segs.length === 0) {
      throw new ProtocolError(ErrorCode.INVALID_PATH, `Invalid path: "${fullPath}"`);
    }
    const name = segs[segs.length - 1];
    const dirSegs = segs.slice(0, -1);
    return this.statInternal(dirSegs, fullPath, name);
  }

  mkdir(fullPath: string): void {
    fullPath = normalizePath(fullPath);
    const segs = fullPath.split("/").filter((s) => s.length > 0);
    if (segs.length === 0) {
      throw new ProtocolError(ErrorCode.INVALID_PATH, `Invalid directory path: "${fullPath}"`);
    }
    const name = segs[segs.length - 1];
    const dirSegs = segs.slice(0, -1);
    this.mkdirInternal(dirSegs, fullPath, name);
  }

  rmdir(fullPath: string): void {
    fullPath = normalizePath(fullPath);
    const segs = fullPath.split("/").filter((s) => s.length > 0);
    if (segs.length === 0) {
      throw new ProtocolError(ErrorCode.INVALID_PATH, `Invalid directory path: "${fullPath}"`);
    }
    const name = segs[segs.length - 1];
    const dirSegs = segs.slice(0, -1);
    this.rmdirInternal(dirSegs, fullPath, name);
  }

  list(path: string): FileTreeEntry[] {
    path = normalizePath(path);
    const segs = path.split("/").filter((s) => s.length > 0);
    return this.listInternal(segs);
  }

  flatten(result: Map<string, ExportedFileEntry | ExportedDirectoryEntry>): void {
    for (const file of this._files.values()) {
      const entry: ExportedFileEntry = {
        kind: "file",
        content: file.content,
        etag: file.etag,
        isReadonly: file.isReadonly,
      };
      result.set(file.path, entry);
    }
    for (const dir of this._dirs.values()) {
      if (dir._files.size === 0 && dir._dirs.size === 0) {
        result.set(dir.path, { kind: "directory" });
      } else {
        dir.flatten(result);
      }
    }
  }

  private statInternal(segs: string[], fullPath: string, name: string): StatResult {
    if (segs.length === 0) {
      const file = this._files.get(name);
      if (file) {
        return { kind: "file", path: file.path, name: file.name, etag: file.etag, isReadonly: file.isReadonly };
      }
      const dir = this._dirs.get(name);
      if (dir) {
        return { kind: "directory", path: dir.path, name: dir.name };
      }
      throw new ProtocolError(ErrorCode.PATH_NOT_FOUND, `Path not found: ${fullPath}`);
    } else {
      const [next, ...rest] = segs;
      const child = this._dirs.get(next);
      if (!child) {
        throw new ProtocolError(
          ErrorCode.DIRECTORY_NOT_FOUND,
          `Directory not found: ${this.path ? `${this.path}/${next}` : next}`
        );
      }
      return child.statInternal(rest, fullPath, name);
    }
  }

  private listInternal(segs: string[]): FileTreeEntry[] {
    if (segs.length === 0) {
      const fileEntries: TreeFileEntry[] = Array.from(this._files.values()).map((f) => ({
        kind: "file",
        path: f.path,
        name: f.name,
        etag: f.etag,
        isReadonly: f.isReadonly,
        // do not include file content
      }));
      const dirEntries: TreeDirectoryEntry[] = Array.from(this._dirs.values()).map((d) => ({
        kind: "directory",
        path: d.path,
        name: d.name,
      }));
      return [...fileEntries, ...dirEntries];
    } else {
      const [next, ...rest] = segs;
      const childDir = this._dirs.get(next);
      if (childDir) {
        return childDir.listInternal(rest);
      } else {
        throw new ProtocolError(
          ErrorCode.DIRECTORY_NOT_FOUND,
          `Directory not found: ${this.path ? `${this.path}/${next}` : next}`
        );
      }
    }
  }

  private readInternal(segs: string[], fullPath: string, name: string): string {
    return this.readEntryInternal(segs, fullPath, name).content;
  }

  private readEntryInternal(segs: string[], fullPath: string, name: string): TreeFileEntryWithContent {
    if (segs.length === 0) {
      const file = this._files.get(name);
      if (!file) {
        throw new ProtocolError(ErrorCode.FILE_NOT_FOUND, `File not found: ${fullPath}`);
      }
      return file;
    } else {
      const [next, ...rest] = segs;
      const child = this._dirs.get(next);
      if (!child) {
        throw new ProtocolError(
          ErrorCode.DIRECTORY_NOT_FOUND,
          `Directory not found: ${this.path ? `${this.path}/${next}` : next}`
        );
      }
      return child.readEntryInternal(rest, fullPath, name);
    }
  }

  private writeInternal(
    segs: string[],
    fullPath: string,
    name: string,
    content: string,
    isReadonly: boolean,
    newEtag: string,
    expectedEtag?: string
  ): void {
    if (segs.length === 0) {
      const existing = this._files.get(name);
      if (existing?.isReadonly) {
        throw new ProtocolError(ErrorCode.FILE_READ_ONLY, `File is read-only: ${fullPath}`);
      }
      if (expectedEtag !== undefined && existing && existing.etag !== expectedEtag) {
        throw new ProtocolError(ErrorCode.ETAG_MISMATCH, `ETag mismatch for ${fullPath}`);
      }
      const entry: TreeFileEntryWithContent = {
        kind: "file",
        path: fullPath,
        name,
        content,
        etag: newEtag,
        isReadonly,
      };
      this._files.set(name, entry);
    } else {
      const [next, ...rest] = segs;
      const child = this._dirs.get(next);
      if (!child) {
        throw new ProtocolError(
          ErrorCode.DIRECTORY_NOT_FOUND,
          `Directory not found: ${this.path ? `${this.path}/${next}` : next}`
        );
      }
      child.writeInternal(rest, fullPath, name, content, isReadonly, newEtag, expectedEtag);
    }
  }

  private deleteInternal(segs: string[], fullPath: string, name: string): void {
    if (segs.length === 0) {
      if (!this._files.has(name)) {
        throw new ProtocolError(ErrorCode.FILE_NOT_FOUND, `File not found: ${fullPath}`);
      }
      const entry = this._files.get(name);
      if (entry?.isReadonly) {
        throw new ProtocolError(ErrorCode.FILE_READ_ONLY, `File is read-only: ${fullPath}`);
      }
      this._files.delete(name);
    } else {
      const [next, ...rest] = segs;
      const child = this._dirs.get(next);
      if (!child) {
        throw new ProtocolError(
          ErrorCode.DIRECTORY_NOT_FOUND,
          `Directory not found: ${this.path ? `${this.path}/${next}` : next}`
        );
      }
      child.deleteInternal(rest, fullPath, name);
    }
  }

  private mkdirInternal(segs: string[], fullPath: string, name: string): void {
    if (segs.length === 0) {
      if (this._dirs.has(name)) {
        throw new ProtocolError(ErrorCode.DIRECTORY_ALREADY_EXISTS, `Directory already exists: ${fullPath}`);
      }
      const childPath = this.path ? `${this.path}/${name}` : name;
      const subtree = new FileTree(childPath, name);
      this._dirs.set(name, subtree);
    } else {
      const [next, ...rest] = segs;
      let child = this._dirs.get(next);
      if (!child) {
        child = new FileTree(this.path ? `${this.path}/${next}` : next, next);
        this._dirs.set(next, child);
      }
      child.mkdirInternal(rest, fullPath, name);
    }
  }

  private rmdirInternal(segs: string[], fullPath: string, name: string): void {
    if (segs.length === 0) {
      if (!this._dirs.has(name)) {
        throw new ProtocolError(ErrorCode.DIRECTORY_NOT_FOUND, `Directory not found: ${fullPath}`);
      }
      const subtree = this._dirs.get(name)!;
      if (subtree.hasReadonlyFiles()) {
        throw new ProtocolError(ErrorCode.DIRECTORY_HAS_READONLY, `Directory contains read-only files: ${fullPath}`);
      }
      this._dirs.delete(name);
    } else {
      const [next, ...rest] = segs;
      const child = this._dirs.get(next);
      if (!child) {
        throw new ProtocolError(
          ErrorCode.DIRECTORY_NOT_FOUND,
          `Directory not found: ${this.path ? `${this.path}/${next}` : next}`
        );
      }
      child.rmdirInternal(rest, fullPath, name);
    }
  }

  private hasReadonlyFiles(): boolean {
    for (const file of this._files.values()) {
      if (file.isReadonly) return true;
    }
    for (const dir of this._dirs.values()) {
      if (dir.hasReadonlyFiles()) return true;
    }
    return false;
  }
}

function normalizePath(path?: string): string {
  if (!path) return "";
  // replace backslashes with forward slashes and remove redundant slashes
  path = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  // remove leading slash if present
  if (path.startsWith("/")) {
    path = path.slice(1);
  }
  return path;
}

function generateEtag(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
