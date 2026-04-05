import type {
  ActionDescriptor,
  BrainActionCallDef,
  Conversion,
  HostFn,
  IBrain,
  IBrainActionTileDef,
  IBrainDef,
  IBrainTileDef,
  OpSpec,
  TypeDef,
  TypeId,
  UserActionArtifact,
} from "./brain/interfaces";
import type { Dict } from "./platform/dict";

export type TileDefinitionInput = IBrainTileDef;
export type MindcraftTypeDefinition = TypeDef;
export type ConversionDefinition = Omit<Conversion, "id">;
export type CompiledActionArtifact = UserActionArtifact;

export interface HostFunctionDefinition {
  readonly name: string;
  readonly isAsync: boolean;
  readonly fn: HostFn;
  readonly callDef: BrainActionCallDef;
}

export interface HostSensorDefinition {
  readonly descriptor: ActionDescriptor;
  readonly function: HostFunctionDefinition;
  readonly tile: IBrainActionTileDef;
}

export interface HostActuatorDefinition {
  readonly descriptor: ActionDescriptor;
  readonly function: HostFunctionDefinition;
  readonly tile: IBrainActionTileDef;
}

export interface OperatorOverloadDefinition {
  readonly argTypes: readonly TypeId[];
  readonly resultType: TypeId;
  readonly fn: HostFn;
  readonly isAsync?: boolean;
}

export interface OperatorDefinition {
  readonly spec: OpSpec;
  readonly overloads?: readonly OperatorOverloadDefinition[];
}

export interface MindcraftCatalog {
  has(tileId: string): boolean;
  get(tileId: string): TileDefinitionInput | undefined;
  getAll(): readonly TileDefinitionInput[];
  registerTile(def: TileDefinitionInput): string;
  delete(tileId: string): boolean;
}

export interface CreateBrainOptions {
  context?: unknown;
  catalogs?: readonly MindcraftCatalog[];
}

export interface MindcraftBrain extends IBrain {
  readonly definition: IBrainDef;
  readonly status: "active" | "invalidated" | "disposed";
  rebuild(): void;
  dispose(): void;
}

export interface MindcraftModule {
  readonly id: string;
  install(api: MindcraftModuleApi): void;
}

export interface MindcraftModuleApi {
  defineType(def: MindcraftTypeDefinition): string;
  registerHostSensor(def: HostSensorDefinition): void;
  registerHostActuator(def: HostActuatorDefinition): void;
  registerFunction(def: HostFunctionDefinition): void;
  registerTile(def: TileDefinitionInput): string;
  registerOperator(def: OperatorDefinition): void;
  registerConversion(def: ConversionDefinition): void;
}

export interface HydratedTileMetadataSnapshot {
  readonly revision: string;
  readonly tiles: readonly TileDefinitionInput[];
}

export interface CompiledActionBundle extends HydratedTileMetadataSnapshot {
  readonly actions: Dict<string, CompiledActionArtifact>;
}

export interface ActionBundleUpdate {
  readonly changedActionKeys: readonly string[];
  readonly invalidatedBrains: readonly MindcraftBrain[];
}

export interface BrainInvalidationEvent extends ActionBundleUpdate {}

export interface MindcraftEnvironment {
  createCatalog(): MindcraftCatalog;
  hydrateTileMetadata(snapshot: HydratedTileMetadataSnapshot): void;
  createBrain(definition: IBrainDef, options?: CreateBrainOptions): MindcraftBrain;
  replaceActionBundle(bundle: CompiledActionBundle): ActionBundleUpdate;
  onBrainsInvalidated(listener: (event: BrainInvalidationEvent) => void): () => void;
  rebuildInvalidatedBrains(brains?: readonly MindcraftBrain[]): void;
}
