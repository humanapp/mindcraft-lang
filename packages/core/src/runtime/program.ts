import type { List } from "../platform/list";
import type { ConstantPools, FunctionBytecode } from "./bytecode";
import type { ExecutableAction } from "./context";

/**
 * Compiled program. Constants are split into typed sub-pools for compactness
 * and ease of porting to fixed-size native vectors. See {@link ConstantPools}
 * for pool semantics.
 */
export interface Program {
  version: number;
  functions: List<FunctionBytecode>;
  constantPools: ConstantPools;
  /** Named variable identifiers for cross-context variable access */
  variableNames: List<string>;
  entryPoint?: number;
  /**
   * Executable action bindings keyed by program-local action slot. Populated
   * by the linker for programs that contain `ACTION_CALL` / `ACTION_CALL_ASYNC`
   * instructions; absent on programs that have not been linked or that emit no
   * action calls.
   */
  actions?: List<ExecutableAction>;
}

/**
 * Program plus the metadata needed to invoke a single user-authored action.
 * Returned by the user-tile compiler; consumed by the linker to splice the
 * action's functions and constants into a host brain program.
 */
export interface ProgramArtifact extends Program {
  entryFuncId: number;
  activationFuncId?: number;
  numStateSlots: number;
  isAsync: boolean;
  revisionId: string;
}
