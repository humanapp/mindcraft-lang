import { List } from "../platform/list";
import {
  type BrainEvents,
  type BrainLinkEnvironment,
  BrainRuntime,
  type IBrain,
  type PageMetadata,
  type UnlinkedBrainProgram,
} from "../runtime";
import { linkBrainProgram } from "../runtime/linker";
import type { Program } from "../runtime/program";
import { treeshakeProgram } from "../runtime/tree-shaker";
import type { Value } from "../runtime/value";
import type { EventEmitterConsumer } from "../util";
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
  /** Runtime page instances */
  pages: List<BrainPage> = new List<BrainPage>();

  /** `BrainRuntime` instance constructed by {@link initialize}. */
  private runtime: BrainRuntime | undefined;

  /**
   * Unlinked program emitted by the brain compiler.
   */
  private compiledProgram: UnlinkedBrainProgram | undefined;

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
    return this.runtime!.events();
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

    this.runtime = new BrainRuntime(
      program,
      pageMetadata,
      { runtime: this.services.runtime, shared: this.services.shared, app: this.services.app },
      contextData,
      previousVariables
    );

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

  getVariableBySlot(slotId: number): Value {
    return this.runtime!.getVariableBySlot(slotId);
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

  setEnabled(enabled: boolean): void {
    this.runtime?.setEnabled(enabled);
  }

  isEnabled(): boolean {
    return this.runtime?.isEnabled() ?? true;
  }

  interrupt(): void {
    this.runtime?.interrupt();
  }

  clearInterrupt(): void {
    this.runtime?.clearInterrupt();
  }

  isInterrupted(): boolean {
    return this.runtime?.isInterrupted() ?? false;
  }

  requestPageChange(pageIndex: number): void {
    this.runtime?.requestPageChange(pageIndex);
  }

  requestPageChangeByPageId(pageId: string): void {
    this.runtime?.requestPageChangeByPageId(pageId);
  }

  requestPageChangeByName(name: string): void {
    this.runtime?.requestPageChangeByName(name);
  }

  requestPageRestart(): void {
    this.runtime?.requestPageRestart();
  }

  getCurrentPageId(): string {
    return this.runtime?.getCurrentPageId() ?? "";
  }

  getPreviousPageId(): string {
    return this.runtime?.getPreviousPageId() ?? "";
  }

  startup(): void {
    this.runtime?.startup();
  }

  shutdown(): void {
    this.runtime?.shutdown();
  }

  think(currentTime: number): void {
    this.runtime?.think(currentTime);
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
