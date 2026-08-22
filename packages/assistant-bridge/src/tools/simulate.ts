import type { DiagCode } from "@wendoo-lang/core/brain/compiler";
import type { ExcludedRule, TraceSummary } from "../simulate/summarizer.js";
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

/** A rehearsal that could not run because the scenario scripted an input kind the target does not read. */
export interface SimulationInputKindResult {
  readonly ok: false;
  readonly error: "unknown_input_kind";
  /** The kinds the scenario named that the target does not read, in first-seen order. */
  readonly named: readonly string[];
  /** Names of the input kinds the target does read. */
  readonly kinds: readonly string[];
}

/** Result of one `simulate` call. */
export type SimulationResult =
  | SimulationSummaryResult
  | SimulationBlockedResult
  | SimulationSubjectResult
  | SimulationInputKindResult;

/**
 * The rules a rehearsal would have to be staged without for the document to
 * build, each with the codes it carries, sorted by id. Empty when the build
 * has no error-severity diagnostic; `undefined` when some build error names no
 * rule, which no exclusion can work around.
 */
export function rulesToExclude(diagnostics: readonly CompileDiagnostic[]): ExcludedRule[] | undefined {
  const codesByRule = new Map<string, DiagCode[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== "error") continue;
    if (diagnostic.ruleId === undefined) return undefined;
    const codes = codesByRule.get(diagnostic.ruleId);
    if (codes) codes.push(diagnostic.code);
    else codesByRule.set(diagnostic.ruleId, [diagnostic.code]);
  }
  return [...codesByRule.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([ruleId, codes]) => ({ ruleId, codes }));
}

/**
 * Run the current brain in a bounded rehearsal and summarize what happened.
 * Compiles first. A brain whose build errors all fall in rules that can be
 * named is rehearsed without those rules, and the account states them; a build
 * error naming no rule blocks the run and is reported with its diagnostics. The
 * compiled actions the workspace's environment holds travel with the request,
 * so the staged world carries the same user tiles the document was written
 * against.
 */
export async function simulate(workspace: AuthoringWorkspace, input: ToolInput<"simulate">): Promise<SimulationResult> {
  const subjects = workspace.adapter.subjects();
  if (!subjects.includes(input.scenario.subject)) {
    return { ok: false, error: "unknown_subject", named: input.scenario.subject, subjects };
  }

  const kinds = workspace.adapter.inputKinds().map((kind) => kind.name);
  const scripted = input.scenario.inputs ?? [];
  const named = [...new Set(scripted.filter((entry) => !kinds.includes(entry.kind)).map((entry) => entry.kind))];
  if (named.length > 0) {
    return { ok: false, error: "unknown_input_kind", named, kinds };
  }

  const compiled = compileBrain(workspace);
  const excludedRules = compiled.ok ? [] : rulesToExclude(compiled.diagnostics);
  if (!excludedRules) {
    return { ok: false, error: "does_not_compile", diagnostics: compiled.diagnostics };
  }

  const actionBundle = workspace.environment.appliedActionBundle();
  const run = await workspace.adapter.run({
    brainDef: workspace.brainDef,
    scenario: input.scenario,
    thinks: input.thinks,
    ...(excludedRules.length > 0 ? { excludedRules: excludedRules.map((rule) => rule.ruleId) } : {}),
    ...(actionBundle ? { actionBundle } : {}),
  });
  return { ok: true, summary: summarizeRun(run, excludedRules) };
}
