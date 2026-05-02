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
   * Push a residual constant value onto the stack.
   * @param constIdx Index into `Program.constantPools.values` (the residual sub-pool).
   */
  pushConst(constIdx: number): void;

  /**
   * Push a numeric constant onto the stack as a `NumberValue`.
   * @param constIdx Index into `Program.constantPools.numbers`.
   */
  pushConstNum(constIdx: number): void;

  /**
   * Push a string constant onto the stack as a `StringValue`.
   * @param constIdx Index into `Program.constantPools.strings`.
   */
  pushConstStr(constIdx: number): void;

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

  /**
   * Pop the top value, then write it to `vstack[top - d]` where `top`
   * is the index of the topmost element after the pop. `d = 0` writes
   * the popped value to the new topmost slot.
   *
   * Used to populate a fixed-width arg buffer at host/action call
   * sites: the compiler pushes one `NIL_VALUE` per slot, then for each
   * supplied slot lowers the user expression and emits
   * `stackSetRel(d)` with `d = N - 1 - slotId`.
   */
  stackSetRel(d: number): void;

  // ==========================================
  // Variables (slot-indexed; slot id is a position in the program's variableNames pool)
  // ==========================================

  /**
   * Load a variable from its compiler-assigned slot onto the stack.
   * @param slotId Slot index. Position in the program's variableNames list.
   */
  loadVarSlot(slotId: number): void;

  /**
   * Store the top stack value into a variable by its compiler-assigned slot.
   * @param slotId Slot index. Position in the program's variableNames list.
   */
  storeVarSlot(slotId: number): void;

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
   * Call function indirectly via FunctionValue on the stack.
   * Pops argc arguments, then pops a FunctionValue, calls the function by funcId.
   */
  callIndirect(argc: number): void;

  /**
   * Return from current function.
   */
  ret(): void;

  // ==========================================
  // Host calls
  // ==========================================

  /**
   * Call a host (native) function synchronously. Expects an `argc`-wide
   * positional arg buffer on the operand stack
   * (`vstack[top - argc + 1 .. top]`); the host reads each slot via
   * `args.get(slotId)`.
   *
   * @param hostId - The host function ID from FunctionRegistry
   * @param argc - Width of the arg buffer on the stack (== `callDef.argSlots.size()`)
   * @param callSiteId - Unique ID for this call site (for per-call-site state)
   */
  hostCall(hostId: number, argc: number, callSiteId: number): void;

  /**
   * Call a host (native) function asynchronously. Same arg layout as
   * {@link hostCall}; the dispatcher copies the buffer into a fresh
   * `List<Value>` before invoking the host.
   *
   * @param hostId - The host function ID from FunctionRegistry
   * @param argc - Width of the arg buffer on the stack (== `callDef.argSlots.size()`)
   * @param callSiteId - Unique ID for this call site (for per-call-site state)
   */
  hostCallAsync(hostId: number, argc: number, callSiteId: number): void;

  /**
   * Call an action synchronously through a program-local action slot.
   * Consumes `argc` positional values from the operand stack.
   * @param actionSlot - The action slot index in BrainProgram.actionRefs
   * @param argc - Width of the arg buffer on the stack
   * @param callSiteId - Unique ID for this call site (for per-call-site state)
   */
  actionCall(actionSlot: number, argc: number, callSiteId: number): void;

  /**
   * Call an action asynchronously through a program-local action slot.
   * Consumes `argc` positional values from the operand stack.
   * @param actionSlot - The action slot index in BrainProgram.actionRefs
   * @param argc - Width of the arg buffer on the stack
   * @param callSiteId - Unique ID for this call site (for per-call-site state)
   */
  actionCallAsync(actionSlot: number, argc: number, callSiteId: number): void;

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
   * Create a new list.
   * @param typeIdConstIdx - constant pool index holding the typeId string
   */
  listNew(typeIdConstIdx: number): void;

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
   * Create a new empty struct.
   * @param typeIdConstIdx - constant pool index holding the typeId string
   */
  structNew(typeIdConstIdx: number): void;

  /**
   * Get field from struct. Field name is on stack.
   */
  structGet(): void;

  /**
   * Set field in struct. Field name and value are on stack.
   */
  structSet(): void;

  /**
   * Get field from a closed struct by `StructFieldDef.fieldIndex`.
   */
  structGetField(fieldIndex: number): void;

  /**
   * Set field on a closed struct by `StructFieldDef.fieldIndex`.
   */
  structSetField(fieldIndex: number): void;

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
  // Frame-local variables
  // ==========================================

  /**
   * Load a frame-local variable onto the stack.
   * @param slotIdx Index into the current frame's locals array
   */
  loadLocal(slotIdx: number): void;

  /**
   * Store the top stack value into a frame-local variable.
   * @param slotIdx Index into the current frame's locals array
   */
  storeLocal(slotIdx: number): void;

  // ==========================================
  // Callsite-persistent variables
  // ==========================================

  /**
   * Load a callsite-persistent variable onto the stack.
   * @param slotIdx Index into the fiber's callsiteVars array
   */
  loadCallsiteVar(slotIdx: number): void;

  /**
   * Store the top stack value into a callsite-persistent variable.
   * @param slotIdx Index into the fiber's callsiteVars array
   */
  storeCallsiteVar(slotIdx: number): void;

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
