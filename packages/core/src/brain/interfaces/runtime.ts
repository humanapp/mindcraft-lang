import type { Dict } from "../../platform/dict";
import type { List, ReadonlyList } from "../../platform/list";
import type { UniqueSet } from "../../platform/uniqueset";
import type { ExecutableAction, ResolvedAction } from "../../runtime/context";
import type { Program } from "../../runtime/program";
import type { Value } from "../../runtime/value";
import type { EventEmitterConsumer } from "../../util";
import type { ITileCatalog } from "./catalog";
import type { ActionDescriptor, ActionKey } from "./functions";
import type { TileId } from "./tiles";

/** Reference to a registered action, by program-local slot and stable key. */
export interface ActionRef {
  slot: number;
  key: ActionKey;
}

/** Identifies one ACTION_CALL site within a brain program. */
export interface ActionCallSiteEntry {
  actionSlot: number;
  callSiteId: number;
}

/**
 * Extended Program interface for compiled brains. Adds rule-to-function mapping
 * and page metadata.
 */
export interface UnlinkedBrainProgram extends Program {
  /**
   * Mapping from rule path to function ID.
   *
   * Key format: "pageIndex/ruleIndex" or "pageIndex/ruleIndex/childIndex/..."
   * Example: "0/0" = Page 0, Rule 0; "0/0/1" = Page 0, Rule 0, Child 1
   */
  ruleIndex: Dict<string, number>;

  /**
   * Program-local action slots referenced by ACTION_CALL instructions.
   */
  actionRefs: List<ActionRef>;

  /**
   * Page metadata for page-switching logic. Each page entry contains the
   * function IDs of its root rules.
   */
  pages: List<PageMetadata>;
}

/** Compiled brain program prior to action linking. Alias for {@link UnlinkedBrainProgram}. */
export type BrainProgram = UnlinkedBrainProgram;

/** Linked brain program ready for VM execution: program-local action slots resolved to executable bindings. */
export interface ExecutableBrainProgram extends Program {
  ruleIndex: Dict<string, number>;
  pages: List<PageMetadata>;
  actions: List<ExecutableAction>;
}

/** Resolves action descriptors to concrete bindings during brain linking. */
export interface BrainActionResolver {
  resolveAction(descriptor: ActionDescriptor): ResolvedAction | undefined;
}

/** Mutable registry of resolved actions keyed by `ActionKey`. */
export interface IBrainActionRegistry extends BrainActionResolver {
  register(action: ResolvedAction): ResolvedAction;
  getByKey(key: ActionKey): ResolvedAction | undefined;
  size(): number;
}

/** Linker inputs: tile catalogs and the action resolver to bind compiled programs against. */
export interface BrainLinkEnvironment {
  catalogs: ReadonlyList<ITileCatalog>;
  actionResolver: BrainActionResolver;
}

/** Per-page metadata embedded in a {@link UnlinkedBrainProgram}. */
export interface PageMetadata {
  /** Page index in the brain */
  pageIndex: number;

  /** Stable page identifier (UUID), persists across renames */
  pageId: string;

  /** Page name for debugging */
  pageName: string;

  /** Function IDs of root-level rules in this page (in order) */
  rootRuleFuncIds: List<number>;

  /** All ACTION_CALL / ACTION_CALL_ASYNC call sites in this page's rule tree */
  actionCallSites: List<ActionCallSiteEntry>;

  /** Unique sensor tile IDs referenced by rules in this page */
  sensors: UniqueSet<TileId>;

  /** Unique actuator tile IDs referenced by rules in this page */
  actuators: UniqueSet<TileId>;
}

/** Events emitted by an {@link IBrain}. */
export type BrainEvents = {
  page_activated: { pageIndex: number };
  page_deactivated: { pageIndex: number };
  //  variable_changed: { varId: string; oldValue: Value | undefined; newValue: Value };
};

export interface IBrain {
  events(): EventEmitterConsumer<BrainEvents>;
  getVariable(varId: string): Value | undefined;
  setVariable(varId: string, value: Value): void;
  clearVariable(varId: string): void;
  clearVariables(): void;

  /**
   * Initialize the brain and set context data. Must be called before startup().
   *
   * @param contextData - Application-specific data to attach to the brain's execution context
     (e.g., game entity, DOM context). This will be available to all host functions via ctx.data.
   */
  initialize(contextData?: unknown): void;
  startup(): void;
  shutdown(): void;
  think(currentTime: number): void;
  getProgram(): ExecutableBrainProgram | undefined;
  getCompiledProgram(): UnlinkedBrainProgram | undefined;
  rng(): number; // Returns a random number between 0 and 1.
  requestPageChange(pageIndex: number): void;
  requestPageChangeByPageId(pageId: string): void;
  requestPageChangeByName(name: string): void;
  requestPageRestart(): void;
  getCurrentPageId(): string;
  getPreviousPageId(): string;
}

export interface IBrainPage {
  brain(): IBrain;
}

export interface IBrainRule {
  page(): IBrainPage;
  ancestor(): IBrainRule | undefined;
  getVariable<T extends Value>(varName: string): T | undefined;
  setVariable(varName: string, value: Value): void;
  clearVariable(varName: string): void;
  clearVariables(): void;
  children(): List<IBrainRule>;
}
