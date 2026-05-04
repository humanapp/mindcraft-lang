import type { ITileCatalog } from "../brain/interfaces/catalog";
import type { Dict } from "../platform/dict";
import type { List, ReadonlyList } from "../platform/list";
import type { UniqueSet } from "../platform/uniqueset";
import type { EventEmitterConsumer } from "../util";
import type { HostActionBinding } from "./context";
import type { ActionDescriptor, ActionKey, ActionKind, BrainActionCallDef } from "./function-defs";
import type { Program, ProgramArtifact } from "./program";
import type { TileId } from "./tile-ids";
import type { TypeId } from "./type-defs";
import type { Value } from "./value";

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

/** Brain-side action metadata associated with a compiled bytecode action artifact. */
export interface BrainActionMetadata {
  key: ActionKey;
  kind: ActionKind;
  callDef: BrainActionCallDef;
  outputType?: TypeId;
}

/**
 * Compiled user-authored action: bytecode-relevant {@link ProgramArtifact}
 * fields combined with the brain-side action metadata that names and shapes
 * the action call site.
 */
export interface UserActionArtifact extends ProgramArtifact, BrainActionMetadata {}

/** Action binding implemented by a compiled bytecode artifact. */
export interface BytecodeResolvedAction {
  binding: "bytecode";
  descriptor: ActionDescriptor;
  artifact: ProgramArtifact;
  metadata: BrainActionMetadata;
}

/** Tagged-union of action bindings: host function or compiled bytecode. */
export type ResolvedAction = HostActionBinding | BytecodeResolvedAction;

/**
 * Output of {@link linkBrainProgram}: an executable {@link Program} (with its
 * `actions` slot populated) plus the brain-side rule-to-function mapping and
 * per-page metadata that the brain runtime consumes for page activation and
 * call-site dispatch.
 */
export interface LinkedBrainProgram {
  program: Program;
  ruleIndex: Dict<string, number>;
  pages: List<PageMetadata>;
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

/**
 * Runtime surface of a Mindcraft brain: every observable behavior reachable
 * during a tick (variable storage, page lifecycle FSM, scheduler-driven
 * `think`, event channel) without any authoring-side compile / link / edit
 * concerns. Implemented by `BrainRuntime` in `runtime/brain-runtime.ts`.
 *
 * `IBrainRuntime` exists so that runtime-only targets can satisfy this
 * contract without ever touching `packages/core/src/brain/`. The
 * dependency-cruiser firewall test (`__firewall__.spec.ts`) enforces
 * that no value-import under `runtime/` resolves into `brain/`; any
 * method added here must be implementable on `BrainRuntime` without
 * crossing that boundary.
 */
export interface IBrainRuntime {
  getVariable(varId: string): Value | undefined;
  setVariable(varId: string, value: Value): void;
  clearVariable(varId: string): void;
  clearVariables(): void;
}

export interface IBrain extends IBrainRuntime {
  events(): EventEmitterConsumer<BrainEvents>;

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
  /** Linked executable program currently loaded into the brain's VM. */
  getProgram(): Program | undefined;
  /** Compiler output prior to action linking. */
  getCompiledProgram(): UnlinkedBrainProgram | undefined;
  /** Per-page metadata for the loaded program (page activation, call sites, sensors, actuators). */
  getPages(): List<PageMetadata>;
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
