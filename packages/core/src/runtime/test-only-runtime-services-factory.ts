import { FunctionRegistry } from "./functions";
import type { PlatformServices } from "./services";
import { TypeRegistry } from "./type-system";

/**
 * TEST-ONLY. Creates a minimal {@link PlatformServices} backed by empty
 * runtime-only registries. Providers import only from `runtime/` and
 * `packages/core/src/platform/`. M4 expands this helper with richer stubs
 * for scenario-specific overrides.
 */
export function __test__createPlatformServices(): PlatformServices {
  return {
    functions: new FunctionRegistry(),
    types: new TypeRegistry(),
  };
}
