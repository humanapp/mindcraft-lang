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

  // Host action calls by stable registry id (positional arg buffer on stack: vstack[top-argc+1 .. top])
  HOST_ACTION_CALL = 44,
  HOST_ACTION_CALL_ASYNC,

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
// Operand schema
///////////////////////////

/**
 * Var-int encoding of a single instruction operand: `uvar` is an unsigned
 * ULEB128 var-int; `svar` is a zigzag + ULEB128 signed var-int.
 */
export type OperandEncoding = "uvar" | "svar";

/** One operand slot in an opcode's {@link OPERAND_SCHEMA} entry. */
export interface OperandSpec {
  /** Var-int encoding used for this operand. */
  readonly encoding: OperandEncoding;
  /**
   * When true, the operand may be absent. Allowed only on the trailing slot.
   * Absence is sentinel-biased on the wire (`0` = absent, `value + 1` =
   * present), so an optional operand always occupies exactly one var-uint.
   */
  readonly optional?: boolean;
}

const UVAR: OperandSpec = { encoding: "uvar" };
const SVAR: OperandSpec = { encoding: "svar" };
const UVAR_OPT: OperandSpec = { encoding: "uvar", optional: true };

/**
 * Per-opcode operand layout for binary instruction serialization, transcribed
 * from the operand columns of `docs/specs/contracts/vm-contract.md`. Each opcode
 * maps to its operands as a contiguous prefix of `a, b, c`, in order. `svar`
 * marks the five signed rel-offset opcodes (`JMP`, `JMP_IF_FALSE`,
 * `JMP_IF_TRUE`, `WHEN_END`, `TRY`); the optional trailing `b` marks the four
 * typeId-carrying constructors (`LIST_NEW`, `MAP_NEW`, `STRUCT_NEW`,
 * `STRUCT_COPY_EXCEPT`); every other operand is `uvar`.
 */
export const OPERAND_SCHEMA: Readonly<Record<Op, readonly OperandSpec[]>> = {
  [Op.PUSH_CONST_VAL]: [UVAR],
  [Op.POP]: [],
  [Op.DUP]: [],
  [Op.SWAP]: [],
  [Op.PUSH_CONST_NUM]: [UVAR],
  [Op.PUSH_CONST_STR]: [UVAR],
  [Op.STACK_SET_REL]: [UVAR],
  [Op.LOAD_VAR_SLOT]: [UVAR],
  [Op.STORE_VAR_SLOT]: [UVAR],
  [Op.JMP]: [SVAR],
  [Op.JMP_IF_FALSE]: [SVAR],
  [Op.JMP_IF_TRUE]: [SVAR],
  [Op.CALL]: [UVAR, UVAR],
  [Op.RET]: [],
  [Op.HOST_CALL]: [UVAR, UVAR, UVAR],
  [Op.HOST_CALL_ASYNC]: [UVAR, UVAR, UVAR],
  [Op.ACTION_CALL]: [UVAR, UVAR, UVAR],
  [Op.ACTION_CALL_ASYNC]: [UVAR, UVAR, UVAR],
  [Op.HOST_ACTION_CALL]: [UVAR, UVAR, UVAR],
  [Op.HOST_ACTION_CALL_ASYNC]: [UVAR, UVAR, UVAR],
  [Op.AWAIT]: [],
  [Op.YIELD]: [],
  [Op.TRY]: [SVAR],
  [Op.END_TRY]: [],
  [Op.THROW]: [],
  [Op.WHEN_START]: [],
  [Op.WHEN_END]: [SVAR],
  [Op.DO_START]: [],
  [Op.DO_END]: [],
  [Op.LIST_NEW]: [UVAR, UVAR_OPT],
  [Op.LIST_PUSH]: [],
  [Op.LIST_GET]: [],
  [Op.LIST_SET]: [],
  [Op.LIST_LEN]: [],
  [Op.LIST_POP]: [],
  [Op.LIST_SHIFT]: [],
  [Op.LIST_REMOVE]: [],
  [Op.LIST_INSERT]: [],
  [Op.LIST_SWAP]: [],
  [Op.MAP_NEW]: [UVAR, UVAR_OPT],
  [Op.MAP_SET]: [],
  [Op.MAP_GET]: [],
  [Op.MAP_HAS]: [],
  [Op.MAP_DELETE]: [],
  [Op.STRUCT_NEW]: [UVAR, UVAR_OPT],
  [Op.STRUCT_GET]: [],
  [Op.STRUCT_SET]: [],
  [Op.STRUCT_COPY_EXCEPT]: [UVAR, UVAR_OPT],
  [Op.STRUCT_GET_FIELD]: [UVAR],
  [Op.STRUCT_SET_FIELD]: [UVAR],
  [Op.GET_FIELD]: [],
  [Op.SET_FIELD]: [],
  [Op.LOAD_LOCAL]: [UVAR],
  [Op.STORE_LOCAL]: [UVAR],
  [Op.LOAD_CALLSITE_VAR]: [UVAR],
  [Op.STORE_CALLSITE_VAR]: [UVAR],
  [Op.TYPE_CHECK]: [UVAR],
  [Op.INSTANCE_OF]: [UVAR],
  [Op.CALL_INDIRECT]: [UVAR],
  [Op.CALL_INDIRECT_ARGS]: [UVAR],
  [Op.MAKE_CLOSURE]: [UVAR, UVAR],
  [Op.LOAD_CAPTURE]: [UVAR],
};

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
