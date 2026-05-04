import type { Dict } from "../platform/dict";
import type { List } from "../platform/list";
import type { IBrainRuntime, PageMetadata } from "./host-bindings";
import type { Program } from "./program";
import type { PlatformServices } from "./services";
import type { Value } from "./value";

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
    protected readonly previousVariables: VariableSnapshot | undefined = undefined
  ) {}
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
