import type { BrainActionCallDef, Program, TypeId } from "@mindcraft-lang/core/brain";
import type ts from "typescript";

export interface CompileDiagnostic {
  message: string;
  line?: number;
  column?: number;
}

export interface UserAuthoredProgram extends Program {
  kind: "sensor" | "actuator";
  name: string;
  callDef: BrainActionCallDef;
  outputType?: TypeId;
  numCallsiteVars: number;
  entryFuncId: number;
  initFuncId?: number;
  lifecycleFuncIds: {
    onPageEntered?: number;
  };
  programRevisionId: string;
  params: ExtractedParam[];
}

export interface UserTileLinkInfo {
  program: UserAuthoredProgram;
  linkedEntryFuncId: number;
  linkedInitFuncId?: number;
  linkedOnPageEnteredFuncId?: number;
}

export interface CompileOptions {
  resolveTypeId?: (shortName: string) => TypeId | undefined;
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
