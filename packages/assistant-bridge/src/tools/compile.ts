import type { DiagnosticSeverity } from "@wendoo/core/brain/compiler";
import type { ToolDiagnostic } from "./diagnostics.js";
import { serializeDiagParams } from "./diagnostics.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { ruleIdsByPath } from "./workspace.js";

/** One diagnostic the whole-brain build reported. */
export interface CompileDiagnostic extends ToolDiagnostic {
  /** Severity core reports the diagnostic at; only "error" blocks producing a program. */
  readonly severity: DiagnosticSeverity;
  /** Durable id of the rule the diagnostic is about, absent when it names none. */
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
  const ruleIds = ruleIdsByPath(workspace.brainDef);
  const diagnostics: CompileDiagnostic[] = [];
  build.diagnostics.forEach((diag) => {
    const params = serializeDiagParams(diag.params, ruleIds);
    const ruleId = params?.ruleId;
    diagnostics.push({
      code: diag.code,
      severity: diag.severity,
      ...(typeof ruleId === "string" ? { ruleId } : {}),
      ...(params ? { params } : {}),
    });
  });
  return { ok: build.program !== undefined, diagnostics };
}
