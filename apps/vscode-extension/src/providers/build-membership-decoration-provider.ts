import * as vscode from "vscode";
import { type BuildMembershipTracker, isBuildMembershipPath } from "../services/build-membership-tracker";

/**
 * Decorates project files that are not named by the manifest `files` list
 * with a neutral "Not in build" badge. Files the list names, the manifest
 * itself, and the `.extensions/` tree carry no decoration; when the project
 * declares no `files` list, nothing is decorated.
 */
export class BuildMembershipDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  constructor(
    private readonly _scheme: string,
    private readonly _tracker: BuildMembershipTracker
  ) {
    _tracker.onDidChange(() => this._onDidChangeFileDecorations.fire(undefined));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== this._scheme) return undefined;
    if (this._tracker.filesList === undefined) return undefined;
    const path = uri.path.replace(/^\//, "");
    if (!isBuildMembershipPath(path)) return undefined;
    if (!this._tracker.isProjectFile(path)) return undefined;
    if (this._tracker.isInBuild(path)) return undefined;
    return new vscode.FileDecoration("-", "Not in build");
  }
}
