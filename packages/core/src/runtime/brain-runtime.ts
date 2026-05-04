import { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import { EventEmitter, type EventEmitterConsumer } from "../platform/event-emitter";
import { List } from "../platform/list";
import type { ICallsiteStore } from "./callsite-store";
import type { BytecodeExecutableAction, ExecutionContext } from "./context";
import type { BrainEvents, IBrainRuntime, PageMetadata } from "./host-bindings";
import type { Program } from "./program";
import type { RuleVariableStores } from "./rule-services";
import type { PlatformServices } from "./services";
import { NIL_VALUE, type Value } from "./value";
import { FiberScheduler, VM } from "./vm";
import { VmStatus } from "./vm-types";

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
   * The linked program loaded into the VM.
   */
  private readonly program: Program;

  /**
   * Per-page metadata produced by the linker (root rule funcIds, action call
   * sites, sensors, actuators).
   */
  private readonly pageMetadata: List<PageMetadata>;

  /**
   * Single VM instance for executing all rules.
   */
  private readonly vm: VM;

  /**
   * Single scheduler for managing all fibers.
   */
  private readonly scheduler: FiberScheduler;

  /**
   * Persistent execution context shared across all fibers. Provides variable
   * access and services to host functions and the VM dispatch loop.
   */
  private readonly executionContext: ExecutionContext;

  /**
   * Brain-instance-scoped owner of per-callsite state. Backs
   * `services.brain.callsite`; cleared on shutdown.
   */
  private readonly callsiteStore: ICallsiteStore;

  /**
   * Per-rule variable storage keyed by rule funcId, then by variable name.
   * Backs `services.brain.ruleVars`. Allocated lazily per rule on first write.
   */
  private readonly ruleVariableStores: RuleVariableStores;

  /**
   * The canonical brain-scheduler interface. Each entry holds the program
   * funcId and the scheduler-assigned fiberId for an active root rule.
   */
  private activeRuleFiberIds: List<{ funcId: number; fiberId: number | undefined }> = List.empty();

  private nextInlineFiberId: number = -1000000;

  /**
   * Event emitter for brain lifecycle events.
   * 
   * @deprecated transitional
   */
  private readonly emitter_: EventEmitter<BrainEvents> = new EventEmitter<BrainEvents>();

  /**
   * Construct a fully ready-to-`startup()` runtime around a linked,
   * treeshaken {@link Program}.
   *
   * @param program - Linked program loaded into the VM. Variable-name to
   *   slot binding is read from `program.variableNames`.
   * @param pageMetadata - Per-page metadata produced by the linker
   *   (root rule funcIds, action call sites, sensors, actuators).
   * @param services - Fully assembled {@link PlatformServices} including
   *   the `brain` tier, built by the authoring-side facade.
   * @param contextData - Application-specific data attached to the
   *   brain's `ExecutionContext`. Host functions read this via `ctx.data`.
   * @param previousVariables - Optional snapshot of the prior runtime's
   *   variable storage, used to carry variable values across a
   *   re-initialization (hot reload).
   */
  constructor(
    program: Program,
    pageMetadata: List<PageMetadata>,
    services: PlatformServices,
    contextData: unknown = undefined,
    previousVariables?: VariableSnapshot
  ) {
    this.program = program;
    this.pageMetadata = pageMetadata;
    this.callsiteStore = services.brain.callsite as ICallsiteStore;
    this.ruleVariableStores = new Dict();

    this.installVariableTable(program.variableNames, previousVariables);

    this.vm = new VM(program, services);
    this.scheduler = new FiberScheduler(this.vm, {
      maxFibersPerTick: 64,
      defaultBudget: 1000,
      autoGcHandles: true,
    });

    const runtime = this;
    this.executionContext = {
      services,
      getVariableBySlot(slotId: number): Value {
        return runtime.getVariableBySlot(slotId);
      },
      setVariableBySlot(slotId: number, value: Value): void {
        runtime.setVariableBySlot(slotId, value);
      },
      time: 0,
      dt: 0,
      currentTick: 0,
      data: contextData,
    };
  }

  /**
   * Linked executable program loaded into the VM.
   */
  getProgram(): Program | undefined {
    return this.program;
  }

  /**
   * Per-page metadata for the loaded program.
   */
  getPages(): List<PageMetadata> {
    return this.pageMetadata;
  }

  /**
   * Event stream for brain lifecycle notifications.
   */
  events(): EventEmitterConsumer<BrainEvents> {
    return this.emitter_.consumer();
  }

  // -------------------------------------------------------------------------
  // Accessors for Brain's FSM while the page lifecycle methods still live
  // in brain.ts. Removed when the FSM moves into this class.
  // -------------------------------------------------------------------------

  /** @deprecated transitional */
  _vm(): VM {
    return this.vm;
  }

  /** @deprecated transitional */
  _scheduler(): FiberScheduler {
    return this.scheduler;
  }

  /** @deprecated transitional */
  _executionContext(): ExecutionContext {
    return this.executionContext;
  }

  /** @deprecated transitional */
  _callsiteStore(): ICallsiteStore {
    return this.callsiteStore;
  }

  /** @deprecated transitional */
  _ruleVariableStores(): RuleVariableStores {
    return this.ruleVariableStores;
  }

  /** @deprecated transitional */
  _getActiveRuleFiberIds(): List<{ funcId: number; fiberId: number | undefined }> {
    return this.activeRuleFiberIds;
  }

  /** @deprecated transitional */
  _setActiveRuleFiberIds(value: List<{ funcId: number; fiberId: number | undefined }>): void {
    this.activeRuleFiberIds = value;
  }

  /** @deprecated transitional */
  _getNextInlineFiberId(): number {
    return this.nextInlineFiberId;
  }

  /** @deprecated transitional */
  _consumeNextInlineFiberId(): number {
    return this.nextInlineFiberId--;
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

  // -------------------------------------------------------------------------
  // Activation / deactivation hook drivers -- called by Brain's FSM.
  // -------------------------------------------------------------------------

  /**
   * Run the host-binding activation hook for a call site.
   */
  public runHostActivationHook(callSiteId: number, onPageEntered: (ctx: ExecutionContext) => void): void {
    const executionContext = this.executionContext;
    const previousCallSiteId = executionContext.currentCallSiteId;
    const previousRuleFuncId = executionContext.currentRuleFuncId;

    executionContext.currentCallSiteId = callSiteId;
    executionContext.currentRuleFuncId = undefined;

    try {
      onPageEntered(executionContext);
    } finally {
      executionContext.currentCallSiteId = previousCallSiteId;
      executionContext.currentRuleFuncId = previousRuleFuncId;
    }
  }

  /**
   * Run the host-binding initializer hook for a call site.
   */
  public runHostInitializerHook(callSiteId: number, onInitialized: (ctx: ExecutionContext) => void): void {
    const executionContext = this.executionContext;
    const previousCallSiteId = executionContext.currentCallSiteId;
    const previousRuleFuncId = executionContext.currentRuleFuncId;

    executionContext.currentCallSiteId = callSiteId;
    executionContext.currentRuleFuncId = undefined;

    try {
      onInitialized(executionContext);
    } finally {
      executionContext.currentCallSiteId = previousCallSiteId;
      executionContext.currentRuleFuncId = previousRuleFuncId;
    }
  }

  /**
   * Run the bytecode initializer hook for an action.
   */
  public runBytecodeInitializerHook(action: BytecodeExecutableAction, callSiteId: number): void {
    if (action.initializerFuncId === undefined) return;
    this.runBytecodeHook(action, callSiteId, action.initializerFuncId, "initialization");
  }

  /**
   * Run the bytecode activation hook for an action.
   */
  public runBytecodeActivationHook(action: BytecodeExecutableAction, callSiteId: number): void {
    if (action.activationFuncId === undefined) return;
    this.runBytecodeHook(action, callSiteId, action.activationFuncId, "activation");
  }

  /**
   * Run the bytecode deactivation hook for an action.
   */
  public runBytecodeDeactivationHook(action: BytecodeExecutableAction, callSiteId: number): void {
    if (action.deactivationFuncId === undefined) return;
    this.runBytecodeHook(action, callSiteId, action.deactivationFuncId, "deactivation");
  }

  /**
   * Run the host-binding deactivation hook for a call site.
   */
  public runHostDeactivationHook(callSiteId: number, onPageExited: (ctx: ExecutionContext) => void): void {
    const executionContext = this.executionContext;
    const previousCallSiteId = executionContext.currentCallSiteId;
    const previousRuleFuncId = executionContext.currentRuleFuncId;

    executionContext.currentCallSiteId = callSiteId;
    executionContext.currentRuleFuncId = undefined;

    try {
      onPageExited(executionContext);
    } finally {
      executionContext.currentCallSiteId = previousCallSiteId;
      executionContext.currentRuleFuncId = previousRuleFuncId;
    }
  }

  /**
   * Spawn a synchronous fiber for a hook function and run it to completion.
   * Throws a platform {@link Error} if the fiber faults or suspends.
   */
  public runBytecodeHook(action: BytecodeExecutableAction, callSiteId: number, funcId: number, label: string): void {
    const executionContext = this.executionContext;
    const vm = this.vm;
    const scheduler = this.scheduler;

    const hookContext: ExecutionContext = {
      ...executionContext,
      currentCallSiteId: callSiteId,
      currentRuleFuncId: undefined,
    };
    const hookFiber = vm.spawnFiber(this.nextInlineFiberId--, funcId, List.empty(), hookContext);
    const hookFrame = hookFiber.frames.get(0)!;
    hookFrame.actionBinding = {
      actionKey: action.descriptor.key,
      callSiteId,
      isAsync: false,
    };
    hookFiber.instrBudget = 10000;

    const result = vm.runFiber(hookFiber, scheduler);
    if (result.status === VmStatus.FAULT) {
      throw new Error(`Page ${label} for action '${action.descriptor.key}' faulted: ${result.error.message}`);
    }
    if (result.status !== VmStatus.DONE) {
      throw new Error(`Page ${label} for action '${action.descriptor.key}' cannot suspend`);
    }
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
