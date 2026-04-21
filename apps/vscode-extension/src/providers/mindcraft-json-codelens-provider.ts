import * as vscode from "vscode";
import type { MindcraftFileSystemProvider } from "../services/mindcraft-fs-provider";
import { MINDCRAFT_JSON, MINDCRAFT_SCHEME } from "../services/mindcraft-fs-provider";

export class MindcraftJsonCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly _fsProvider: MindcraftFileSystemProvider) {
    _fsProvider.onDidChangeMindcraftJsonLock(() => this._onDidChangeCodeLenses.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme !== MINDCRAFT_SCHEME) {
      return [];
    }

    const path = document.uri.path.replace(/^\//, "");
    if (path !== MINDCRAFT_JSON) {
      return [];
    }

    const range = new vscode.Range(0, 0, 0, 0);

    if (this._fsProvider.isMindcraftJsonUnlocked) {
      return [
        new vscode.CodeLens(range, {
          title: "$(warning) Editing unlocked. Be careful, manual changes may break your project.",
          command: "",
        }),
      ];
    }

    return [
      new vscode.CodeLens(range, {
        title: "$(lock) This file is auto-managed. Manual edits may break your project.",
        command: "",
      }),
      new vscode.CodeLens(range, {
        title: "$(key) Unlock for Editing",
        command: "mindcraft.unlockMindcraftJson",
      }),
    ];
  }
}
