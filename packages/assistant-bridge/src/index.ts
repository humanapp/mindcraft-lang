export type { CatalogDigest } from "./catalog/digest.js";
export { catalogDigest, languageGrammarLegend } from "./catalog/digest.js";
export type { ExcludedRule, RuleTotals, ThinkSummary, TraceSpan, TraceSummary } from "./simulate/summarizer.js";
export { summarizeRun } from "./simulate/summarizer.js";
export type {
  AdapterArtifactResult,
  AdapterExpectation,
  AdapterNonconformance,
  DispatchObservation,
  GateObservation,
  OperationEnding,
  PageSwitchObservation,
  ScenarioInput,
  ScenarioInputKind,
  SimulationRequest,
  SimulationRun,
  SimulationScenario,
  TargetAdapter,
  TargetManifest,
  ThinkObservation,
  WorldObservation,
} from "./target/adapter.js";
export {
  ADAPTER_CONTRACT_VERSION,
  AdapterNonconformanceCode,
  adapterMethods,
  adapterNonconformance,
  DispatchOutcome,
  readAdapterArtifact,
} from "./target/adapter.js";
export type { CompileDiagnostic, CompileResult } from "./tools/compile.js";
export { compileBrain } from "./tools/compile.js";
export type {
  DiagnosticRuleSideName,
  DiagParamValue,
  SerializedDiagParams,
  ToolDiagnostic,
} from "./tools/diagnostics.js";
export { ruleSideName, serializeDiagParams, toToolDiagnostic } from "./tools/diagnostics.js";
export type { ToolCallError, ToolCallOutcome } from "./tools/dispatch.js";
export { executeToolCall, isToolName, ToolCallErrorCode } from "./tools/dispatch.js";
export type {
  BatchAccepted,
  BatchResult,
  ProposalAccepted,
  ProposalRejected,
  ProposalResult,
  ProposalUnresolved,
} from "./tools/propose-edit.js";
export { batchReplayStepMs, proposeEdit, proposeEditBatch, resolveRunEntry } from "./tools/propose-edit.js";
export type { CatalogTile, CatalogView } from "./tools/read-catalog.js";
export { readCatalog } from "./tools/read-catalog.js";
export type { ProjectPage, ProjectRule, ProjectTile, ProjectView } from "./tools/read-project.js";
export { readProject, readRule } from "./tools/read-project.js";
export type { PolicyDecision, ProposalPolicyEntry, ProposalVerdict } from "./tools/rejection-policy.js";
export { acceptedDiagCodes, decideProposal, proposalPolicy, proposalVerdict } from "./tools/rejection-policy.js";
export type {
  SimulationBlockedResult,
  SimulationInputKindResult,
  SimulationResult,
  SimulationSubjectResult,
  SimulationSummaryResult,
} from "./tools/simulate.js";
export { simulate } from "./tools/simulate.js";
export type { SuggestedTile, SuggestionError, SuggestionView } from "./tools/suggest-tiles.js";
export { suggestTiles } from "./tools/suggest-tiles.js";
export { descriptionFromMarkdown, sessionTileDescriptions } from "./tools/tile-descriptions.js";
export type {
  ProposeEditBatchInput,
  ProposeEditInput,
  RuleSideName,
  TileRunEntry,
  ToolDefinition,
  ToolInput,
  ToolName,
} from "./tools/tool-schemas.js";
export {
  batchRuleIndex,
  scenarioInputSchema,
  tileRunEntrySchema,
  toolDefinitions,
  toolInputSchemas,
} from "./tools/tool-schemas.js";
export type { AuthoringWorkspace, AuthoringWorkspaceOptions, LocatedRule } from "./tools/workspace.js";
export {
  allTiles,
  createAuthoringWorkspace,
  findPage,
  findRule,
  findTile,
  isNestedRulePath,
  locateRules,
  ruleIdsByPath,
  toRuleSide,
} from "./tools/workspace.js";
