import type { IFunctionRegistry } from "./function-defs";
import { FunctionRegistry } from "./functions";
import type { PlatformServices } from "./services";
import type { ITypeRegistry } from "./type-defs";
import { TypeRegistry } from "./type-system";

/**
 * TEST-ONLY. Per-provider overrides for {@link __test__createPlatformServices}.
 * Each field is optional; omitted fields fall back to empty runtime-only defaults.
 */
export interface __test__PlatformServicesOptions {
  /** Override the function registry. */
  functions?: IFunctionRegistry;
  /** Override the type registry. */
  types?: ITypeRegistry;
}

/**
 * TEST-ONLY. Creates a {@link PlatformServices} backed by runtime-only registries.
 * Pass an {@link __test__PlatformServicesOptions} to override individual providers
 * without rebuilding the whole aggregate.
 */
export function __test__createPlatformServices(options?: __test__PlatformServicesOptions): PlatformServices {
  return {
    functions: options?.functions ?? new FunctionRegistry(),
    types: options?.types ?? new TypeRegistry(),
  };
}
