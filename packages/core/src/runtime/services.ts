import type { IFunctionRegistry } from "./function-defs";
import type { ITypeRegistry } from "./type-defs";

/** Runtime service aggregate required by VM execution paths. */
export interface PlatformServices {
  /** Host function registry used by HOST_CALL and HOST_CALL_ASYNC dispatch. */
  functions: IFunctionRegistry;

  /** Type registry used by VM value copying and struct field access paths. */
  types: ITypeRegistry;
}
