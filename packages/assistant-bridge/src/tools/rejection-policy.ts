import type { DiagCode, DiagnosticSeverity } from "@wendoo/core/brain/compiler";
import {
  CompilationDiagCode,
  diagnosticSeverity,
  LinkDiagCode,
  ParseDiagCode,
  TypeDiagCode,
} from "@wendoo/core/brain/compiler";
import type { DiagParamValue, SerializedDiagParams, ToolDiagnostic } from "./diagnostics.js";

/** What the bridge does with a proposed edit that produced a given diagnostic. */
export type ProposalVerdict = "accept" | "reject";

/**
 * The only diagnostic codes an edit may carry and still land in the document.
 * An edit reporting any code not listed here is rejected, whatever severity
 * core reports that code at.
 */
export const acceptedDiagCodes: readonly DiagCode[] = [TypeDiagCode.DataTypeConverted];

/** One row of {@link proposalPolicy}. */
export interface ProposalPolicyEntry {
  /** Stable numeric diagnostic code. */
  readonly code: DiagCode;
  /** Severity core reports the code at, everywhere it reports it. */
  readonly coreSeverity: DiagnosticSeverity;
  /** What the bridge does with an edit that produced the code. */
  readonly verdict: ProposalVerdict;
}

/** Numeric members of one core diagnostic-code enum, in declaration order. */
function codesOf(enumObject: Record<string, string | number>): DiagCode[] {
  const codes: DiagCode[] = [];
  for (const value of Object.values(enumObject)) {
    if (typeof value === "number") codes.push(value as DiagCode);
  }
  return codes;
}

/**
 * The bridge's verdict for one diagnostic code, independent of where the code
 * was reported.
 */
export function proposalVerdict(code: DiagCode): ProposalVerdict {
  return acceptedDiagCodes.includes(code) ? "accept" : "reject";
}

/**
 * Every diagnostic code the compile pipeline can report, with the severity core
 * gives it and the verdict the bridge applies. This is the whole policy; see
 * {@link decideProposal} for how an edit's diagnostics are read against it.
 */
export const proposalPolicy: readonly ProposalPolicyEntry[] = [
  ...codesOf(ParseDiagCode),
  ...codesOf(TypeDiagCode),
  ...codesOf(CompilationDiagCode),
  ...codesOf(LinkDiagCode),
].map((code) => ({
  code,
  coreSeverity: diagnosticSeverity(code),
  verdict: proposalVerdict(code),
}));

/** Outcome of applying {@link proposalPolicy} to one proposed edit's diagnostics. */
export interface PolicyDecision {
  readonly verdict: ProposalVerdict;
  /** The diagnostic that rejected the edit; absent when the edit was accepted. */
  readonly rejectedBy?: ToolDiagnostic;
}

/** Sort key placing errors ahead of warnings and warnings ahead of infos. */
function severityRank(code: DiagCode): number {
  const severity = diagnosticSeverity(code);
  if (severity === "error") return 0;
  return severity === "warning" ? 1 : 2;
}

/**
 * Decide one proposed edit from every diagnostic reported for it. The rejecting
 * diagnostic is the most severe one carrying a "reject" verdict, and among
 * equally severe ones the first reported.
 */
export function decideProposal(diagnostics: readonly ToolDiagnostic[]): PolicyDecision {
  let rejectedBy: ToolDiagnostic | undefined;
  for (const diagnostic of diagnostics) {
    if (proposalVerdict(diagnostic.code) === "accept") continue;
    if (rejectedBy === undefined || severityRank(diagnostic.code) < severityRank(rejectedBy.code)) {
      rejectedBy = diagnostic;
    }
  }
  return rejectedBy ? { verdict: "reject", rejectedBy } : { verdict: "accept" };
}

/**
 * The params a refusal reports for `rejectedBy`, filled out from the rest of
 * `diagnostics`: what `rejectedBy` reports itself, the rule the edit was judged
 * on (`editedRuleId`) when `rejectedBy` names no rule, and the side and tile
 * that a dropped-expression diagnostic in the same rule pins for the same
 * failure. A value `rejectedBy` reports is never replaced, so the result always
 * carries every param it reported, plus `ruleId`.
 *
 * @param editedRuleId - Durable id of the rule the edit was judged on.
 */
export function rejectionParams(
  rejectedBy: ToolDiagnostic,
  diagnostics: readonly ToolDiagnostic[],
  editedRuleId: string
): SerializedDiagParams {
  const params: Record<string, DiagParamValue> = { ...rejectedBy.params };
  const reported = params.ruleId;
  const ruleId = typeof reported === "string" ? reported : editedRuleId;
  params.ruleId = ruleId;

  const dropped = diagnostics.find(
    (diagnostic) =>
      diagnostic.code === CompilationDiagCode.UncompilableExpressionDropped && diagnostic.params?.ruleId === ruleId
  );
  for (const key of ["side", "tileId"] as const) {
    const value = dropped?.params?.[key];
    if (value !== undefined && params[key] === undefined) params[key] = value;
  }
  return params;
}
