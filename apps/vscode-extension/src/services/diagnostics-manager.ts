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
  private readonly _fileCounts = new Map<string, { errors: number; warnings: number }>();
  private _totalErrors = 0;
  private _totalWarnings = 0;
  private readonly _onDidChangeCounts = new vscode.EventEmitter<{ errors: number; warnings: number }>();
  readonly onDidChangeCounts = this._onDidChangeCounts.event;

  constructor() {
    this._collection = vscode.languages.createDiagnosticCollection("mindcraft");
  }

  get compileCounts(): { errors: number; warnings: number } {
    return { errors: this._totalErrors, warnings: this._totalWarnings };
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
    this._updateFileCounts(file, diagnostics);
  }

  private _updateFileCounts(file: string, diagnostics: CompileDiagnosticsPayload["diagnostics"]): void {
    const old = this._fileCounts.get(file) ?? { errors: 0, warnings: 0 };
    const newErrors = diagnostics.filter((d) => d.severity === "error").length;
    const newWarnings = diagnostics.filter((d) => d.severity === "warning").length;

    const prevTotalErrors = this._totalErrors;
    const prevTotalWarnings = this._totalWarnings;
    this._totalErrors += newErrors - old.errors;
    this._totalWarnings += newWarnings - old.warnings;
    this._fileCounts.set(file, { errors: newErrors, warnings: newWarnings });

    if (this._totalErrors !== prevTotalErrors || this._totalWarnings !== prevTotalWarnings) {
      this._onDidChangeCounts.fire({ errors: this._totalErrors, warnings: this._totalWarnings });
    }
  }

  clear(): void {
    const hadCounts = this._totalErrors > 0 || this._totalWarnings > 0;
    this._collection.clear();
    this._versions.clear();
    this._fileCounts.clear();
    this._totalErrors = 0;
    this._totalWarnings = 0;
    if (hadCounts) {
      this._onDidChangeCounts.fire({ errors: 0, warnings: 0 });
    }
  }

  dispose(): void {
    this._collection.dispose();
    this._onDidChangeCounts.dispose();
  }
}
