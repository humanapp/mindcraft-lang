import type { BrainServices, ConstantOffsets, UserActionArtifact } from "@mindcraft-lang/core/brain";
import type ts from "typescript";
import type { TsDiagCode } from "./diag-codes.js";

/** Severity classification for a {@link CompileDiagnostic}. */
export type DiagnosticSeverity = "error" | "warning" | "info";

/** A diagnostic produced by any phase of the user-tile compiler. Lines and columns are 1-based when present. */
export interface CompileDiagnostic {
  code: TsDiagCode;
  message: string;
  severity: DiagnosticSeverity;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

/** Compiler output for a single user tile: a {@link UserActionArtifact} extended with extracted descriptor metadata. */
export interface UserAuthoredProgram extends UserActionArtifact {
  name: string;
  args: ExtractedArgSpec[];
  debugMetadata?: DebugMetadata;
  label?: string;
  iconUrl?: string;
  docsMarkdown?: string;
  tags?: string[];
}

/** A {@link UserAuthoredProgram} plus the offsets at which the linker placed its functions, constants, and variables in the merged brain program. */
export interface LinkedUserProgram {
  program: UserAuthoredProgram;
  functionOffset: number;
  constantOffsets: ConstantOffsets;
  variableOffset: number;
  linkedDebugMetadata?: DebugMetadata;
}

/** Options passed to the user-tile compiler. */
export interface CompileOptions {
  /** Override the ambient `.d.ts` source. When omitted, declarations are generated from `services.types`. */
  ambientSource?: string;
  services: BrainServices;
}

/** A 1-based source range produced by the descriptor extractor. */
export interface SourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/** Descriptor extracted from a `Sensor({...})` or `Actuator({...})` default export. */
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

/** Modifier arg spec extracted from a `modifier(...)` call. */
export interface ExtractedModifier {
  kind: "modifier";
  id: string;
  label: string;
  icon?: string;
}

/** Parameter arg spec extracted from a `param(...)` call or a top-level `params` object. */
export interface ExtractedParam {
  kind: "param";
  name: string;
  type: string;
  defaultValue?: number | string | boolean | null;
  anonymous: boolean;
}

/** Tagged-union of arg spec shapes accepted by the descriptor extractor. */
export type ExtractedArgSpec =
  | ExtractedModifier
  | ExtractedParam
  | ExtractedChoice
  | ExtractedOptional
  | ExtractedRepeated
  | ExtractedConditional
  | ExtractedSeq;

/** Choice arg spec: any one of `items` may appear at the call site. */
export interface ExtractedChoice {
  kind: "choice";
  name?: string;
  items: ExtractedArgSpec[];
}

/** Optional arg spec: `item` may be omitted at the call site. */
export interface ExtractedOptional {
  kind: "optional";
  item: ExtractedArgSpec;
}

/** Repeated arg spec: `item` may appear between `min` and `max` times. */
export interface ExtractedRepeated {
  kind: "repeated";
  item: ExtractedArgSpec;
  min?: number;
  max?: number;
}

/** Conditional arg spec: `thenItem` is included when `condition` is satisfied at the call site, otherwise `elseItem`. */
export interface ExtractedConditional {
  kind: "conditional";
  condition: string;
  thenItem: ExtractedArgSpec;
  elseItem?: ExtractedArgSpec;
}

/** Sequence arg spec: `items` appear in order at the call site. */
export interface ExtractedSeq {
  kind: "seq";
  items: ExtractedArgSpec[];
}

/** Debug metadata for a compiled user-tile program: per-file source info and per-function PC mappings. */
export interface DebugMetadata {
  files: DebugFileInfo[];
  functions: DebugFunctionInfo[];
}

/** Identifies a source file referenced by debug spans. */
export interface DebugFileInfo {
  fileIndex: number;
  path: string;
  sourceHash: string;
}

/** Per-function debug info: spans, PC-to-span map, scopes, locals, and call/suspend sites. */
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

/** A source-position range tagged with a `spanId` and a flag marking statement boundaries. */
export interface DebugSpan {
  spanId: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  isStatementBoundary: boolean;
}

/** A lexical scope for debug inspection: function, block, module, or brain. */
export interface ScopeInfo {
  scopeId: number;
  kind: "function" | "block" | "module" | "brain";
  parentScopeId: number | null;
  startPc: number;
  endPc: number;
  name: string | null;
}

/** A local variable's slot, scope, lifetime, and (optional) static type hint for debug inspection. */
export interface LocalInfo {
  name: string;
  slotIndex: number;
  storageKind: "local" | "parameter" | "capture";
  scopeId: number;
  lifetimeStartPc: number;
  lifetimeEndPc: number;
  typeHint: string | null;
}

/** Identifies a `Call` instruction at PC `pc`, with the target function (when known) and async flag. */
export interface CallSiteInfo {
  pc: number;
  callSiteId: number;
  targetDebugFunctionId: string | null;
  isAsync: boolean;
}

/** Identifies the PC range and source span surrounding an `await` site. */
export interface SuspendSiteInfo {
  awaitPc: number;
  resumePc: number;
  sourceSpan: DebugSpan;
}
