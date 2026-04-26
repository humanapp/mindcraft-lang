import { installCoreBrainComponents } from "./brain";
import type {
  ActionDescriptor,
  BrainActionCallDef,
  BrainActionResolver,
  BrainTileDefCreateOptions,
  Conversion,
  EnumTypeDef,
  EnumTypeShape,
  FunctionTypeDef,
  FunctionTypeShape,
  HostActionBinding,
  HostAsyncFn,
  HostFn,
  HostSyncFn,
  IBrain,
  IBrainActionTileDef,
  IBrainDef,
  IBrainTileDef,
  ITileCatalog,
  ITileMetadata,
  ListTypeDef,
  ListTypeShape,
  MapTypeDef,
  MapTypeShape,
  NullableTypeDef,
  NullableTypeShape,
  OpSpec,
  ResolvedAction,
  StructTypeDef,
  StructTypeShape,
  TypeDef,
  TypeId,
  UnionTypeDef,
  UnionTypeShape,
  UserActionArtifact,
} from "./brain/interfaces";
import { CoreOpId, NativeType, NIL_VALUE } from "./brain/interfaces";
import type { BrainJson } from "./brain/model";
import { BrainDef, brainJsonFromPlain } from "./brain/model";
import { Brain } from "./brain/runtime";
import type { BrainServices } from "./brain/services";
import { createBrainServices } from "./brain/services-factory";
import { registerAccessorTileDef } from "./brain/tiles/accessors";
import { BrainTileActuatorDef } from "./brain/tiles/actuators";
import { TileCatalog } from "./brain/tiles/catalog";
import { BrainTileModifierDef } from "./brain/tiles/modifiers";
import { BrainTileParameterDef } from "./brain/tiles/parameters";
import { BrainTileSensorDef } from "./brain/tiles/sensors";
import { registerVariableFactoryTileDef } from "./brain/tiles/variables";
import { Dict } from "./platform/dict";
import { Error } from "./platform/error";
import { List } from "./platform/list";
import { TypeUtils } from "./platform/types";

/** Tile definition value. Alias for {@link IBrainTileDef}. */
export type TileDefinitionInput = IBrainTileDef;

/** Definition of a value-conversion overload. Same as {@link Conversion} but without the auto-assigned `id`. */
export type ConversionDefinition = Omit<Conversion, "id">;

type TypeDefInput = Omit<TypeDef, "codec">;

interface StructDefineOptions {
  accessors?: boolean | string[];
  variableFactory?: boolean;
}

/**
 * Type definition accepted by {@link MindcraftModuleApi.defineType}. The shape
 * fields determine the type's category (struct, enum, list, etc.).
 */
export type MindcraftTypeDefinition =
  | TypeDefInput
  | (TypeDefInput & StructTypeShape & StructDefineOptions)
  | (TypeDefInput & EnumTypeShape)
  | (TypeDefInput & ListTypeShape)
  | (TypeDefInput & MapTypeShape)
  | (TypeDefInput & NullableTypeShape)
  | (TypeDefInput & UnionTypeShape)
  | (TypeDefInput & Partial<FunctionTypeShape>);
/** Compiled user-tile artifact. Alias for {@link UserActionArtifact}. */
export type CompiledActionArtifact = UserActionArtifact;

/** A host-implemented function registered with a brain's function registry. */
export interface HostFunctionDefinition {
  readonly name: string;
  readonly isAsync: boolean;
  readonly fn: HostFn;
  readonly callDef: BrainActionCallDef;
}

/** A host-implemented sensor: descriptor + function + sensor tile. Build with {@link createHostSensor}. */
export interface HostSensorDefinition {
  readonly descriptor: ActionDescriptor;
  readonly function: HostFunctionDefinition;
  readonly tile: IBrainActionTileDef;
}

/** A host-implemented actuator: descriptor + function + actuator tile. Build with {@link createHostActuator}. */
export interface HostActuatorDefinition {
  readonly descriptor: ActionDescriptor;
  readonly function: HostFunctionDefinition;
  readonly tile: IBrainActionTileDef;
}

type HostActionOptionsBase = {
  readonly key: string;
  readonly callDef: BrainActionCallDef;
  readonly metadata?: ITileMetadata;
  readonly capabilities?: BrainTileDefCreateOptions["capabilities"];
};

type SyncHostActionOptions = HostActionOptionsBase & {
  readonly fn: HostSyncFn;
  readonly isAsync?: false;
};

type AsyncHostActionOptions = HostActionOptionsBase & {
  readonly fn: HostAsyncFn;
  readonly isAsync: true;
};

/** Options for {@link createHostSensor}. Sensors return a value of `outputType`. */
export type CreateHostSensorOptions = (SyncHostActionOptions | AsyncHostActionOptions) & {
  readonly outputType: TypeId;
};

/** Options for {@link createHostActuator}. Actuators do not return a value. */
export type CreateHostActuatorOptions = SyncHostActionOptions | AsyncHostActionOptions;

/** Build a {@link HostSensorDefinition} from `options`. */
export function createHostSensor(options: CreateHostSensorOptions): HostSensorDefinition {
  const isAsync = options.isAsync ?? false;
  const descriptor: ActionDescriptor = {
    key: options.key,
    kind: "sensor",
    callDef: options.callDef,
    isAsync,
    outputType: options.outputType,
  };
  return {
    descriptor,
    function: { name: options.key, isAsync, fn: options.fn, callDef: options.callDef },
    tile: new BrainTileSensorDef(options.key, descriptor, {
      metadata: options.metadata,
      capabilities: options.capabilities,
    }),
  };
}

/** Build a {@link HostActuatorDefinition} from `options`. */
export function createHostActuator(options: CreateHostActuatorOptions): HostActuatorDefinition {
  const isAsync = options.isAsync ?? false;
  const descriptor: ActionDescriptor = {
    key: options.key,
    kind: "actuator",
    callDef: options.callDef,
    isAsync,
  };
  return {
    descriptor,
    function: { name: options.key, isAsync, fn: options.fn, callDef: options.callDef },
    tile: new BrainTileActuatorDef(options.key, descriptor, {
      metadata: options.metadata,
      capabilities: options.capabilities,
    }),
  };
}

/** A single overload of an operator: argument types, result type, and the implementing host function. */
export interface OperatorOverloadDefinition {
  readonly argTypes: readonly TypeId[];
  readonly resultType: TypeId;
  readonly fn: HostFn;
  readonly isAsync?: boolean;
}

/** A registerable operator: its `OpSpec` plus zero or more overloads. */
export interface OperatorDefinition {
  readonly spec: OpSpec;
  readonly overloads?: readonly OperatorOverloadDefinition[];
}

/** A catalog of tile definitions. Brains are matched against catalogs to enumerate available tiles. */
export interface MindcraftCatalog {
  has(tileId: string): boolean;
  get(tileId: string): TileDefinitionInput | undefined;
  getAll(): readonly TileDefinitionInput[];
  registerTile(def: TileDefinitionInput): string;
  delete(tileId: string): boolean;
}

/** Options for {@link MindcraftEnvironment.createBrain}. */
export interface CreateBrainOptions {
  /** Opaque value forwarded to the brain's runtime context. */
  context?: unknown;
  /** Catalogs the brain should consult when resolving tiles. */
  catalogs?: readonly MindcraftCatalog[];
}

/** A brain instance produced by {@link MindcraftEnvironment.createBrain}. */
export interface MindcraftBrain extends IBrain {
  readonly definition: IBrainDef;
  readonly status: "active" | "invalidated" | "disposed";
  /** Recompile and rebuild this brain against the current environment. */
  rebuild(): void;
  /** Dispose this brain, releasing its runtime state. */
  dispose(): void;
}

/** Function that mutates an in-memory `BrainJson` to upgrade it from an older module schema. */
export type BrainJsonMigration = (json: unknown) => void;

/** A unit of installable functionality (types, host functions, tiles, operators) for a {@link MindcraftEnvironment}. */
export interface MindcraftModule {
  readonly id: string;
  install(api: MindcraftModuleApi): void;
  migrateBrainJson?: BrainJsonMigration;
}

/** API exposed to {@link MindcraftModule.install} for registering types, tiles, functions, operators, and conversions. */
export interface MindcraftModuleApi {
  readonly brainServices: BrainServices;
  defineType(def: MindcraftTypeDefinition): string;
  registerHostSensor(def: HostSensorDefinition): void;
  registerHostActuator(def: HostActuatorDefinition): void;
  registerFunction(def: HostFunctionDefinition): void;
  registerTile(def: TileDefinitionInput): string;
  registerModifiers(defs: readonly ModifierTileInput[]): void;
  registerParameters(defs: readonly ParameterTileInput[]): void;
  registerOperator(def: OperatorDefinition): void;
  registerConversion(def: ConversionDefinition): void;
}

/** Definition of a modifier tile. */
export interface ModifierTileInput {
  readonly id: string;
  readonly label: string;
  readonly iconUrl?: string;
}

/** Definition of a parameter tile. */
export interface ParameterTileInput {
  readonly id: string;
  readonly dataType: TypeId;
  readonly label?: string;
  readonly iconUrl?: string;
  /** When true, the tile is excluded from default catalog listings. */
  readonly hidden?: boolean;
}

/** Snapshot of tile metadata applied via {@link MindcraftEnvironment.hydrateTileMetadata}. */
export interface HydratedTileMetadataSnapshot {
  readonly revision: string;
  readonly tiles: readonly TileDefinitionInput[];
}

/**
 * A bundle of compiled user actions and the tiles they back. Apply with
 * {@link MindcraftEnvironment.replaceActionBundle}.
 */
export interface CompiledActionBundle {
  readonly revision: string;
  readonly tiles: readonly TileDefinitionInput[];
  readonly actions: Dict<string, CompiledActionArtifact>;
}

/** Result of {@link MindcraftEnvironment.replaceActionBundle}: which actions changed and which brains were invalidated. */
export interface ActionBundleUpdate {
  readonly changedActionKeys: readonly string[];
  readonly invalidatedBrains: readonly MindcraftBrain[];
}

/** Event payload for {@link MindcraftEnvironment.onBrainsInvalidated}. */
export interface BrainInvalidationEvent extends ActionBundleUpdate {}

/**
 * Top-level Mindcraft environment: hosts brain services, manages catalogs and
 * action bundles, and creates {@link MindcraftBrain} instances. Build with
 * {@link createMindcraftEnvironment}.
 */
export interface MindcraftEnvironment {
  readonly brainServices: BrainServices;
  withServices<T>(callback: (services: BrainServices) => T): T;
  createCatalog(): MindcraftCatalog;
  deserializeBrainJson(json: BrainJson): IBrainDef;
  deserializeBrainJsonFromPlain(plain: unknown): IBrainDef;
  hydrateTileMetadata(snapshot: HydratedTileMetadataSnapshot): void;
  createBrain(definition: IBrainDef, options?: CreateBrainOptions): MindcraftBrain;
  replaceActionBundle(bundle: CompiledActionBundle): ActionBundleUpdate;
  onBrainsInvalidated(listener: (event: BrainInvalidationEvent) => void): () => void;
  rebuildInvalidatedBrains(brains?: readonly MindcraftBrain[]): void;
  tileCatalogs(): readonly ITileCatalog[];
}

type CreateMindcraftEnvironmentOptions = {
  readonly modules?: readonly MindcraftModule[];
};

function buildHostActionBinding(descriptor: ActionDescriptor, definition: HostFunctionDefinition): HostActionBinding {
  if (descriptor.key !== definition.name) {
    throw new Error(`Action descriptor key '${descriptor.key}' must match function name '${definition.name}'`);
  }
  if (descriptor.isAsync !== definition.isAsync) {
    throw new Error(`Action descriptor async flag mismatch for '${descriptor.key}'`);
  }

  const binding: HostActionBinding = {
    binding: "host",
    descriptor,
    onPageEntered: definition.fn.onPageEntered,
  };

  if (definition.isAsync) {
    binding.execAsync = (definition.fn as HostAsyncFn).exec;
  } else {
    binding.execSync = (definition.fn as HostSyncFn).exec;
  }

  return binding;
}

function ensureFunctionRegistered(services: BrainServices, definition: HostFunctionDefinition): void {
  if (services.functions.get(definition.name)) {
    return;
  }

  services.functions.register(definition.name, definition.isAsync, definition.fn, definition.callDef);
}

function assertRegisteredTypeId(actual: string, expected: string, name: string): string {
  if (actual !== expected) {
    throw new Error(`Type '${name}' registered as '${actual}' instead of expected '${expected}'`);
  }
  return actual;
}

const assignNoop: HostSyncFn = { exec: () => NIL_VALUE };

function autoRegisterAssignment(services: BrainServices, typeId: TypeId): void {
  if (services.operatorOverloads.resolve(CoreOpId.Assign, [typeId, typeId])) {
    return;
  }
  services.operatorOverloads.binary(CoreOpId.Assign, typeId, typeId, typeId, assignNoop, false);
}

function registerMindcraftTypeDefinition(services: BrainServices, definition: MindcraftTypeDefinition): string {
  const nullableDef = definition as NullableTypeDef;
  if (definition.nullable && nullableDef.baseTypeId !== undefined) {
    return assertRegisteredTypeId(
      services.types.addNullableType(nullableDef.baseTypeId),
      nullableDef.typeId,
      nullableDef.name
    );
  }

  let registeredTypeId: string;

  switch (definition.coreType) {
    case NativeType.Void:
      return assertRegisteredTypeId(services.types.addVoidType(definition.name), definition.typeId, definition.name);
    case NativeType.Nil:
      return assertRegisteredTypeId(services.types.addNilType(definition.name), definition.typeId, definition.name);
    case NativeType.Boolean:
      return assertRegisteredTypeId(services.types.addBooleanType(definition.name), definition.typeId, definition.name);
    case NativeType.Number:
      return assertRegisteredTypeId(services.types.addNumberType(definition.name), definition.typeId, definition.name);
    case NativeType.String:
      return assertRegisteredTypeId(services.types.addStringType(definition.name), definition.typeId, definition.name);
    case NativeType.Enum: {
      const enumDef = definition as EnumTypeDef;
      registeredTypeId = assertRegisteredTypeId(
        services.types.addEnumType(enumDef.name, {
          symbols: enumDef.symbols,
          defaultKey: enumDef.defaultKey,
        }),
        enumDef.typeId,
        enumDef.name
      );
      break;
    }
    case NativeType.List: {
      const listDef = definition as ListTypeDef;
      registeredTypeId = assertRegisteredTypeId(
        services.types.addListType(listDef.name, { elementTypeId: listDef.elementTypeId }),
        listDef.typeId,
        listDef.name
      );
      break;
    }
    case NativeType.Map: {
      const mapDef = definition as MapTypeDef;
      registeredTypeId = assertRegisteredTypeId(
        services.types.addMapType(mapDef.name, { keyTypeId: mapDef.keyTypeId, valueTypeId: mapDef.valueTypeId }),
        mapDef.typeId,
        mapDef.name
      );
      break;
    }
    case NativeType.Struct: {
      const structDef = definition as StructTypeDef & StructDefineOptions;
      registeredTypeId = assertRegisteredTypeId(
        services.types.addStructType(structDef.name, {
          fields: structDef.fields,
          nominal: structDef.nominal,
          fieldGetter: structDef.fieldGetter,
          fieldSetter: structDef.fieldSetter,
          snapshotNative: structDef.snapshotNative,
          methods: structDef.methods,
        }),
        structDef.typeId,
        structDef.name
      );
      if (structDef.accessors) {
        const subset = TypeUtils.isArray(structDef.accessors) ? structDef.accessors : undefined;
        for (let i = 0; i < structDef.fields.size(); i++) {
          const field = structDef.fields.get(i);
          if (subset && subset.indexOf(field.name) === -1) continue;
          registerAccessorTileDef(
            registeredTypeId,
            field.name,
            field.typeId,
            field.readOnly ? { readOnly: field.readOnly } : undefined,
            services
          );
        }
      }
      if (structDef.variableFactory) {
        registerVariableFactoryTileDef(registeredTypeId, registeredTypeId, {}, services);
      }
      break;
    }
    case NativeType.Any:
      return assertRegisteredTypeId(services.types.addAnyType(definition.name), definition.typeId, definition.name);
    case NativeType.Function: {
      const functionDef = definition as FunctionTypeDef;
      if (functionDef.paramTypeIds !== undefined && functionDef.returnTypeId !== undefined) {
        return assertRegisteredTypeId(
          services.types.getOrCreateFunctionType({
            paramTypeIds: functionDef.paramTypeIds,
            returnTypeId: functionDef.returnTypeId,
          }),
          functionDef.typeId,
          functionDef.name
        );
      }
      return assertRegisteredTypeId(
        services.types.addFunctionType(definition.name),
        definition.typeId,
        definition.name
      );
    }
    case NativeType.Union: {
      const unionDef = definition as UnionTypeDef;
      return assertRegisteredTypeId(
        services.types.getOrCreateUnionType(unionDef.memberTypeIds),
        unionDef.typeId,
        unionDef.name
      );
    }
    default:
      throw new Error(`Unsupported mindcraft type '${definition.name}' (coreType: ${definition.coreType})`);
  }

  autoRegisterAssignment(services, registeredTypeId);
  return registeredTypeId;
}

function registerOperatorDefinition(services: BrainServices, definition: OperatorDefinition): void {
  services.operatorTable.add(definition.spec);
  const overloads = definition.overloads;
  if (!overloads) {
    return;
  }

  const overloadList = List.from(overloads);
  for (let i = 0; i < overloadList.size(); i++) {
    const overload = overloadList.get(i)!;
    const argTypes = List.from(overload.argTypes);
    if (argTypes.size() === 1) {
      services.operatorOverloads.unary(
        definition.spec.id,
        argTypes.get(0)!,
        overload.resultType,
        overload.fn,
        overload.isAsync ?? false
      );
      continue;
    }

    if (argTypes.size() === 2) {
      services.operatorOverloads.binary(
        definition.spec.id,
        argTypes.get(0)!,
        argTypes.get(1)!,
        overload.resultType,
        overload.fn,
        overload.isAsync ?? false
      );
      continue;
    }

    throw new Error(`Operator '${definition.spec.id}' supports only unary or binary overloads in v1`);
  }
}

function copyActionArtifacts(actions: Dict<string, CompiledActionArtifact>): Dict<string, CompiledActionArtifact> {
  const copy = new Dict<string, CompiledActionArtifact>();
  const entries = actions.entries();
  for (let i = 0; i < entries.size(); i++) {
    const entry = entries.get(i)!;
    copy.set(entry[0], entry[1]);
  }
  return copy;
}

function descriptorFromArtifact(artifact: CompiledActionArtifact): ActionDescriptor {
  return {
    key: artifact.key,
    kind: artifact.kind,
    callDef: artifact.callDef,
    isAsync: artifact.isAsync,
    outputType: artifact.outputType,
  };
}

function collectChangedActionKeys(
  previous: Dict<string, CompiledActionArtifact>,
  nextActions: Dict<string, CompiledActionArtifact>
): readonly string[] {
  const changed = new Dict<string, boolean>();
  const previousKeys = previous.keys();
  for (let i = 0; i < previousKeys.size(); i++) {
    const key = previousKeys.get(i)!;
    const prevArtifact = previous.get(key)!;
    const nextArtifact = nextActions.get(key);
    if (!nextArtifact || nextArtifact.revisionId !== prevArtifact.revisionId) {
      changed.set(key, true);
    }
  }

  const nextKeys = nextActions.keys();
  for (let i = 0; i < nextKeys.size(); i++) {
    const key = nextKeys.get(i)!;
    const prevArtifact = previous.get(key);
    const nextArtifact = nextActions.get(key)!;
    if (!prevArtifact || prevArtifact.revisionId !== nextArtifact.revisionId) {
      changed.set(key, true);
    }
  }

  return changed.keys().toArray();
}

function toActionKeySet(keys: readonly string[]): Dict<string, boolean> {
  const set = new Dict<string, boolean>();
  const keyList = List.from(keys);
  for (let i = 0; i < keyList.size(); i++) {
    set.set(keyList.get(i)!, true);
  }
  return set;
}

class MindcraftCatalogImpl implements MindcraftCatalog {
  constructor(private readonly catalog: TileCatalog = new TileCatalog()) {}

  rawCatalog(): TileCatalog {
    return this.catalog;
  }

  has(tileId: string): boolean {
    return this.catalog.has(tileId);
  }

  get(tileId: string): TileDefinitionInput | undefined {
    return this.catalog.get(tileId);
  }

  getAll(): readonly TileDefinitionInput[] {
    return this.catalog.getAll().toArray();
  }

  registerTile(def: TileDefinitionInput): string {
    this.catalog.registerTileDef(def);
    return def.tileId;
  }

  delete(tileId: string): boolean {
    return this.catalog.delete(tileId);
  }
}

function unwrapCatalog(catalog: MindcraftCatalog): ITileCatalog {
  if (catalog instanceof MindcraftCatalogImpl) {
    return catalog.rawCatalog();
  }

  const clone = new TileCatalog();
  const tiles = List.from(catalog.getAll());
  for (let i = 0; i < tiles.size(); i++) {
    clone.registerTileDef(tiles.get(i)!);
  }
  return clone;
}

class EnvironmentModuleApi implements MindcraftModuleApi {
  readonly brainServices: BrainServices;

  constructor(services: BrainServices) {
    this.brainServices = services;
  }

  defineType(def: MindcraftTypeDefinition): string {
    return registerMindcraftTypeDefinition(this.brainServices, def);
  }

  registerHostSensor(def: HostSensorDefinition): void {
    if (def.descriptor.kind !== "sensor" || def.tile.kind !== "sensor") {
      throw new Error(`Host sensor registration requires a sensor descriptor and sensor tile`);
    }

    ensureFunctionRegistered(this.brainServices, def.function);
    this.brainServices.actions.register(buildHostActionBinding(def.descriptor, def.function));
    this.brainServices.tiles.registerTileDef(def.tile);
  }

  registerHostActuator(def: HostActuatorDefinition): void {
    if (def.descriptor.kind !== "actuator" || def.tile.kind !== "actuator") {
      throw new Error(`Host actuator registration requires an actuator descriptor and actuator tile`);
    }

    ensureFunctionRegistered(this.brainServices, def.function);
    this.brainServices.actions.register(buildHostActionBinding(def.descriptor, def.function));
    this.brainServices.tiles.registerTileDef(def.tile);
  }

  registerFunction(def: HostFunctionDefinition): void {
    ensureFunctionRegistered(this.brainServices, def);
  }

  registerTile(def: TileDefinitionInput): string {
    this.brainServices.tiles.registerTileDef(def);
    return def.tileId;
  }

  registerModifiers(defs: readonly ModifierTileInput[]): void {
    for (const def of defs) {
      const metadata: ITileMetadata = { label: def.label, iconUrl: def.iconUrl };
      this.brainServices.tiles.registerTileDef(new BrainTileModifierDef(def.id, { metadata }));
    }
  }

  registerParameters(defs: readonly ParameterTileInput[]): void {
    for (const def of defs) {
      const opts: BrainTileDefCreateOptions = { hidden: def.hidden };
      if (def.label) {
        opts.metadata = { label: def.label, iconUrl: def.iconUrl };
      }
      this.brainServices.tiles.registerTileDef(new BrainTileParameterDef(def.id, def.dataType, opts));
    }
  }

  registerOperator(def: OperatorDefinition): void {
    registerOperatorDefinition(this.brainServices, def);
  }

  registerConversion(def: ConversionDefinition): void {
    this.brainServices.conversions.register(def);
  }
}

class EnvironmentActionResolver implements BrainActionResolver {
  constructor(private readonly environment: MindcraftEnvironmentImpl) {}

  resolveAction(descriptor: ActionDescriptor): ResolvedAction | undefined {
    return this.environment.resolveAction(descriptor);
  }
}

class MindcraftEnvironmentImpl implements MindcraftEnvironment {
  readonly brainServices: BrainServices;
  private readonly bundleCatalog = new TileCatalog();
  private readonly bundleResolver = new Dict<string, CompiledActionArtifact>();
  private readonly trackedBrains = List.empty<ManagedMindcraftBrain>();
  private readonly invalidatedBrains = List.empty<ManagedMindcraftBrain>();
  private readonly invalidationListeners = List.empty<(event: BrainInvalidationEvent) => void>();
  private readonly actionResolver: BrainActionResolver;
  private readonly brainJsonMigrations_ = List.empty<BrainJsonMigration>();

  constructor(modules: readonly MindcraftModule[]) {
    this.brainServices = createBrainServices();
    this.actionResolver = new EnvironmentActionResolver(this);
    this.installModules(modules);
  }

  withServices<T>(callback: (services: BrainServices) => T): T {
    return withMindcraftEnvironmentServices(this, callback);
  }

  tileCatalogs(): readonly ITileCatalog[] {
    return [this.brainServices.tiles, this.bundleCatalog];
  }

  createCatalog(): MindcraftCatalog {
    return new MindcraftCatalogImpl();
  }

  deserializeBrainJson(json: BrainJson): IBrainDef {
    return BrainDef.fromJson(json, this.brainServices, this.buildDeserializeCatalogs());
  }

  deserializeBrainJsonFromPlain(plain: unknown): IBrainDef {
    for (let i = 0; i < this.brainJsonMigrations_.size(); i++) {
      this.brainJsonMigrations_.get(i)!(plain);
    }
    return this.deserializeBrainJson(brainJsonFromPlain(plain));
  }

  hydrateTileMetadata(snapshot: HydratedTileMetadataSnapshot): void {
    this.replaceCatalogContents(this.bundleCatalog, List.from(snapshot.tiles));
  }

  createBrain(definition: IBrainDef, options?: CreateBrainOptions): MindcraftBrain {
    const overlayCatalogs = this.resolveOverlayCatalogs(options?.catalogs);
    const brain = new ManagedMindcraftBrain(this, definition, overlayCatalogs);
    brain.initialize(options?.context);
    this.trackBrain(brain);
    return brain;
  }

  replaceActionBundle(bundle: CompiledActionBundle): ActionBundleUpdate {
    const nextActions = copyActionArtifacts(bundle.actions);
    const changedActionKeys = collectChangedActionKeys(this.bundleResolver, nextActions);
    const changedActionKeySet = toActionKeySet(changedActionKeys);
    const hasChangedActions = !changedActionKeySet.isEmpty();

    this.replaceCatalogContents(this.bundleCatalog, List.from(bundle.tiles));

    this.bundleResolver.clear();
    const nextKeys = nextActions.keys();
    for (let i = 0; i < nextKeys.size(); i++) {
      const key = nextKeys.get(i)!;
      this.bundleResolver.set(key, nextActions.get(key)!);
    }

    const invalidated = List.empty<MindcraftBrain>();
    if (hasChangedActions) {
      for (let i = 0; i < this.trackedBrains.size(); i++) {
        const brain = this.trackedBrains.get(i)!;
        if (brain.isDisposed()) {
          continue;
        }
        if (!brain.usesChangedBundleActions(changedActionKeySet)) {
          continue;
        }
        this.markBrainInvalidated(brain);
        invalidated.push(brain);
      }
    }

    const event: BrainInvalidationEvent = {
      changedActionKeys,
      invalidatedBrains: invalidated.toArray(),
    };

    if (!invalidated.isEmpty()) {
      this.emitInvalidation(event);
    }

    return event;
  }

  onBrainsInvalidated(listener: (event: BrainInvalidationEvent) => void): () => void {
    this.invalidationListeners.push(listener);
    return () => {
      const index = this.invalidationListeners.indexOf(listener);
      if (index >= 0) {
        this.invalidationListeners.remove(index);
      }
    };
  }

  rebuildInvalidatedBrains(brains?: readonly MindcraftBrain[]): void {
    const targets = brains ? List.from(brains) : List.from(this.invalidatedBrains.toArray());
    for (let i = 0; i < targets.size(); i++) {
      const candidate = targets.get(i);
      if (!(candidate instanceof ManagedMindcraftBrain)) {
        continue;
      }
      if (candidate.owner() !== this || candidate.isDisposed()) {
        continue;
      }
      candidate.rebuild();
    }
  }

  buildCatalogChain(definition: IBrainDef, overlays: List<ITileCatalog>): List<ITileCatalog> {
    const catalogs = List.empty<ITileCatalog>();
    catalogs.push(this.brainServices.tiles);
    if (!this.bundleCatalog.getAll().isEmpty()) {
      catalogs.push(this.bundleCatalog);
    }
    for (let i = 0; i < overlays.size(); i++) {
      catalogs.push(overlays.get(i)!);
    }
    catalogs.push(definition.catalog());
    return catalogs;
  }

  buildDeserializeCatalogs(): List<ITileCatalog> {
    const catalogs = List.empty<ITileCatalog>();
    catalogs.push(this.brainServices.tiles);
    if (!this.bundleCatalog.getAll().isEmpty()) {
      catalogs.push(this.bundleCatalog);
    }
    return catalogs;
  }

  actionBindings(): BrainActionResolver {
    return this.actionResolver;
  }

  getBundleActionRevision(key: string): string | undefined {
    return this.bundleResolver.get(key)?.revisionId;
  }

  resolveAction(descriptor: ActionDescriptor): ResolvedAction | undefined {
    const bundleArtifact = this.bundleResolver.get(descriptor.key);
    if (bundleArtifact && bundleArtifact.kind === descriptor.kind && bundleArtifact.isAsync === descriptor.isAsync) {
      return {
        binding: "bytecode",
        descriptor: descriptorFromArtifact(bundleArtifact),
        artifact: bundleArtifact,
      };
    }

    return this.brainServices.actions.resolveAction(descriptor);
  }

  removeBrain(brain: ManagedMindcraftBrain): void {
    const trackedIndex = this.trackedBrains.indexOf(brain);
    if (trackedIndex >= 0) {
      this.trackedBrains.remove(trackedIndex);
    }
    const invalidatedIndex = this.invalidatedBrains.indexOf(brain);
    if (invalidatedIndex >= 0) {
      this.invalidatedBrains.remove(invalidatedIndex);
    }
  }

  markBrainActive(brain: ManagedMindcraftBrain): void {
    brain.markActive();
    const invalidatedIndex = this.invalidatedBrains.indexOf(brain);
    if (invalidatedIndex >= 0) {
      this.invalidatedBrains.remove(invalidatedIndex);
    }
  }

  private emitInvalidation(event: BrainInvalidationEvent): void {
    for (let i = 0; i < this.invalidationListeners.size(); i++) {
      this.invalidationListeners.get(i)!(event);
    }
  }

  private installModules(modules: readonly MindcraftModule[]): void {
    const seen = new Dict<string, boolean>();
    const moduleList = List.from(modules);
    for (let i = 0; i < moduleList.size(); i++) {
      const module = moduleList.get(i)!;
      if (seen.has(module.id)) {
        throw new Error(`Mindcraft module '${module.id}' is already installed`);
      }
      seen.set(module.id, true);

      const api = new EnvironmentModuleApi(this.brainServices);
      module.install(api);
      if (module.migrateBrainJson) {
        this.brainJsonMigrations_.push(module.migrateBrainJson);
      }
    }
  }

  private markBrainInvalidated(brain: ManagedMindcraftBrain): void {
    brain.markInvalidated();
    if (this.invalidatedBrains.indexOf(brain) === -1) {
      this.invalidatedBrains.push(brain);
    }
  }

  private replaceCatalogContents(catalog: TileCatalog, tiles: List<TileDefinitionInput>): void {
    catalog.clear();
    for (let i = 0; i < tiles.size(); i++) {
      catalog.add(tiles.get(i)!);
    }
  }

  private resolveOverlayCatalogs(catalogs?: readonly MindcraftCatalog[]): List<ITileCatalog> {
    const resolved = List.empty<ITileCatalog>();
    if (!catalogs) {
      return resolved;
    }

    const catalogList = List.from(catalogs);
    for (let i = 0; i < catalogList.size(); i++) {
      resolved.push(unwrapCatalog(catalogList.get(i)!));
    }
    return resolved;
  }

  private trackBrain(brain: ManagedMindcraftBrain): void {
    this.trackedBrains.push(brain);
  }
}

class ManagedMindcraftBrain extends Brain implements MindcraftBrain {
  status: "active" | "invalidated" | "disposed" = "active";
  private readonly linkEnvironmentRef: {
    catalogs: List<ITileCatalog>;
    actionResolver: BrainActionResolver;
  };
  private readonly linkedActionRevisions = new Dict<string, string>();
  private readonly overlayCatalogs: List<ITileCatalog>;
  private contextData: unknown;
  private started = false;

  constructor(
    private readonly environment: MindcraftEnvironmentImpl,
    public readonly definition: IBrainDef,
    overlayCatalogs: List<ITileCatalog>
  ) {
    const linkEnvironment = {
      catalogs: environment.buildCatalogChain(definition, overlayCatalogs),
      actionResolver: environment.actionBindings(),
    };
    super(definition, environment.brainServices, linkEnvironment);
    this.linkEnvironmentRef = linkEnvironment;
    this.overlayCatalogs = overlayCatalogs;
  }

  owner(): MindcraftEnvironmentImpl {
    return this.environment;
  }

  override initialize(contextData?: unknown): void {
    if (this.status === "disposed") {
      return;
    }

    const shouldRestart = this.started;
    if (this.isInitialized()) {
      super.shutdown();
      this.started = false;
    }

    this.contextData = contextData;
    this.refreshLinkEnvironment();
    super.initialize(contextData);
    this.refreshLinkedActionRevisions();
    this.status = "active";

    if (shouldRestart) {
      super.startup();
      this.started = true;
    }
  }

  override startup(): void {
    if (this.status === "disposed") {
      return;
    }
    super.startup();
    this.started = true;
  }

  override shutdown(): void {
    if (this.status === "disposed" && !this.isInitialized()) {
      return;
    }
    super.shutdown();
    this.started = false;
  }

  rebuild(): void {
    if (this.status === "disposed") {
      return;
    }

    const shouldRestart = this.started;
    if (this.isInitialized()) {
      super.shutdown();
      this.started = false;
    }

    this.refreshLinkEnvironment();
    super.initialize(this.contextData);
    this.refreshLinkedActionRevisions();

    if (shouldRestart) {
      super.startup();
      this.started = true;
    }

    this.environment.markBrainActive(this);
  }

  dispose(): void {
    if (this.status === "disposed") {
      return;
    }

    if (this.isInitialized()) {
      super.shutdown();
    }
    this.linkedActionRevisions.clear();
    this.started = false;
    this.status = "disposed";
    this.environment.removeBrain(this);
  }

  isDisposed(): boolean {
    return this.status === "disposed";
  }

  markActive(): void {
    if (this.status !== "disposed") {
      this.status = "active";
    }
  }

  markInvalidated(): void {
    if (this.status !== "disposed") {
      this.status = "invalidated";
    }
  }

  usesChangedBundleActions(changedActionKeys: Dict<string, boolean>): boolean {
    if (changedActionKeys.isEmpty() || this.linkedActionRevisions.isEmpty()) {
      return false;
    }

    const actionKeys = this.linkedActionRevisions.keys();
    for (let i = 0; i < actionKeys.size(); i++) {
      if (changedActionKeys.has(actionKeys.get(i)!)) {
        return true;
      }
    }

    return false;
  }

  private refreshLinkEnvironment(): void {
    this.linkEnvironmentRef.catalogs = this.environment.buildCatalogChain(this.definition, this.overlayCatalogs);
    this.linkEnvironmentRef.actionResolver = this.environment.actionBindings();
  }

  private refreshLinkedActionRevisions(): void {
    this.linkedActionRevisions.clear();

    const program = this.getProgram();
    if (!program) {
      return;
    }

    const actions = program.actions;
    for (let i = 0; i < actions.size(); i++) {
      const action = actions.get(i)!;
      if (action.binding !== "bytecode") {
        continue;
      }

      const revisionId = this.environment.getBundleActionRevision(action.descriptor.key);
      if (!revisionId) {
        continue;
      }

      this.linkedActionRevisions.set(action.descriptor.key, revisionId);
    }
  }
}

/** Construct a {@link MindcraftEnvironment}, installing each module in `options.modules`. */
export function createMindcraftEnvironment(options: CreateMindcraftEnvironmentOptions = {}): MindcraftEnvironment {
  return new MindcraftEnvironmentImpl(options.modules ?? []);
}

/** The built-in `mindcraft.core` module: registers the core types, operators, and tile components every brain needs. */
export function coreModule(): MindcraftModule {
  return {
    id: "mindcraft.core",
    install(api: MindcraftModuleApi): void {
      installCoreBrainComponents(api.brainServices);
    },
  };
}

/** Access the underlying {@link BrainServices} of a {@link MindcraftEnvironment}. Throws on foreign implementations. */
export function getMindcraftEnvironmentServices(environment: MindcraftEnvironment): BrainServices {
  if (!(environment instanceof MindcraftEnvironmentImpl)) {
    throw new Error("Unsupported MindcraftEnvironment implementation");
  }
  return environment.brainServices;
}

/** Run `callback` with the environment's {@link BrainServices} and return its result. */
export function withMindcraftEnvironmentServices<T>(
  environment: MindcraftEnvironment,
  callback: (services: BrainServices) => T
): T {
  return callback(environment.brainServices);
}
