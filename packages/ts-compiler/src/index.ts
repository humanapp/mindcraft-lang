export { buildAmbientDeclarations } from "./compiler/ambient.js";
export type {
  CompileDiagnostic,
  CompileOptions,
  CompileResult,
  ExtractedDescriptor,
  ExtractedParam,
  ProjectCompileResult,
} from "./compiler/compile.js";
export { compileUserTile, UserTileProject } from "./compiler/compile.js";
export type { TsDiagCode } from "./compiler/diag-codes.js";
export {
  CompileDiagCode,
  DescriptorDiagCode,
  EmitDiagCode,
  LoweringDiagCode,
  ValidatorDiagCode,
} from "./compiler/diag-codes.js";
export type { LinkedUserProgram, UserAuthoredProgram } from "./compiler/types.js";
export type { LinkResult } from "./linker/linker.js";
export { linkUserPrograms } from "./linker/linker.js";
export { registerUserTile } from "./runtime/registration-bridge.js";
