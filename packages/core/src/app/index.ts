// Curated barrel for app integrators.
// Provides the symbols apps typically need from a single import path
// (`@mindcraft-lang/core/app`) instead of spreading imports across
// `@mindcraft-lang/core`, `/brain`, `/brain/model`, and `/brain/tiles`.

// -- Environment & module API ---------------------------------------------------

export type {
  BrainJsonMigration,
  CreateBrainOptions,
  CreateHostActuatorOptions,
  CreateHostSensorOptions,
  HydratedTileMetadataSnapshot,
  MindcraftBrain,
  MindcraftEnvironment,
  MindcraftModule,
  MindcraftModuleApi,
  ModifierTileInput,
  ParameterTileInput,
  TileDefinitionInput,
} from "../mindcraft";
export { coreModule, createHostActuator, createHostSensor, createMindcraftEnvironment } from "../mindcraft";

// -- Brain model ----------------------------------------------------------------

export type { IBrainDef } from "../brain/interfaces";
export { BrainDef, brainJsonFromPlain } from "../brain/model";

// -- Call-spec builders ---------------------------------------------------------

export type { BrainActionCallChoiceSpec, BrainActionCallSpec } from "../brain/interfaces";
export { bag, choice, conditional, mkCallDef, mod, optional, param, repeated } from "../brain/interfaces";

// -- Tile definitions -----------------------------------------------------------

export {
  BrainTileAccessorDef,
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileModifierDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
  BrainTileVariableDef,
  createAccessorTileDef,
  createVariableFactoryTileDef,
  getCatalogFallbackLabel,
} from "../brain/tiles";

// -- Tile ID constructors -------------------------------------------------------

export {
  mkAccessorTileId,
  mkActuatorTileId,
  mkControlFlowTileId,
  mkLiteralFactoryTileId,
  mkLiteralTileId,
  mkModifierTileId,
  mkOperatorTileId,
  mkPageTileId,
  mkParameterTileId,
  mkSensorTileId,
  mkVariableFactoryTileId,
} from "../brain/interfaces";

// -- Core ID enums --------------------------------------------------------------

export {
  CoreActuatorId,
  CoreControlFlowId,
  CoreLiteralFactoryId,
  CoreOpId,
  CoreParameterId,
  CoreSensorId,
  CoreTypeIds,
  CoreVariableFactoryId,
} from "../brain/interfaces";

// -- Context type IDs (for extending EngineContext, BrainContext, etc.) ----------

export { ContextTypeIds, ContextTypeNames } from "../brain/runtime/context-types";

// -- Type system ----------------------------------------------------------------

export type { ITypeRegistry } from "../brain/interfaces";
export { mkTypeId, NativeType } from "../brain/interfaces";

// -- Runtime values & helpers ---------------------------------------------------

export type {
  ExecutionContext,
  ListValue,
  MapValue,
  NumberValue,
  StructFieldGetterFn,
  StructValue,
  Value,
} from "../brain/interfaces";
export {
  APP_CAPABILITY_BIT_OFFSET,
  CoreCapabilityBits,
  extractListValue,
  extractNumberValue,
  extractStringValue,
  FALSE_VALUE,
  getCallSiteState,
  getSlotId,
  isNilValue,
  isNumberValue,
  mkListValue,
  mkNativeStructValue,
  mkNumberValue,
  mkStructValue,
  NIL_VALUE,
  setCallSiteState,
  TRUE_VALUE,
  VOID_VALUE,
} from "../brain/interfaces";

// -- Tile visual types (editor integration) -------------------------------------

export type { BrainTileKind, IBrainTileDef, ITileMetadata } from "../brain/interfaces";

// -- Platform utilities (commonly needed by apps) -------------------------------

export { Dict } from "../platform/dict";
export type { ReadonlyList } from "../platform/list";
export { List } from "../platform/list";
export { LogLevel, logger } from "../platform/logger";
export { TypeUtils } from "../platform/types";
export { Vector2 } from "../platform/vector2";
export { BitSet } from "../util/bitset";
