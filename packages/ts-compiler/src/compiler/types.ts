import type { BrainServices, UserActionArtifact } from "@mindcraft-lang/core/brain";
import type ts from "typescript";
import type { TsDiagCode } from "./diag-codes.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface CompileDiagnostic {
  code: TsDiagCode;
  message: string;
  severity: DiagnosticSeverity;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface UserAuthoredProgram extends UserActionArtifact {
  name: string;
  args: ExtractedArgSpec[];
  debugMetadata?: DebugMetadata;
  label?: string;
  iconUrl?: string;
  docsMarkdown?: string;
  tags?: string[];
}

export interface LinkedUserProgram {
  program: UserAuthoredProgram;
  functionOffset: number;
  constantOffset: number;
  variableOffset: number;
  linkedDebugMetadata?: DebugMetadata;
}

export interface CompileOptions {
  ambientSource?: string;
  services: BrainServices;
}

export interface SourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface ExtractedDescriptor {
  kind: "sensor" | "actuator";
  name: string;
  returnType: string | undefined;
  args: ExtractedArgSpec[];
  execIsAsync: boolean;
  onExecuteNode: ts.FunctionExpression | ts.MethodDeclaration | ts.ArrowFunction;
  onPageEnteredNode: ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction | null;
  label?: string;
  icon?: string;
  iconSpan?: SourceSpan;
  docs?: string;
  docsSpan?: SourceSpan;
  tags?: string[];
}

export interface ExtractedModifier {
  kind: "modifier";
  id: string;
  label: string;
  icon?: string;
}

export interface ExtractedParam {
  kind: "param";
  name: string;
  type: string;
  defaultValue?: number | string | boolean | null;
  anonymous: boolean;
}

export type ExtractedArgSpec =
  | ExtractedModifier
  | ExtractedParam
  | ExtractedChoice
  | ExtractedOptional
  | ExtractedRepeated
  | ExtractedConditional
  | ExtractedSeq;

export interface ExtractedChoice {
  kind: "choice";
  name?: string;
  items: ExtractedArgSpec[];
}

export interface ExtractedOptional {
  kind: "optional";
  item: ExtractedArgSpec;
}

export interface ExtractedRepeated {
  kind: "repeated";
  item: ExtractedArgSpec;
  min?: number;
  max?: number;
}

export interface ExtractedConditional {
  kind: "conditional";
  condition: string;
  thenItem: ExtractedArgSpec;
  elseItem?: ExtractedArgSpec;
}

export interface ExtractedSeq {
  kind: "seq";
  items: ExtractedArgSpec[];
}

export interface DebugMetadata {
  files: DebugFileInfo[];
  functions: DebugFunctionInfo[];
}

export interface DebugFileInfo {
  fileIndex: number;
  path: string;
  sourceHash: string;
}

export interface DebugFunctionInfo {
  debugFunctionId: string;
  compiledFuncId: number;
  fileIndex: number;
  prettyName: string;
  isGenerated: boolean;
  sourceSpan: DebugSpan;
  spans: DebugSpan[];
  pcToSpanIndex: number[];
  scopes: ScopeInfo[];
  locals: LocalInfo[];
  callSites: CallSiteInfo[];
  suspendSites: SuspendSiteInfo[];
}

export interface DebugSpan {
  spanId: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  isStatementBoundary: boolean;
}

export interface ScopeInfo {
  scopeId: number;
  kind: "function" | "block" | "module" | "brain";
  parentScopeId: number | null;
  startPc: number;
  endPc: number;
  name: string | null;
}

export interface LocalInfo {
  name: string;
  slotIndex: number;
  storageKind: "local" | "parameter" | "capture";
  scopeId: number;
  lifetimeStartPc: number;
  lifetimeEndPc: number;
  typeHint: string | null;
}

export interface CallSiteInfo {
  pc: number;
  callSiteId: number;
  targetDebugFunctionId: string | null;
  isAsync: boolean;
}

export interface SuspendSiteInfo {
  awaitPc: number;
  resumePc: number;
  sourceSpan: DebugSpan;
}
