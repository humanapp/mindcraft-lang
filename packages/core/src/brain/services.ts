import type { AppServices, EditLangServices, RuntimeLangServices, SharedLangServices } from "../runtime";

/**
 * Container holding the four service tiers that make up a brain runtime:
 * the runtime-side language registries (`runtime`), the edit-time
 * language registries (`edit`), the shared language registries
 * (`shared`), and the host-supplied capabilities (`app`).
 *
 * The partition encodes which consumer touches which registry. The VM
 * reads from `runtime` and `shared`; the compiler / editor reads from
 * `edit` and `shared`; the host injects `app`. {@link PlatformServices},
 * the per-fiber aggregate the VM consumes, is composed by spreading
 * `runtime`, `shared`, `app`, and the per-brain instance state.
 */
export class BrainServices {
  /** Runtime-side language registries (types, functions, operator table, action registry). */
  public readonly runtime: RuntimeLangServices;

  /** Edit-time language registries (tile catalog, tile builder, operator overloads). */
  public readonly edit: EditLangServices;

  /** Language registries consumed by both the VM and the editor (conversions). */
  public readonly shared: SharedLangServices;

  /**
   * Host-supplied capabilities shared across every brain in the process.
   * The same reference is exposed by {@link MindcraftEnvironment.appServices}.
   */
  public readonly app: AppServices;

  constructor(config: {
    runtime: RuntimeLangServices;
    edit: EditLangServices;
    shared: SharedLangServices;
    app: AppServices;
  }) {
    this.runtime = config.runtime;
    this.edit = config.edit;
    this.shared = config.shared;
    this.app = config.app;
  }
}
