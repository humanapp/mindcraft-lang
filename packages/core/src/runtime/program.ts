import type { List } from "../platform/list";
import type { ConstantPools, FunctionBytecode } from "./bytecode";

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
}
