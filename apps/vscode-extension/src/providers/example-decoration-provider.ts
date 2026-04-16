import * as vscode from "vscode";
import { MINDCRAFT_EXAMPLE_SCHEME } from "../services/mindcraft-example-fs-provider";

export class ExampleDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== MINDCRAFT_EXAMPLE_SCHEME) {
      return undefined;
    }

    return new vscode.FileDecoration("Ex", "Example file", new vscode.ThemeColor("charts.purple"));
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
  }
}
