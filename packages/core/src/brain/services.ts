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
