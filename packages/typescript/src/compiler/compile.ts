import type { Program } from "@mindcraft-lang/core/brain";
import ts from "typescript";
import { AMBIENT_MINDCRAFT_DTS } from "./ambient.js";
import { createVirtualCompilerHost } from "./virtual-host.js";

export interface CompileDiagnostic {
  message: string;
  line?: number;
  column?: number;
}

export interface CompileResult {
  diagnostics: CompileDiagnostic[];
  program?: Program;
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

export function compileUserTile(source: string): CompileResult {
  if (!cachedLibFiles) {
    throw new Error("Compiler not initialized. Call initCompiler() first.");
  }

  const files = new Map<string, string>();

  for (const [name, content] of Object.entries(cachedLibFiles)) {
    files.set(`${LIB_DIR}${name}`, content);
  }

  files.set("/mindcraft.d.ts", AMBIENT_MINDCRAFT_DTS);
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

  return { diagnostics };
}
