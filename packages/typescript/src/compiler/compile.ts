import type { Program } from "@mindcraft-lang/core/brain";

export interface CompileDiagnostic {
  message: string;
  line?: number;
  column?: number;
}

export interface CompileResult {
  diagnostics: CompileDiagnostic[];
  program?: Program;
}

export function compileUserTile(source: string): CompileResult {
  return { diagnostics: [] };
}
