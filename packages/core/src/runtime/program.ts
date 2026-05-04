import type { Dict } from "../platform/dict";
import type { List } from "../platform/list";
import type { UniqueSet } from "../platform/uniqueset";
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
  /**
   * Set of function ids that are rule entries. Membership identifies a
   * function as the body of a brain rule; non-members are regular bytecode
   * functions called from rule bodies. Backs
   * {@link IProgramServices.getRuleFuncIdForFunc}. Absent on programs that
   * have not been compiled from a brain definition (e.g. raw test
   * fixtures); treated as empty in that case.
   */
  ruleFuncIds?: UniqueSet<number>;
  /**
   * Mapping from a rule's funcId to its enclosing parent rule's funcId. A
   * rule with no enclosing rule (i.e. a root rule on a page) has no entry.
   * Backs the ancestor-walk semantics of
   * {@link IRuleVariableServices.getByName}: a read on a child rule resolves
   * up the ancestor chain when the variable is not present in the child's
   * own store. Absent on programs that have not been compiled from a brain
   * definition; treated as empty in that case.
   */
  ruleAncestors?: Dict<number, number>;
}

/**
 * Program plus the metadata needed to invoke a single user-authored action.
 * Returned by the user-tile compiler; consumed by the linker to splice the
 * action's functions and constants into a host brain program.
 */
export interface ProgramArtifact extends Program {
  entryFuncId: number;
  /**
   * Optional one-time initializer body for the action. Linked into
   * {@link BytecodeExecutableAction.initializerFuncId}; runs once per
   * `(brainInstance, callSiteId)`.
   */
  initializerFuncId?: number;
  /**
   * Optional per-page-activation entry hook. Linked into
   * {@link BytecodeExecutableAction.activationFuncId}; runs every time the
   * owning page is activated.
   */
  activationFuncId?: number;
  /**
   * Optional per-page-deactivation hook. Linked into
   * {@link BytecodeExecutableAction.deactivationFuncId}; runs every time
   * the owning page is deactivated, before fiber cancellation.
   */
  deactivationFuncId?: number;
  numStateSlots: number;
  isAsync: boolean;
  revisionId: string;
}
