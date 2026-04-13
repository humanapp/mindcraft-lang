export { buildAmbientDeclarations } from "./compiler/ambient.js";
export type {
  CompileDiagnostic,
  CompileOptions,
  CompileResult,
  ExtractedArgSpec,
  ExtractedChoice,
  ExtractedConditional,
  ExtractedDescriptor,
  ExtractedModifier,
  ExtractedOptional,
  ExtractedParam,
  ExtractedRepeated,
  ExtractedSeq,
  ProjectCompileResult,
} from "./compiler/compile.js";
export { collectParams, compileUserTile, isCompilerControlledPath, UserTileProject } from "./compiler/compile.js";
export type { TsDiagCode } from "./compiler/diag-codes.js";
export {
  CompileDiagCode,
  DescriptorDiagCode,
  EmitDiagCode,
  LoweringDiagCode,
  ValidatorDiagCode,
} from "./compiler/diag-codes.js";
export type { LinkedUserProgram, UserAuthoredProgram } from "./compiler/types.js";
export { isCallSpec, isExtractedParam, isOptionalString, isOptionalStringArray, isRecord } from "./guards.js";
export type { LinkResult } from "./linker/linker.js";
export { linkUserPrograms } from "./linker/linker.js";
export type { BuildCompiledActionBundleOptions } from "./runtime/action-bundle.js";
export { buildCompiledActionBundle } from "./runtime/action-bundle.js";
export type {
  CreateWorkspaceCompilerOptions,
  WorkspaceChange,
  WorkspaceCompileResult,
  WorkspaceCompiler,
  WorkspaceDiagnosticEntry,
  WorkspaceDiagnosticRange,
  WorkspaceSnapshot,
  WorkspaceSnapshotEntry,
} from "./workspace-compiler.js";
export { createWorkspaceCompiler } from "./workspace-compiler.js";
