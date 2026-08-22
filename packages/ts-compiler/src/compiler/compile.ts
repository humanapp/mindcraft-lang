import type { BrainServices } from "@wendoo/core/brain";
import { CompileDiagCode, DescriptorDiagCode } from "./diag-codes.js";
import { UserTileProject } from "./project.js";
import type { CompileOptions } from "./types.js";

export { collectParams } from "./arg-spec-utils.js";
export type { CompileResult, FunctionDebugInfo, ProjectCompileResult } from "./project.js";
export { isCompilerControlledPath, UserTileProject } from "./project.js";
export type {
  AmbientFile,
  CallSiteInfo,
  CompileDiagnostic,
  CompileOptions,
  DebugFileInfo,
  DebugFunctionInfo,
  DebugMetadata,
  DebugSpan,
  ExtractedArgSpec,
  ExtractedChoice,
  ExtractedConditional,
  ExtractedDescriptor,
  ExtractedModifier,
  ExtractedOptional,
  ExtractedOutput,
  ExtractedParam,
  ExtractedRepeated,
  ExtractedSeq,
  LocalInfo,
  ScopeInfo,
  StdlibSourceFile,
  SuspendSiteInfo,
} from "./types.js";

/** Compile a single source string as a user tile. Convenience wrapper around {@link UserTileProject} for one-off compilation. */
export function compileUserTile(
  source: string,
  options: CompileOptions | { projectNamespace: string; services: BrainServices }
) {
  const project = new UserTileProject(options);
  project.updateFile("user-code.ts", source);
  const result = project.compileAll();
  const entry = result.results.get("user-code.ts");
  const entryTsErrors = result.tsErrors.get("user-code.ts") ?? [];
  if (entry) {
    if (entryTsErrors.length === 0) return entry;
    return { ...entry, diagnostics: [...entryTsErrors, ...entry.diagnostics] };
  }

  const allTsErrors = Array.from(result.tsErrors.values()).flat();
  if (allTsErrors.length > 0) {
    return { diagnostics: allTsErrors };
  }

  return {
    diagnostics: [
      {
        code: DescriptorDiagCode.MissingDefaultExport,
        message:
          "Missing default export. Expected `export default Sensor({...})`, `Actuator({...})`, or `Conversion({...})`.",
        severity: "error" as const,
        line: 1,
        column: 1,
      },
    ],
  };
}
