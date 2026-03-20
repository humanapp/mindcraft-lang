import type { List } from "@mindcraft-lang/core";
import type { BrainActionCallDef, FunctionBytecode, Program, TypeId, Value } from "@mindcraft-lang/core/brain";

export type { CompileDiagnostic, CompileResult, ExtractedDescriptor, ExtractedParam } from "./compiler/compile.js";
export { compileUserTile, initCompiler } from "./compiler/compile.js";

export interface UserAuthoredProgram extends Program {
  kind: "sensor" | "actuator";
  name: string;
  callDef: BrainActionCallDef;
  outputType?: TypeId;
  numCallsiteVars: number;
  entryFuncId: number;
  lifecycleFuncIds: {
    onPageEntered?: number;
  };
  programRevisionId: string;
}

export interface UserTileLinkInfo {
  program: UserAuthoredProgram;
  linkedEntryFuncId: number;
}
