import type { List } from "../platform/list";
import type { TypeId } from "./type-defs";
import type { Value } from "./value";

///////////////////////////
// Opcodes
///////////////////////////

/** Brain VM bytecode opcodes. */
export enum Op {
  // Stack manipulation
  /** Pushes `Program.constantPools.values[a]` (residual / non-numeric / non-string pool). */
  PUSH_CONST_VAL = 0,
  POP,
  DUP,
  SWAP,
  /** Pushes `Program.constantPools.numbers[a]` as a NumberValue. */
  PUSH_CONST_NUM = 4,
  /** Pushes `Program.constantPools.strings[a]` as a StringValue. */
  PUSH_CONST_STR = 5,
  /**
   * Pops one value off the operand stack, then writes it to
   * `vstack[top - a]` where `top` is the index of the topmost element
   * AFTER the pop. `STACK_SET_REL 0` writes the popped value to the
   * new topmost slot. Faults `ScriptError` if `a` exceeds the
   * post-pop top index.
   */
  STACK_SET_REL = 6,

  // Variables (stored in the brain by slot index from the program's variableNames pool)
  LOAD_VAR_SLOT = 10,
  STORE_VAR_SLOT,

  // Control flow
  JMP = 20,
  JMP_IF_FALSE,
  JMP_IF_TRUE,

  // Function calls
  CALL = 30,
  RET,

  // Host calls (positional arg buffer on stack: vstack[top-argc+1 .. top])
  HOST_CALL = 40,
  HOST_CALL_ASYNC,

  // Action calls (positional arg buffer on stack: vstack[top-argc+1 .. top])
  ACTION_CALL = 42,
  ACTION_CALL_ASYNC,

  // Async operations and cooperative scheduling
  AWAIT = 50,
  YIELD,

  // Exception handling
  TRY = 60,
  END_TRY,
  THROW,

  // Boundaries
  WHEN_START = 70,
  WHEN_END,
  DO_START,
  DO_END,

  // List operations
  LIST_NEW = 90,
  LIST_PUSH,
  LIST_GET,
  LIST_SET,
  LIST_LEN,
  LIST_POP,
  LIST_SHIFT,
  LIST_REMOVE,
  LIST_INSERT,
  LIST_SWAP,

  // Map operations
  MAP_NEW = 100,
  MAP_SET,
  MAP_GET,
  MAP_HAS,
  MAP_DELETE,

  // Struct operations
  STRUCT_NEW = 110,
  STRUCT_GET,
  STRUCT_SET,
  STRUCT_COPY_EXCEPT,
  STRUCT_GET_FIELD,
  STRUCT_SET_FIELD,

  // Generic field access (works with Struct, extensible for custom types)
  GET_FIELD = 120,
  SET_FIELD,

  // Frame-local variables (indexed slots on the current call frame)
  LOAD_LOCAL = 130,
  STORE_LOCAL,

  // Legacy opcode name retained; resolves against the current action instance state slots.
  LOAD_CALLSITE_VAR = 140,
  STORE_CALLSITE_VAR,

  // Type introspection
  TYPE_CHECK = 150,
  INSTANCE_OF,

  // Indirect function calls
  CALL_INDIRECT = 160,
  CALL_INDIRECT_ARGS,

  // Closure operations
  MAKE_CLOSURE = 170,
  LOAD_CAPTURE,
}

/** Current bytecode format version. */
export const BYTECODE_VERSION = 1;

///////////////////////////
// Bytecode Structures
///////////////////////////

/** Single VM instruction: opcode plus up to three operands. */
export interface Instr {
  op: Op;
  a?: number;
  b?: number;
  c?: number;
}

/** Compiled function body: instruction list plus param/local counts and optional metadata. */
export interface FunctionBytecode {
  code: List<Instr>;
  numParams: number;
  /** Total number of local variable slots (includes params). Defaults to numParams. */
  numLocals?: number;
  name?: string;
  maxStackDepth?: number;
  injectCtxTypeId?: TypeId;
}

/**
 * Three parallel typed constant pools carried by every {@link Program}.
 * Pool indices are independent: the same numeric `idx` in `numbers`,
 * `strings`, and `values` references unrelated entries.
 */
export interface ConstantPools {
  /** Raw `number` values pushed by `PUSH_CONST_NUM` (wrapped into `NumberValue` at runtime). */
  numbers: List<number>;
  /**
   * Raw `string` values pushed by `PUSH_CONST_STR`, and used directly
   * (without `Value` wrapping) as the typeId payload for `INSTANCE_OF.a`,
   * `LIST_NEW.b`, `MAP_NEW.b`, `STRUCT_NEW.b`, and `STRUCT_COPY_EXCEPT.b`.
   */
  strings: List<string>;
  /**
   * Residual heterogeneous pool addressed by `PUSH_CONST_VAL`. Carries every
   * `Value` shape that is not a plain number or string: `Nil`, `Boolean`,
   * `Enum`, `List`, `Map`, `Struct`, `Function`, etc.
   */
  values: List<Value>;
}

/**
 * Per-pool offsets used by the linker when concatenating constant pools
 * across artifacts.
 */
export interface ConstantOffsets {
  numbers: number;
  strings: number;
  values: number;
}
