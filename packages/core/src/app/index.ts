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

export type { BrainActionCallChoiceSpec, BrainActionCallSpec } from "../runtime";
export { bag, choice, conditional, mkCallDef, mod, optional, param, repeated } from "../runtime";

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
  CoreParameterId,
  CoreSensorId,
  CoreVariableFactoryId,
} from "../brain/interfaces";
export { CoreOpId, CoreTypeIds } from "../runtime";

// -- Context type IDs (for extending EngineContext, BrainContext, etc.) ----------

export { ContextTypeIds, ContextTypeNames } from "../runtime/context-types";

// -- Type system ----------------------------------------------------------------

export type { ITypeRegistry } from "../runtime";
export { mkTypeId, NativeType } from "../runtime";

// -- Runtime values & helpers ---------------------------------------------------

export { APP_CAPABILITY_BIT_OFFSET, CoreCapabilityBits } from "../brain/interfaces";
export type { StructFieldGetterFn, StructTypeDef } from "../runtime";
export { getSlotId } from "../runtime";
export type { ExecutionContext } from "../runtime/context";
export {
  clearCallSiteState,
  getCallSiteState,
  getRuleVariable,
  setCallSiteState,
  setRuleVariable,
} from "../runtime/context";
export type {
  ListValue,
  MapValue,
  NumberValue,
  StructValue,
  Value,
} from "../runtime/value";
export {
  extractListValue,
  extractNumberValue,
  extractStringValue,
  FALSE_VALUE,
  getClosedStructFieldByName,
  isNilValue,
  isNumberValue,
  mkClosedStructValue,
  mkClosedStructValueByName,
  mkListValue,
  mkNativeStructValue,
  mkNumberValue,
  NIL_VALUE,
  TRUE_VALUE,
  VOID_VALUE,
} from "../runtime/value";

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
