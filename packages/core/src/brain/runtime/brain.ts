import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import { MathOps } from "../../platform/math";
import { EventEmitter, type EventEmitterConsumer } from "../../util";
import { compileBrain } from "../compiler";
import {
  type ActionInstance,
  type BrainEvents,
  type BrainLinkEnvironment,
  type BytecodeExecutableAction,
  type ExecutableBrainProgram,
  type ExecutionContext,
  FiberState,
  HandleTable,
  type IBrain,
  type IBrainDef,
  type IBrainPageDef,
  type IBrainRule,
  NIL_VALUE,
  resetActionInstance,
  type UnlinkedBrainProgram,
  type Value,
  VmStatus,
} from "../interfaces";
import type { BrainServices } from "../services";
import { linkBrainProgram } from "./linker";
import { BrainPage } from "./page";
import type { BrainRule } from "./rule";
import { treeshakeProgram } from "./tree-shaker";
import { FiberScheduler, VM } from "./vm";

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
  private program: ExecutableBrainProgram | undefined;

  /**
   * Single VM instance for executing all rules.
   */
  private vm: VM | undefined;

  /**
   * Single scheduler for managing all fibers.
   */
  private scheduler: FiberScheduler | undefined;

  /**
   * Handle table for async operations.
   */
  private handles: HandleTable;

  /**
   * Persistent execution context for the brain.
   * Shared across all fibers, provides variable access.
   */
  private executionContext: ExecutionContext | undefined;

  /**
   * Fiber IDs for the currently active page's root rules.
   * Tracked for respawning when they complete.
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
    this.handles = new HandleTable(100000);

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
    this.program = linkBrainProgram(
      this.compiledProgram,
      this.brainDef,
      linkEnvironment.catalogs,
      linkEnvironment.actionResolver
    );

    // Tree-shake unreachable functions, constants, and variable names.
    this.program = treeshakeProgram(this.program);

    // Wire the brain-level variable storage to the loaded program's variableNames pool.
    this.installVariableTable(this.program.variableNames);

    // Create VM with the linked executable program.
    this.vm = new VM(this.services, this.program, this.handles);

    // Create scheduler
    this.scheduler = new FiberScheduler(this.vm, {
      maxFibersPerTick: 64,
      defaultBudget: 1000,
      autoGcHandles: true,
    });

    // Assign function IDs to runtime rule objects and build funcId->rule mapping
    const funcIdToRule = new Dict<number, IBrainRule>();
    for (let pageIdx = 0; pageIdx < this.pages.size(); pageIdx++) {
      const page = this.pages.get(pageIdx)!;
      page.assignFuncIds(this.program.ruleIndex, pageIdx);
      this.collectFuncIdToRuleMapping(page.children(), funcIdToRule);
    }

    // Build page lookup indices for O(1) resolution in requestPageChangeByPageId / requestPageChangeByName
    this.pageIdToIndex = new Dict();
    this.pageNameToIndex = new Dict();
    for (let i = 0; i < this.program.pages.size(); i++) {
      const meta = this.program.pages.get(i);
      if (meta) {
        this.pageIdToIndex.set(meta.pageId, i);
        this.pageNameToIndex.set(meta.pageName, i);
      }
    }

    // Create shared execution context
    // The getVariable/setVariable/clearVariable closures capture `brain` by reference
    // instead of using method references (this.getVariable) because Roblox-TS
    // doesn't support `this` binding with unbound method references.
    const brain = this;
    this.executionContext = {
      brain: this,
      getVariable<T extends Value>(varId: string): T | undefined {
        return brain.getVariable<T>(varId);
      },
      setVariable(varId: string, value: Value): void {
        brain.setVariable(varId, value);
      },
      clearVariable(varId: string): void {
        brain.clearVariable(varId);
      },
      getVariableBySlot(slotId: number): Value {
        return brain.getVariableBySlot(slotId);
      },
      setVariableBySlot(slotId: number, value: Value): void {
        brain.setVariableBySlot(slotId, value);
      },
      time: 0,
      dt: 0,
      currentTick: 0,
      funcIdToRule,
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
  getProgram(): ExecutableBrainProgram | undefined {
    return this.program;
  }

  getCompiledProgram(): UnlinkedBrainProgram | undefined {
    return this.compiledProgram;
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
    if (!this.program || !this.isValidPageIndex(this.currentPageIndex)) return "";
    const meta = this.program.pages.get(this.currentPageIndex);
    return meta ? meta.pageId : "";
  }

  getPreviousPageId(): string {
    if (!this.program || !this.isValidPageIndex(this.previousPageIndex)) {
      return this.getCurrentPageId();
    }
    const meta = this.program.pages.get(this.previousPageIndex);
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
    // Cancel all active fibers
    this.deactivateCurrentPage();

    // Clear handles
    this.handles.clear();

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
    if (!this.program || !this.scheduler || !this.executionContext || !this.vm) return;

    const pageMetadata = this.program.pages.get(pageIndex);
    if (!pageMetadata) return;

    // Clear any existing tracked fibers
    this.activeRuleFiberIds = List.empty();

    // Reset and activate each action callsite once for this page activation.
    for (let i = 0; i < pageMetadata.actionCallSites.size(); i++) {
      const site = pageMetadata.actionCallSites.get(i)!;
      const action = this.program.actions.get(site.actionSlot);
      if (!action) {
        continue;
      }

      const actionInstance = resetActionInstance(
        this.executionContext,
        site.callSiteId,
        action.binding === "bytecode" ? action.numStateSlots : 0
      );

      if (action.binding === "host") {
        if (action.onPageEntered) {
          this.runHostActivationHook(site.callSiteId, actionInstance, action.onPageEntered);
        }
        continue;
      }

      if (action.activationFuncId !== undefined) {
        this.runBytecodeActivationHook(action, site.callSiteId, actionInstance);
      }
    }

    this.executionContext.currentCallSiteId = undefined;
    this.executionContext.currentActionInstance = undefined;
    this.executionContext.rule = undefined;

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
   * Deactivate the current page by cancelling its fibers.
   */
  private deactivateCurrentPage(): void {
    this.cancelActiveFibers();
    this.activeRuleFiberIds = List.empty();

    if (this.executionContext) {
      this.executionContext.currentActionInstance = undefined;
      this.executionContext.currentCallSiteId = undefined;
      this.executionContext.rule = undefined;
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

  private runHostActivationHook(
    callSiteId: number,
    actionInstance: ActionInstance,
    onPageEntered: (ctx: ExecutionContext) => void
  ): void {
    if (!this.executionContext) {
      return;
    }

    const previousCallSiteId = this.executionContext.currentCallSiteId;
    const previousActionInstance = this.executionContext.currentActionInstance;
    const previousRule = this.executionContext.rule;

    this.executionContext.currentCallSiteId = callSiteId;
    this.executionContext.currentActionInstance = actionInstance;
    this.executionContext.rule = undefined;

    try {
      onPageEntered(this.executionContext);
    } finally {
      this.executionContext.currentCallSiteId = previousCallSiteId;
      this.executionContext.currentActionInstance = previousActionInstance;
      this.executionContext.rule = previousRule;
    }
  }

  private runBytecodeActivationHook(
    action: BytecodeExecutableAction,
    callSiteId: number,
    actionInstance: ActionInstance
  ): void {
    if (!this.executionContext || !this.vm || !this.scheduler || action.activationFuncId === undefined) {
      return;
    }

    const activationContext: ExecutionContext = {
      ...this.executionContext,
      currentCallSiteId: callSiteId,
      currentActionInstance: actionInstance,
      rule: undefined,
    };
    const activationFiber = this.vm.spawnFiber(
      this.nextInlineFiberId--,
      action.activationFuncId,
      List.empty(),
      activationContext
    );
    const activationFrame = activationFiber.frames.get(0)!;
    activationFrame.actionBinding = {
      actionKey: action.descriptor.key,
      callSiteId,
      isAsync: false,
      actionInstance,
    };
    activationFiber.instrBudget = 10000;

    const result = this.vm.runFiber(activationFiber, this.scheduler);
    if (result.status === VmStatus.FAULT) {
      throw new Error(`Page activation for action '${action.descriptor.key}' faulted: ${result.error.message}`);
    }
    if (result.status !== VmStatus.DONE) {
      throw new Error(`Page activation for action '${action.descriptor.key}' cannot suspend`);
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

  /**
   * Recursively collect funcId -> BrainRule mappings from rules and their children.
   */
  private collectFuncIdToRuleMapping(rules: List<BrainRule>, mapping: Dict<number, IBrainRule>): void {
    for (let i = 0; i < rules.size(); i++) {
      const rule = rules.get(i)!;
      const funcId = rule.getFuncId();
      if (funcId !== undefined) {
        mapping.set(funcId, rule);
      }
      this.collectFuncIdToRuleMapping(rule.children(), mapping);
    }
  }
}
