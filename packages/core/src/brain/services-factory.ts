import { createDefaultLocalizer, type Localizer } from "../localization/localizer";
import { MathOps } from "../platform/math";
import type {
  AppServices,
  EditLangServices,
  IBrainActionRegistry,
  IConversionRegistry,
  IFunctionRegistry,
  IOperatorOverloads,
  IOperatorTable,
  IRngServices,
  ITypeRegistry,
  RuntimeLangServices,
  SharedLangServices,
} from "../runtime";
import { BrainActionRegistry } from "../runtime/action-registry";
import { ConversionRegistry } from "../runtime/conversions";
import { FunctionRegistry } from "../runtime/functions";
import { OperatorOverloads, OperatorTable } from "../runtime/operators";
import { createF64ProfileNumerics, type ProfileNumerics } from "../runtime/profile-numerics";
import { TypeRegistry } from "../runtime/type-system";
import type { IBrainTileDefBuilder, ITileCatalog } from "./interfaces";
import { BrainServices } from "./services";
import { BrainTileDefBuilder } from "./tiles/builder";
import { TileCatalog } from "./tiles/catalog";

/**
 * Factory module for creating and wiring together brain service registries.
 *
 * This module breaks circular dependencies by:
 * 1. Only importing interface types from ./interfaces
 * 2. Importing concrete implementations only where needed
 * 3. Creating registries that don't depend on the services singleton
 *
 * For testing, you can create registries manually or use mock implementations.
 */

/** Creates an empty {@link ITileCatalog}. */
export function createTileCatalog(): ITileCatalog {
  return new TileCatalog();
}

/** Creates an empty {@link IBrainActionRegistry}. */
export function createActionRegistry(): IBrainActionRegistry {
  return new BrainActionRegistry();
}

/**
 * Creates an empty {@link ITypeRegistry}. Core types are not registered
 * automatically; call `registerCoreTypes()` separately.
 */
export function createTypeRegistry(): ITypeRegistry {
  return new TypeRegistry();
}

/** Creates an empty {@link IFunctionRegistry}. */
export function createFunctionRegistry(): IFunctionRegistry {
  return new FunctionRegistry();
}

/**
 * Creates a new {@link IConversionRegistry} that registers its conversion
 * functions through `functions`.
 */
export function createConversionRegistry(functions: IFunctionRegistry): IConversionRegistry {
  return new ConversionRegistry(functions);
}

/**
 * Creates a new {@link IOperatorTable} / {@link IOperatorOverloads} pair.
 * Both are wired against `functions` so operator implementations resolve
 * through the same function registry as host calls.
 */
export function createOperatorRegistries(functions: IFunctionRegistry): {
  operatorTable: IOperatorTable;
  operatorOverloads: IOperatorOverloads;
} {
  const operatorTable = new OperatorTable();
  const operatorOverloads = new OperatorOverloads(operatorTable, functions);
  return { operatorTable, operatorOverloads };
}

/** Creates an empty {@link IBrainTileDefBuilder}. */
export function createTileBuilder(): IBrainTileDefBuilder {
  return new BrainTileDefBuilder();
}

/** Default {@link IRngServices} implementation backed by {@link MathOps.random}. */
export function createDefaultRng(): IRngServices {
  return {
    next(): number {
      return MathOps.random();
    },
  };
}

/**
 * Creates an {@link AppServices} aggregate of host-supplied capabilities.
 * The RNG defaults to {@link createDefaultRng} when `rng` is omitted, the
 * numerics to {@link createF64ProfileNumerics} when `numerics` is omitted, and
 * the localizer to {@link createDefaultLocalizer} when `localizer` is omitted.
 */
export function createAppServices(rng?: IRngServices, numerics?: ProfileNumerics, localizer?: Localizer): AppServices {
  return {
    rng: rng ?? createDefaultRng(),
    numerics: numerics ?? createF64ProfileNumerics(),
    localizer: localizer ?? createDefaultLocalizer(),
  };
}

/**
 * Creates a fully wired {@link BrainServices} container with empty
 * registries in each tier.
 *
 * Core types, operators, conversions, functions, and tiles are NOT
 * registered by this function. Call `installCoreBrainComponents()` after
 * creating services to register all core components, or manually
 * register components against the appropriate tier
 * (`services.runtime.types`, `services.shared.conversions`, etc.).
 *
 * @param app - Host-supplied capabilities (RNG and future host injections).
 *   The same reference is exposed by `MindcraftEnvironment.appServices`.
 * @returns A new {@link BrainServices} instance.
 */
export function createBrainServices(app: AppServices): BrainServices {
  const types = createTypeRegistry();
  const functions = createFunctionRegistry();
  const actions = createActionRegistry();
  const conversions = createConversionRegistry(functions);
  const { operatorTable, operatorOverloads } = createOperatorRegistries(functions);
  const tiles = createTileCatalog();
  const tileBuilder = createTileBuilder();

  const runtime: RuntimeLangServices = { types, functions, operatorTable, actions };
  const edit: EditLangServices = { tiles, tileBuilder, operatorOverloads };
  const shared: SharedLangServices = { conversions };

  const services = new BrainServices({ runtime, edit, shared, app });

  (tileBuilder as BrainTileDefBuilder).setServices(services);
  (types as TypeRegistry).setServices(services);

  return services;
}
