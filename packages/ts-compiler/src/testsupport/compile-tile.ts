import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "../compiler/ambient.js";
import { compileUserTile } from "../compiler/compile.js";
import type { CompileDiagnostic } from "../compiler/types.js";

let sharedServices: BrainServices | undefined;

function services(): BrainServices {
  if (!sharedServices) {
    sharedServices = __test__createBrainServices();
  }
  return sharedServices;
}

/**
 * Compile a single user-tile `source` (as `tile.ts`) and return its compile
 * diagnostics. Pair with `expectDiagnostic` to assert that a minimal fixture
 * triggers a specific `LoweringDiagCode`. The fixture must be valid TypeScript;
 * a TypeScript error halts before lowering and surfaces as
 * `CompileDiagCode.TypeScriptError`.
 */
export function compileTileDiagnostics(source: string): readonly CompileDiagnostic[] {
  const svc = services();
  const ambientSource = buildAmbientDeclarations(svc.runtime.types);
  return compileUserTile(source, {
    ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
    services: svc,
  }).diagnostics;
}
