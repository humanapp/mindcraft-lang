import type {
  IBrainTileDefBuilder,
  IConversionRegistry,
  IFunctionRegistry,
  IOperatorOverloads,
  IOperatorTable,
  ITileCatalog,
  ITypeRegistry,
} from "./interfaces";
import { ConversionRegistry } from "./runtime/conversions";
import { FunctionRegistry } from "./runtime/functions";
import { OperatorOverloads, OperatorTable } from "./runtime/operators";
import { TypeRegistry } from "./runtime/type-system";
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

/**
 * Creates a new TileCatalog instance.
 * Isolated factory function to avoid circular dependencies.
 */
export function createTileCatalog(): ITileCatalog {
  return new TileCatalog();
}

/**
 * Creates a new TypeRegistry instance.
 * Does not register core types - call registerCoreTypes() separately.
 */
export function createTypeRegistry(): ITypeRegistry {
  return new TypeRegistry();
}

/**
 * Creates a new FunctionRegistry instance.
 */
export function createFunctionRegistry(): IFunctionRegistry {
  return new FunctionRegistry();
}

/**
 * Creates a new ConversionRegistry instance.
 * Requires a FunctionRegistry to register conversion functions.
 */
export function createConversionRegistry(functions: IFunctionRegistry): IConversionRegistry {
  return new ConversionRegistry(functions);
}

/**
 * Creates a new OperatorTable and OperatorOverloads pair.
 * Requires a FunctionRegistry to register operator implementations.
 */
export function createOperatorRegistries(functions: IFunctionRegistry): {
  operatorTable: IOperatorTable;
  operatorOverloads: IOperatorOverloads;
} {
  const operatorTable = new OperatorTable();
  const operatorOverloads = new OperatorOverloads(operatorTable, functions);
  return { operatorTable, operatorOverloads };
}

/**
 * Creates a new BrainTileDefBuilder instance.
 */
export function createTileBuilder(): IBrainTileDefBuilder {
  return new BrainTileDefBuilder();
}

/**
 * Creates a complete BrainServices instance with all registries initialized.
 *
 * This function:
 * 1. Creates all registries in the correct dependency order
 * 2. Wires them together
 * 3. Returns an immutable BrainServices container
 *
 * Note: Core types, operators, conversions, functions, and tiles are NOT registered by this function.
 * Call registerCoreBrainComponents() to set up services and register all core components,
 * or manually register components after creating services:
 * - registerCoreTypes(services.types)
 * - registerCoreOperators(services.operatorTable, services.operatorOverloads)
 * - registerCoreConversions(services.conversions)
 * - registerCoreActuatorFunctions(services.functions)
 * - registerCoreTileComponents()
 *
 * @returns A new BrainServices instance with empty registries
 */
export function createBrainServices(): BrainServices {
  const tiles = createTileCatalog();
  const types = createTypeRegistry();
  const functions = createFunctionRegistry();
  const conversions = createConversionRegistry(functions);
  const { operatorTable, operatorOverloads } = createOperatorRegistries(functions);
  const tileBuilder = createTileBuilder();

  return new BrainServices({
    tiles,
    operatorTable,
    operatorOverloads,
    types,
    tileBuilder,
    functions,
    conversions,
  });
}
