import { List } from "@mindcraft-lang/core";
import { compiler, getBrainServices } from "@mindcraft-lang/core/brain";
import ts from "typescript";
import { buildAmbientDeclarations } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { extractDescriptor } from "./descriptor.js";
import { emitFunction } from "./emit.js";
import { lowerProgram } from "./lowering.js";
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

  files.set("/mindcraft.d.ts", options?.ambientSource ?? buildAmbientDeclarations());
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

  const checker = tsProgram.getTypeChecker();
  const programResult = lowerProgram(sourceFile, descriptor, checker);
  if (programResult.diagnostics.length > 0) {
    return { diagnostics: programResult.diagnostics };
  }

  const pool = new compiler.ConstantPool();
  const emittedFunctions: ReturnType<typeof emitFunction>["bytecode"][] = [];

  for (const func of programResult.functions) {
    const emitResult = emitFunction(func.ir, func.numParams, func.numLocals, func.name, pool);
    if (emitResult.diagnostics.length > 0) {
      return { diagnostics: emitResult.diagnostics };
    }
    emittedFunctions.push(emitResult.bytecode);
  }

  const callDef = buildCallDef(descriptor.name, descriptor.params);
  const outputType = descriptor.outputType ? getBrainServices().types.resolveByName(descriptor.outputType) : undefined;
  if (descriptor.outputType && !outputType) {
    return { diagnostics: [{ message: `Unknown output type: "${descriptor.outputType}"` }] };
  }

  const program: UserAuthoredProgram = {
    version: 1,
    functions: List.from(emittedFunctions),
    constants: pool.getConstants(),
    variableNames: List.empty(),
    entryPoint: programResult.entryFuncId,
    kind: descriptor.kind,
    name: descriptor.name,
    callDef,
    outputType,
    numCallsiteVars: programResult.numCallsiteVars,
    entryFuncId: programResult.entryFuncId,
    initFuncId: programResult.initFuncId,
    lifecycleFuncIds: {
      onPageEntered: programResult.onPageEnteredWrapperId,
    },
    programRevisionId: generateRevisionId(),
    params: descriptor.params,
  };

  return { diagnostics: [], program, descriptor };
}

function generateRevisionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
