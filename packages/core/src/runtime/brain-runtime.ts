import { Dict } from "../platform/dict";
import { List } from "../platform/list";
import type { IBrainRuntime, PageMetadata } from "./host-bindings";
import type { Program } from "./program";
import type { PlatformServices } from "./services";
import { NIL_VALUE, type Value } from "./value";

/**
 * Runtime entry point for a compiled Mindcraft brain. Owns the VM, the fiber
 * scheduler, the page lifecycle FSM, and brain- and rule-scoped variable
 * storage. Built once per linked {@link Program} from a pre-built
 * {@link PlatformServices} aggregate (minus the `brain` tier, which the
 * runtime constructs internally).
 *
 * A runtime-only target instantiates `BrainRuntime` directly from a
 * deserialized `Program` blob and a host-supplied `PlatformServices`
 * view; the authoring-side {@link Brain} facade does the same after
 * running the compile / link / treeshake pipeline, then bridges
 * {@link BrainEvents} to per-page authoring callbacks.
 *
 * The runtime surface (`think`, page-change requests, variable accessors,
 * etc.) is declared on {@link IBrainRuntime}.
 */
export class BrainRuntime implements IBrainRuntime {
  /**
   * Variable storage at the Brain level, indexed by compiler-assigned slot id.
   * Slot ids correspond to positions in the loaded program's variableNames pool;
   * they are the operand of LOAD_VAR_SLOT / STORE_VAR_SLOT. A slot value of
   * `undefined` means the slot has never been written; bytecode reads of such
   * slots observe `NIL_VALUE`.
   */
  private variables: List<Value | undefined> = List.empty();

  /**
   * Map from variable name to slot id. Populated from `Program.variableNames`
   * at program load. Names not in the program may be lazily added by host
   * functions calling the name-keyed `setVariable` API; such slots are addressable
   * by name only (no bytecode operand can target them).
   */
  private varSlotByName: Dict<string, number> = new Dict<string, number>();

  /**
   * Construct a fully ready-to-`startup()` runtime around a linked,
   * treeshaken {@link Program}.
   *
   * @param program - Linked program loaded into the VM. Variable-name to
   *   slot binding is read from `program.variableNames`.
   * @param pageMetadata - Per-page metadata produced by the linker
   *   (root rule funcIds, action call sites, sensors, actuators).
   * @param hostServices - The three host- and module-supplied tiers of
   *   {@link PlatformServices} (`runtime`, `shared`, `app`). The runtime
   *   builds the `brain` tier internally and composes the full nested
   *   aggregate before handing it to the VM.
   * @param contextData - Application-specific data attached to the
   *   brain's `ExecutionContext`. Host functions read this via
   *   `ctx.data`.
   * @param previousVariables - Optional snapshot of the prior runtime's
   *   variable storage, used by the authoring-side facade to carry
   *   variable values across a re-initialization (hot reload). Each
   *   variable whose name exists in both the old and new
   *   `program.variableNames` keeps its value; variables only in the old
   *   program are dropped; variables new to the new program start
   *   unwritten.
   */
  constructor(
    protected readonly program: Program,
    protected readonly pageMetadata: List<PageMetadata>,
    protected readonly hostServices: Omit<PlatformServices, "brain">,
    protected readonly contextData: unknown = undefined,
    previousVariables?: VariableSnapshot
  ) {
    this.installVariableTable(program.variableNames, previousVariables);
  }

  /**
   * Get a variable value by its name. The brain looks up the slot id assigned
   * to the name (either by the loaded program or lazily by a previous host
   * write) and returns the slot's current value, or `undefined` if the name
   * has never been associated with a slot.
   *
   * @param varId - Variable name
   * @returns The variable's current value, or undefined if not found
   */
  getVariable<T extends Value>(varId: string): T | undefined {
    const slotId = this.varSlotByName.get(varId);
    if (slotId === undefined) return undefined;
    if (slotId >= this.variables.size()) return undefined;
    return this.variables.get(slotId) as T | undefined;
  }

  /**
   * Set a variable value by its name. If the name is not yet bound to a slot,
   * a new slot is allocated and `varSlotByName` is extended. Slots allocated
   * this way are not addressable from bytecode (no `LOAD_VAR_SLOT` operand can
   * target them) -- only host functions that use the name-keyed API can read
   * them back.
   *
   * @param varId - Variable name
   * @param value - The value to store
   */
  setVariable(varId: string, value: Value): void {
    const existingSlot = this.varSlotByName.get(varId);
    if (existingSlot !== undefined) {
      this.variables.set(existingSlot, value);
      return;
    }
    const newSlot = this.variables.size();
    this.variables.push(value);
    this.varSlotByName.set(varId, newSlot);
  }

  /**
   * Clear a variable by its name. Resets the underlying slot to the
   * never-written sentinel; the slot itself is retained so subsequent
   * bytecode operands remain valid (and observe `NIL_VALUE`).
   *
   * @param varId - Variable name
   */
  clearVariable(varId: string): void {
    const slotId = this.varSlotByName.get(varId);
    if (slotId === undefined) return;
    if (slotId < this.variables.size()) {
      this.variables.set(slotId, undefined);
    }
  }

  /**
   * Reset every slot to the never-written sentinel while preserving the
   * program-derived slot layout (slot ids and `varSlotByName` mappings
   * remain stable).
   */
  clearVariables(): void {
    for (let i = 0; i < this.variables.size(); i++) {
      this.variables.set(i, undefined);
    }
  }

  /**
   * Read a variable by its compiler-assigned slot id. Returns `NIL_VALUE`
   * if the slot is out of range or has never been written. Called by the
   * VM dispatch loop on every `LOAD_VAR_SLOT`.
   */
  getVariableBySlot(slotId: number): Value {
    if (slotId < 0 || slotId >= this.variables.size()) return NIL_VALUE;
    const v = this.variables.get(slotId);
    return v === undefined ? NIL_VALUE : v;
  }

  /**
   * Write a variable by its compiler-assigned slot id. Called by the VM
   * dispatch loop on every `STORE_VAR_SLOT`. Out-of-range slot ids are
   * a compiler / linker bug; the VM enforces bounds against
   * `program.variableNames.size()` before calling this.
   */
  setVariableBySlot(slotId: number, value: Value): void {
    if (slotId < 0) return;
    while (this.variables.size() <= slotId) {
      this.variables.push(undefined);
    }
    this.variables.set(slotId, value);
  }

  /**
   * Returns a snapshot of the current variable storage for carry-forward
   * across a re-initialization. The snapshot holds live references to the
   * current `variables` list and `varSlotByName` map; the caller consumes
   * it immediately to construct the next runtime and then drops the old
   * runtime.
   */
  snapshotVariables(): VariableSnapshot {
    return { values: this.variables, slotsByName: this.varSlotByName };
  }

  /**
   * Wire variable storage to a program's `variableNames` pool.
   * Allocates a fresh slot list of size `programVariableNames.size()`
   * with the never-written sentinel, builds a fresh name->slot map, and
   * copies any previously-set values forward by name -- preserving values
   * for variables that exist in both the previous and the new program.
   * Variables present only in the previous program are dropped; variables
   * new to the program start unwritten (read as `NIL_VALUE` from bytecode,
   * `undefined` from the name-keyed `getVariable`).
   */
  private installVariableTable(programVariableNames: List<string>, previousVariables?: VariableSnapshot): void {
    const previousValues = previousVariables?.values ?? List.empty<Value | undefined>();
    const previousSlots = previousVariables?.slotsByName ?? new Dict<string, number>();

    const newSize = programVariableNames.size();
    const newValues = List.empty<Value | undefined>();
    const newSlots = new Dict<string, number>();
    for (let i = 0; i < newSize; i++) {
      const name = programVariableNames.get(i)!;
      newSlots.set(name, i);
      const oldSlot = previousSlots.get(name);
      if (oldSlot !== undefined && oldSlot < previousValues.size()) {
        newValues.push(previousValues.get(oldSlot));
      } else {
        newValues.push(undefined);
      }
    }

    this.variables = newValues;
    this.varSlotByName = newSlots;
  }
}

/**
 * Snapshot of a {@link BrainRuntime}'s variable storage. Carries forward
 * variable values across a re-initialization: the next runtime's
 * constructor receives this snapshot and keeps every value whose
 * variable name still exists in the new `program.variableNames`.
 *
 * Slots in `values` are indexed by the slot id assigned by the prior
 * program; `slotsByName` maps each variable name to its slot id in that
 * snapshot. Both sides are needed because slot ids are program-local
 * and not stable across recompiles.
 */
export interface VariableSnapshot {
  values: List<Value | undefined>;
  slotsByName: Dict<string, number>;
}
