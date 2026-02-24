import type { List } from "../../platform/list";
import type { Instr } from "./vm";

/**
 * Interface for bytecode emitter that generates VM instructions.
 *
 * The emitter follows a two-pass approach:
 * 1. Emit instructions with placeholder offsets for jumps/branches
 * 2. Finalize to compute and patch relative offsets
 */
export interface IBytecodeEmitter {
  /**
   * Create a new label. Returns a label ID.
   * Call this before emitting the target instruction.
   */
  label(): number;

  /**
   * Mark the current position with a label.
   */
  mark(labelId: number): void;

  /**
   * Get current instruction count (useful for calculating stack depth).
   */
  pos(): number;

  // ==========================================
  // Stack manipulation
  // ==========================================

  /**
   * Push a constant value onto the stack.
   * @param constIdx Index into the constant pool
   */
  pushConst(constIdx: number): void;

  /**
   * Pop the top value from the stack.
   */
  pop(): void;

  /**
   * Duplicate the top value on the stack.
   */
  dup(): void;

  /**
   * Swap the top two values on the stack.
   */
  swap(): void;

  // ==========================================
  // Variables (stored in execution context by name)
  // ==========================================

  /**
   * Load a variable from the execution context onto the stack.
   * @param varNameIdx Index into the program's variableNames list
   */
  loadVar(varNameIdx: number): void;

  /**
   * Store the top stack value into a variable in the execution context.
   * @param varNameIdx Index into the program's variableNames list
   */
  storeVar(varNameIdx: number): void;

  // ==========================================
  // Control flow
  // ==========================================

  /**
   * Unconditional jump to a label. Offset will be patched during finalize().
   */
  jmp(labelId: number): void;

  /**
   * Jump to label if top of stack is false (pops value).
   */
  jmpIfFalse(labelId: number): void;

  /**
   * Jump to label if top of stack is true (pops value).
   */
  jmpIfTrue(labelId: number): void;

  // ==========================================
  // Function calls
  // ==========================================

  /**
   * Call function by ID with argc arguments from stack.
   */
  call(funcId: number, argc: number): void;

  /**
   * Return from current function.
   */
  ret(): void;

  // ==========================================
  // Host calls
  // ==========================================

  /**
   * Call a host (native) function synchronously.
   * Expects a single pre-built MapValue on the stack.
   * @param hostId - The host function ID from FunctionRegistry
   * @param argc - Number of arguments on the stack
   * @param callSiteId - Unique ID for this call site (for per-call-site state)
   */
  hostCall(hostId: number, argc: number, callSiteId: number): void;

  /**
   * Call a host (native) function asynchronously.
   * Expects a single pre-built MapValue on the stack.
   * @param hostId - The host function ID from FunctionRegistry
   * @param argc - Number of arguments on the stack
   * @param callSiteId - Unique ID for this call site (for per-call-site state)
   */
  hostCallAsync(hostId: number, argc: number, callSiteId: number): void;

  /**
   * Call a host function synchronously with raw values on the stack.
   * The VM pops `argc` values and auto-wraps them into a MapValue with 0-indexed keys.
   * More efficient than building a map in bytecode for fixed-arity calls (operators, conversions).
   * @param hostId - The host function ID from FunctionRegistry
   * @param argc - Number of raw argument values on the stack
   * @param callSiteId - Unique ID for this call site (for per-call-site state)
   */
  hostCallArgs(hostId: number, argc: number, callSiteId: number): void;

  /**
   * Call a host function asynchronously with raw values on the stack.
   * The VM pops `argc` values and auto-wraps them into a MapValue with 0-indexed keys.
   * @param hostId - The host function ID from FunctionRegistry
   * @param argc - Number of raw argument values on the stack
   * @param callSiteId - Unique ID for this call site (for per-call-site state)
   */
  hostCallArgsAsync(hostId: number, argc: number, callSiteId: number): void;

  // ==========================================
  // Async operations
  // ==========================================

  /**
   * Await a promise/future value.
   */
  await(): void;

  /**
   * Yield control back to the scheduler.
   */
  yield(): void;

  // ==========================================
  // Exception handling
  // ==========================================

  /**
   * Begin try block. catchLabel points to the catch handler.
   */
  try(catchLabel: number): void;

  /**
   * End try block.
   */
  endTry(): void;

  /**
   * Throw the value on top of the stack.
   */
  throw(): void;

  // ==========================================
  // Boundaries
  // ==========================================

  /**
   * Mark the start of a WHEN boundary.
   */
  whenStart(): void;

  /**
   * Mark the end of a WHEN boundary.
   * Conditionally skips to skipLabel if the WHEN result (top of stack) is false.
   *
   * @param skipLabel - Label to jump to if WHEN evaluated to false (typically after DO section)
   */
  whenEnd(skipLabel: number): void;

  /**
   * Mark the start of a DO boundary.
   */
  doStart(): void;

  /**
   * Mark the end of a DO boundary.
   */
  doEnd(): void;

  // ==========================================
  // List operations
  // ==========================================

  /**
   * Create a new list with typeId.
   */
  listNew(typeId: number): void;

  /**
   * Push value onto list.
   */
  listPush(): void;

  /**
   * Get element from list at index.
   */
  listGet(): void;

  /**
   * Set element in list at index.
   */
  listSet(): void;

  /**
   * Get list length.
   */
  listLen(): void;

  // ==========================================
  // Map operations
  // ==========================================

  /**
   * Create a new map with typeId.
   */
  mapNew(typeId: number): void;

  /**
   * Set key-value pair in map.
   */
  mapSet(): void;

  /**
   * Get value from map by key.
   */
  mapGet(): void;

  /**
   * Check if map has key.
   */
  mapHas(): void;

  /**
   * Delete key from map.
   */
  mapDelete(): void;

  // ==========================================
  // Struct operations
  // ==========================================

  /**
   * Create a new struct with typeId.
   */
  structNew(typeId: number): void;

  /**
   * Get field from struct. Field name is on stack.
   */
  structGet(): void;

  /**
   * Set field in struct. Field name and value are on stack.
   */
  structSet(): void;

  // ==========================================
  // Generic field access
  // ==========================================

  /**
   * Get field from value. Field name is on stack.
   */
  getField(): void;

  /**
   * Set field on value. Value and field name are on stack.
   */
  setField(): void;

  // ==========================================
  // Finalization
  // ==========================================

  /**
   * Finalize the instruction stream by patching all jump/try offsets.
   * Returns the complete list of instructions ready for execution.
   * After calling finalize(), no more instructions can be emitted.
   */
  finalize(): List<Instr>;

  /**
   * Reset the emitter state to start building a new function.
   * Useful when emitting multiple functions sequentially.
   */
  reset(): void;
}
