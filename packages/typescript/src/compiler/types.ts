import type ts from "typescript";

export interface CompileDiagnostic {
  message: string;
  line?: number;
  column?: number;
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
