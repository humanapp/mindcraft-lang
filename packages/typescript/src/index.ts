export { buildAmbientDeclarations } from "./compiler/ambient.js";
export type {
  CompileDiagnostic,
  CompileOptions,
  CompileResult,
  ExtractedDescriptor,
  ExtractedParam,
} from "./compiler/compile.js";
export { compileUserTile } from "./compiler/compile.js";
export type { TsDiagCode } from "./compiler/diag-codes.js";
export {
  CompileDiagCode,
  DescriptorDiagCode,
  EmitDiagCode,
  LoweringDiagCode,
  ValidatorDiagCode,
} from "./compiler/diag-codes.js";
export type { UserAuthoredProgram, UserTileLinkInfo } from "./compiler/types.js";
export type { LinkResult } from "./linker/linker.js";
export { linkUserPrograms } from "./linker/linker.js";
export { createUserTileExec } from "./runtime/authored-function.js";
export { registerUserTile } from "./runtime/registration-bridge.js";
