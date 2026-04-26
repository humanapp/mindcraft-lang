import { z } from "zod";

/** Zero-based source range of a {@link CompileDiagnosticEntry}. */
export interface CompileDiagnosticRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** A single compiler diagnostic for a file. */
export interface CompileDiagnosticEntry {
  severity: "error" | "warning" | "info";
  message: string;
  /** Diagnostic code identifier. */
  code: string;
  range: CompileDiagnosticRange;
}

/** Payload of {@link CompileDiagnosticsMessage}: all diagnostics for one file. */
export interface CompileDiagnosticsPayload {
  /** File path the diagnostics apply to. */
  file: string;
  /** File-content version the diagnostics were computed against. */
  version: number;
  diagnostics: CompileDiagnosticEntry[];
}

/** Pushes the current diagnostics for a single file to the peer. */
export interface CompileDiagnosticsMessage {
  type: "compile:diagnostics";
  id?: string;
  payload: CompileDiagnosticsPayload;
}

/** Payload of {@link CompileStatusMessage}: pass/fail summary for a file. */
export interface CompileStatusPayload {
  file: string;
  success: boolean;
  diagnosticCount: { error: number; warning: number };
}

/** Pushes a compile pass/fail summary for a single file to the peer. */
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

/** Schema for {@link CompileDiagnosticsPayload}. */
export const compileDiagnosticsPayloadSchema = z.object({
  file: z.string(),
  version: z.number(),
  diagnostics: z.array(compileDiagnosticEntrySchema),
});

/** Schema for {@link CompileStatusPayload}. */
export const compileStatusPayloadSchema = z.object({
  file: z.string(),
  success: z.boolean(),
  diagnosticCount: z.object({
    error: z.number(),
    warning: z.number(),
  }),
});
