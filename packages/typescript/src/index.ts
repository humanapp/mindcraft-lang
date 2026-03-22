export { buildAmbientSource } from "./compiler/ambient.js";
export type {
  CompileDiagnostic,
  CompileOptions,
  CompileResult,
  ExtractedDescriptor,
  ExtractedParam,
} from "./compiler/compile.js";
export { compileUserTile, initCompiler } from "./compiler/compile.js";
export type { UserAuthoredProgram, UserTileLinkInfo } from "./compiler/types.js";
export type { LinkResult } from "./linker/linker.js";
export { linkUserPrograms } from "./linker/linker.js";
export { createUserTileExec } from "./runtime/authored-function.js";
export { registerUserTile } from "./runtime/registration-bridge.js";
