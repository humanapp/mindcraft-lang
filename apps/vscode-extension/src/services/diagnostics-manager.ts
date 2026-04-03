import type { CompileDiagnosticsPayload } from "@mindcraft-lang/bridge-protocol";
import * as vscode from "vscode";
import { MINDCRAFT_SCHEME } from "./mindcraft-fs-provider";

const SEVERITY_MAP: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export class DiagnosticsManager implements vscode.Disposable {
  private readonly _collection: vscode.DiagnosticCollection;
  private readonly _versions = new Map<string, number>();

  constructor() {
    this._collection = vscode.languages.createDiagnosticCollection("mindcraft");
  }

  handleDiagnostics(payload: CompileDiagnosticsPayload): void {
    const { file, version, diagnostics } = payload;

    const lastVersion = this._versions.get(file);
    if (lastVersion !== undefined && version < lastVersion) return;
    this._versions.set(file, version);

    const uri = vscode.Uri.from({ scheme: MINDCRAFT_SCHEME, path: `/${file}` });
    const mapped = diagnostics.map((entry) => {
      const range = new vscode.Range(
        entry.range.startLine - 1,
        entry.range.startColumn - 1,
        entry.range.endLine - 1,
        entry.range.endColumn - 1
      );
      const diag = new vscode.Diagnostic(
        range,
        entry.message,
        SEVERITY_MAP[entry.severity] ?? vscode.DiagnosticSeverity.Error
      );
      diag.code = entry.code;
      diag.source = "mindcraft";
      return diag;
    });

    this._collection.set(uri, mapped);
  }

  clear(): void {
    this._collection.clear();
    this._versions.clear();
  }

  dispose(): void {
    this._collection.dispose();
  }
}
