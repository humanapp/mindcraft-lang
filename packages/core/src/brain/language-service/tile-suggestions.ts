import { List, type ReadonlyList } from "../../platform/list";
import { UniqueSet } from "../../platform/uniqueset";
import type { ReadonlyBitSet } from "../../util/bitset";
import { parseBrainTiles } from "../compiler/parser";
import type { ActuatorExpr, Expr, FieldAccessExpr, SensorExpr, Span } from "../compiler/types";
import {
  CoreControlFlowId,
  CoreOpId,
  CoreTypeIds,
  type IBrainTileDef,
  type IConversionRegistry,
  type IOperatorOverloads,
  type ITileCatalog,
  mkControlFlowTileId,
  NativeType,
  type RuleSide,
  type TileId,
  TilePlacement,
  type TypeId,
} from "../interfaces";
import type { BrainActionArgSlot, BrainActionCallSpec } from "../interfaces/functions";
import type { StructTypeDef } from "../interfaces/type-system";
import { getBrainServices } from "../services";
import type { BrainTileAccessorDef } from "../tiles/accessors";
import { BrainTileActuatorDef } from "../tiles/actuators";
import type { BrainTileControlFlowDef } from "../tiles/controlflow";
import type { BrainTileFactoryDef } from "../tiles/factories";
import type { BrainTileLiteralDef } from "../tiles/literals";
import type { BrainTileOperatorDef } from "../tiles/operators";
import type { BrainTilePageDef } from "../tiles/pagetiles";
import type { BrainTileParameterDef } from "../tiles/parameters";
import type { BrainTileSensorDef } from "../tiles/sensors";
import type { BrainTileVariableDef } from "../tiles/variables";

// ---- Public Types ----

/**
 * Describes how a tile matches the expected type at an insertion point.
 */
export enum TileCompatibility {
  /** Tile's output type exactly matches the expected type */
  Exact = 0,
  /** Tile's output type can be converted to the expected type */
  Conversion = 1,
  /** Type could not be checked (e.g., operators whose result depends on operands, or no expected type constraint) */
  Unchecked = 2,
}

/**
 * A single tile suggestion with type compatibility information.
 */
export interface TileSuggestion {
  /** The suggested tile definition */
  tileDef: IBrainTileDef;
  /** How the tile is compatible with the insertion point */
  compatibility: TileCompatibility;
  /** Total conversion cost (0 for exact and unchecked matches) */
  conversionCost: number;
}

/**
 * Result of tile suggestion, with exact matches separated from conversion matches.
 *
 * The `exact` list contains tiles that either match the expected type exactly or
 * whose compatibility could not be checked (e.g., operators, control flow).
 * The `withConversion` list contains tiles that require a type conversion.
 */
export interface TileSuggestionResult {
  /** Tiles compatible by exact type match or type-unchecked */
  exact: List<TileSuggestion>;
  /** Tiles compatible only via type conversion */
  withConversion: List<TileSuggestion>;
}

/**
 * Describes the insertion point where the user wants to place a tile.
 */
export interface InsertionContext {
  /** Which side of the rule: When, Do, or Either */
  ruleSide: RuleSide;
  /**
   * The expected type at this position, if known. When set, tiles are
   * filtered and classified by type compatibility. When undefined or
   * CoreTypeIds.Unknown, all placement-compatible tiles are returned
   * as Unchecked.
   */
  expectedType?: TypeId;
  /**
   * The parsed expression tree at the insertion point. Behavior is derived
   * from the expr kind:
   * - `empty` or omitted -> suggest all placement-compatible tiles
   * - `actuator` with unfilled slots or parameters needing values -> suggest call spec tiles
   * - `actuator` with trailing complete value -> infix operators + remaining call spec tiles
   * - `actuator` fully complete -> suggest nothing
   * - `sensor` with unfilled slots or parameters needing values -> suggest call spec tiles
   * - `sensor` with trailing complete value or fully complete -> infix operators + remaining call spec tiles
   * - value expr (literal, variable, binaryOp, unaryOp, assignment) -> suggest infix operators
   * - `errorExpr` -> suggest all tiles (recovery)
   */
  expr?: Expr;
  /**
   * When replacing a tile, the index of the tile being replaced in the flat
   * tile list. When set (and expr is provided), the AST is walked using span
   * information to determine the structural role at that position, and
   * suggestions are constrained to what is valid there.
   */
  replaceTileIndex?: number;
  /**
   * The OR'd capabilities of all tiles in the current rule hierarchy that
   * precede the insertion point. Tiles whose `requirements()` are not a
   * subset of this set are excluded from suggestions. When undefined,
   * no capability filtering is performed (all tiles pass).
   */
  availableCapabilities?: ReadonlyBitSet;
  /**
   * Number of unmatched open parentheses preceding the insertion point.
   * When > 0, the close paren tile is suggested after complete expressions
   * and non-inline sensors and actuators are excluded (only inline sensors
   * and value-producing tiles are valid inside grouped expressions).
   */
  unclosedParenDepth?: number;
}

// ---- Helpers ----

/**
 * Extracts the output/value type of a tile, if determinable from the tile
 * definition alone. Returns undefined for tiles whose output type depends
 * on context (operators, control flow).
 */
export function getTileOutputType(tileDef: IBrainTileDef): TypeId | undefined {
  switch (tileDef.kind) {
    case "literal":
      return (tileDef as BrainTileLiteralDef).valueType;
    case "variable":
      return (tileDef as BrainTileVariableDef).varType;
    case "sensor":
      return (tileDef as BrainTileSensorDef).outputType;
    case "factory":
      return (tileDef as BrainTileFactoryDef).producedDataType;
    case "parameter":
      return (tileDef as BrainTileParameterDef).dataType;
    case "actuator":
      return CoreTypeIds.Void;
    case "accessor":
      return (tileDef as BrainTileAccessorDef).fieldTypeId;
    case "page":
      return (tileDef as BrainTilePageDef).valueType;
    default:
      return undefined;
  }
}

/**
 * Checks if a tile's placement flags allow it on the given rule side.
 */
function isPlacementValid(tileDef: IBrainTileDef, ruleSide: RuleSide): boolean {
  const placement = tileDef.placement;
  if (placement === undefined) return true;
  return (placement & ruleSide) !== 0;
}

/**
 * Checks if a tile's requirements are satisfied by the available capabilities.
 * A tile's requirements must be a subset of the available capabilities.
 * Returns true if no requirements exist, or if availableCapabilities is undefined
 * (no capability filtering).
 */
function areRequirementsMet(tileDef: IBrainTileDef, availableCapabilities: ReadonlyBitSet | undefined): boolean {
  const requirements = tileDef.requirements();
  if (requirements.isEmpty()) return true;
  if (availableCapabilities === undefined) return true;
  // Check that every bit set in requirements is also set in availableCapabilities
  const msb = requirements.msb();
  for (let i = 0; i <= msb; i++) {
    if (requirements.get(i) === 1 && availableCapabilities.get(i) === 0) return false;
  }
  return true;
}

/**
 * Checks if a slot ID is in the filled list.
 */
function isSlotFilled(slotId: number, filledSlotIds: ReadonlyList<number>): boolean {
  for (let i = 0; i < filledSlotIds.size(); i++) {
    if (filledSlotIds.get(i) === slotId) return true;
  }
  return false;
}

/**
 * Looks up a tile definition across multiple catalogs.
 */
function findTileInCatalogs(tileId: TileId, catalogs: ReadonlyList<ITileCatalog>): IBrainTileDef | undefined {
  for (let ci = 0; ci < catalogs.size(); ci++) {
    const tileDef = catalogs.get(ci).get(tileId);
    if (tileDef) return tileDef;
  }
  return undefined;
}

/**
 * Whether the given expected type represents an actual type constraint.
 * CoreTypeIds.Unknown means "no constraint" -- all tiles should be included.
 */
function hasTypeConstraint(expectedType: TypeId | undefined): boolean {
  return expectedType !== undefined && expectedType !== CoreTypeIds.Unknown;
}

/**
 * Classifies a tile's type compatibility against an expected type.
 * Returns undefined if the tile is not compatible at all.
 *
 * For struct-typed tiles, also checks if any field of the struct matches
 * the expected type (directly or via conversion). This allows struct
 * variables to appear in positions needing a field type, since the user
 * can add an accessor tile to extract the matching field.
 */
function classifyTypeCompatibility(
  outputType: TypeId | undefined,
  expectedType: TypeId | undefined,
  conversions: IConversionRegistry
): { compatibility: TileCompatibility; cost: number } | undefined {
  // If no constraint or unknown output type, compatibility is unchecked
  if (!hasTypeConstraint(expectedType) || !outputType || outputType === CoreTypeIds.Unknown) {
    return { compatibility: TileCompatibility.Unchecked, cost: 0 };
  }

  // Exact type match
  if (outputType === expectedType) {
    return { compatibility: TileCompatibility.Exact, cost: 0 };
  }

  // Conversion match
  const path = conversions.findBestPath(outputType, expectedType!);
  if (path !== undefined && path.size() > 0) {
    let totalCost = 0;
    for (let i = 0; i < path.size(); i++) {
      totalCost += path.get(i).cost;
    }
    return { compatibility: TileCompatibility.Conversion, cost: totalCost };
  }

  // Struct field match -- if the tile produces a struct type and any of its
  // fields match the expected type, treat it as a conversion (the user will
  // need to add an accessor tile to reach the desired field value).
  const fieldResult = structFieldTypeCompatibility(outputType, expectedType!, conversions);
  if (fieldResult !== undefined) {
    return fieldResult;
  }

  // Not compatible
  return undefined;
}

/**
 * Checks if a struct type has any field whose type matches the expected type
 * (directly or via conversion). Returns a Conversion compatibility result
 * if a matching field exists, undefined otherwise.
 *
 * The cost is 1 (for the accessor step) plus any conversion cost from the
 * field type to the expected type.
 */
function structFieldTypeCompatibility(
  structTypeId: TypeId,
  expectedType: TypeId,
  conversions: IConversionRegistry
): { compatibility: TileCompatibility; cost: number } | undefined {
  const typeRegistry = getBrainServices().types;
  const typeDef = typeRegistry.get(structTypeId);
  if (!typeDef || typeDef.coreType !== NativeType.Struct) return undefined;

  const fields = (typeDef as StructTypeDef).fields;
  let bestCost: number | undefined;

  for (let i = 0; i < fields.size(); i++) {
    const fieldTypeId = fields.get(i).typeId;
    if (fieldTypeId === expectedType) {
      // Direct field match -- cost is 1 for the accessor step
      bestCost = 1;
      break; // Can't do better
    }
    const path = conversions.findBestPath(fieldTypeId, expectedType);
    if (path !== undefined && path.size() > 0) {
      let cost = 1; // accessor step
      for (let j = 0; j < path.size(); j++) {
        cost += path.get(j).cost;
      }
      if (bestCost === undefined || cost < bestCost) {
        bestCost = cost;
      }
    }
  }

  if (bestCost !== undefined) {
    return { compatibility: TileCompatibility.Conversion, cost: bestCost };
  }
  return undefined;
}

/**
 * Collects the slot IDs that have already been filled in an action expr.
 * Optionally excludes a single slot ID (used for replacement scenarios).
 */
function collectFilledSlotIds(expr: ActuatorExpr | SensorExpr, excludeSlotId?: number): ReadonlyList<number> {
  const ids = List.empty<number>();
  // When replacing a repeated slot, only exclude one instance of the slotId --
  // not all of them. Without this, replacing one [nearby] in [nearby][nearby]
  // would remove both fills, making the choice node think no option is selected
  // and incorrectly offering [far away] as an alternative.
  let excluded = false;
  for (let i = 0; i < expr.anons.size(); i++) {
    const id = expr.anons.get(i).slotId;
    if (!excluded && id === excludeSlotId) {
      excluded = true;
      continue;
    }
    ids.push(id);
  }
  for (let i = 0; i < expr.parameters.size(); i++) {
    const id = expr.parameters.get(i).slotId;
    if (!excluded && id === excludeSlotId) {
      excluded = true;
      continue;
    }
    ids.push(id);
  }
  for (let i = 0; i < expr.modifiers.size(); i++) {
    const id = expr.modifiers.get(i).slotId;
    if (!excluded && id === excludeSlotId) {
      excluded = true;
      continue;
    }
    ids.push(id);
  }
  return ids.asReadonly();
}

/**
 * Counts how many times a given slotId appears in the filled list.
 * Used for repeat cardinality checks where the same slot can be filled multiple times.
 */
function countSlotFills(slotId: number, filledSlotIds: ReadonlyList<number>): number {
  let count = 0;
  for (let i = 0; i < filledSlotIds.size(); i++) {
    if (filledSlotIds.get(i) === slotId) count++;
  }
  return count;
}

/**
 * Finds the BrainActionArgSlot for a given tileId in the flat argSlots list.
 */
function findArgSlotByTileId(
  tileId: string,
  argSlots: ReadonlyList<BrainActionArgSlot>
): BrainActionArgSlot | undefined {
  for (let i = 0; i < argSlots.size(); i++) {
    if (argSlots.get(i).argSpec.tileId === tileId) return argSlots.get(i);
  }
  return undefined;
}

/**
 * Checks whether any constituent arg in a call spec node has been filled.
 */
function specHasAnyFill(
  spec: BrainActionCallSpec,
  argSlots: ReadonlyList<BrainActionArgSlot>,
  filledSlotIds: ReadonlyList<number>
): boolean {
  switch (spec.type) {
    case "arg": {
      const slot = findArgSlotByTileId(spec.tileId, argSlots);
      return slot !== undefined && isSlotFilled(slot.slotId, filledSlotIds);
    }
    case "seq":
    case "bag":
      for (const item of spec.items) {
        if (specHasAnyFill(item, argSlots, filledSlotIds)) return true;
      }
      return false;
    case "choice":
      for (const option of spec.options) {
        if (specHasAnyFill(option, argSlots, filledSlotIds)) return true;
      }
      return false;
    case "optional":
    case "repeat":
      return specHasAnyFill(spec.item, argSlots, filledSlotIds);
    case "conditional":
      if (specHasAnyFill(spec.then, argSlots, filledSlotIds)) return true;
      return spec.else !== undefined && specHasAnyFill(spec.else, argSlots, filledSlotIds);
    default: {
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}

/**
 * Finds a named spec node within a call spec tree by its `name` property.
 * Used for evaluating `conditional` spec conditions.
 */
function findNamedSpec(spec: BrainActionCallSpec, name: string): BrainActionCallSpec | undefined {
  if (spec.name === name) return spec;
  switch (spec.type) {
    case "arg":
      return undefined;
    case "seq":
    case "bag":
      for (const item of spec.items) {
        const found = findNamedSpec(item, name);
        if (found !== undefined) return found;
      }
      return undefined;
    case "choice":
      for (const option of spec.options) {
        const found = findNamedSpec(option, name);
        if (found !== undefined) return found;
      }
      return undefined;
    case "optional":
    case "repeat":
      return findNamedSpec(spec.item, name);
    case "conditional": {
      const found = findNamedSpec(spec.then, name);
      if (found !== undefined) return found;
      return spec.else !== undefined ? findNamedSpec(spec.else, name) : undefined;
    }
    default: {
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}

/**
 * Walks the call spec tree to collect arg slots that are currently
 * available for suggestion, respecting all grammar constraints:
 *
 * - **choice**: mutual exclusion -- if one option has a fill, others are excluded
 * - **repeat**: cardinality -- respects max bounds, allows multiple fills up to max
 * - **seq**: all items suggested (ordering is lenient for tile picker)
 * - **optional**: delegates to inner item
 * - **bag**: all items independently available
 * - **conditional**: evaluates named condition to pick the active branch
 *
 * @param repeatMax Max occurrences for args under this node.
 *   1 for normal single-use, N for repeat(max=N), undefined for unlimited.
 * @param rootSpec The root call spec, used for conditional condition lookup.
 */
function collectAvailableArgSlots(
  spec: BrainActionCallSpec,
  argSlots: ReadonlyList<BrainActionArgSlot>,
  filledSlotIds: ReadonlyList<number>,
  available: List<BrainActionArgSlot>,
  repeatMax: number | undefined,
  rootSpec: BrainActionCallSpec
): void {
  switch (spec.type) {
    case "arg": {
      const slot = findArgSlotByTileId(spec.tileId, argSlots);
      if (slot === undefined) break;
      const fillCount = countSlotFills(slot.slotId, filledSlotIds);
      // Available if under the repeat max (undefined = no limit)
      if (repeatMax === undefined || fillCount < repeatMax) {
        available.push(slot);
      }
      break;
    }

    case "bag":
      for (const item of spec.items) {
        collectAvailableArgSlots(item, argSlots, filledSlotIds, available, repeatMax, rootSpec);
      }
      break;

    case "choice": {
      // Find which option (if any) has been selected
      let selectedOption: BrainActionCallSpec | undefined;
      for (const option of spec.options) {
        if (specHasAnyFill(option, argSlots, filledSlotIds)) {
          selectedOption = option;
          break;
        }
      }
      if (selectedOption !== undefined) {
        // Only the selected option's arg slots are available
        collectAvailableArgSlots(selectedOption, argSlots, filledSlotIds, available, repeatMax, rootSpec);
      } else {
        // No option selected yet -- all options are available
        for (const option of spec.options) {
          collectAvailableArgSlots(option, argSlots, filledSlotIds, available, repeatMax, rootSpec);
        }
      }
      break;
    }

    case "optional":
      collectAvailableArgSlots(spec.item, argSlots, filledSlotIds, available, repeatMax, rootSpec);
      break;

    case "repeat":
      // Override repeatMax with this repeat node's max bound
      collectAvailableArgSlots(spec.item, argSlots, filledSlotIds, available, spec.max, rootSpec);
      break;

    case "seq":
      // Suggest all items (ordering is lenient for the tile picker;
      // the parser enforces sequence constraints).
      for (const item of spec.items) {
        collectAvailableArgSlots(item, argSlots, filledSlotIds, available, repeatMax, rootSpec);
      }
      break;

    case "conditional": {
      // Check if the named condition spec has been matched (has any fills)
      const condSpec = findNamedSpec(rootSpec, spec.condition);
      const conditionMet = condSpec !== undefined && specHasAnyFill(condSpec, argSlots, filledSlotIds);
      if (conditionMet) {
        collectAvailableArgSlots(spec.then, argSlots, filledSlotIds, available, repeatMax, rootSpec);
      } else if (spec.else !== undefined) {
        collectAvailableArgSlots(spec.else, argSlots, filledSlotIds, available, repeatMax, rootSpec);
      }
      break;
    }
    default: {
      const _exhaustive: never = spec;
      break;
    }
  }
}

/**
 * Whether a parameter's value expression indicates no value has been provided.
 * The parser produces `ErrorExpr` when no value tile follows a parameter tile,
 * and `EmptyExpr` is used in synthetic / test contexts.
 */
function isParameterValueMissing(value: Expr): boolean {
  switch (value.kind) {
    case "empty":
    case "errorExpr":
      return true;
    case "binaryOp":
      return isParameterValueMissing(value.right);
    case "unaryOp":
      return isParameterValueMissing(value.operand);
    case "assignment":
      return isParameterValueMissing(value.value);
    default:
      return false;
  }
}

/**
 * Checks whether any filled parameter slot in the action expr has a
 * missing value (the parameter tile was placed but no value tile follows it).
 * Optionally excludes a single slot ID (used for replacement scenarios).
 */
function hasParametersNeedingValues(actionExpr: ActuatorExpr | SensorExpr, excludeSlotId?: number): boolean {
  for (let i = 0; i < actionExpr.parameters.size(); i++) {
    if (actionExpr.parameters.get(i).slotId === excludeSlotId) continue;
    const slotExpr = actionExpr.parameters.get(i).expr;
    if (slotExpr.kind === "parameter" && isParameterValueMissing(slotExpr.value)) return true;
  }
  return false;
}

/**
 * Checks whether any filled anonymous slot in the action expr has an
 * incomplete value expression (e.g., a binary op with missing right operand).
 * This is the anonymous-slot counterpart of hasParametersNeedingValues.
 *
 * Anonymous slots that are empty or error-only are handled by
 * collectAvailableArgSlots (the slot counts as unfilled). This function
 * targets the case where a value was partially entered.
 */
function hasIncompleteAnonValues(actionExpr: ActuatorExpr | SensorExpr): boolean {
  for (let i = 0; i < actionExpr.anons.size(); i++) {
    const anonExpr = actionExpr.anons.get(i).expr;
    if (anonExpr.kind !== "empty" && anonExpr.kind !== "errorExpr" && !isCompleteValueExpr(anonExpr)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether any slot in the action expr contains a complete value whose
 * output type is a struct that does not match the slot's expected type.
 *
 * When this is true the user likely needs to refine the value via accessor
 * tiles (e.g., `[me] [position]` produces Vector2 but the slot expects
 * Number -- the user wants `[me] [position] [x]`). Named modifier/parameter
 * tiles should be suppressed so only accessor and value tiles are visible.
 */
function hasStructValuePendingAccessor(
  actionExpr: ActuatorExpr | SensorExpr,
  catalogs: ReadonlyList<ITileCatalog>,
  excludeSlotId?: number
): boolean {
  const types = getBrainServices().types;

  // Check parameter slots
  for (let i = 0; i < actionExpr.parameters.size(); i++) {
    if (actionExpr.parameters.get(i).slotId === excludeSlotId) continue;
    const slotExpr = actionExpr.parameters.get(i).expr;
    if (slotExpr.kind !== "parameter") continue;
    if (!isCompleteValueExpr(slotExpr.value)) continue;

    const outputType = getExprOutputType(slotExpr.value);
    if (outputType === undefined || outputType === slotExpr.tileDef.dataType) continue;

    const typeDef = types.get(outputType);
    if (typeDef && typeDef.coreType === NativeType.Struct) return true;
  }

  // Check anonymous slots
  const callDef = actionExpr.tileDef.fnEntry.callDef;
  for (let i = 0; i < actionExpr.anons.size(); i++) {
    if (actionExpr.anons.get(i).slotId === excludeSlotId) continue;
    const anonExpr = actionExpr.anons.get(i).expr;
    if (!isCompleteValueExpr(anonExpr)) continue;

    const outputType = getExprOutputType(anonExpr);
    if (outputType === undefined) continue;

    const typeDef = types.get(outputType);
    if (!typeDef || typeDef.coreType !== NativeType.Struct) continue;

    // Find the expected type for this slot
    const slotId = actionExpr.anons.get(i).slotId;
    for (let j = 0; j < callDef.argSlots.size(); j++) {
      if (callDef.argSlots.get(j).slotId === slotId) {
        const argTileDef = findTileInCatalogs(callDef.argSlots.get(j).argSpec.tileId, catalogs);
        if (argTileDef && argTileDef.kind === "parameter") {
          const expectedType = (argTileDef as BrainTileParameterDef).dataType;
          if (outputType !== expectedType) return true;
        }
        break;
      }
    }
  }

  return false;
}

/**
 * Collects the set of value types that an action call currently expects.
 * This includes types from:
 * 1. Available (unfilled) anonymous slots
 * 2. Filled parameter slots whose value is still missing
 * 3. Filled anonymous slots with incomplete values
 * 4. Filled anonymous slots where value is a struct that doesn't match the
 *    expected type (struct-pending-accessor -- user needs to drill down)
 *
 * Used to filter accessor suggestions -- only accessors whose output type
 * is compatible with at least one expected type should be suggested.
 */
function collectActionCallExpectedTypes(
  actionExpr: ActuatorExpr | SensorExpr,
  catalogs: ReadonlyList<ITileCatalog>
): List<TypeId> {
  const callDef = actionExpr.tileDef.fnEntry.callDef;
  const filledSlotIds = collectFilledSlotIds(actionExpr);
  const availableSlots = List.empty<BrainActionArgSlot>();
  collectAvailableArgSlots(callDef.callSpec, callDef.argSlots, filledSlotIds, availableSlots, 1, callDef.callSpec);

  const types = getBrainServices().types;
  const expectedTypes = List.empty<TypeId>();

  // Available anonymous slots
  for (let i = 0; i < availableSlots.size(); i++) {
    const slot = availableSlots.get(i);
    if (!slot.argSpec.anonymous) continue;
    const argTileDef = findTileInCatalogs(slot.argSpec.tileId, catalogs);
    if (argTileDef && argTileDef.kind === "parameter") {
      expectedTypes.push((argTileDef as BrainTileParameterDef).dataType);
    }
  }

  // Filled parameters with missing values
  for (let i = 0; i < actionExpr.parameters.size(); i++) {
    const slotExpr = actionExpr.parameters.get(i).expr;
    if (slotExpr.kind === "parameter" && isParameterValueMissing(slotExpr.value)) {
      expectedTypes.push(slotExpr.tileDef.dataType);
    }
  }

  // Filled anonymous slots with incomplete values or struct-pending-accessor
  for (let i = 0; i < actionExpr.anons.size(); i++) {
    const anonExpr = actionExpr.anons.get(i).expr;
    const slotId = actionExpr.anons.get(i).slotId;

    // Find the slot's expected type from the call def
    let slotExpectedType: TypeId | undefined;
    for (let j = 0; j < callDef.argSlots.size(); j++) {
      if (callDef.argSlots.get(j).slotId === slotId) {
        const argTileDef = findTileInCatalogs(callDef.argSlots.get(j).argSpec.tileId, catalogs);
        if (argTileDef && argTileDef.kind === "parameter") {
          slotExpectedType = (argTileDef as BrainTileParameterDef).dataType;
        }
        break;
      }
    }
    if (slotExpectedType === undefined) continue;

    // Incomplete value -- user is building an expression
    if (anonExpr.kind !== "empty" && anonExpr.kind !== "errorExpr" && !isCompleteValueExpr(anonExpr)) {
      expectedTypes.push(slotExpectedType);
      continue;
    }

    // Struct-pending-accessor: complete value whose type is a struct that
    // doesn't match the expected type -- user needs to apply accessor tiles.
    if (isCompleteValueExpr(anonExpr)) {
      const outputType = getExprOutputType(anonExpr);
      if (outputType !== undefined && outputType !== slotExpectedType) {
        const typeDef = types.get(outputType);
        if (typeDef && typeDef.coreType === NativeType.Struct) {
          expectedTypes.push(slotExpectedType);
        }
      }
    }
  }

  return expectedTypes;
}

/**
 * Whether an expression is a "complete value" that can be extended with an
 * infix operator. For example, a literal `[1]` or a binary op `[1] [+] [1]`
 * are complete values, while `empty` and `errorExpr` are not.
 */
function isCompleteValueExpr(expr: Expr): expr is Expr & { span: Span } {
  switch (expr.kind) {
    case "literal":
    case "variable":
    case "sensor":
    case "fieldAccess":
      return true;
    case "binaryOp":
      return isCompleteValueExpr(expr.right);
    case "unaryOp":
      return isCompleteValueExpr(expr.operand);
    case "assignment":
      return isCompleteValueExpr(expr.value);
    default:
      return false;
  }
}

/**
 * For an incomplete expression, determines the expected type of the missing
 * sub-expression if it can be statically inferred. For example:
 * - `[$vec].[x] = _` -> the field type of x (Number)
 * - `[$numVar] = _` -> the variable type (Number)
 * - `[1] [+] _` -> undefined (operator result depends on overload resolution)
 */
function incompleteExprExpectedType(
  expr: Expr,
  operatorOverloads?: IOperatorOverloads,
  conversions?: IConversionRegistry
): TypeId | undefined {
  switch (expr.kind) {
    case "assignment":
      if (expr.target.kind === "fieldAccess") {
        return expr.target.accessor.fieldTypeId;
      }
      return expr.target.tileDef.varType;
    case "binaryOp":
      // Walk to the incomplete tail
      if (!isCompleteValueExpr(expr.right)) {
        // First try to determine the expected type from the nested incomplete expression
        const nestedType = incompleteExprExpectedType(expr.right, operatorOverloads, conversions);
        if (nestedType !== undefined) return nestedType;

        // If the nested expression couldn't determine a type (e.g., it's an errorExpr),
        // try to infer the expected RHS type from this operator's overloads and the
        // LHS type. For example, ["hello"] [!=] _ -> LHS is String, != has overload
        // (String, String) -> Boolean, so the expected RHS type is String.
        if (operatorOverloads) {
          const leftType = getExprOutputType(expr.left, operatorOverloads, conversions);
          if (leftType) {
            const allOverloads = expr.operator.op.overloads();
            let rhsType: TypeId | undefined;
            let ambiguous = false;
            for (let i = 0; i < allOverloads.size(); i++) {
              const overload = allOverloads.get(i);
              // Binary operators always have 2 argTypes; match on LHS type
              if (overload.argTypes[0] === leftType && overload.argTypes[1] !== undefined) {
                const rhs = overload.argTypes[1];
                if (rhsType === undefined) {
                  rhsType = rhs;
                } else if (rhsType !== rhs) {
                  ambiguous = true;
                  break;
                }
              }
            }
            if (!ambiguous && rhsType !== undefined) return rhsType;
          }
        }
      }
      return undefined;
    case "unaryOp":
      if (!isCompleteValueExpr(expr.operand)) {
        return incompleteExprExpectedType(expr.operand, operatorOverloads, conversions);
      }
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Walks to the rightmost primary (leaf) expression in the tree.
 * Since accessor tiles bind at maximum precedence (postfix), the type
 * relevant for accessor suggestions is the trailing primary, not the
 * type of the overall expression. For example, in `[$vec].[x] = [$vec]`,
 * the trailing primary is the rightmost `[$vec]`, whose struct type
 * determines which accessors are valid.
 */
function trailingPrimaryExpr(expr: Expr): Expr {
  switch (expr.kind) {
    case "binaryOp":
      return trailingPrimaryExpr(expr.right);
    case "unaryOp":
      return trailingPrimaryExpr(expr.operand);
    case "assignment":
      return trailingPrimaryExpr(expr.value);
    default:
      return expr;
  }
}

/**
 * Computes the accepted types for the trailing primary's position within
 * a complete expression. This prevents accessor tiles from being suggested
 * when their field type would be incompatible with the enclosing context.
 *
 * For example, in `[$actor] [=] [it]` where both are ActorRef, adding an
 * accessor to `[it]` would change the RHS type to a field type (e.g.,
 * Number) that no longer matches the target variable's type. This function
 * returns `[ActorRef]` so that only accessors producing ActorRef would be
 * suggested (and since no ActorRef field produces ActorRef, none are).
 *
 * Walks the same path as `trailingPrimaryExpr`, collecting the innermost
 * type constraint from enclosing assignment or binary op contexts.
 */
function trailingPrimaryAcceptedTypes(
  expr: Expr,
  operatorOverloads?: IOperatorOverloads,
  conversions?: IConversionRegistry
): ReadonlyList<TypeId> | undefined {
  switch (expr.kind) {
    case "assignment": {
      // Recurse into the value -- a deeper constraint takes priority
      const deeper = trailingPrimaryAcceptedTypes(expr.value, operatorOverloads, conversions);
      if (deeper !== undefined) return deeper;
      // The trailing primary sits directly in the value position;
      // its type must match the assignment target type
      const targetType =
        expr.target.kind === "fieldAccess" ? expr.target.accessor.fieldTypeId : expr.target.tileDef.varType;
      return List.from([targetType]);
    }
    case "binaryOp": {
      const deeper = trailingPrimaryAcceptedTypes(expr.right, operatorOverloads, conversions);
      if (deeper !== undefined) return deeper;
      // The trailing primary is the right operand; infer the expected
      // RHS type from operator overloads when available
      if (operatorOverloads) {
        const leftType = getExprOutputType(expr.left, operatorOverloads, conversions);
        if (leftType) {
          const allOverloads = expr.operator.op.overloads();
          let rhsType: TypeId | undefined;
          let ambiguous = false;
          for (let i = 0; i < allOverloads.size(); i++) {
            const overload = allOverloads.get(i);
            if (overload.argTypes[0] === leftType && overload.argTypes[1] !== undefined) {
              const rhs = overload.argTypes[1];
              if (rhsType === undefined) {
                rhsType = rhs;
              } else if (rhsType !== rhs) {
                ambiguous = true;
                break;
              }
            }
          }
          if (!ambiguous && rhsType !== undefined) return List.from([rhsType]);
        }
      }
      return undefined;
    }
    case "unaryOp":
      return trailingPrimaryAcceptedTypes(expr.operand, operatorOverloads, conversions);
    default:
      // Leaf node (literal, variable, fieldAccess) -- no enclosing constraint
      return undefined;
  }
}

/**
 * Returns the trailing (rightmost by span) value expression inside an
 * actuator or sensor, if one exists. This checks:
 * 1. Anonymous slots -- if the last anon slot has a complete value
 * 2. Parameter slots -- if the last parameter has a complete value expression
 *
 * The "last" is determined by the highest span.to across all children,
 * since tiles appear in flat order. If a modifier appears after the
 * trailing value (higher span), the value is not truly trailing and
 * undefined is returned -- infix operators should not follow modifiers.
 */
function trailingValueExpr(actionExpr: ActuatorExpr | SensorExpr): Expr | undefined {
  let trailing: Expr | undefined;
  let trailingEnd = -1;

  for (let i = 0; i < actionExpr.anons.size(); i++) {
    const slotExpr = actionExpr.anons.get(i).expr;
    if (isCompleteValueExpr(slotExpr) && slotExpr.span.to > trailingEnd) {
      trailing = slotExpr;
      trailingEnd = slotExpr.span.to;
    }
  }

  for (let i = 0; i < actionExpr.parameters.size(); i++) {
    const slotExpr = actionExpr.parameters.get(i).expr;
    if (slotExpr.kind === "parameter" && isCompleteValueExpr(slotExpr.value)) {
      const valueExpr = slotExpr.value;
      if (valueExpr.span.to > trailingEnd) {
        trailing = valueExpr;
        trailingEnd = valueExpr.span.to;
      }
    }
  }

  if (trailing === undefined) return undefined;

  // Check if any modifier appears after the trailing value expression.
  // If so, the value is not the actual last child -- a modifier is -- and
  // infix operators should not be offered after a modifier.
  for (let i = 0; i < actionExpr.modifiers.size(); i++) {
    const modExpr = actionExpr.modifiers.get(i).expr;
    if (modExpr.kind === "modifier" && modExpr.span.to > trailingEnd) {
      return undefined;
    }
  }

  return trailing;
}

/**
 * Determines the output type of an expression, if it can be statically
 * determined from the AST and operator overload table. Returns undefined
 * for expressions whose type cannot be resolved (e.g., unknown operators,
 * error expressions).
 */
function getExprOutputType(
  expr: Expr,
  operatorOverloads?: IOperatorOverloads,
  conversions?: IConversionRegistry
): TypeId | undefined {
  switch (expr.kind) {
    case "literal":
      return expr.tileDef.valueType;
    case "variable":
      return expr.tileDef.varType;
    case "sensor":
      return expr.tileDef.outputType;
    case "actuator":
      return CoreTypeIds.Void;
    case "assignment":
      if (expr.target.kind === "fieldAccess") {
        return expr.target.accessor.fieldTypeId;
      }
      return expr.target.tileDef.varType;
    case "fieldAccess":
      return expr.accessor.fieldTypeId;
    case "binaryOp": {
      if (!operatorOverloads) return undefined;
      const leftType = getExprOutputType(expr.left, operatorOverloads, conversions);
      const rightType = getExprOutputType(expr.right, operatorOverloads, conversions);
      if (!leftType || !rightType) return undefined;
      const resolved = operatorOverloads.resolve(expr.operator.op.id, [leftType, rightType]);
      return resolved?.overload.resultType;
    }
    case "unaryOp": {
      if (!operatorOverloads) return undefined;
      const operandType = getExprOutputType(expr.operand, operatorOverloads, conversions);
      if (!operandType) return undefined;
      const resolved = operatorOverloads.resolve(expr.operator.op.id, [operandType]);
      return resolved?.overload.resultType;
    }
    default:
      return undefined;
  }
}

/**
 * Checks whether an infix operator has any overload that directly accepts
 * the given left operand type. Returns true if an exact LHS match exists,
 * or false if no overload is compatible.
 *
 * Unlike value-tile suggestions, operators do NOT use conversion-based
 * matching. Suggesting `subtract` when the LHS is a String (via
 * String->Number conversion) is confusing -- only operators with a
 * direct overload for the LHS type are offered.
 */
function operatorHasLhsOverload(opDef: BrainTileOperatorDef, leftOperandType: TypeId): boolean {
  const allOverloads = opDef.op.overloads();
  for (let i = 0; i < allOverloads.size(); i++) {
    const overload = allOverloads.get(i);
    const lhsArgType = overload.argTypes[0];
    if (lhsArgType === leftOperandType) return true;
  }
  return false;
}

/**
 * Whether a tile can produce a value in an expression position.
 * Excludes operators (context-dependent), control flow, modifiers,
 * and parameters (action-call only).
 */
function isValueProducingTile(tileDef: IBrainTileDef): boolean {
  switch (tileDef.kind) {
    case "literal":
    case "variable":
    case "sensor":
    case "factory":
    case "page":
      return true;
    default:
      return false;
  }
}

// ---- Replacement Context ----

/**
 * Describes the structural role of a tile being replaced in the AST.
 * Used to determine what tiles are valid replacements.
 */
type ReplacementRole =
  /** Top-level or unknown position -- suggest all placement-compatible tiles. */
  | { kind: "expressionPosition" }
  /** Value-producing position (operand, assignment value, parameter value, etc.). */
  | { kind: "value"; expectedType?: TypeId }
  /** Infix operator position in a binary expression. */
  | { kind: "infixOperator"; leftExpr?: Expr }
  /** Prefix operator position in a unary expression. */
  | { kind: "prefixOperator" }
  /** Parameter, modifier, or anonymous slot tile inside an action call. */
  | { kind: "actionCallArg"; actionExpr: ActuatorExpr | SensorExpr; excludeSlotId?: number }
  /** Accessor tile position in a field access expression. */
  | { kind: "accessorPosition"; structTypeId: TypeId };

/**
 * Whether an expr's span contains the given tile index (half-open interval).
 */
function exprContainsTileIndex(expr: Expr, tileIndex: number): boolean {
  switch (expr.kind) {
    case "empty":
      return false;
    case "errorExpr":
      return expr.span !== undefined && tileIndex >= expr.span.from && tileIndex < expr.span.to;
    default:
      return tileIndex >= expr.span.from && tileIndex < expr.span.to;
  }
}

/**
 * Walks the AST using span information to determine the structural role
 * of the tile at `tileIndex`. This tells us what kinds of tiles are valid
 * replacements for the tile at that position.
 *
 * @param expr - The root expression to walk
 * @param tileIndex - The index of the tile being replaced in the flat tile list
 * @param parentRole - The role assigned by the parent node (passed down recursively)
 */
function findReplacementRole(expr: Expr, tileIndex: number, parentRole: ReplacementRole): ReplacementRole {
  switch (expr.kind) {
    case "empty":
    case "literal":
    case "variable":
    case "modifier":
      // Leaf nodes -- the role is whatever the parent says
      return parentRole;

    case "errorExpr":
      if (expr.expr && exprContainsTileIndex(expr.expr, tileIndex)) {
        return findReplacementRole(expr.expr, tileIndex, parentRole);
      }
      return parentRole;

    case "binaryOp": {
      if (exprContainsTileIndex(expr.left, tileIndex)) {
        return findReplacementRole(expr.left, tileIndex, { kind: "value" });
      }
      if (exprContainsTileIndex(expr.right, tileIndex)) {
        return findReplacementRole(expr.right, tileIndex, { kind: "value" });
      }
      // Tile is the operator itself
      return { kind: "infixOperator", leftExpr: expr.left };
    }

    case "unaryOp": {
      if (exprContainsTileIndex(expr.operand, tileIndex)) {
        return findReplacementRole(expr.operand, tileIndex, { kind: "value" });
      }
      // Tile is the prefix operator itself
      return { kind: "prefixOperator" };
    }

    case "assignment": {
      if (exprContainsTileIndex(expr.target, tileIndex)) {
        return findReplacementRole(expr.target, tileIndex, { kind: "value" });
      }
      if (exprContainsTileIndex(expr.value, tileIndex)) {
        const expectedType =
          expr.target.kind === "fieldAccess" ? expr.target.accessor.fieldTypeId : expr.target.tileDef.varType;
        return findReplacementRole(expr.value, tileIndex, {
          kind: "value",
          expectedType,
        });
      }
      // The = operator tile -- suggest infix operators
      return { kind: "infixOperator", leftExpr: expr.target };
    }

    case "fieldAccess": {
      if (exprContainsTileIndex(expr.object, tileIndex)) {
        return findReplacementRole(expr.object, tileIndex, { kind: "value" });
      }
      // The accessor tile itself -- suggest other accessors for the same struct
      return { kind: "accessorPosition", structTypeId: expr.accessor.structTypeId };
    }

    case "parameter": {
      if (exprContainsTileIndex(expr.value, tileIndex)) {
        return findReplacementRole(expr.value, tileIndex, {
          kind: "value",
          expectedType: expr.tileDef.dataType,
        });
      }
      // The parameter tile itself -- role is determined by the parent (action call arg)
      return parentRole;
    }

    case "actuator":
    case "sensor": {
      // Check anonymous slots
      for (let i = 0; i < expr.anons.size(); i++) {
        const slot = expr.anons.get(i);
        if (exprContainsTileIndex(slot.expr, tileIndex)) {
          // Use actionCallArg role with excludeSlotId, consistent with how
          // parameter and modifier slots are handled. This ensures that
          // suggestActionCallTiles collects expected types from ALL available
          // anonymous slots (including choice siblings), rather than using
          // only the single slot the parser happened to assign. For example,
          // choice(AnonNumber, AnonString) should offer both Number-typed
          // and String-typed tiles as exact matches when replacing either slot.
          return findReplacementRole(slot.expr, tileIndex, {
            kind: "actionCallArg",
            actionExpr: expr,
            excludeSlotId: slot.slotId,
          });
        }
      }
      // Check parameter slots
      for (let i = 0; i < expr.parameters.size(); i++) {
        const slot = expr.parameters.get(i);
        if (exprContainsTileIndex(slot.expr, tileIndex)) {
          return findReplacementRole(slot.expr, tileIndex, {
            kind: "actionCallArg",
            actionExpr: expr,
            excludeSlotId: slot.slotId,
          });
        }
      }
      // Check modifier slots
      for (let i = 0; i < expr.modifiers.size(); i++) {
        const slot = expr.modifiers.get(i);
        if (exprContainsTileIndex(slot.expr, tileIndex)) {
          return findReplacementRole(slot.expr, tileIndex, {
            kind: "actionCallArg",
            actionExpr: expr,
            excludeSlotId: slot.slotId,
          });
        }
      }
      // Tile is the action tile itself -- suggest all expression tiles
      return { kind: "expressionPosition" };
    }
  }
}

// ---- Main API ----

/**
 * Suggests tiles that are valid at a given insertion point.
 *
 * Given an insertion context (rule side, expected type, and optional parsed
 * expression), enumerates tiles from the provided catalogs and returns
 * those that are valid at that position, separated into exact type matches
 * and conversion-based matches.
 *
 * Behavior is derived from the `expr` tree:
 * - **Empty / omitted** -- all placement-compatible tiles (expression position)
 * - **Actuator/sensor with unfilled slots** -- call spec tiles + infix operators if trailing value
 * - **Actuator/sensor with trailing complete value** -- infix operators (extend the value expr)
 * - **Complete actuator** (no unfilled slots, no trailing value) -- nothing (Void return)
 * - **Complete sensor** (no unfilled slots) -- infix operators (produces a value)
 * - **Value expr** (literal, variable, binaryOp, unaryOp, assignment) -- infix operators
 * - **Error expr** -- all tiles (recovery)
 *
 * **Deferred for future work:**
 * - InsideLoop placement flag checking
 *
 * @param context - Describes the insertion point
 * @param catalogs - Tile catalogs to enumerate (e.g., core + game-specific)
 * @returns Grouped suggestions: exact matches and conversion-based matches
 */
export function suggestTiles(context: InsertionContext, catalogs: ReadonlyList<ITileCatalog>): TileSuggestionResult {
  const { conversions, operatorOverloads } = getBrainServices();
  const result: TileSuggestionResult = {
    exact: List.empty(),
    withConversion: List.empty(),
  };

  const expr: Expr = context.expr ?? { nodeId: 0, kind: "empty" };

  // ---- Replacement mode ----
  if (context.replaceTileIndex !== undefined && expr.kind !== "empty") {
    // When the tile being replaced falls outside the AST span (e.g., a close
    // paren that the parser consumed transparently), fall through to append
    // mode so the user sees infix operators and close paren suggestions.
    if (exprContainsTileIndex(expr, context.replaceTileIndex)) {
      const role = findReplacementRole(expr, context.replaceTileIndex, { kind: "expressionPosition" });
      suggestForReplacementRole(role, context, catalogs, conversions, result, operatorOverloads);
      return result;
    }
    // Tile is outside the AST (e.g., a paren) -- fall through to append mode.
  }

  // ---- Append mode (existing behavior) ----
  switch (expr.kind) {
    case "empty":
    case "errorExpr":
      suggestExpressionTiles(context, catalogs, conversions, result);
      break;

    case "actuator":
    case "sensor": {
      const callDef = expr.tileDef.fnEntry.callDef;
      const filledSlotIds = collectFilledSlotIds(expr);
      const availableArgSlots = List.empty<BrainActionArgSlot>();
      collectAvailableArgSlots(
        callDef.callSpec,
        callDef.argSlots,
        filledSlotIds,
        availableArgSlots,
        1,
        callDef.callSpec
      );
      const needsSlots =
        availableArgSlots.size() > 0 || hasParametersNeedingValues(expr) || hasIncompleteAnonValues(expr);

      if (needsSlots) {
        // Slots or parameter values still missing -- suggest call spec tiles
        suggestActionCallTiles(
          expr,
          context.ruleSide,
          catalogs,
          conversions,
          result,
          undefined,
          context.availableCapabilities
        );
      }

      // If the trailing child is a complete value expression, also offer infix
      // operators so the user can extend it (e.g., [priority] [1] -> [priority] [1] [+] ...).
      // For a complete inline sensor (no arg slots), also offer infix ops -- inline sensors
      // are parsed inside the Pratt expression loop so infix operators can follow them.
      // Non-inline sensors are parsed via parseActionCall which returns directly to parseTop,
      // so infix operators cannot follow them at the top level (they'd start a new expression).
      if (
        trailingValueExpr(expr) !== undefined ||
        (expr.kind === "sensor" && !needsSlots && callDef.argSlots.size() === 0)
      ) {
        const leftExpr = trailingValueExpr(expr) ?? expr;
        const leftType = operatorOverloads ? getExprOutputType(leftExpr, operatorOverloads, conversions) : undefined;
        suggestInfixOperators(context, catalogs, conversions, result, leftType, operatorOverloads, leftExpr);
        suggestCloseParenIfNeeded(context, catalogs, result);
        const trailingForAccessor = trailingPrimaryExpr(leftExpr);
        const acceptedTypes = collectActionCallExpectedTypes(expr, catalogs);
        suggestAccessorTiles(
          context,
          catalogs,
          result,
          getExprOutputType(trailingForAccessor, operatorOverloads, conversions) ??
            getExprOutputType(trailingForAccessor),
          acceptedTypes
        );
      }
      break;
    }

    case "unaryOp": {
      if (expr.operand.kind === "sensor" || expr.operand.kind === "actuator") {
        // The operand is a non-inline sensor/actuator (e.g., [not] [see ...]).
        // Handle similarly to the top-level sensor/actuator case: check for
        // unfilled call spec slots and offer call spec tiles when needed.
        const innerExpr = expr.operand as SensorExpr | ActuatorExpr;
        const callDef = innerExpr.tileDef.fnEntry.callDef;
        const filledSlotIds = collectFilledSlotIds(innerExpr);
        const availableArgSlots = List.empty<BrainActionArgSlot>();
        collectAvailableArgSlots(
          callDef.callSpec,
          callDef.argSlots,
          filledSlotIds,
          availableArgSlots,
          1,
          callDef.callSpec
        );
        const needsSlots =
          availableArgSlots.size() > 0 || hasParametersNeedingValues(innerExpr) || hasIncompleteAnonValues(innerExpr);

        if (needsSlots) {
          suggestActionCallTiles(
            innerExpr,
            context.ruleSide,
            catalogs,
            conversions,
            result,
            undefined,
            context.availableCapabilities
          );
        }

        // If the trailing child is a complete value or the sensor is fully complete
        // with no arg slots, offer infix operators on the whole unaryOp expression.
        if (
          trailingValueExpr(innerExpr) !== undefined ||
          (innerExpr.kind === "sensor" && !needsSlots && callDef.argSlots.size() === 0)
        ) {
          const leftExpr = trailingValueExpr(innerExpr) ?? expr;
          const leftType = operatorOverloads ? getExprOutputType(leftExpr, operatorOverloads, conversions) : undefined;
          suggestInfixOperators(context, catalogs, conversions, result, leftType, operatorOverloads, leftExpr);
          suggestCloseParenIfNeeded(context, catalogs, result);
          const trailingForAccessor = trailingPrimaryExpr(leftExpr);
          const innerAcceptedTypes = collectActionCallExpectedTypes(innerExpr, catalogs);
          suggestAccessorTiles(
            context,
            catalogs,
            result,
            getExprOutputType(trailingForAccessor, operatorOverloads, conversions) ??
              getExprOutputType(trailingForAccessor),
            innerAcceptedTypes
          );
        }
      } else if (isCompleteValueExpr(expr)) {
        const leftType = operatorOverloads ? getExprOutputType(expr, operatorOverloads, conversions) : undefined;
        suggestInfixOperators(context, catalogs, conversions, result, leftType, operatorOverloads, expr);
        suggestCloseParenIfNeeded(context, catalogs, result);
        const trailingExpr = trailingPrimaryExpr(expr);
        suggestAccessorTiles(
          context,
          catalogs,
          result,
          getExprOutputType(trailingExpr, operatorOverloads, conversions) ?? getExprOutputType(trailingExpr),
          trailingPrimaryAcceptedTypes(expr, operatorOverloads, conversions)
        );
      } else {
        // Incomplete unaryOp: operand missing. Allow non-inline sensors since
        // they can now appear as operands of prefix operators (e.g., [not] [see]).
        const expectedType = incompleteExprExpectedType(expr, operatorOverloads, conversions);
        const ctx: InsertionContext = expectedType
          ? { ruleSide: context.ruleSide, expectedType, unclosedParenDepth: context.unclosedParenDepth }
          : context;
        suggestExpressionTiles(ctx, catalogs, conversions, result, true, true);
      }
      break;
    }

    case "literal":
    case "variable":
    case "binaryOp":
    case "assignment":
    case "fieldAccess":
      if (isCompleteValueExpr(expr)) {
        const leftType = operatorOverloads ? getExprOutputType(expr, operatorOverloads, conversions) : undefined;
        suggestInfixOperators(context, catalogs, conversions, result, leftType, operatorOverloads, expr);
        suggestCloseParenIfNeeded(context, catalogs, result);
        const trailingExpr = trailingPrimaryExpr(expr);
        suggestAccessorTiles(
          context,
          catalogs,
          result,
          getExprOutputType(trailingExpr, operatorOverloads, conversions) ?? getExprOutputType(trailingExpr),
          trailingPrimaryAcceptedTypes(expr, operatorOverloads, conversions)
        );
      } else {
        // Incomplete expression (e.g., [1] [+] -- right operand missing, or [$v] [=] -- value needed)
        // Determine expected type from the expression context when possible.
        const expectedType = incompleteExprExpectedType(expr, operatorOverloads, conversions);
        const ctx: InsertionContext = expectedType
          ? { ruleSide: context.ruleSide, expectedType, unclosedParenDepth: context.unclosedParenDepth }
          : context;
        suggestExpressionTiles(ctx, catalogs, conversions, result, true);
      }
      break;

    case "parameter":
    case "modifier":
      // Argument-level nodes, not top-level insertion points
      break;
  }

  return result;
}

// ---- Close Paren ----

/**
 * Suggests the close paren tile when the insertion point is inside unclosed
 * parentheses. Called alongside infix operator suggestions since both
 * indicate the expression at the current position is complete and can be
 * extended (with an operator) or terminated (with a close paren).
 *
 * Does nothing when `context.unclosedParenDepth` is 0 or undefined.
 */
function suggestCloseParenIfNeeded(
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  result: TileSuggestionResult
): void {
  if ((context.unclosedParenDepth ?? 0) <= 0) return;
  const closeParenId = mkControlFlowTileId(CoreControlFlowId.CloseParen);
  for (let ci = 0; ci < catalogs.size(); ci++) {
    const tileDef = catalogs.get(ci).get(closeParenId);
    if (tileDef && isPlacementValid(tileDef, context.ruleSide)) {
      result.exact.push({
        tileDef,
        compatibility: TileCompatibility.Unchecked,
        conversionCost: 0,
      });
      return;
    }
  }
}

// ---- Expression Position ----

/**
 * Suggests tiles for a normal expression position (not inside an action call).
 *
 * When `valueOnly` is true, only value-producing tiles are suggested
 * (actuators are excluded because they return Void). This is used for
 * sub-expression positions like the right operand of a binary op or
 * assignment where a value is required.
 *
 * When `allowNonInlineSensors` is true (only meaningful with `valueOnly`),
 * non-inline sensors are included in suggestions. This is used when the
 * insertion point is the operand of a prefix operator (e.g., [not] _),
 * where non-inline sensors can appear because the parser supports them
 * in expression NUD position.
 */
function suggestExpressionTiles(
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  result: TileSuggestionResult,
  valueOnly = false,
  allowNonInlineSensors = false
): void {
  const seen = new UniqueSet<string>();

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      // Skip hidden tiles
      if (tileDef.hidden) continue;

      // Skip modifier, parameter, and accessor tiles (only valid in specific contexts)
      if (tileDef.kind === "modifier" || tileDef.kind === "parameter" || tileDef.kind === "accessor") continue;

      // Skip close paren -- it is never a valid expression start. Close parens
      // are suggested only through suggestCloseParenIfNeeded when unclosed
      // parens exist and the current expression is complete.
      if (tileDef.kind === "controlFlow" && (tileDef as BrainTileControlFlowDef).cfId === CoreControlFlowId.CloseParen)
        continue;

      // Skip infix operators -- they require a left-hand operand and can never
      // start an expression. Prefix operators are allowed (e.g., [not] [x]).
      if (tileDef.kind === "operator") {
        const opDef = tileDef as BrainTileOperatorDef;
        if (opDef.op.parse.fixity === "infix") continue;

        // When there's a type constraint, filter prefix operators by result type.
        // Only include prefix operators that have at least one overload whose
        // result type exactly matches the expected type. Like infix operators,
        // conversion-based matching is not used -- suggesting [negate] when
        // expecting String would be confusing.
        if (opDef.op.parse.fixity === "prefix" && hasTypeConstraint(context.expectedType)) {
          const allOverloads = opDef.op.overloads();
          let anyMatch = false;
          for (let oi = 0; oi < allOverloads.size(); oi++) {
            if (allOverloads.get(oi).resultType === context.expectedType) {
              anyMatch = true;
              break;
            }
          }
          if (!anyMatch) continue;
        }
      }

      // In value-only mode (sub-expression position), skip non-inline sensors
      // unless explicitly allowed. Non-inline sensors are normally parsed via
      // parseActionCall at the top level, but they can also appear as operands
      // of prefix operators (e.g., [not] [see]). The allowNonInlineSensors flag
      // enables them in those positions.
      // Inside unclosed parentheses, non-inline sensors are always excluded
      // regardless of other flags -- only inline sensors are valid in grouped
      // expressions (parens are parsed via Pratt NUD, not parseActionCall).
      const insideParens = (context.unclosedParenDepth ?? 0) > 0;
      if (((valueOnly && !allowNonInlineSensors) || insideParens) && tileDef.kind === "sensor") {
        if (tileDef.placement === undefined || (tileDef.placement & TilePlacement.Inline) === 0) continue;
      }

      // In value-only mode, skip actuators (they return Void, not a value).
      // Inside unclosed parentheses, actuators are also excluded -- only
      // value-producing expressions are valid inside grouped expressions.
      if ((valueOnly || insideParens) && tileDef.kind === "actuator") continue;

      // Check placement compatibility with rule side
      if (!isPlacementValid(tileDef, context.ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, context.availableCapabilities)) continue;

      // Deduplicate across catalogs
      if (seen.has(tileDef.tileId)) continue;
      seen.add(tileDef.tileId);

      // Determine type compatibility
      const outputType = getTileOutputType(tileDef);
      const typeResult = classifyTypeCompatibility(outputType, context.expectedType, conversions);

      // Not compatible at all -- skip
      if (!typeResult) continue;

      const suggestion: TileSuggestion = {
        tileDef,
        compatibility: typeResult.compatibility,
        conversionCost: typeResult.cost,
      };

      if (typeResult.compatibility === TileCompatibility.Conversion) {
        result.withConversion.push(suggestion);
      } else {
        result.exact.push(suggestion);
      }
    }
  }
}

// ---- Infix Operator Position ----

/**
 * Suggests infix operator tiles that can extend a complete value expression.
 * Only includes operators with `fixity === "infix"` that pass placement checks.
 *
 * When `leftOperandType` and `operatorOverloads` are provided, filters operators
 * to those with at least one overload accepting the left operand type (directly
 * or via conversion). Operators needing LHS conversion go into `withConversion`.
 * When these are not provided, all infix operators are included as `Unchecked`.
 *
 * The assignment operator is excluded unless `leftExpr` is an l-value (variable).
 */
function suggestInfixOperators(
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  result: TileSuggestionResult,
  leftOperandType?: TypeId,
  operatorOverloads?: IOperatorOverloads,
  leftExpr?: Expr
): void {
  const seen = new UniqueSet<string>();
  const canFilter = leftOperandType !== undefined && operatorOverloads !== undefined;
  const lhsIsLValue =
    leftExpr !== undefined &&
    (leftExpr.kind === "variable" ||
      (leftExpr.kind === "fieldAccess" && !(leftExpr as FieldAccessExpr).accessor.readOnly));

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      if (tileDef.hidden) continue;
      if (tileDef.kind !== "operator") continue;

      const opDef = tileDef as BrainTileOperatorDef;
      if (opDef.op.parse.fixity !== "infix") continue;

      // Assignment requires an l-value on the left (variable)
      if (opDef.op.id === CoreOpId.Assign && !lhsIsLValue) continue;

      if (!isPlacementValid(tileDef, context.ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, context.availableCapabilities)) continue;

      if (seen.has(tileDef.tileId)) continue;
      seen.add(tileDef.tileId);

      if (canFilter) {
        if (!operatorHasLhsOverload(opDef, leftOperandType)) continue;

        result.exact.push({
          tileDef,
          compatibility: TileCompatibility.Unchecked,
          conversionCost: 0,
        });
      } else {
        // No overload info -- fall back to Unchecked
        result.exact.push({
          tileDef,
          compatibility: TileCompatibility.Unchecked,
          conversionCost: 0,
        });
      }
    }
  }
}

// ---- Accessor Tile Position ----

/**
 * Suggests accessor tiles that can follow a complete value expression
 * producing a struct type. Only includes accessor tiles whose `structTypeId`
 * matches the output type of the left expression.
 *
 * Accessor tiles bind at maximum precedence (like postfix operators),
 * selecting a named field from the struct value. For example, if the
 * expression [$my_position] produces a struct with field "x" of type
 * Number, this function suggests the accessor tile for "x".
 */
function suggestAccessorTiles(
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  result: TileSuggestionResult,
  leftExprType: TypeId | undefined,
  acceptedFieldTypes?: ReadonlyList<TypeId>
): void {
  if (leftExprType === undefined) return;

  const typeRegistry = getBrainServices().types;
  const typeDef = typeRegistry.get(leftExprType);
  if (!typeDef || typeDef.coreType !== NativeType.Struct) return;

  const conversions = acceptedFieldTypes ? getBrainServices().conversions : undefined;
  const seen = new UniqueSet<string>();

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      if (tileDef.hidden) continue;
      if (tileDef.kind !== "accessor") continue;

      const accessorDef = tileDef as BrainTileAccessorDef;
      if (accessorDef.structTypeId !== leftExprType) continue;

      // When acceptedFieldTypes is provided, only suggest accessors whose
      // output type is compatible with at least one accepted type. This
      // prevents suggesting accessors inside action calls when the resulting
      // type would not be accepted by any remaining slot. An empty list
      // means no value types are needed, so all accessors are filtered out.
      if (acceptedFieldTypes !== undefined && conversions) {
        let fieldAccepted = false;
        for (let ai = 0; ai < acceptedFieldTypes.size(); ai++) {
          const compat = classifyTypeCompatibility(accessorDef.fieldTypeId, acceptedFieldTypes.get(ai), conversions);
          if (compat) {
            fieldAccepted = true;
            break;
          }
        }
        if (!fieldAccepted) continue;
      }

      if (!isPlacementValid(tileDef, context.ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, context.availableCapabilities)) continue;

      if (seen.has(tileDef.tileId)) continue;
      seen.add(tileDef.tileId);

      result.exact.push({
        tileDef,
        compatibility: TileCompatibility.Exact,
        conversionCost: 0,
      });
    }
  }
}

// ---- Prefix Operator Position ----

/**
 * Suggests prefix operator tiles in a value position, where they can start
 * a sub-expression (e.g., [negative] [1]). Only includes operators with
 * `fixity === "prefix"` that pass placement checks and have at least one
 * overload whose result type exactly matches one of the expected types.
 *
 * Like infix operators, conversion-based matching is not used -- suggesting
 * `not` when the context expects String (via Boolean->String conversion)
 * would be confusing.
 */
function suggestPrefixOperatorsForValue(
  ruleSide: RuleSide,
  catalogs: ReadonlyList<ITileCatalog>,
  expectedTypes: ReadonlyList<TypeId>,
  result: TileSuggestionResult,
  availableCapabilities?: ReadonlyBitSet
): void {
  const seen = new UniqueSet<string>();

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      if (tileDef.hidden) continue;
      if (tileDef.kind !== "operator") continue;

      const opDef = tileDef as BrainTileOperatorDef;
      if (opDef.op.parse.fixity !== "prefix") continue;

      if (!isPlacementValid(tileDef, ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, availableCapabilities)) continue;

      if (seen.has(tileDef.tileId)) continue;

      // Check if any overload's result type exactly matches any expected type
      const allOverloads = opDef.op.overloads();
      let matched = false;

      for (let oi = 0; oi < allOverloads.size() && !matched; oi++) {
        const overload = allOverloads.get(oi);
        for (let ei = 0; ei < expectedTypes.size(); ei++) {
          if (overload.resultType === expectedTypes.get(ei)) {
            matched = true;
            break;
          }
        }
      }

      if (!matched) continue;

      seen.add(tileDef.tileId);

      result.exact.push({
        tileDef,
        compatibility: TileCompatibility.Unchecked,
        conversionCost: 0,
      });
    }
  }
}

/**
 * Suggests prefix operator tiles for replacement in a unary expression.
 * Only includes operators with `fixity === "prefix"` that pass placement checks.
 */
function suggestPrefixOperators(
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  result: TileSuggestionResult
): void {
  const seen = new UniqueSet<string>();

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      if (tileDef.hidden) continue;
      if (tileDef.kind !== "operator") continue;

      const opDef = tileDef as BrainTileOperatorDef;
      if (opDef.op.parse.fixity !== "prefix") continue;

      if (!isPlacementValid(tileDef, context.ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, context.availableCapabilities)) continue;

      if (seen.has(tileDef.tileId)) continue;
      seen.add(tileDef.tileId);

      result.exact.push({
        tileDef,
        compatibility: TileCompatibility.Unchecked,
        conversionCost: 0,
      });
    }
  }
}

// ---- Replacement Dispatch ----

/**
 * Routes a replacement role to the appropriate suggestion function.
 */
function suggestForReplacementRole(
  role: ReplacementRole,
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  result: TileSuggestionResult,
  operatorOverloads?: IOperatorOverloads
): void {
  switch (role.kind) {
    case "expressionPosition":
      suggestExpressionTiles(context, catalogs, conversions, result);
      break;

    case "value": {
      const ctx: InsertionContext = {
        ruleSide: context.ruleSide,
        expectedType: role.expectedType ?? context.expectedType,
        availableCapabilities: context.availableCapabilities,
      };
      suggestExpressionTiles(ctx, catalogs, conversions, result);
      break;
    }

    case "infixOperator": {
      const leftType =
        role.leftExpr && operatorOverloads
          ? getExprOutputType(role.leftExpr, operatorOverloads, conversions)
          : undefined;
      suggestInfixOperators(context, catalogs, conversions, result, leftType, operatorOverloads, role.leftExpr);
      suggestCloseParenIfNeeded(context, catalogs, result);
      break;
    }

    case "prefixOperator":
      suggestPrefixOperators(context, catalogs, result);
      break;

    case "actionCallArg":
      suggestActionCallTiles(
        role.actionExpr,
        context.ruleSide,
        catalogs,
        conversions,
        result,
        role.excludeSlotId,
        context.availableCapabilities
      );
      break;

    case "accessorPosition":
      suggestAccessorTiles(context, catalogs, result, role.structTypeId);
      break;
  }
}

// ---- Action Call Position ----

/**
 * Suggests tiles for a position inside an action's argument list.
 *
 * Walks the call spec tree to determine which argument tiles are available,
 * respecting grammar constraints (choice exclusion, repeat cardinality,
 * conditional dependencies). Also identifies anonymous slots needing value
 * expressions and parameters whose value is still incomplete.
 */
function suggestActionCallTiles(
  actionExpr: ActuatorExpr | SensorExpr,
  ruleSide: RuleSide,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  result: TileSuggestionResult,
  excludeSlotId?: number,
  availableCapabilities?: ReadonlyBitSet
): void {
  const callDef = actionExpr.tileDef.fnEntry.callDef;
  const filledSlotIds = collectFilledSlotIds(actionExpr, excludeSlotId);

  // Walk the call spec tree to find available arg slots
  const availableSlots = List.empty<BrainActionArgSlot>();
  collectAvailableArgSlots(callDef.callSpec, callDef.argSlots, filledSlotIds, availableSlots, 1, callDef.callSpec);

  // Check whether a value is pending (parameter needing a value or incomplete anon).
  // When a value is pending, only value expressions should be suggested -- named
  // parameter/modifier tiles are suppressed because the user must complete the
  // current parameter or anonymous value expression first.
  const valuePending =
    hasParametersNeedingValues(actionExpr, excludeSlotId) ||
    hasIncompleteAnonValues(actionExpr) ||
    hasStructValuePendingAccessor(actionExpr, catalogs, excludeSlotId);

  // Collect expected types from available anonymous slots and suggest named tiles
  const valueExpectedTypes = List.empty<TypeId>();

  for (let i = 0; i < availableSlots.size(); i++) {
    const slot = availableSlots.get(i);

    // Resolve the tile referenced by this slot
    const argTileDef = findTileInCatalogs(slot.argSpec.tileId, catalogs);
    if (!argTileDef) continue;

    if (slot.argSpec.anonymous) {
      // Anonymous slot: collect expected type for expression suggestions
      if (argTileDef.kind === "parameter") {
        valueExpectedTypes.push((argTileDef as BrainTileParameterDef).dataType);
      }
    } else if (!valuePending) {
      // Named parameter or modifier tile: suggest it directly, but only when
      // no parameter/anonymous value is pending completion.
      // Also check capability requirements.
      if (!areRequirementsMet(argTileDef, availableCapabilities)) continue;
      result.exact.push({
        tileDef: argTileDef,
        compatibility: TileCompatibility.Exact,
        conversionCost: 0,
      });
    }
  }

  // Also collect expected types from filled parameters whose value is still missing
  for (let i = 0; i < actionExpr.parameters.size(); i++) {
    if (actionExpr.parameters.get(i).slotId === excludeSlotId) continue;
    const slotExpr = actionExpr.parameters.get(i).expr;
    if (slotExpr.kind === "parameter" && isParameterValueMissing(slotExpr.value)) {
      valueExpectedTypes.push(slotExpr.tileDef.dataType);
    }
  }

  // Also collect expected types from filled anonymous slots with incomplete values
  // (e.g., [say] ["hi"] [+] -- the binaryOp needs a right operand)
  for (let i = 0; i < actionExpr.anons.size(); i++) {
    const anonExpr = actionExpr.anons.get(i).expr;
    if (anonExpr.kind !== "empty" && anonExpr.kind !== "errorExpr" && !isCompleteValueExpr(anonExpr)) {
      const slotId = actionExpr.anons.get(i).slotId;
      for (let j = 0; j < callDef.argSlots.size(); j++) {
        if (callDef.argSlots.get(j).slotId === slotId) {
          const argTileDef = findTileInCatalogs(callDef.argSlots.get(j).argSpec.tileId, catalogs);
          if (argTileDef && argTileDef.kind === "parameter") {
            valueExpectedTypes.push((argTileDef as BrainTileParameterDef).dataType);
          }
          break;
        }
      }
    }
  }

  // Suggest expression tiles matching the expected types
  if (valueExpectedTypes.size() > 0) {
    suggestExpressionsForAnonymousSlots(
      valueExpectedTypes,
      ruleSide,
      catalogs,
      conversions,
      result,
      availableCapabilities
    );
    // Prefix operators can start value sub-expressions (e.g., [negative] [1]).
    suggestPrefixOperatorsForValue(ruleSide, catalogs, valueExpectedTypes, result, availableCapabilities);
  }
}

/**
 * Suggests expression tiles that match one or more expected types from
 * anonymous action call slots. A tile is suggested if it matches any of
 * the expected types (exact or via conversion). The best compatibility
 * across all types is used for the suggestion.
 */
function suggestExpressionsForAnonymousSlots(
  expectedTypes: ReadonlyList<TypeId>,
  ruleSide: RuleSide,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  result: TileSuggestionResult,
  availableCapabilities?: ReadonlyBitSet
): void {
  const seen = new UniqueSet<string>();

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      // Skip hidden tiles
      if (tileDef.hidden) continue;

      // Only value-producing expression tiles
      if (!isValueProducingTile(tileDef)) continue;

      // Skip non-inline sensors -- action call anonymous slots are sub-expression
      // positions where only inline sensors are valid (parsed via Pratt NUD handler).
      if (tileDef.kind === "sensor") {
        if (tileDef.placement === undefined || (tileDef.placement & TilePlacement.Inline) === 0) continue;
      }

      // Check placement
      if (!isPlacementValid(tileDef, ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, availableCapabilities)) continue;

      // Deduplicate
      if (seen.has(tileDef.tileId)) continue;

      const outputType = getTileOutputType(tileDef);
      if (!outputType || outputType === CoreTypeIds.Unknown) continue;

      // Check against each expected type, find best match
      let bestCompatibility: TileCompatibility | undefined;
      let bestCost = 0;

      for (let ei = 0; ei < expectedTypes.size(); ei++) {
        const typeResult = classifyTypeCompatibility(outputType, expectedTypes.get(ei), conversions);
        if (!typeResult) continue;

        if (typeResult.compatibility === TileCompatibility.Exact) {
          bestCompatibility = TileCompatibility.Exact;
          bestCost = 0;
          break; // Can't do better than exact
        }

        if (
          typeResult.compatibility === TileCompatibility.Conversion &&
          (bestCompatibility === undefined || typeResult.cost < bestCost)
        ) {
          bestCompatibility = TileCompatibility.Conversion;
          bestCost = typeResult.cost;
        }
      }

      if (bestCompatibility === undefined) continue;

      seen.add(tileDef.tileId);

      const suggestion: TileSuggestion = {
        tileDef,
        compatibility: bestCompatibility,
        conversionCost: bestCost,
      };

      if (bestCompatibility === TileCompatibility.Conversion) {
        result.withConversion.push(suggestion);
      } else {
        result.exact.push(suggestion);
      }
    }
  }
}

/**
 * Parses a tile list and returns the first expression, or an EmptyExpr
 * if the list is empty. This is a convenience for building InsertionContext.expr
 * from the raw tile list on a rule side.
 */
export function parseTilesForSuggestions(tiles: ReadonlyList<IBrainTileDef>): Expr {
  if (tiles.size() === 0) return { nodeId: 0, kind: "empty" };
  const result = parseBrainTiles(tiles);
  if (result.exprs.size() === 0) return { nodeId: 0, kind: "empty" };
  return result.exprs.get(0);
}

/**
 * Counts the number of unmatched open parentheses in a tile sequence.
 * Returns 0 when all parens are balanced. Use this to populate
 * `InsertionContext.unclosedParenDepth` so the suggestion system knows
 * to offer the close paren tile and restrict non-inline sensors and
 * actuators inside grouped expressions.
 *
 * @param excludeIndex - Optional tile index to skip when counting. Use this
 *   in replacement mode so the tile being replaced is not counted.
 */
export function countUnclosedParens(tiles: ReadonlyList<IBrainTileDef>, excludeIndex?: number): number {
  let depth = 0;
  for (let i = 0; i < tiles.size(); i++) {
    if (i === excludeIndex) continue;
    const tile = tiles.get(i);
    if (tile.kind === "controlFlow") {
      const cfId = (tile as BrainTileControlFlowDef).cfId;
      if (cfId === CoreControlFlowId.OpenParen) depth++;
      else if (cfId === CoreControlFlowId.CloseParen && depth > 0) depth--;
    }
  }
  return depth;
}
