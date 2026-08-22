// Curated barrel for app integrators.
// Provides the symbols apps typically need from a single import path
// (`@wendoo/core/app`) instead of spreading imports across
// `@wendoo/core`, `/brain`, `/brain/model`, and `/brain/tiles`.

// -- Environment & module API ---------------------------------------------------

export type {
  BrainJsonMigration,
  CompiledActionArtifact,
  CompiledActionBundle,
  CreateBrainOptions,
  CreateHostActuatorOptions,
  CreateHostSensorOptions,
  HydratedTileMetadataSnapshot,
  ModifierTileInput,
  ParameterTileInput,
  TileDefinitionInput,
  WendooBrain,
  WendooEnvironment,
  WendooModule,
  WendooModuleApi,
} from "../wendoo";
export { coreModule, createHostActuator, createHostSensor, createWendooEnvironment } from "../wendoo";

// -- Brain model ----------------------------------------------------------------

export type { IBrainDef, IBrainPageDef, IBrainRuleDef, IBrainTileSet } from "../brain/interfaces";
export type {
  NamespaceRewrite,
  PersistedBrainJson,
  PersistedIdRef,
  PersistedTileRef,
  PersistedTypeRef,
  RenamedBrainJson,
} from "../brain/model";
export {
  BrainDef,
  brainJsonFromPlain,
  decodePersistedBrainJson,
  deserializePersistedBrainJson,
  encodePersistedBrainJson,
  renameBrainNamespaces,
} from "../brain/model";

// -- Call-spec builders ---------------------------------------------------------

export type { ActionKind, BrainActionCallChoiceSpec, BrainActionCallSpec } from "../runtime";
export { bag, choice, conditional, mkCallDef, mod, optional, param, repeated } from "../runtime";

// -- Tile definitions -----------------------------------------------------------

export {
  BrainTileAccessorDef,
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileModifierDef,
  BrainTileOutputDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
  BrainTileVariableDef,
  buildDescriptorOutputTiles,
  createAccessorTileDef,
  createVariableFactoryTileDef,
  getCatalogFallbackLabel,
} from "../brain/tiles";

// -- Tile ID constructors -------------------------------------------------------

export {
  mkAccessorTileId,
  mkActionTileId,
  mkActuatorTileId,
  mkControlFlowTileId,
  mkLiteralFactoryTileId,
  mkLiteralTileId,
  mkModifierTileId,
  mkOperatorTileId,
  mkOutputTileId,
  mkOutputVarKey,
  mkPageTileId,
  mkParameterTileId,
  mkSensorTileId,
  mkVariableFactoryTileId,
} from "../brain/interfaces";

// -- Core ID enums --------------------------------------------------------------

export {
  CoreControlFlowId,
  CoreLiteralFactoryId,
  CoreParameterId,
  CoreVariableFactoryId,
} from "../brain/interfaces";
export { CoreOpId, CoreTypeIds } from "../runtime";

// -- Stable ABI ids ---------------------------------------------------------------

export type { HostActionIds, StableIdOwner } from "../runtime";
export { CoreFuncId, CoreHostActions, TARGET_ACTION_ID_BASE, TARGET_FUNC_ID_BASE } from "../runtime";

// -- Context type IDs (for extending EngineContext, BrainContext, etc.) ----------

export { ContextTypeIds, ContextTypeNames } from "../runtime/context-types";

// -- Type system ----------------------------------------------------------------

export type { ITypeRegistry } from "../runtime";
export { mkTypeId, NativeType } from "../runtime";

// -- Host services --------------------------------------------------------------

export { MathOps } from "../platform/math";
export type { AppServices, IRngServices } from "../runtime";
export { createEntropySeededRng, Rng } from "../runtime/rng";

// -- Runtime values & helpers ---------------------------------------------------

export { APP_CAPABILITY_BIT_OFFSET, CoreCapabilityBits, TilePlacement } from "../brain/interfaces";
export type { StructFieldGetterFn, StructTypeDef } from "../runtime";
export { getSlotId } from "../runtime";
export { formatF32 } from "../runtime/binary32-format";
export type { ExecutionContext } from "../runtime/context";
export {
  clearCallSiteState,
  getCallSiteState,
  getRuleVariable,
  getWhenResult,
  setCallSiteState,
  setRuleVariable,
  setSensorOutput,
} from "../runtime/context";
export type {
  AsyncHandle,
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
  isBooleanValue,
  isEnumValue,
  isFunctionValue,
  isHandleValue,
  isListValue,
  isMapValue,
  isNilValue,
  isNumberValue,
  isStringValue,
  isStructValue,
  isUnknownValue,
  isVoidValue,
  mkBooleanValue,
  mkClosedStructValue,
  mkClosedStructValueByName,
  mkFunctionValue,
  mkListValue,
  mkNativeStructValue,
  mkNumberValue,
  mkStringValue,
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
export type { Logger } from "../platform/logger";
export { LogLevel, logger } from "../platform/logger";
export { TypeUtils } from "../platform/types";
export { Vector2 } from "../platform/vector2";
export { BitSet } from "../util/bitset";
