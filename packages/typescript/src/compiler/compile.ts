import { List } from "@mindcraft-lang/core";
import { CoreTypeIds, compiler } from "@mindcraft-lang/core/brain";
import ts from "typescript";
import { AMBIENT_MINDCRAFT_DTS, buildAmbientSource } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { extractDescriptor } from "./descriptor.js";
import { emitFunction } from "./emit.js";
import { lowerOnExecute } from "./lowering.js";
import type { CompileDiagnostic, CompileOptions, ExtractedDescriptor, UserAuthoredProgram } from "./types.js";
import { validateAst } from "./validator.js";
import { createVirtualCompilerHost } from "./virtual-host.js";

export type { CompileDiagnostic, CompileOptions, ExtractedDescriptor, ExtractedParam } from "./types.js";

export interface CompileResult {
  diagnostics: CompileDiagnostic[];
  program?: UserAuthoredProgram;
  descriptor?: ExtractedDescriptor;
}

const LIB_DIR = "/lib/";

const checkerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES5,
  module: ts.ModuleKind.ES2015,
  strict: true,
  noEmit: true,
  skipLibCheck: false,
};

let cachedLibFiles: Record<string, string> | undefined;

export async function initCompiler(): Promise<void> {
  if (cachedLibFiles) return;
  const mod = await import("./lib-dts.generated.js");
  cachedLibFiles = mod.LIB_FILES;
}

export function compileUserTile(source: string, options?: CompileOptions): CompileResult {
  if (!cachedLibFiles) {
    throw new Error("Compiler not initialized. Call initCompiler() first.");
  }

  const files = new Map<string, string>();

  for (const [name, content] of Object.entries(cachedLibFiles)) {
    files.set(`${LIB_DIR}${name}`, content);
  }

  files.set("/mindcraft.d.ts", options?.ambientSource ?? AMBIENT_MINDCRAFT_DTS);
  files.set("/user-code.ts", source);

  const host = createVirtualCompilerHost(files, checkerOptions);
  const tsProgram = ts.createProgram(["/mindcraft.d.ts", "/user-code.ts"], checkerOptions, host);
  const tsDiagnostics = ts.getPreEmitDiagnostics(tsProgram);

  const diagnostics: CompileDiagnostic[] = tsDiagnostics
    .filter((d) => d.file?.fileName === "/user-code.ts" || !d.file)
    .map((d) => {
      const result: CompileDiagnostic = {
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      };
      if (d.file && d.start !== undefined) {
        const pos = d.file.getLineAndCharacterOfPosition(d.start);
        result.line = pos.line + 1;
        result.column = pos.character + 1;
      }
      return result;
    });

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  const sourceFile = tsProgram.getSourceFile("/user-code.ts");
  if (!sourceFile) {
    return { diagnostics: [{ message: "Internal error: source file not found" }] };
  }

  const validationDiags = validateAst(sourceFile);
  if (validationDiags.length > 0) {
    return { diagnostics: validationDiags };
  }

  const extractionResult = extractDescriptor(sourceFile);
  if (extractionResult.diagnostics.length > 0) {
    return { diagnostics: extractionResult.diagnostics };
  }

  const descriptor = extractionResult.descriptor!;

  if (!options?.resolveHostFn) {
    return { diagnostics: [], descriptor };
  }

  const checker = tsProgram.getTypeChecker();
  const resolveOperator = options.resolveOperator ?? (() => undefined);
  const lowerResult = lowerOnExecute(descriptor, checker, resolveOperator);
  if (lowerResult.diagnostics.length > 0) {
    return { diagnostics: lowerResult.diagnostics };
  }

  const pool = new compiler.ConstantPool();
  const emitResult = emitFunction(
    lowerResult.ir,
    lowerResult.numParams,
    lowerResult.numLocals,
    `${descriptor.name}.onExecute`,
    pool,
    options.resolveHostFn
  );
  if (emitResult.diagnostics.length > 0) {
    return { diagnostics: emitResult.diagnostics };
  }

  const callDef = buildCallDef(descriptor.name, descriptor.params);
  const resolveTypeId = options.resolveTypeId ?? coreTypeResolver;
  const outputType = descriptor.outputType ? resolveTypeId(descriptor.outputType) : undefined;
  if (descriptor.outputType && !outputType) {
    return { diagnostics: [{ message: `Unknown output type: "${descriptor.outputType}"` }] };
  }

  const program: UserAuthoredProgram = {
    version: 1,
    functions: List.from([emitResult.bytecode]),
    constants: pool.getConstants(),
    variableNames: List.empty(),
    entryPoint: 0,
    kind: descriptor.kind,
    name: descriptor.name,
    callDef,
    outputType,
    numCallsiteVars: 0,
    entryFuncId: 0,
    lifecycleFuncIds: {},
    programRevisionId: generateRevisionId(),
  };

  return { diagnostics: [], program, descriptor };
}

function coreTypeResolver(shortName: string): string | undefined {
  switch (shortName) {
    case "boolean":
      return CoreTypeIds.Boolean;
    case "number":
      return CoreTypeIds.Number;
    case "string":
      return CoreTypeIds.String;
    default:
      return undefined;
  }
}

function generateRevisionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
