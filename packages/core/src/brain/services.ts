import type {
  IBrainActionRegistry,
  IBrainTileDefBuilder,
  IConversionRegistry,
  IFunctionRegistry,
  IOperatorOverloads,
  IOperatorTable,
  ITileCatalog,
  ITypeRegistry,
} from "./interfaces";
export class BrainServices {
  public readonly tiles: ITileCatalog;
  public readonly actions: IBrainActionRegistry;
  public readonly operatorTable: IOperatorTable;
  public readonly operatorOverloads: IOperatorOverloads;
  public readonly types: ITypeRegistry;
  public readonly tileBuilder: IBrainTileDefBuilder;
  public readonly functions: IFunctionRegistry;
  public readonly conversions: IConversionRegistry;

  constructor(config: {
    tiles: ITileCatalog;
    actions: IBrainActionRegistry;
    operatorTable: IOperatorTable;
    operatorOverloads: IOperatorOverloads;
    types: ITypeRegistry;
    tileBuilder: IBrainTileDefBuilder;
    functions: IFunctionRegistry;
    conversions: IConversionRegistry;
  }) {
    this.tiles = config.tiles;
    this.actions = config.actions;
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
 * Set by registerCoreBrainComponents() during initialization, which:
 * 1. Creates services with empty registries
 * 2. Sets them as global (via setBrainServices)
 * 3. Registers all core components
 */
let _brainServices: BrainServices | undefined;

export function getDefaultBrainServices(): BrainServices | undefined {
  return _brainServices;
}

export function runWithBrainServices<T>(_services: BrainServices, callback: () => T): T {
  return callback();
}

export function setBrainServices(services: BrainServices): void {
  _brainServices = services;
}

export function hasBrainServices(): boolean {
  return _brainServices !== undefined;
}

export function resetBrainServices(): void {
  _brainServices = undefined;
}
