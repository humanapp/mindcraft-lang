import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import type { IBytecodeEmitter } from "../interfaces/emitter";
import type { Instr } from "../interfaces/vm";
import { Op } from "../interfaces/vm";

/**
 * Two-pass bytecode emitter for VM instructions.
 *
 * Usage:
 * ```
 * const em = new BytecodeEmitter();
 * const loopStart = em.label();
 * em.mark(loopStart);
 * em.pushConst(0);
 * em.loadVarSlot(1);
 * em.add();
 * em.dup();
 * em.pushConst(1);
 * em.lt();
 * em.jmpIfTrue(loopStart);
 * em.ret();
 * const instrs = em.finalize();
 * ```
 *
 * Key Design:
 * - Labels are created before the target instruction is emitted
 * - Jump/TRY instructions emit placeholders and record fixups
 * - finalize() computes relative offsets and patches them in
 * - All offsets are signed relative (target_pc - current_pc)
 */

interface Fixup {
  /** Instruction index that needs patching */
  instrIdx: number;
  /** Target label ID */
  labelId: number;
  /** Which field to patch: "a" or "b" */
  field: "a" | "b";
}

/** Builds a {@link FunctionBytecode} from emitted instructions, resolving forward jumps via labels and fixups. */
export class BytecodeEmitter implements IBytecodeEmitter {
  private instrs: List<Instr> = List.empty();
  private labels: Dict<number, number> = Dict.empty(); // labelId -> instruction index
  private fixups: List<Fixup> = List.empty();
  private nextLabelId = 0;
  private finalized = false;

  /** Create a new label. Returns a label ID. Call this before emitting the target instruction. */
  label(): number {
    const id = this.nextLabelId++;
    return id;
  }

  /** Mark the current position with a label. */
  mark(labelId: number): void {
    if (this.labels.has(labelId)) {
      throw new Error(`Label ${labelId} already defined`);
    }
    this.labels.set(labelId, this.instrs.size());
  }

  /** Get current instruction count (useful for calculating stack depth). */
  pos(): number {
    return this.instrs.size();
  }

  private emit(ins: Instr): void {
    if (this.finalized) {
      throw new Error("Cannot emit after finalize()");
    }
    this.instrs.push(ins);
  }

  private addFixup(labelId: number, field: "a" | "b"): void {
    this.fixups.push({
      instrIdx: this.instrs.size() - 1,
      labelId,
      field,
    });
  }

  // ==========================================
  // Stack manipulation
  // ==========================================

  pushConst(constIdx: number): void {
    this.emit({ op: Op.PUSH_CONST_VAL, a: constIdx });
  }

  pushConstNum(constIdx: number): void {
    this.emit({ op: Op.PUSH_CONST_NUM, a: constIdx });
  }

  pushConstStr(constIdx: number): void {
    this.emit({ op: Op.PUSH_CONST_STR, a: constIdx });
  }

  pop(): void {
    this.emit({ op: Op.POP });
  }

  dup(): void {
    this.emit({ op: Op.DUP });
  }

  swap(): void {
    this.emit({ op: Op.SWAP });
  }

  stackSetRel(d: number): void {
    this.emit({ op: Op.STACK_SET_REL, a: d });
  }

  // ==========================================
  // Variables (slot-indexed; slot id is a position in the program's variableNames pool)
  // ==========================================

  loadVarSlot(slotId: number): void {
    this.emit({ op: Op.LOAD_VAR_SLOT, a: slotId });
  }

  storeVarSlot(slotId: number): void {
    this.emit({ op: Op.STORE_VAR_SLOT, a: slotId });
  }

  // ==========================================
  // Control flow
  // ==========================================

  /** Unconditional jump to a label. Offset will be patched during finalize(). */
  jmp(labelId: number): void {
    this.emit({ op: Op.JMP, a: 0 }); // placeholder
    this.addFixup(labelId, "a");
  }

  /** Jump to label if top of stack is false (pops value). */
  jmpIfFalse(labelId: number): void {
    this.emit({ op: Op.JMP_IF_FALSE, a: 0 }); // placeholder
    this.addFixup(labelId, "a");
  }

  /** Jump to label if top of stack is true (pops value). */
  jmpIfTrue(labelId: number): void {
    this.emit({ op: Op.JMP_IF_TRUE, a: 0 }); // placeholder
    this.addFixup(labelId, "a");
  }

  // ==========================================
  // Function calls
  // ==========================================

  /** Call function by ID with argc arguments from stack. */
  call(funcId: number, argc: number): void {
    this.emit({ op: Op.CALL, a: funcId, b: argc });
  }

  /** Call function indirectly via FunctionValue on the stack. */
  callIndirect(argc: number): void {
    this.emit({ op: Op.CALL_INDIRECT, a: argc });
  }

  /** Call function indirectly, adapting argc to callee's numParams (truncate or pad with nil). */
  callIndirectArgs(argc: number): void {
    this.emit({ op: Op.CALL_INDIRECT_ARGS, a: argc });
  }

  /** Create a closure: pops captureCount values from the stack, creates a FunctionValue with captures. */
  makeClosure(funcId: number, captureCount: number): void {
    this.emit({ op: Op.MAKE_CLOSURE, a: funcId, b: captureCount });
  }

  /** Load a captured variable from the current frame's captures. */
  loadCapture(slotIdx: number): void {
    this.emit({ op: Op.LOAD_CAPTURE, a: slotIdx });
  }

  ret(): void {
    this.emit({ op: Op.RET });
  }

  // ==========================================
  // Host calls
  // ==========================================

  hostCall(hostId: number, argc: number, callSiteId: number): void {
    this.emit({ op: Op.HOST_CALL, a: hostId, b: argc, c: callSiteId });
  }

  hostCallAsync(hostId: number, argc: number, callSiteId: number): void {
    this.emit({ op: Op.HOST_CALL_ASYNC, a: hostId, b: argc, c: callSiteId });
  }

  actionCall(actionSlot: number, argc: number, callSiteId: number): void {
    this.emit({ op: Op.ACTION_CALL, a: actionSlot, b: argc, c: callSiteId });
  }

  actionCallAsync(actionSlot: number, argc: number, callSiteId: number): void {
    this.emit({ op: Op.ACTION_CALL_ASYNC, a: actionSlot, b: argc, c: callSiteId });
  }

  // ==========================================
  // Async operations
  // ==========================================

  await(): void {
    this.emit({ op: Op.AWAIT });
  }

  yield(): void {
    this.emit({ op: Op.YIELD });
  }

  // ==========================================
  // Exception handling
  // ==========================================

  /** Begin try block. catchLabel points to the catch handler. */
  try(catchLabel: number): void {
    this.emit({ op: Op.TRY, a: 0 }); // placeholder for relative offset to catch block
    this.addFixup(catchLabel, "a");
  }

  endTry(): void {
    this.emit({ op: Op.END_TRY });
  }

  throw(): void {
    this.emit({ op: Op.THROW });
  }

  // ==========================================
  // Boundaries
  // ==========================================

  /**
   * Mark the start of a WHEN boundary.
   * The VM will store the current operand stack height for comparison at WHEN_END.
   */
  whenStart(): void {
    this.emit({ op: Op.WHEN_START });
  }

  /**
   * Mark the end of a WHEN boundary.
   * Conditionally skips to skipLabel if the WHEN result (popped from stack) is false.
   *
   * @param skipLabel - Label to jump to if WHEN evaluated to false (typically after DO section)
   */
  whenEnd(skipLabel: number): void {
    this.emit({ op: Op.WHEN_END, a: 0 }); // placeholder for relative offset
    this.addFixup(skipLabel, "a");
  }

  /**
   * Mark the start of a DO boundary.
   */
  doStart(): void {
    this.emit({ op: Op.DO_START });
  }

  /**
   * Mark the end of a DO boundary.
   */
  doEnd(): void {
    this.emit({ op: Op.DO_END });
  }

  // ==========================================
  // List operations
  // ==========================================

  /** Create a new list with typeId. */
  listNew(typeIdConstIdx: number): void {
    this.emit({ op: Op.LIST_NEW, a: 0, b: typeIdConstIdx });
  }

  /** Push value onto list. */
  listPush(): void {
    this.emit({ op: Op.LIST_PUSH });
  }

  /** Get element from list at index. */
  listGet(): void {
    this.emit({ op: Op.LIST_GET });
  }

  /** Set element in list at index. */
  listSet(): void {
    this.emit({ op: Op.LIST_SET });
  }

  /** Get list length. */
  listLen(): void {
    this.emit({ op: Op.LIST_LEN });
  }

  /** Pop last element from list. */
  listPop(): void {
    this.emit({ op: Op.LIST_POP });
  }

  /** Shift first element from list. */
  listShift(): void {
    this.emit({ op: Op.LIST_SHIFT });
  }

  /** Remove element at index from list. */
  listRemove(): void {
    this.emit({ op: Op.LIST_REMOVE });
  }

  /** Insert value at index in list. */
  listInsert(): void {
    this.emit({ op: Op.LIST_INSERT });
  }

  /** Swap elements at indices i and j in list (void). */
  listSwap(): void {
    this.emit({ op: Op.LIST_SWAP });
  }

  // ==========================================
  // Map operations
  // ==========================================

  /** Create a new map with typeId from constant pool. */
  mapNew(typeIdConstIdx: number): void {
    this.emit({ op: Op.MAP_NEW, a: 0, b: typeIdConstIdx });
  }

  /** Set key-value pair in map. */
  mapSet(): void {
    this.emit({ op: Op.MAP_SET });
  }

  /** Get value from map by key. */
  mapGet(): void {
    this.emit({ op: Op.MAP_GET });
  }

  /** Check if map has key. */
  mapHas(): void {
    this.emit({ op: Op.MAP_HAS });
  }

  /** Delete key from map. */
  mapDelete(): void {
    this.emit({ op: Op.MAP_DELETE });
  }

  // ==========================================
  // Struct operations
  // ==========================================

  /** Create a new empty struct. typeIdConstIdx is the constant pool index for the typeId string. */
  structNew(typeIdConstIdx: number): void {
    this.emit({ op: Op.STRUCT_NEW, a: 0, b: typeIdConstIdx });
  }

  /** Get field from struct. Field name is on stack. */
  structGet(): void {
    this.emit({ op: Op.STRUCT_GET });
  }

  /** Set field in struct. Field name and value are on stack. */
  structSet(): void {
    this.emit({ op: Op.STRUCT_SET });
  }

  /** Copy struct excluding N keys. Keys are on stack, then source struct. typeIdConstIdx is constant pool index for typeId. */
  structCopyExcept(numExclude: number, typeIdConstIdx: number): void {
    this.emit({ op: Op.STRUCT_COPY_EXCEPT, a: numExclude, b: typeIdConstIdx });
  }

  // ==========================================
  // Generic field access
  // ==========================================

  /** Get field from value. Field name is on stack. */
  getField(): void {
    this.emit({ op: Op.GET_FIELD });
  }

  /** Set field on value. Value and field name are on stack. */
  setField(): void {
    this.emit({ op: Op.SET_FIELD });
  }

  // ==========================================
  // Frame-local variables
  // ==========================================

  loadLocal(slotIdx: number): void {
    this.emit({ op: Op.LOAD_LOCAL, a: slotIdx });
  }

  storeLocal(slotIdx: number): void {
    this.emit({ op: Op.STORE_LOCAL, a: slotIdx });
  }

  // ==========================================
  // Callsite-persistent variables
  // ==========================================

  loadCallsiteVar(slotIdx: number): void {
    this.emit({ op: Op.LOAD_CALLSITE_VAR, a: slotIdx });
  }

  storeCallsiteVar(slotIdx: number): void {
    this.emit({ op: Op.STORE_CALLSITE_VAR, a: slotIdx });
  }

  // ==========================================
  // Type introspection
  // ==========================================

  typeCheck(nativeType: number): void {
    this.emit({ op: Op.TYPE_CHECK, a: nativeType });
  }

  instanceOf(typeIdConstIdx: number): void {
    this.emit({ op: Op.INSTANCE_OF, a: typeIdConstIdx });
  }

  // ==========================================
  // Finalization
  // ==========================================

  /**
   * Finalize the instruction stream by patching all jump/try offsets.
   * Returns the complete list of instructions ready for execution.
   * After calling finalize(), no more instructions can be emitted.
   */
  finalize(): List<Instr> {
    if (this.finalized) {
      throw new Error("Already finalized");
    }
    this.finalized = true;

    // Patch all fixups
    for (let i = 0; i < this.fixups.size(); i++) {
      const fixup = this.fixups.get(i)!;
      const targetPc = this.labels.get(fixup.labelId);

      if (targetPc === undefined) {
        throw new Error(`Undefined label ${fixup.labelId} referenced at instruction ${fixup.instrIdx}`);
      }

      // Calculate signed relative offset: target - current
      const currentPc = fixup.instrIdx;
      const relOffset = targetPc - currentPc;

      // Patch the instruction
      const instr = this.instrs.get(fixup.instrIdx)!;
      if (fixup.field === "a") {
        instr.a = relOffset;
      } else {
        instr.b = relOffset;
      }
    }

    return this.instrs;
  }

  /**
   * Reset the emitter state to start building a new function.
   * Useful when emitting multiple functions sequentially.
   */
  reset(): void {
    this.instrs = List.empty();
    this.labels = Dict.empty();
    this.fixups = List.empty();
    this.nextLabelId = 0;
    this.finalized = false;
  }
}
