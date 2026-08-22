import * as vscode from "vscode";
import type { WendooFileSystemProvider } from "../services/wendoo-fs-provider";
import { WENDOO_SCHEME } from "../services/wendoo-fs-provider";
import { WENDOO_JSON } from "../wendoo-json";

export class WendooJsonCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly _fsProvider: WendooFileSystemProvider) {
    _fsProvider.onDidChangeWendooJsonLock(() => this._onDidChangeCodeLenses.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme !== WENDOO_SCHEME) {
      return [];
    }

    const path = document.uri.path.replace(/^\//, "");
    if (path !== WENDOO_JSON) {
      return [];
    }

    const range = new vscode.Range(0, 0, 0, 0);

    if (this._fsProvider.isWendooJsonUnlocked) {
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
        command: "wendoo.unlockWendooJson",
      }),
    ];
  }
}
