import { fileContentText } from "@mindcraft-lang/app-host";
import {
  findMissingListedFiles,
  isFileInBuild,
  readManifestFilesList,
} from "@mindcraft-lang/bridge-app/manifest-files";
import type { IFileSystem } from "@mindcraft-lang/bridge-client";
import * as vscode from "vscode";
import { MINDCRAFT_JSON } from "../mindcraft-json";

/** Diagnostic code for a manifest `files` entry that is absent from the project. */
export const LISTED_FILE_MISSING_CODE = "MINDCRAFT_LISTED_FILE_MISSING";

const EXTENSIONS_TREE_PREFIX = ".libraries/";

/**
 * True when `path` (project-root-relative, no leading slash) participates in
 * build membership: project files other than the manifest itself and the
 * read-only `.libraries/` dependency tree.
 */
export function isBuildMembershipPath(path: string): boolean {
  return path !== "" && path !== MINDCRAFT_JSON && !path.startsWith(EXTENSIONS_TREE_PREFIX);
}

/**
 * Tracks the connected project's build membership: the manifest `files` list
 * naming what is in the build, and error diagnostics for listed entries that
 * are absent from the project. Call {@link refresh} whenever project content
 * may have changed; `onDidChange` fires after every refresh.
 */
export class BuildMembershipTracker implements vscode.Disposable {
  private readonly _diagnostics = vscode.languages.createDiagnosticCollection("mindcraft-build");
  private _readFs: IFileSystem | undefined;
  private _files: readonly string[] | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly _scheme: string) {}

  /** The manifest `files` list, or undefined when the project declares none. */
  get filesList(): readonly string[] | undefined {
    return this._files;
  }

  /** True when the manifest lists `path` (project-root-relative) in the build. */
  isInBuild(path: string): boolean {
    return this._files !== undefined && isFileInBuild(this._files, path);
  }

  /** True when `path` (project-root-relative) exists in the project as a file. */
  isProjectFile(path: string): boolean {
    const fs = this._readFs;
    if (!fs) return false;
    try {
      return fs.stat(path).kind === "file";
    } catch {
      return false;
    }
  }

  /**
   * Re-read the manifest from `readFs`, recompute membership state and the
   * listed-but-missing diagnostics, and notify listeners. Pass `undefined`
   * when no project is connected to clear all state.
   */
  refresh(readFs: IFileSystem | undefined): void {
    this._readFs = readFs;
    let manifestText: string | undefined;
    if (readFs) {
      try {
        manifestText = fileContentText(readFs.read(MINDCRAFT_JSON));
      } catch {
        manifestText = undefined;
      }
    }
    this._files = manifestText === undefined ? undefined : readManifestFilesList(manifestText);
    this._updateDiagnostics(manifestText);
    this._onDidChange.fire();
  }

  private _updateDiagnostics(manifestText: string | undefined): void {
    this._diagnostics.clear();
    const fs = this._readFs;
    if (!fs || this._files === undefined || manifestText === undefined) return;

    const missing = findMissingListedFiles(this._files, (path) => {
      try {
        fs.stat(path);
        return true;
      } catch {
        return false;
      }
    });
    if (missing.length === 0) return;

    const uri = vscode.Uri.from({ scheme: this._scheme, path: `/${MINDCRAFT_JSON}` });
    const diagnostics = missing.map((entry) => {
      const diagnostic = new vscode.Diagnostic(
        entryRange(manifestText, entry),
        `"${entry}" is listed in "files" but missing from the project.`,
        vscode.DiagnosticSeverity.Error
      );
      diagnostic.code = LISTED_FILE_MISSING_CODE;
      diagnostic.source = "mindcraft";
      return diagnostic;
    });
    this._diagnostics.set(uri, diagnostics);
  }

  dispose(): void {
    this._diagnostics.dispose();
    this._onDidChange.dispose();
  }
}

/** Range of `entry`'s quoted occurrence in the manifest text, or the file start. */
function entryRange(manifestText: string, entry: string): vscode.Range {
  const needle = JSON.stringify(entry);
  const index = manifestText.indexOf(needle);
  if (index === -1) {
    return new vscode.Range(0, 0, 0, 0);
  }
  const before = manifestText.slice(0, index);
  const line = before.split("\n").length - 1;
  const column = index - (before.lastIndexOf("\n") + 1);
  return new vscode.Range(line, column, line, column + needle.length);
}
