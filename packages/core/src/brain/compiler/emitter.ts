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
 * em.loadVar(1);
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
    this.emit({ op: Op.PUSH_CONST, a: constIdx });
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

  // ==========================================
  // Variables (stored in execution context by name)
  // ==========================================

  loadVar(varNameIdx: number): void {
    this.emit({ op: Op.LOAD_VAR, a: varNameIdx });
  }

  storeVar(varNameIdx: number): void {
    this.emit({ op: Op.STORE_VAR, a: varNameIdx });
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

  hostCallArgs(hostId: number, argc: number, callSiteId: number): void {
    this.emit({ op: Op.HOST_CALL_ARGS, a: hostId, b: argc, c: callSiteId });
  }

  hostCallArgsAsync(hostId: number, argc: number, callSiteId: number): void {
    this.emit({ op: Op.HOST_CALL_ARGS_ASYNC, a: hostId, b: argc, c: callSiteId });
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
  listNew(typeId: number): void {
    this.emit({ op: Op.LIST_NEW, a: typeId });
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

  // ==========================================
  // Map operations
  // ==========================================

  /** Create a new map with typeId. */
  mapNew(typeId: number): void {
    this.emit({ op: Op.MAP_NEW, a: typeId });
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

  /** Create a new struct with typeId. */
  structNew(typeId: number): void {
    this.emit({ op: Op.STRUCT_NEW, a: typeId });
  }

  /** Get field from struct. Field name is on stack. */
  structGet(): void {
    this.emit({ op: Op.STRUCT_GET });
  }

  /** Set field in struct. Field name and value are on stack. */
  structSet(): void {
    this.emit({ op: Op.STRUCT_SET });
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
