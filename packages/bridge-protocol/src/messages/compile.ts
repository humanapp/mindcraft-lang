export interface CompileDiagnosticRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface CompileDiagnosticEntry {
  severity: "error" | "warning" | "info";
  message: string;
  code: string;
  range: CompileDiagnosticRange;
}

export interface CompileDiagnosticsPayload {
  file: string;
  version: number;
  diagnostics: CompileDiagnosticEntry[];
}

export interface CompileDiagnosticsMessage {
  type: "compile:diagnostics";
  id?: string;
  payload: CompileDiagnosticsPayload;
}

export interface CompileStatusPayload {
  file: string;
  success: boolean;
  diagnosticCount: { error: number; warning: number };
}

export interface CompileStatusMessage {
  type: "compile:status";
  id?: string;
  payload: CompileStatusPayload;
}
