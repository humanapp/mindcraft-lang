import type { List } from "@mindcraft-lang/core";
import type { FunctionBytecode, Program, Value } from "@mindcraft-lang/core/brain";

export interface UserAuthoredProgram extends Program {
  kind: "sensor" | "actuator";
  name: string;
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
