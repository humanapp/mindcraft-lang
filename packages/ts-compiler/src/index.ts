export {
  buildAmbientDeclarations,
  buildCoreAmbientDeclarations,
  buildPlatformAmbientDeclarations,
} from "./compiler/ambient.js";
export type {
  AmbientFile,
  CompileDiagnostic,
  CompileOptions,
  CompileResult,
  ExtractedArgSpec,
  ExtractedChoice,
  ExtractedConditional,
  ExtractedDescriptor,
  ExtractedModifier,
  ExtractedOptional,
  ExtractedOutput,
  ExtractedParam,
  ExtractedRepeated,
  ExtractedSeq,
  ProjectCompileResult,
  StdlibSourceFile,
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
export type { DependencyMount, ProjectDependency } from "./compiler/extension-mounts.js";
export { EXTENSION_IMPORT_PREFIX } from "./compiler/extension-mounts.js";
export type { Mount, MountFile, MountKind } from "./compiler/mounts.js";
export {
  declarationMount,
  declarationMounts,
  isMountedPath,
  mountedFiles,
  sourceMount,
  sourceMounts,
} from "./compiler/mounts.js";
export type {
  SharedModifierDeclaration,
  SharedParameterDeclaration,
  SharedTileSessionContext,
} from "./compiler/project.js";
export type { MultiRootCompileResult, MultiRootSessionOptions, ProjectRoot } from "./compiler/project-set.js";
export { MultiRootSession } from "./compiler/project-set.js";
export {
  privateArgTileId,
  publicSymbolKey,
  qualifiedClassName,
  scopedOutputName,
  userActionKey,
} from "./compiler/symbol-keys.js";
export type { LinkedUserProgram, UserAuthoredProgram, UserTileDefinition } from "./compiler/types.js";
export {
  isCallSpec,
  isExtractedParam,
  isOptionalBoolean,
  isOptionalString,
  isOptionalStringArray,
  isRecord,
} from "./guards.js";
export type { LinkResult } from "./linker/linker.js";
export { linkUserPrograms } from "./linker/linker.js";
export type { BuildCompiledActionBundleOptions } from "./runtime/action-bundle.js";
export {
  buildCompiledActionBundle,
  buildMultiRootActionBundle,
  compileResultContributes,
} from "./runtime/action-bundle.js";
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
