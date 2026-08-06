import type {
  ExecutionContext,
  MindcraftEnvironment,
  MindcraftModule,
  MindcraftModuleApi,
  ReadonlyList,
  Value,
} from "@mindcraft-lang/core/app";
import { coreModule, createMindcraftEnvironment, NativeType } from "@mindcraft-lang/core/app";
import type { ITileCatalog } from "@mindcraft-lang/core/brain";
import type { BrainActionArgSlot } from "@mindcraft-lang/core/runtime";
import { tileLabel } from "../tools/tile-label.js";
import { renderValue } from "./value-text.js";

/**
 * A seeded pseudo-random generator producing values in `[0, 1)`. The same seed
 * always yields the same sequence, so every choice a rehearsal draws from it is
 * reproducible.
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** One host-action call, reported before the action runs. */
export interface DispatchEvent {
  /** Context the call is executing in; a world driver recognizes its own participants by it. */
  readonly ctx: ExecutionContext;
  /** Stable action key, for example `actuator.move`. */
  readonly action: string;
  /**
   * Render the arguments this call carried, as `name=value` for every argument
   * slot the call filled, in slot order. Call it during the notification: the
   * argument container is reused once the notification returns.
   */
  renderArgs(): string[];
}

/** How a rehearsal environment is built. */
export interface RehearsalEnvironmentOptions {
  /** Modules to install beyond core's own. */
  readonly modules: readonly MindcraftModule[];
  /** The run's seeded random stream, shared with every brain in the environment. */
  readonly rng: () => number;
  /** Called before every synchronous host-action call any brain in the environment makes. */
  readonly onDispatch: (event: DispatchEvent) => void;
}

/** The host sensor / actuator definition shape the module API accepts. */
type HostDefinition = Parameters<MindcraftModuleApi["registerHostSensor"]>[0];

/** Look up the name a tile reads by, over catalogs that exist only once the environment is built. */
function createTileNamer(catalogsOf: () => readonly ITileCatalog[]): (tileId: string) => string {
  let names: Map<string, string> | undefined;
  return (tileId: string): string => {
    if (!names) {
      names = new Map<string, string>();
      for (const catalog of catalogsOf()) {
        catalog.getAll().forEach((tile) => {
          if (!names?.has(tile.tileId)) names?.set(tile.tileId, tileLabel(tile));
        });
      }
    }
    return names.get(tileId) ?? tileId;
  };
}

/** True when `value` stands for an argument slot the call left empty. */
function isUnfilled(value: Value): boolean {
  return value.t === NativeType.Nil || value.t === NativeType.Void;
}

/** Render the filled argument slots of one call as `name=value`, in slot order. */
function renderArgs(
  slots: ReadonlyList<BrainActionArgSlot>,
  args: ReadonlyList<Value>,
  nameOf: (tileId: string) => string
): string[] {
  const rendered: string[] = [];
  for (let i = 0; i < slots.size(); i++) {
    const value = args.get(i);
    if (value === undefined || isUnfilled(value)) continue;
    rendered.push(`${nameOf(slots.get(i).argSpec.tileId)}=${renderValue(value)}`);
  }
  return rendered;
}

/**
 * Wrap a synchronous host action's `exec` so every call reaches `onDispatch`
 * before it runs. Asynchronous actions pass through unchanged.
 */
function traced(
  def: HostDefinition,
  onDispatch: (event: DispatchEvent) => void,
  nameOf: (tileId: string) => string
): HostDefinition {
  if (def.descriptor.isAsync) return def;
  const actionFn = def.actionFn as { exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => Value };
  const action = def.descriptor.key;
  const slots = def.descriptor.callDef.argSlots;
  const exec = actionFn.exec;
  return {
    ...def,
    actionFn: {
      ...actionFn,
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>): Value => {
        onDispatch({ ctx, action, renderArgs: () => renderArgs(slots, args, nameOf) });
        return exec(ctx, args);
      },
    },
  };
}

/** A module API that reports every host-action call made through the definitions it registers. */
function tracingApi(
  api: MindcraftModuleApi,
  onDispatch: (event: DispatchEvent) => void,
  nameOf: (tileId: string) => string
): MindcraftModuleApi {
  return {
    brainServices: api.brainServices,
    defineType: (def) => api.defineType(def),
    registerHostSensor: (def) => api.registerHostSensor(traced(def, onDispatch, nameOf)),
    registerHostActuator: (def) => api.registerHostActuator(traced(def, onDispatch, nameOf)),
    registerFunction: (def) => api.registerFunction(def),
    registerTile: (def) => api.registerTile(def),
    registerModifiers: (defs) => api.registerModifiers(defs),
    registerParameters: (defs) => api.registerParameters(defs),
    registerOperator: (def) => api.registerOperator(def),
    registerConversion: (def) => api.registerConversion(def),
  };
}

/** The module with every host action it installs wrapped for call observation. */
function tracingModule(
  inner: MindcraftModule,
  onDispatch: (event: DispatchEvent) => void,
  nameOf: (tileId: string) => string
): MindcraftModule {
  return {
    id: inner.id,
    migrateBrainJson: inner.migrateBrainJson,
    install: (api: MindcraftModuleApi) => inner.install(tracingApi(api, onDispatch, nameOf)),
  };
}

/**
 * Build the environment one rehearsal runs in: core's modules plus the
 * target's, drawing randomness from `options.rng`, with every synchronous host
 * action wrapped so its calls reach `options.onDispatch`.
 */
export function createRehearsalEnvironment(options: RehearsalEnvironmentOptions): MindcraftEnvironment {
  let built: MindcraftEnvironment | undefined;
  const nameOf = createTileNamer(() => built?.tileCatalogs() ?? []);
  const modules = [coreModule(), ...options.modules].map((module) => tracingModule(module, options.onDispatch, nameOf));
  built = createMindcraftEnvironment({ modules, rng: { next: options.rng } });
  return built;
}
