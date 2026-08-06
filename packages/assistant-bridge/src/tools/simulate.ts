import type { TraceSummary } from "../simulate/summarizer.js";
import { summarizeRun } from "../simulate/summarizer.js";
import type { CompileDiagnostic } from "./compile.js";
import { compileBrain } from "./compile.js";
import type { ToolInput } from "./tool-schemas.js";
import type { AuthoringWorkspace } from "./workspace.js";

/** A rehearsal that ran, with its summarized account. */
export interface SimulationSummaryResult {
  readonly ok: true;
  readonly summary: TraceSummary;
}

/** A rehearsal that could not run because the brain does not build. */
export interface SimulationBlockedResult {
  readonly ok: false;
  readonly error: "does_not_compile";
  readonly diagnostics: readonly CompileDiagnostic[];
}

/** A rehearsal that could not run because the scenario named an unknown subject. */
export interface SimulationSubjectResult {
  readonly ok: false;
  readonly error: "unknown_subject";
  readonly named: string;
  /** The subjects the target's rehearsal driver does offer. */
  readonly subjects: readonly string[];
}

/** Result of one `simulate` call. */
export type SimulationResult = SimulationSummaryResult | SimulationBlockedResult | SimulationSubjectResult;

/**
 * Run the current brain in a bounded rehearsal and summarize what happened.
 * Compiles first: a brain that does not build is reported with its diagnostics
 * and no run is staged.
 */
export async function simulate(workspace: AuthoringWorkspace, input: ToolInput<"simulate">): Promise<SimulationResult> {
  const subjects = workspace.adapter.subjects();
  if (!subjects.includes(input.scenario.subject)) {
    return { ok: false, error: "unknown_subject", named: input.scenario.subject, subjects };
  }

  const compiled = compileBrain(workspace);
  if (!compiled.ok) {
    return { ok: false, error: "does_not_compile", diagnostics: compiled.diagnostics };
  }

  const run = await workspace.adapter.run({
    brainDef: workspace.brainDef,
    scenario: input.scenario,
    thinks: input.thinks,
  });
  return { ok: true, summary: summarizeRun(run) };
}
