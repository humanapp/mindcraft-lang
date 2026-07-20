import type { IBrainDef } from "@mindcraft-lang/core/app";
import type { IBrainRuleDef } from "@mindcraft-lang/core/brain";
import { TypeDiagCode } from "@mindcraft-lang/core/brain/compiler";
import { BrainRuleDef } from "@mindcraft-lang/core/brain/model";

/**
 * One brain diagnostic as the compiler emitted it: the stable code, the rule
 * location within the brain, and the compiler's message text verbatim.
 * Rendered on console-style surfaces only, where machine forms are the
 * expected content.
 */
export interface BrainDiagnosticEntry {
  /** Stable diagnostic code of the underlying parse or type diagnostic. */
  readonly code: number;
  /** Rule location within the brain: the page name followed by the rule chain. */
  readonly location: string;
  /** The compiler's diagnostic message, verbatim. */
  readonly message: string;
}

function collectRuleDiagnostics(rule: IBrainRuleDef, out: BrainDiagnosticEntry[]): void {
  if (rule instanceof BrainRuleDef) {
    const result = rule.when().typecheckResult();
    if (result) {
      const location = rule.getLocationPath();
      result.whenParseResult.diags.forEach((diag) => {
        out.push({ code: diag.code, location, message: diag.message });
      });
      result.doParseResult.diags.forEach((diag) => {
        out.push({ code: diag.code, location, message: diag.message });
      });
      result.typeInfo.diags.forEach((diag) => {
        if (diag.code === TypeDiagCode.DataTypeConverted) {
          return;
        }
        out.push({ code: diag.code, location, message: diag.message });
      });
    }
  }
  rule.children().forEach((child) => {
    collectRuleDiagnostics(child, out);
  });
}

/**
 * Collect a brain's error diagnostics from the typecheck results stored on its
 * rules, verbatim. Reads stored state only; the brain is not re-typechecked.
 * A rule that has never been typechecked contributes nothing, and
 * informational type-conversion diagnostics are excluded.
 *
 * @param brain - The brain to read.
 */
export function collectBrainErrorDiagnostics(brain: IBrainDef): readonly BrainDiagnosticEntry[] {
  const out: BrainDiagnosticEntry[] = [];
  brain.pages().forEach((page) => {
    page.children().forEach((rule) => {
      collectRuleDiagnostics(rule, out);
    });
  });
  return out;
}
