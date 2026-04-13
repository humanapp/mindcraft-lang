import { z } from "zod";

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

const compileDiagnosticRangeSchema = z.object({
  startLine: z.number(),
  startColumn: z.number(),
  endLine: z.number(),
  endColumn: z.number(),
});

const compileDiagnosticEntrySchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  code: z.string(),
  range: compileDiagnosticRangeSchema,
});

export const compileDiagnosticsPayloadSchema = z.object({
  file: z.string(),
  version: z.number(),
  diagnostics: z.array(compileDiagnosticEntrySchema),
});

export const compileStatusPayloadSchema = z.object({
  file: z.string(),
  success: z.boolean(),
  diagnosticCount: z.object({
    error: z.number(),
    warning: z.number(),
  }),
});
