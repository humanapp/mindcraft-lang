import * as vscode from "vscode";
import { type BuildMembershipTracker, isBuildMembershipPath } from "../services/build-membership-tracker";

/**
 * Offers a single membership-toggle CodeLens on project files when the
 * manifest declares a `files` list: "Add to build" on an unlisted file,
 * "Remove from build" on a listed one. The manifest itself and the
 * `.extensions/` tree get no lens.
 */
export class BuildMembershipCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly _tracker: BuildMembershipTracker) {
    _tracker.onDidChange(() => this._onDidChangeCodeLenses.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (this._tracker.filesList === undefined) return [];
    const path = document.uri.path.replace(/^\//, "");
    if (!isBuildMembershipPath(path)) return [];

    const range = new vscode.Range(0, 0, 0, 0);
    if (this._tracker.isInBuild(path)) {
      return [
        new vscode.CodeLens(range, {
          title: "In build - Remove from build",
          tooltip: "Remove this file from the manifest files list. The file stays in the project.",
          command: "mindcraft.toggleFileInBuild",
          arguments: [document.uri],
        }),
      ];
    }
    return [
      new vscode.CodeLens(range, {
        title: "Not in build - Add to build",
        tooltip: "Add this file to the manifest files list so the build includes it.",
        command: "mindcraft.toggleFileInBuild",
        arguments: [document.uri],
      }),
    ];
  }
}
