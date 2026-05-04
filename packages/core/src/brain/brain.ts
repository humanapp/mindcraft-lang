import { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import { List } from "../platform/list";
import {
  type BrainEvents,
  type BrainLinkEnvironment,
  BrainRuntime,
  FiberState,
  type IBrain,
  type PageMetadata,
  type UnlinkedBrainProgram,
} from "../runtime";
import { createCallsiteStore } from "../runtime/callsite-store";
import { linkBrainProgram } from "../runtime/linker";
import type { Program } from "../runtime/program";
import { createProgramServices, createRuleVariableServices, type RuleVariableStores } from "../runtime/rule-services";
import { createRuntimeServices } from "../runtime/runtime-services";
import type { PlatformServices } from "../runtime/services";
import { treeshakeProgram } from "../runtime/tree-shaker";
import { NIL_VALUE, type Value } from "../runtime/value";
import { EventEmitter, type EventEmitterConsumer } from "../util";
import { compileBrain } from "./compiler";
import type { IBrainDef, IBrainPageDef } from "./interfaces";
import { BrainPage } from "./page";
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

  /** `BrainRuntime` instance constructed by {@link initialize}. */
  private runtime: BrainRuntime | undefined;

  /**
   * Unlinked program emitted by the brain compiler.
   */
  private compiledProgram: UnlinkedBrainProgram | undefined;

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
    const previousVariables = this.runtime?.snapshotVariables();

    const linkEnvironment = this.getLinkEnvironment();

    this.compiledProgram = compileBrain(this.brainDef, linkEnvironment.catalogs, this.services.shared.conversions);
    let linked = linkBrainProgram(
      this.compiledProgram,
      this.brainDef,
      linkEnvironment.catalogs,
      linkEnvironment.actionResolver
    );
    linked = treeshakeProgram(linked);

    const { program, ruleIndex, pages: pageMetadata } = linked;

    for (let pageIdx = 0; pageIdx < this.pages.size(); pageIdx++) {
      const page = this.pages.get(pageIdx)!;
      page.assignFuncIds(ruleIndex, pageIdx);
    }

    const callsiteStore = createCallsiteStore();
    const ruleVariableStores: RuleVariableStores = new Dict();
    const runtimeServices = createRuntimeServices(this, callsiteStore);
    const platformServices: PlatformServices = {
      runtime: this.services.runtime,
      shared: this.services.shared,
      app: this.services.app,
      brain: {
        program: createProgramServices(program),
        brainVars: runtimeServices.brainVars,
        ruleVars: createRuleVariableServices(program, ruleVariableStores),
        pages: runtimeServices.brainPages,
        callsite: callsiteStore,
      },
    };

    this.runtime = new BrainRuntime(program, pageMetadata, platformServices, contextData, previousVariables);

    this.pageIdToIndex = new Dict();
    this.pageNameToIndex = new Dict();
    for (let i = 0; i < pageMetadata.size(); i++) {
      const meta = pageMetadata.get(i);
      if (meta) {
        this.pageIdToIndex.set(meta.pageId, i);
        this.pageNameToIndex.set(meta.pageName, i);
      }
    }

    this.runtime.events().on("page_activated", ({ pageIndex }) => {
      const page = this.pages.get(pageIndex);
      if (page) {
        page.activate();
      }
    });
    this.runtime.events().on("page_deactivated", ({ pageIndex }) => {
      const page = this.pages.get(pageIndex);
      if (page) {
        page.deactivate();
      }
    });
  }

  /**
   * Check if the brain has been initialized and is ready to execute.
   */
  isInitialized(): boolean {
    return this.runtime !== undefined;
  }

  /**
   * Get the linked executable program (for debugging/inspection).
   */
  getProgram(): Program | undefined {
    return this.runtime?.getProgram();
  }

  getCompiledProgram(): UnlinkedBrainProgram | undefined {
    return this.compiledProgram;
  }

  getPages(): List<PageMetadata> {
    return this.runtime?.getPages() ?? List.empty<PageMetadata>();
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
    return this.runtime?.getVariable<T>(varId);
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
    this.runtime?.setVariable(varId, value);
  }

  /**
   * Clear a variable by its name. Resets the underlying slot to the
   * never-written sentinel; the slot itself is retained so subsequent
   * bytecode operands remain valid (and observe `NIL_VALUE`).
   *
   * @param varId - Variable name
   */
  clearVariable(varId: string): void {
    this.runtime?.clearVariable(varId);
  }

  /**
   * Reset every slot to the never-written sentinel while preserving the
   * program-derived slot layout (slot ids and `varSlotByName` mappings
   * remain stable).
   */
  clearVariables(): void {
    this.runtime?.clearVariables();
  }

  /**
   * Read a variable by its compiler-assigned slot id. Returns `NIL_VALUE`
   * if the slot is out of range or has never been written. Called by the
   * VM dispatch loop on every `LOAD_VAR_SLOT`.
   */
  getVariableBySlot(slotId: number): Value {
    return this.runtime?.getVariableBySlot(slotId) ?? NIL_VALUE;
  }

  /**
   * Write a variable by its compiler-assigned slot id. Called by the VM
   * dispatch loop on every `STORE_VAR_SLOT`. Out-of-range slot ids are
   * a compiler / linker bug; the VM enforces bounds against
   * `program.variableNames.size()` before calling this.
   */
  setVariableBySlot(slotId: number, value: Value): void {
    this.runtime?.setVariableBySlot(slotId, value);
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
    this.requestPageChange(-1);
  }

  requestPageRestart() {
    this.restartPageRequested = true;
    // Cancel active fibers so no more rules evaluate this tick
    this.cancelActiveFibers();
  }

  getCurrentPageId(): string {
    const pageMetadata = this.runtime?.getPages();
    if (!pageMetadata || !this.isValidPageIndex(this.currentPageIndex)) return "";
    const meta = pageMetadata.get(this.currentPageIndex);
    return meta ? meta.pageId : "";
  }

  getPreviousPageId(): string {
    const pageMetadata = this.runtime?.getPages();
    if (!pageMetadata || !this.isValidPageIndex(this.previousPageIndex)) {
      return this.getCurrentPageId();
    }
    const meta = pageMetadata.get(this.previousPageIndex);
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
    this.runtime?._vm().shutdown();

    // Tear down all per-callsite storage so a subsequent startup() re-runs
    // every action's initializerFuncId.
    this.runtime?._callsiteStore().clearAll();

    // Clear per-rule variable storage.
    this.runtime?._ruleVariableStores().clear();

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

  /**
   * Activate a page by spawning fibers for its root rules.
   */
  private activatePage(pageIndex: number): void {
    if (!this.runtime) return;
    const program = this.runtime.getProgram();
    const pageMetadata = this.runtime.getPages();
    const scheduler = this.runtime._scheduler();
    const executionContext = this.runtime._executionContext();
    const callsiteStore = this.runtime._callsiteStore();

    if (!program) return;
    const meta = pageMetadata.get(pageIndex);
    if (!meta) return;

    // Clear any existing tracked fibers
    this.runtime._setActiveRuleFiberIds(List.empty());

    for (let i = 0; i < meta.actionCallSites.size(); i++) {
      const site = meta.actionCallSites.get(i)!;
      const actions = program.actions;
      const action = actions ? actions.get(site.actionSlot) : undefined;
      if (!action) {
        continue;
      }

      if (action.binding === "bytecode" && action.initializerFuncId !== undefined) {
        const newlyAllocated = callsiteStore.ensure(site.callSiteId);
        if (newlyAllocated) {
          this.runtime.runBytecodeInitializerHook(action, site.callSiteId);
        }
      }

      if (action.binding === "host") {
        if (action.onInitialized) {
          const newlyAllocated = callsiteStore.ensure(site.callSiteId);
          if (newlyAllocated) {
            this.runtime.runHostInitializerHook(site.callSiteId, action.onInitialized);
          }
        }
        if (action.onPageEntered) {
          this.runtime.runHostActivationHook(site.callSiteId, action.onPageEntered);
        }
        continue;
      }

      if (action.activationFuncId !== undefined) {
        this.runtime.runBytecodeActivationHook(action, site.callSiteId);
      }
    }

    executionContext.currentCallSiteId = undefined;
    executionContext.currentRuleFuncId = undefined;

    const activeIds = this.runtime._getActiveRuleFiberIds();
    for (let i = 0; i < meta.rootRuleFuncIds.size(); i++) {
      const funcId = meta.rootRuleFuncIds.get(i)!;
      const fiberId = scheduler.spawn(funcId, List.empty(), executionContext);
      activeIds.push({ funcId, fiberId });
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
    if (!this.runtime) return;
    const scheduler = this.runtime._scheduler();
    const activeIds = this.runtime._getActiveRuleFiberIds();
    for (let i = 0; i < activeIds.size(); i++) {
      const entry = activeIds.get(i)!;
      if (entry.fiberId !== undefined) {
        scheduler.cancel(entry.fiberId);
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
    if (this.runtime) {
      this.runtime._setActiveRuleFiberIds(List.empty());
      this.runtime._executionContext().currentCallSiteId = undefined;
      this.runtime._executionContext().currentRuleFuncId = undefined;
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
    if (!this.runtime || !this.isValidPageIndex(this.currentPageIndex)) {
      return;
    }
    const program = this.runtime.getProgram();
    const pageMetadata = this.runtime.getPages();
    if (!program) return;
    const meta = pageMetadata.get(this.currentPageIndex);
    if (!meta) return;

    const actions = program.actions;
    if (!actions) return;

    for (let i = 0; i < meta.actionCallSites.size(); i++) {
      const site = meta.actionCallSites.get(i)!;
      const action = actions.get(site.actionSlot);
      if (!action) continue;

      if (action.binding === "host") {
        if (action.onPageExited) {
          this.runtime.runHostDeactivationHook(site.callSiteId, action.onPageExited);
        }
        continue;
      }

      if (action.deactivationFuncId !== undefined) {
        this.runtime.runBytecodeDeactivationHook(action, site.callSiteId);
      }
    }
  }

  /**
   * Execute one frame of the current page's rules.
   */
  private thinkPage(currentTime: number, dt: number): void {
    if (!this.runtime) return;
    const scheduler = this.runtime._scheduler();
    const executionContext = this.runtime._executionContext();

    executionContext.time = currentTime;
    executionContext.dt = dt;
    executionContext.currentTick += 1;

    const activeIds = this.runtime._getActiveRuleFiberIds();
    for (let i = 0; i < activeIds.size(); i++) {
      const entry = activeIds.get(i)!;
      const needsRespawn = this.shouldRespawnFiber(entry.fiberId);

      if (needsRespawn) {
        const newFiberId = scheduler.spawn(entry.funcId, List.empty(), executionContext);
        entry.fiberId = newFiberId;
      }
    }

    scheduler.tick();
    scheduler.gc();
  }

  /**
   * Check if a fiber needs to be respawned (completed, faulted, or cancelled).
   */
  private shouldRespawnFiber(fiberId: number | undefined): boolean {
    if (fiberId === undefined) return true;
    if (!this.runtime) return false;

    const fiber = this.runtime._scheduler().getFiber(fiberId);
    if (!fiber) return true;

    return fiber.state === FiberState.DONE || fiber.state === FiberState.FAULT || fiber.state === FiberState.CANCELLED;
  }

  private isValidPageIndex(pageIndex: number): boolean {
    return pageIndex >= 0 && pageIndex < this.pages.size();
  }

  private getLinkEnvironment(): BrainLinkEnvironment {
    if (this.linkEnvironment) {
      return this.linkEnvironment;
    }

    return {
      catalogs: List.from([this.services.edit.tiles]),
      actionResolver: this.services.runtime.actions,
    };
  }
}
