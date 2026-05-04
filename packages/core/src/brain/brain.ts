import { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import { List } from "../platform/list";
import { MathOps } from "../platform/math";
import {
  type BrainEvents,
  type BrainLinkEnvironment,
  FiberState,
  type IBrain,
  type PageMetadata,
  type UnlinkedBrainProgram,
  VmStatus,
} from "../runtime";
import { createCallsiteStore, type ICallsiteStore } from "../runtime/callsite-store";
import type { BytecodeExecutableAction, ExecutionContext } from "../runtime/context";
import { linkBrainProgram } from "../runtime/linker";
import type { Program } from "../runtime/program";
import { createProgramServices, createRuleVariableServices, type RuleVariableStores } from "../runtime/rule-services";
import { createRuntimeServices } from "../runtime/runtime-services";
import type { PlatformServices } from "../runtime/services";
import { treeshakeProgram } from "../runtime/tree-shaker";
import { NIL_VALUE, type Value } from "../runtime/value";
import { FiberScheduler, VM } from "../runtime/vm";
import { EventEmitter, type EventEmitterConsumer } from "../util";
import { compileBrain } from "./compiler";
import type { IBrainDef, IBrainPageDef } from "./interfaces";
import { BrainPage } from "./page";
import type { BrainRule } from "./rule";
import type { BrainServices } from "./services";

/**
 * Brain runtime instance.
 *
 * The Brain serves as the central execution engine for all rules.
 * It owns a single VM and FiberScheduler that execute the compiled BrainProgram.
 *
 * Architecture: Each Rule = One Function
 * - The entire brain is compiled into a single BrainProgram
 * - Each rule becomes a function in the program
 * - The Brain owns one VM instance and one FiberScheduler
 * - Variables are stored at the Brain level (shared across all rules)
 * - Page switching spawns fibers for the new page's root rules
 *
 * Execution Model:
 * - On page activation, spawn fibers for each root rule in the page
 * - Each frame, tick the scheduler to execute fibers
 * - When a rule's WHEN is true, it executes DO and then CALLs child rules
 * - Fibers that complete are respawned on the next frame
 */
export class Brain implements IBrain {
  private readonly emitter_ = new EventEmitter<BrainEvents>();
  private enabled: boolean = true;
  private interrupted: boolean = false;
  private currentPageIndex: number = 0;
  private desiredPageIndex: number = 0;
  private previousPageIndex: number = -1;
  private restartPageRequested: boolean = false;
  private lastThinkTime: number = 0;

  /** Runtime page instances */
  pages: List<BrainPage> = new List<BrainPage>();

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
   * Unlinked program emitted by the brain compiler.
   */
  private compiledProgram: UnlinkedBrainProgram | undefined;

  /**
   * Linked executable program used by the VM.
   */
  private program: Program | undefined;

  /**
   * Brain-side rule-to-function-id mapping for the loaded program.
   * Built by {@link linkBrainProgram} and updated by {@link treeshakeProgram}
   * when functions are compacted.
   */
  private ruleIndex: Dict<string, number> | undefined;

  /**
   * Per-page metadata for the loaded program (page activation, call sites,
   * sensors, actuators).
   */
  private pageMetadata: List<PageMetadata> | undefined;

  /**
   * Single VM instance for executing all rules.
   */
  private vm: VM | undefined;

  /**
   * Single scheduler for managing all fibers.
   */
  private scheduler: FiberScheduler | undefined;

  /**
   * Persistent execution context for the brain.
   * Shared across all fibers, provides variable access.
   */
  private executionContext: ExecutionContext | undefined;

  /**
   * Brain-instance-scoped owner of per-callsite state. Backs the
   * `services.callsite` adapter built by {@link createRuntimeServices};
   * cleared on {@link shutdown}.
   */
  private readonly callsiteStore: ICallsiteStore = createCallsiteStore();

  /**
   * Per-rule variable storage keyed by rule funcId, then by variable name.
   * Backs {@link PlatformServices.ruleVars}; reads walk the ancestor chain
   * declared by `Program.ruleAncestors` when the variable is not present in
   * the child rule's own store. Allocated lazily per rule on first write.
   */
  private ruleVariableStores: RuleVariableStores = new Dict();

  /**
   * The canonical Brain<->scheduler interface object. Each entry holds
   * `funcId` (program-resolved rule function id) and `fiberId`
   * (scheduler-issued fiber id).
   */
  private activeRuleFiberIds: List<{ funcId: number; fiberId: number | undefined }> = List.empty();

  private nextInlineFiberId: number = -1000000;

  /** O(1) lookup from stable pageId (UUID) to page index, built during initialize(). */
  private pageIdToIndex: Dict<string, number> = new Dict();

  /** O(1) lookup from page name to page index, built during initialize(). */
  private pageNameToIndex: Dict<string, number> = new Dict();

  constructor(
    public readonly brainDef: IBrainDef,
    private readonly services: BrainServices,
    private readonly linkEnvironment?: BrainLinkEnvironment
  ) {
    // Create runtime page instances
    brainDef.pages().forEach((pageDef: IBrainPageDef) => {
      const page = new BrainPage(this, pageDef);
      this.pages.push(page);
    });
  }

  events(): EventEmitterConsumer<BrainEvents> {
    return this.emitter_.consumer();
  }

  /**
   * Compile the brain, link its actions, and initialize the VM.
   * Must be called before think() can execute rules.
   */
  initialize(contextData?: unknown): void {
    const linkEnvironment = this.getLinkEnvironment();

    // Compile the entire brain into an unlinked program, then link actions.
    this.compiledProgram = compileBrain(this.brainDef, linkEnvironment.catalogs, this.services.conversions);
    let linked = linkBrainProgram(
      this.compiledProgram,
      this.brainDef,
      linkEnvironment.catalogs,
      linkEnvironment.actionResolver
    );

    // Tree-shake unreachable functions, constants, and variable names.
    linked = treeshakeProgram(linked);
    this.program = linked.program;
    this.ruleIndex = linked.ruleIndex;
    this.pageMetadata = linked.pages;

    // Wire the brain-level variable storage to the loaded program's variableNames pool.
    this.installVariableTable(this.program.variableNames);

    // Assign function IDs to runtime rule objects
    for (let pageIdx = 0; pageIdx < this.pages.size(); pageIdx++) {
      const page = this.pages.get(pageIdx)!;
      page.assignFuncIds(this.ruleIndex, pageIdx);
    }

    // Allocate the brain-instance side-table that backs services.ruleVars.
    this.ruleVariableStores = new Dict<number, Dict<string, Value>>();

    // Assemble PlatformServices for the VM, binding the per-callsite
    // adapter to the brain's callsiteStore.
    const runtimeServices = createRuntimeServices(this, this.callsiteStore);
    const platformServices: PlatformServices = {
      functions: this.services.functions,
      types: this.services.types,
      program: createProgramServices(this.program),
      brainVars: runtimeServices.brainVars,
      ruleVars: createRuleVariableServices(this.program, this.ruleVariableStores),
      brainPages: runtimeServices.brainPages,
      rng: runtimeServices.rng,
      callsite: runtimeServices.callsite,
    };

    // Create VM with the linked executable program.
    this.vm = new VM(this.program, platformServices);

    // Create scheduler
    this.scheduler = new FiberScheduler(this.vm, {
      maxFibersPerTick: 64,
      defaultBudget: 1000,
      autoGcHandles: true,
    });

    // Build page lookup indices for O(1) resolution in requestPageChangeByPageId / requestPageChangeByName
    this.pageIdToIndex = new Dict();
    this.pageNameToIndex = new Dict();
    for (let i = 0; i < this.pageMetadata.size(); i++) {
      const meta = this.pageMetadata.get(i);
      if (meta) {
        this.pageIdToIndex.set(meta.pageId, i);
        this.pageNameToIndex.set(meta.pageName, i);
      }
    }

    // Create shared execution context
    const brain = this;
    this.executionContext = {
      services: platformServices,
      getVariableBySlot(slotId: number): Value {
        return brain.getVariableBySlot(slotId);
      },
      setVariableBySlot(slotId: number, value: Value): void {
        brain.setVariableBySlot(slotId, value);
      },
      time: 0,
      dt: 0,
      currentTick: 0,
      data: contextData,
    };
  }

  /**
   * Check if the brain has been initialized and is ready to execute.
   */
  isInitialized(): boolean {
    return this.vm !== undefined && this.scheduler !== undefined && this.program !== undefined;
  }

  /**
   * Get the linked executable program (for debugging/inspection).
   */
  getProgram(): Program | undefined {
    return this.program;
  }

  getCompiledProgram(): UnlinkedBrainProgram | undefined {
    return this.compiledProgram;
  }

  getPages(): List<PageMetadata> {
    return this.pageMetadata ?? List.empty<PageMetadata>();
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
   * Wire the brain's variable storage to a program's `variableNames` pool.
   * Allocates a fresh slot list of size `programVariableNames.size()`
   * with the never-written sentinel, builds a fresh name->slot map, and
   * copies any previously-set values forward by name -- preserving values
   * for variables that exist in both the previous and the new program.
   * Variables present only in the previous program are dropped; variables
   * new to the program start unwritten (read as `NIL_VALUE` from bytecode,
   * `undefined` from the name-keyed `getVariable`).
   */
  private installVariableTable(programVariableNames: List<string>): void {
    const previousValues = this.variables;
    const previousSlots = this.varSlotByName;

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

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled() {
    return this.enabled;
  }

  interrupt() {
    this.interrupted = true;
  }

  clearInterrupt() {
    this.interrupted = false;
  }

  isInterrupted() {
    return this.interrupted;
  }

  requestPageChange(pageIndex: number) {
    if (pageIndex < 0 || pageIndex >= this.pages.size()) {
      // Invalid page index -> disable the brain by setting desired page to -1
      this.desiredPageIndex = -1;
      return;
    }
    if (pageIndex === this.currentPageIndex) {
      this.requestPageRestart();
      return;
    }
    this.desiredPageIndex = pageIndex;
    // Cancel active fibers so no more rules evaluate this tick
    this.cancelActiveFibers();
  }

  requestPageChangeByPageId(pageId: string): void {
    const idx = this.pageIdToIndex.get(pageId);
    if (idx !== undefined) {
      this.requestPageChange(idx);
      return;
    }
    // No pageId match -- fall back to name lookup so that programmatically
    // constructed strings still work (e.g. page-jump tables).
    this.requestPageChangeByName(pageId);
  }

  requestPageChangeByName(name: string): void {
    const idx = this.pageNameToIndex.get(name);
    if (idx !== undefined) {
      this.requestPageChange(idx);
      return;
    }
    // No matching page found -> resolve to -1 (disabled)
    this.requestPageChange(-1);
  }

  requestPageRestart() {
    this.restartPageRequested = true;
    // Cancel active fibers so no more rules evaluate this tick
    this.cancelActiveFibers();
  }

  getCurrentPageId(): string {
    if (!this.pageMetadata || !this.isValidPageIndex(this.currentPageIndex)) return "";
    const meta = this.pageMetadata.get(this.currentPageIndex);
    return meta ? meta.pageId : "";
  }

  getPreviousPageId(): string {
    if (!this.pageMetadata || !this.isValidPageIndex(this.previousPageIndex)) {
      return this.getCurrentPageId();
    }
    const meta = this.pageMetadata.get(this.previousPageIndex);
    return meta ? meta.pageId : this.getCurrentPageId();
  }

  startup() {
    this.currentPageIndex = this.desiredPageIndex = 0;
    this.previousPageIndex = -1;
    this.restartPageRequested = false;
    this.lastThinkTime = 0;
    this.interrupted = false;

    // Activate first page
    if (this.isInitialized() && this.pages.size() > 0) {
      this.activatePage(0);
    }
  }

  shutdown() {
    // Run deactivation hooks for the current page, then cancel its fibers.
    this.deactivateCurrentPage();

    // Release VM-owned transient runtime state.
    this.vm?.shutdown();

    // Tear down all per-callsite storage so a subsequent startup() re-runs
    // every action's initializerFuncId.
    this.callsiteStore.clearAll();

    // Clear per-rule variable storage.
    this.ruleVariableStores.clear();

    // Clear variables
    this.clearVariables();
  }

  think(currentTime: number) {
    if (!this.enabled || this.interrupted || !this.pages.size() || !this.isInitialized()) return;

    // Handle page restart (same page). Fibers were already cancelled in
    // requestPageRestart(); thinkPage() will detect them as CANCELLED and
    // respawn fresh fibers. We intentionally skip deactivate/activate so
    // callsite state, action instances, and page events are preserved.
    if (this.restartPageRequested) {
      this.restartPageRequested = false;
    }

    // Handle page changes
    if (this.currentPageIndex !== this.desiredPageIndex) {
      // Deactivate current page
      this.deactivateCurrentPage();

      this.previousPageIndex = this.currentPageIndex;
      this.currentPageIndex = this.desiredPageIndex;

      // Activate new page
      if (this.isValidPageIndex(this.currentPageIndex)) {
        this.activatePage(this.currentPageIndex);
      }
    }

    // Execute current page's rules
    if (this.isValidPageIndex(this.currentPageIndex)) {
      const dt = this.lastThinkTime === 0 ? 0 : currentTime - this.lastThinkTime;
      this.thinkPage(currentTime, dt);
    }

    this.lastThinkTime = currentTime;
  }

  rng(): number {
    return MathOps.random(); // TODO: Replace with a seeded deterministic RNG
  }

  /**
   * Activate a page by spawning fibers for its root rules.
   */
  private activatePage(pageIndex: number): void {
    if (!this.program || !this.scheduler || !this.executionContext || !this.vm || !this.pageMetadata) return;

    const pageMetadata = this.pageMetadata.get(pageIndex);
    if (!pageMetadata) return;

    // Clear any existing tracked fibers
    this.activeRuleFiberIds = List.empty();

    // For bytecode actions with an initializer, ensure the callsite to
    // detect first-touch and dispatch the initializer exactly once per
    // (brainInstance, callSiteId). Other action storage (state slots,
    // host state) is allocated lazily on first write.
    for (let i = 0; i < pageMetadata.actionCallSites.size(); i++) {
      const site = pageMetadata.actionCallSites.get(i)!;
      const actions = this.program.actions;
      const action = actions ? actions.get(site.actionSlot) : undefined;
      if (!action) {
        continue;
      }

      if (action.binding === "bytecode" && action.initializerFuncId !== undefined) {
        const newlyAllocated = this.callsiteStore.ensure(site.callSiteId);
        if (newlyAllocated) {
          this.runBytecodeInitializerHook(action, site.callSiteId);
        }
      }

      if (action.binding === "host") {
        if (action.onInitialized) {
          const newlyAllocated = this.callsiteStore.ensure(site.callSiteId);
          if (newlyAllocated) {
            this.runHostInitializerHook(site.callSiteId, action.onInitialized);
          }
        }
        if (action.onPageEntered) {
          this.runHostActivationHook(site.callSiteId, action.onPageEntered);
        }
        continue;
      }

      if (action.activationFuncId !== undefined) {
        this.runBytecodeActivationHook(action, site.callSiteId);
      }
    }

    this.executionContext.currentCallSiteId = undefined;
    this.executionContext.currentRuleFuncId = undefined;

    // Spawn a fiber for each root rule in the page.
    for (let i = 0; i < pageMetadata.rootRuleFuncIds.size(); i++) {
      const funcId = pageMetadata.rootRuleFuncIds.get(i)!;
      const fiberId = this.scheduler.spawn(funcId, List.empty(), this.executionContext);
      this.activeRuleFiberIds.push({ funcId, fiberId });
    }

    // Notify the page runtime
    const page = this.pages.get(pageIndex);
    if (page) {
      page.activate();
      this.emitter_.emit("page_activated", { pageIndex });
    }
  }

  /**
   * Cancel all active fibers for the current page.
   * Used to stop execution immediately when a page change or restart is requested.
   */
  private cancelActiveFibers(): void {
    if (!this.scheduler) return;
    for (let i = 0; i < this.activeRuleFiberIds.size(); i++) {
      const entry = this.activeRuleFiberIds.get(i)!;
      if (entry.fiberId !== undefined) {
        this.scheduler.cancel(entry.fiberId);
      }
    }
  }

  /**
   * Deactivate the current page by running its actions' deactivation hooks
   * and then cancelling its fibers. Hooks run before fiber cancellation so
   * they observe a fully live execution context.
   */
  private deactivateCurrentPage(): void {
    this.runDeactivationHooksForCurrentPage();

    this.cancelActiveFibers();
    this.activeRuleFiberIds = List.empty();

    if (this.executionContext) {
      this.executionContext.currentCallSiteId = undefined;
      this.executionContext.currentRuleFuncId = undefined;
    }

    // Notify the page runtime
    if (this.isValidPageIndex(this.currentPageIndex)) {
      const page = this.pages.get(this.currentPageIndex);
      if (page) {
        page.deactivate();
        this.emitter_.emit("page_deactivated", { pageIndex: this.currentPageIndex });
      }
    }
  }

  private runDeactivationHooksForCurrentPage(): void {
    if (!this.program || !this.pageMetadata || !this.isValidPageIndex(this.currentPageIndex)) {
      return;
    }
    const pageMetadata = this.pageMetadata.get(this.currentPageIndex);
    if (!pageMetadata) return;

    const actions = this.program.actions;
    if (!actions) return;

    for (let i = 0; i < pageMetadata.actionCallSites.size(); i++) {
      const site = pageMetadata.actionCallSites.get(i)!;
      const action = actions.get(site.actionSlot);
      if (!action) continue;

      if (action.binding === "host") {
        if (action.onPageExited) {
          this.runHostDeactivationHook(site.callSiteId, action.onPageExited);
        }
        continue;
      }

      if (action.deactivationFuncId !== undefined) {
        this.runBytecodeDeactivationHook(action, site.callSiteId);
      }
    }
  }

  /**
   * Execute one frame of the current page's rules.
   */
  private thinkPage(currentTime: number, dt: number): void {
    if (!this.scheduler || !this.executionContext) return;

    // Update execution context
    this.executionContext.time = currentTime;
    this.executionContext.dt = dt;
    this.executionContext.currentTick += 1;

    // Respawn completed root-rule fibers so rules re-evaluate every frame.\n    // Each root rule runs as a fiber that executes WHEN/DO once, then completes.\n    // On the next frame, we detect the completed fiber and spawn a fresh one.
    for (let i = 0; i < this.activeRuleFiberIds.size(); i++) {
      const entry = this.activeRuleFiberIds.get(i)!;
      const needsRespawn = this.shouldRespawnFiber(entry.fiberId);

      if (needsRespawn) {
        const newFiberId = this.scheduler.spawn(entry.funcId, List.empty(), this.executionContext);
        entry.fiberId = newFiberId;
      }
    }

    // Run the scheduler tick
    this.scheduler.tick();

    this.scheduler.gc();
  }

  /**
   * Check if a fiber needs to be respawned (completed, faulted, or cancelled).
   */
  private shouldRespawnFiber(fiberId: number | undefined): boolean {
    if (fiberId === undefined) return true;
    if (!this.scheduler) return false;

    const fiber = this.scheduler.getFiber(fiberId);
    if (!fiber) return true;

    return fiber.state === FiberState.DONE || fiber.state === FiberState.FAULT || fiber.state === FiberState.CANCELLED;
  }

  private runHostActivationHook(callSiteId: number, onPageEntered: (ctx: ExecutionContext) => void): void {
    if (!this.executionContext) {
      return;
    }

    const previousCallSiteId = this.executionContext.currentCallSiteId;
    const previousRuleFuncId = this.executionContext.currentRuleFuncId;

    this.executionContext.currentCallSiteId = callSiteId;
    this.executionContext.currentRuleFuncId = undefined;

    try {
      onPageEntered(this.executionContext);
    } finally {
      this.executionContext.currentCallSiteId = previousCallSiteId;
      this.executionContext.currentRuleFuncId = previousRuleFuncId;
    }
  }

  private runHostInitializerHook(callSiteId: number, onInitialized: (ctx: ExecutionContext) => void): void {
    if (!this.executionContext) {
      return;
    }

    const previousCallSiteId = this.executionContext.currentCallSiteId;
    const previousRuleFuncId = this.executionContext.currentRuleFuncId;

    this.executionContext.currentCallSiteId = callSiteId;
    this.executionContext.currentRuleFuncId = undefined;

    try {
      onInitialized(this.executionContext);
    } finally {
      this.executionContext.currentCallSiteId = previousCallSiteId;
      this.executionContext.currentRuleFuncId = previousRuleFuncId;
    }
  }

  private runBytecodeInitializerHook(action: BytecodeExecutableAction, callSiteId: number): void {
    if (action.initializerFuncId === undefined) return;
    this.runBytecodeHook(action, callSiteId, action.initializerFuncId, "initialization");
  }

  private runBytecodeActivationHook(action: BytecodeExecutableAction, callSiteId: number): void {
    if (action.activationFuncId === undefined) return;
    this.runBytecodeHook(action, callSiteId, action.activationFuncId, "activation");
  }

  private runBytecodeDeactivationHook(action: BytecodeExecutableAction, callSiteId: number): void {
    if (action.deactivationFuncId === undefined) return;
    this.runBytecodeHook(action, callSiteId, action.deactivationFuncId, "deactivation");
  }

  private runHostDeactivationHook(callSiteId: number, onPageExited: (ctx: ExecutionContext) => void): void {
    if (!this.executionContext) {
      return;
    }

    const previousCallSiteId = this.executionContext.currentCallSiteId;
    const previousRuleFuncId = this.executionContext.currentRuleFuncId;

    this.executionContext.currentCallSiteId = callSiteId;
    this.executionContext.currentRuleFuncId = undefined;

    try {
      onPageExited(this.executionContext);
    } finally {
      this.executionContext.currentCallSiteId = previousCallSiteId;
      this.executionContext.currentRuleFuncId = previousRuleFuncId;
    }
  }

  private runBytecodeHook(action: BytecodeExecutableAction, callSiteId: number, funcId: number, label: string): void {
    if (!this.executionContext || !this.vm || !this.scheduler) {
      return;
    }

    const hookContext: ExecutionContext = {
      ...this.executionContext,
      currentCallSiteId: callSiteId,
      currentRuleFuncId: undefined,
    };
    const hookFiber = this.vm.spawnFiber(this.nextInlineFiberId--, funcId, List.empty(), hookContext);
    const hookFrame = hookFiber.frames.get(0)!;
    hookFrame.actionBinding = {
      actionKey: action.descriptor.key,
      callSiteId,
      isAsync: false,
    };
    hookFiber.instrBudget = 10000;

    const result = this.vm.runFiber(hookFiber, this.scheduler);
    if (result.status === VmStatus.FAULT) {
      throw new Error(`Page ${label} for action '${action.descriptor.key}' faulted: ${result.error.message}`);
    }
    if (result.status !== VmStatus.DONE) {
      throw new Error(`Page ${label} for action '${action.descriptor.key}' cannot suspend`);
    }
  }

  private isValidPageIndex(pageIndex: number): boolean {
    return pageIndex >= 0 && pageIndex < this.pages.size();
  }

  private getLinkEnvironment(): BrainLinkEnvironment {
    if (this.linkEnvironment) {
      return this.linkEnvironment;
    }

    return {
      catalogs: List.from([this.services.tiles]),
      actionResolver: this.services.actions,
    };
  }
}
