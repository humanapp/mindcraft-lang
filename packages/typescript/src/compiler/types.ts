import type { UserActionArtifact } from "@mindcraft-lang/core/brain";
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
  params: ExtractedParam[];
  debugMetadata?: DebugMetadata;
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
}

export interface ExtractedDescriptor {
  kind: "sensor" | "actuator";
  name: string;
  outputType: string | undefined;
  params: ExtractedParam[];
  execIsAsync: boolean;
  onExecuteNode: ts.FunctionExpression | ts.MethodDeclaration | ts.ArrowFunction;
  onPageEnteredNode: ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction | null;
}

export interface ExtractedParam {
  name: string;
  type: string;
  defaultValue?: number | string | boolean | null;
  required: boolean;
  anonymous: boolean;
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
