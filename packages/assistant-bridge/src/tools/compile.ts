import type { DiagnosticSeverity } from "@mindcraft-lang/core/brain/compiler";
import type { ToolDiagnostic } from "./diagnostics.js";
import { serializeDiagParams } from "./diagnostics.js";
import type { AuthoringWorkspace } from "./workspace.js";

/** One diagnostic the whole-brain build reported. */
export interface CompileDiagnostic extends ToolDiagnostic {
  /** Severity core reports the diagnostic at; only "error" blocks producing a program. */
  readonly severity: DiagnosticSeverity;
  /** Rule the diagnostic is about, absent when it names none. */
  readonly ruleId?: string;
}

/** Result of one `compile` call. */
export interface CompileResult {
  /** `true` when the brain compiled and linked to a runnable program. */
  readonly ok: boolean;
  readonly diagnostics: readonly CompileDiagnostic[];
}

/** Compile and link the whole brain, and report its diagnostics. */
export function compileBrain(workspace: AuthoringWorkspace): CompileResult {
  const build = workspace.environment.linkBrain(workspace.brainDef);
  const diagnostics: CompileDiagnostic[] = [];
  build.diagnostics.forEach((diag) => {
    const params = serializeDiagParams(diag.params);
    diagnostics.push({
      code: diag.code,
      severity: diag.severity,
      ...(diag.params?.rulePath ? { ruleId: diag.params.rulePath } : {}),
      ...(params ? { params } : {}),
    });
  });
  return { ok: build.program !== undefined, diagnostics };
}
