import * as vscode from "vscode";
import { MINDCRAFT_EXAMPLE_SCHEME } from "../services/mindcraft-example-fs-provider";

export class ExampleCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme !== MINDCRAFT_EXAMPLE_SCHEME) {
      return [];
    }

    const folder = document.uri.path.replace(/^\//, "").split("/")[0];
    if (!folder) return [];

    const range = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(range, {
        title: "$(cloud-download) Copy to Workspace",
        command: "mindcraft.copyExampleToWorkspace",
        arguments: [folder],
      }),
    ];
  }
}
