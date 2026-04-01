import { CompileDiagCode, DescriptorDiagCode } from "./diag-codes.js";
import { UserTileProject } from "./project.js";
import type { CompileOptions } from "./types.js";

export type { CompileResult, ProjectCompileResult } from "./project.js";
export { UserTileProject } from "./project.js";
export type { CompileDiagnostic, CompileOptions, ExtractedDescriptor, ExtractedParam } from "./types.js";

export function compileUserTile(source: string, options?: CompileOptions) {
  const project = new UserTileProject(options);
  project.updateFile("user-code.ts", source);
  const result = project.compileAll();
  const entry = result.results.get("user-code.ts");
  if (entry) return entry;

  const allTsErrors = Array.from(result.tsErrors.values()).flat();
  if (allTsErrors.length > 0) {
    return { diagnostics: allTsErrors };
  }

  return {
    diagnostics: [
      {
        code: DescriptorDiagCode.MissingDefaultExport,
        message: "Missing default export. Expected `export default Sensor({...})` or `export default Actuator({...})`.",
        line: 1,
        column: 1,
      },
    ],
  };
}
