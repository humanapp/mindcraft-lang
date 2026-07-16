import type {
  FileSystemNotification,
  FolderAppMessage,
  FolderHostMessage,
  FolderSessionErrorCode as FolderSessionErrorCodeType,
} from "@mindcraft-lang/bridge-protocol";
import {
  FOLDER_SESSION_PROTOCOL_VERSION,
  FolderSessionErrorCode,
  filesystemNotificationSchema,
  MAX_FILE_CONTENT_BYTES,
} from "@mindcraft-lang/bridge-protocol";
import * as vscode from "vscode";
import type { DiagnosticsManager } from "./diagnostics-manager";

const MINDCRAFT_JSON = "mindcraft.json";

/** Marks a path in the self-write log whose latest host-side operation was a delete. */
const SELF_DELETED = "__self-deleted__";

type FolderFileEntry = [string, { kind: "file"; content: string; etag: string; isReadonly: boolean }];
type FolderDirectoryEntry = [string, { kind: "directory" }];

/**
 * Extension-side host of one folder session: performs the project folder's
 * disk I/O for the embedded app, forwards external disk changes to it, and
 * publishes its compile diagnostics.
 *
 * All writes are confined to the project folder; a change naming a path
 * outside it is refused with a machine-readable error.
 */
export class FolderStoreHost {
  private readonly folder: vscode.Uri;
  private readonly postToApp: (message: FolderHostMessage) => void;
  private readonly diagnostics: DiagnosticsManager;
  private readonly onHandshakeComplete: (() => void) | undefined;
  /** Latest etag (or delete marker) this host produced per path, for watcher echo suppression. */
  private readonly selfWriteLog = new Map<string, string>();

  constructor(
    folder: vscode.Uri,
    postToApp: (message: FolderHostMessage) => void,
    diagnostics: DiagnosticsManager,
    onHandshakeComplete?: () => void
  ) {
    this.folder = folder;
    this.postToApp = postToApp;
    this.diagnostics = diagnostics;
    this.onHandshakeComplete = onHandshakeComplete;
  }

  /** Handle one message posted by the embedded app. */
  async handleAppMessage(raw: unknown): Promise<void> {
    if (typeof raw !== "object" || raw === null || typeof (raw as { type?: unknown }).type !== "string") {
      return;
    }
    const message = raw as FolderAppMessage;
    switch (message.type) {
      case "folder:hello":
        await this.handleHello(message.id, message.payload?.protocolVersion);
        return;
      case "folder:loadFiles":
        await this.handleLoadFiles(message.id);
        return;
      case "folder:change":
        await this.handleChange(message.id, message.payload);
        return;
      case "folder:manifestWrite":
        await this.handleManifestWrite(message.id, message.payload?.content);
        return;
      case "folder:diagnostics":
        if (message.payload) {
          this.diagnostics.handleDiagnostics(message.payload);
        }
        return;
    }
  }

  /** Handle one file watcher event under the project folder. */
  async handleWatcherEvent(kind: "create" | "change" | "delete", uri: vscode.Uri): Promise<void> {
    const path = this.toRelativePath(uri);
    if (path === undefined || path.length === 0 || isExcludedPath(path)) {
      return;
    }

    if (kind === "delete") {
      if (this.selfWriteLog.get(path) === SELF_DELETED) {
        return;
      }
      this.postToApp({ type: "folder:externalChange", payload: { action: "delete", path } });
      return;
    }

    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      return;
    }
    if (stat.type === vscode.FileType.Directory) {
      this.postToApp({ type: "folder:externalChange", payload: { action: "mkdir", path } });
      return;
    }
    if (stat.type !== vscode.FileType.File) {
      return;
    }
    const etag = etagFromStat(stat);
    if (this.selfWriteLog.get(path) === etag) {
      return;
    }
    const content = await this.readTextFile(uri, stat);
    if (content === undefined) {
      return;
    }
    this.postToApp({
      type: "folder:externalChange",
      payload: { action: "write", path, content, newEtag: etag },
    });
  }

  private async handleHello(id: string | undefined, protocolVersion: number | undefined): Promise<void> {
    if (protocolVersion !== FOLDER_SESSION_PROTOCOL_VERSION) {
      this.postError(
        id,
        FolderSessionErrorCode.PROTOCOL_VERSION_MISMATCH,
        `This host speaks folder-session protocol version ${FOLDER_SESSION_PROTOCOL_VERSION}`
      );
      return;
    }
    const manifestUri = vscode.Uri.joinPath(this.folder, MINDCRAFT_JSON);
    let content: string;
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(manifestUri);
      content = new TextDecoder().decode(await vscode.workspace.fs.readFile(manifestUri));
    } catch {
      this.postError(
        id,
        FolderSessionErrorCode.PROJECT_MANIFEST_NOT_FOUND,
        `${this.folder.toString()} carries no readable ${MINDCRAFT_JSON}`
      );
      return;
    }
    this.postToApp({
      type: "folder:welcome",
      id,
      payload: {
        protocolVersion: FOLDER_SESSION_PROTOCOL_VERSION,
        projectId: this.folder.toString(),
        manifest: { content, etag: etagFromStat(stat) },
      },
    });
    this.onHandshakeComplete?.();
  }

  private async handleLoadFiles(id: string | undefined): Promise<void> {
    const entries: Array<FolderFileEntry | FolderDirectoryEntry> = [];
    await this.collectEntries(this.folder, "", entries);
    this.postToApp({ type: "folder:files", id, payload: { entries } });
  }

  private async collectEntries(
    directory: vscode.Uri,
    prefix: string,
    entries: Array<FolderFileEntry | FolderDirectoryEntry>
  ): Promise<void> {
    let children: Array<[string, vscode.FileType]>;
    try {
      children = await vscode.workspace.fs.readDirectory(directory);
    } catch {
      return;
    }
    for (const [name, type] of children) {
      const path = prefix.length > 0 ? `${prefix}/${name}` : name;
      if (isExcludedPath(path) || path === MINDCRAFT_JSON) {
        continue;
      }
      if (type === vscode.FileType.Directory) {
        entries.push([path, { kind: "directory" }]);
        await this.collectEntries(vscode.Uri.joinPath(directory, name), path, entries);
        continue;
      }
      if (type !== vscode.FileType.File) {
        continue;
      }
      const uri = vscode.Uri.joinPath(directory, name);
      let stat: vscode.FileStat;
      try {
        stat = await vscode.workspace.fs.stat(uri);
      } catch {
        continue;
      }
      const content = await this.readTextFile(uri, stat);
      if (content === undefined) {
        continue;
      }
      entries.push([path, { kind: "file", content, etag: etagFromStat(stat), isReadonly: false }]);
    }
  }

  private async handleChange(id: string | undefined, payload: unknown): Promise<void> {
    const parsed = filesystemNotificationSchema.safeParse(payload);
    if (!parsed.success) {
      this.postError(id, FolderSessionErrorCode.INVALID_PAYLOAD, "folder:change payload failed validation");
      return;
    }
    const change = parsed.data;
    if (change.action === "import") {
      this.postError(
        id,
        FolderSessionErrorCode.UNSUPPORTED_CHANGE,
        "A full-snapshot import is not applied to a project folder"
      );
      return;
    }
    const paths = change.action === "rename" ? [change.oldPath, change.newPath] : [change.path];
    for (const path of paths) {
      if (!isSafeRelativePath(path)) {
        this.postError(
          id,
          FolderSessionErrorCode.PATH_OUTSIDE_PROJECT,
          `"${path}" does not name a path inside the project folder`
        );
        return;
      }
    }
    try {
      await this.applyChange(change);
    } catch (error) {
      this.postError(id, FolderSessionErrorCode.WRITE_FAILED, describeError(error));
      return;
    }
    this.postToApp({ type: "folder:ack", id });
  }

  private async applyChange(change: Exclude<FileSystemNotification, { action: "import" }>): Promise<void> {
    switch (change.action) {
      case "write": {
        const uri = this.toUri(change.path);
        const parent = parentDirectoryPath(change.path);
        if (parent) {
          await vscode.workspace.fs.createDirectory(this.toUri(parent));
        }
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(change.content));
        await this.recordSelfWrite(change.path, uri);
        return;
      }
      case "delete": {
        await this.deleteIgnoringMissing(this.toUri(change.path), false);
        this.selfWriteLog.set(change.path, SELF_DELETED);
        return;
      }
      case "rename": {
        await vscode.workspace.fs.rename(this.toUri(change.oldPath), this.toUri(change.newPath), {
          overwrite: true,
        });
        this.selfWriteLog.set(change.oldPath, SELF_DELETED);
        await this.recordSelfWrite(change.newPath, this.toUri(change.newPath));
        return;
      }
      case "mkdir": {
        await vscode.workspace.fs.createDirectory(this.toUri(change.path));
        return;
      }
      case "rmdir": {
        await this.deleteIgnoringMissing(this.toUri(change.path), true);
        this.selfWriteLog.set(change.path, SELF_DELETED);
        return;
      }
    }
  }

  private async handleManifestWrite(id: string | undefined, content: string | undefined): Promise<void> {
    if (typeof content !== "string") {
      this.postError(id, FolderSessionErrorCode.INVALID_PAYLOAD, "folder:manifestWrite payload failed validation");
      return;
    }
    const uri = vscode.Uri.joinPath(this.folder, MINDCRAFT_JSON);
    try {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
      await this.recordSelfWrite(MINDCRAFT_JSON, uri);
    } catch (error) {
      this.postError(id, FolderSessionErrorCode.WRITE_FAILED, describeError(error));
      return;
    }
    this.postToApp({ type: "folder:ack", id });
  }

  private async recordSelfWrite(path: string, uri: vscode.Uri): Promise<void> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      this.selfWriteLog.set(path, etagFromStat(stat));
    } catch {
      this.selfWriteLog.delete(path);
    }
  }

  private async deleteIgnoringMissing(uri: vscode.Uri, recursive: boolean): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri, { recursive, useTrash: false });
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return;
      }
      throw error;
    }
  }

  private async readTextFile(uri: vscode.Uri, stat: vscode.FileStat): Promise<string | undefined> {
    if (stat.size > MAX_FILE_CONTENT_BYTES) {
      return undefined;
    }
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      return undefined;
    }
    if (bytes.includes(0)) {
      return undefined;
    }
    return new TextDecoder().decode(bytes);
  }

  private toUri(path: string): vscode.Uri {
    return vscode.Uri.joinPath(this.folder, path);
  }

  private toRelativePath(uri: vscode.Uri): string | undefined {
    const folderPath = this.folder.path.endsWith("/") ? this.folder.path : `${this.folder.path}/`;
    if (!uri.path.startsWith(folderPath)) {
      return undefined;
    }
    return uri.path.slice(folderPath.length);
  }

  private postError(id: string | undefined, code: FolderSessionErrorCodeType, message: string): void {
    this.postToApp({ type: "folder:error", id, payload: { code, message } });
  }
}

function etagFromStat(stat: vscode.FileStat): string {
  return `${stat.mtime}-${stat.size}`;
}

function parentDirectoryPath(path: string): string | undefined {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : undefined;
}

/**
 * True for a normalized project-relative path: non-empty segments, no `.` or
 * `..`, no leading slash, no backslashes.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/**
 * True for paths the folder session does not sync: any segment starting with
 * a dot (`.git`, `.extensions`) or a `node_modules` directory.
 */
export function isExcludedPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith(".") || segment === "node_modules");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
