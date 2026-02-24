import { Error } from "../platform/error";
import type {
  IBrainTileDefBuilder,
  IConversionRegistry,
  IFunctionRegistry,
  IOperatorOverloads,
  IOperatorTable,
  ITileCatalog,
  ITypeRegistry,
} from "./interfaces";

/**
 * Immutable container for all brain subsystem registries.
 *
 * This class replaces the previous mutable global singleton pattern with proper
 * dependency injection that supports:
 * - Type safety (all services are required and non-nullable)
 * - Testability (easy to create isolated test instances with mocks)
 * - Immutability (services cannot be changed after construction)
 * - No circular dependencies (only depends on interface types)
 *
 * The typical initialization flow is:
 * 1. Create services using createBrainServices() from services-factory.ts
 * 2. Set as global with setBrainServices() BEFORE registering components
 * 3. Register runtime components (types, operators, conversions, functions)
 * 4. Register tile definitions (which use getBrainServices() internally)
 *
 * Example usage:
 * ```typescript
 * // Standard initialization (done by registerCoreBrainComponents)
 * const services = createBrainServices();
 * setBrainServices(services);
 * registerCoreTypes(services.types);
 * registerCoreOperators(services.operatorTable, services.operatorOverloads);
 * registerCoreTileComponents(); // Uses getBrainServices() internally
 *
 * // For testing with mocks
 * const mockServices = new BrainServices({
 *   tiles: mockTileCatalog,
 *   operatorTable: mockOperatorTable,
 *   // ... other mocks
 * });
 * setBrainServices(mockServices);
 * ```
 */
export class BrainServices {
  public readonly tiles: ITileCatalog;
  public readonly operatorTable: IOperatorTable;
  public readonly operatorOverloads: IOperatorOverloads;
  public readonly types: ITypeRegistry;
  public readonly tileBuilder: IBrainTileDefBuilder;
  public readonly functions: IFunctionRegistry;
  public readonly conversions: IConversionRegistry;

  constructor(config: {
    tiles: ITileCatalog;
    operatorTable: IOperatorTable;
    operatorOverloads: IOperatorOverloads;
    types: ITypeRegistry;
    tileBuilder: IBrainTileDefBuilder;
    functions: IFunctionRegistry;
    conversions: IConversionRegistry;
  }) {
    this.tiles = config.tiles;
    this.operatorTable = config.operatorTable;
    this.operatorOverloads = config.operatorOverloads;
    this.types = config.types;
    this.tileBuilder = config.tileBuilder;
    this.functions = config.functions;
    this.conversions = config.conversions;
  }
}

/**
 * Global brain services instance.
 *
 * This is set by registerCoreBrainComponents() during initialization, which:
 * 1. Creates services with empty registries
 * 2. Sets them as global (via setBrainServices)
 * 3. Registers all core components
 *
 * Components can access services via getBrainServices() without needing explicit
 * dependency injection. This is particularly useful for tile constructors and
 * registration functions that need access to registries.
 *
 * For testing, you have two options:
 * 1. Use real registries: Call registerCoreBrainComponents() normally, then add/modify
 *    test data in the registries (they're mutable even though the BrainServices properties are readonly)
 * 2. Use fully mocked registries: Call resetBrainServices(), create BrainServices with mocks,
 *    call setBrainServices(), then manually register only the components your test needs
 *    (setting custom services bypasses registerCoreBrainComponents() early-exit check)
 */
let _brainServices: BrainServices | undefined;

/**
 * Get the global brain services instance.
 *
 * This is used throughout the codebase to access registries without requiring
 * explicit dependency injection. Services must be initialized first by calling
 * registerCoreBrainComponents() or setBrainServices().
 *
 * @throws {Error} If services have not been initialized
 * @returns The BrainServices instance
 */
export function getBrainServices(): BrainServices {
  if (!_brainServices) {
    throw new Error("Brain services not initialized. Call registerCoreBrainComponents() or setBrainServices() first.");
  }
  return _brainServices;
}

/**
 * Set the global brain services instance.
 *
 * This should be called once during initialization, immediately after creating
 * services and BEFORE registering any components. This allows tile constructors
 * and registration functions to access services via getBrainServices().
 *
 * Call order in registerCoreBrainComponents():
 * 1. createBrainServices()
 * 2. setBrainServices() <- Called here
 * 3. registerCoreTypes(), registerCoreOperators(), etc.
 * 4. registerCoreTileComponents() <- Can now use getBrainServices()
 *
 * @param services - The services instance to use as the global instance
 */
export function setBrainServices(services: BrainServices): void {
  _brainServices = services;
}

/**
 * Alias for setBrainServices() to support existing code during migration.
 * @deprecated Use setBrainServices() instead
 */
export function setDefaultServices(services: BrainServices): void {
  setBrainServices(services);
}

/**
 * Checks if brain services have been initialized.
 *
 * Useful for preventing double-initialization in registerCoreBrainComponents().
 *
 * @returns true if services are initialized, false otherwise
 */
export function hasBrainServices(): boolean {
  return _brainServices !== undefined;
}

/**
 * Alias for hasBrainServices() to support existing code during migration.
 * @deprecated Use hasBrainServices() instead
 */
export function hasDefaultServices(): boolean {
  return hasBrainServices();
}

/**
 * Resets the brain services instance to undefined.
 *
 * This should only be used in testing to ensure a clean state between tests.
 * Not intended for production use.
 */
export function resetBrainServices(): void {
  _brainServices = undefined;
}

/**
 * Alias for resetBrainServices() to support existing code during migration.
 * @deprecated Use resetBrainServices() instead
 */
export function resetDefaultServices(): void {
  resetBrainServices();
}
