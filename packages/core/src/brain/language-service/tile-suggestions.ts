import { List, type ReadonlyList } from "../../platform/list";
import { UniqueSet } from "../../platform/uniqueset";
import {
  type BrainActionArgSlot,
  type BrainActionCallArgSpec,
  type BrainActionCallSpec,
  CoreOpId,
  CoreTypeIds,
  type IConversionRegistry,
  type IOperatorOverloads,
  type ITypeRegistry,
  NativeType,
  type StructTypeDef,
  type TypeId,
} from "../../runtime";
import { BitSet, type ReadonlyBitSet } from "../../util/bitset";
import { isLValue, isLValueTile } from "../compiler/lvalue";
import {
  collectProvidedCapabilities,
  collectProvidedOutputKeys,
  parseBrainTiles,
  whenResultConsumerEligible,
} from "../compiler/parser";
import type { ActuatorExpr, Expr, SensorExpr, Span } from "../compiler/types";
import {
  CoreControlFlowId,
  type IBrainRuleDef,
  type IBrainTileDef,
  type ITileCatalog,
  isInlineTileDef,
  mkControlFlowTileId,
  RuleSide,
  type TileId,
} from "../interfaces";
import type { BrainServices } from "../services";
import type { BrainTileAccessorDef } from "../tiles/accessors";
import { BrainTileActuatorDef } from "../tiles/actuators";
import type { BrainTileControlFlowDef } from "../tiles/controlflow";
import type { BrainTileFactoryDef } from "../tiles/factories";
import type { BrainTileLiteralDef } from "../tiles/literals";
import type { BrainTileOperatorDef } from "../tiles/operators";
import type { BrainTileOutputDef } from "../tiles/outputs";
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
   * - `sensor` with trailing complete value, or fully complete and inline -> infix
   *   operators + remaining call spec tiles
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
   * precede the insertion point. A tile with non-empty `requirements()` is
   * offered only when this is present and covers every required bit; when
   * undefined, no requirements-bearing tile is offered (fail closed). Tiles
   * with empty requirements are unaffected.
   */
  availableCapabilities?: ReadonlyBitSet;
  /**
   * The output identity keys (see `mkOutputVarKey`) provided by sensors in the
   * current rule hierarchy. An output tile is offered only when this is present
   * and contains its `outputKey`; when undefined, no output tile is offered
   * (fail closed).
   */
  availableOutputKeys?: UniqueSet<string>;
  /**
   * Number of unmatched open parentheses preceding the insertion point.
   * When > 0, the close paren tile is suggested after complete expressions
   * and non-inline sensors and actuators are excluded (only inline sensors
   * and value-producing tiles are valid inside grouped expressions).
   */
  unclosedParenDepth?: number;
  /**
   * The rule whose side is being edited. Supplies the WHEN-result type available
   * at this insertion point (see `getRuleWhenResultType`), which gates tiles that
   * declare `consumesWhenResult()`: on the DO side the rule's own WHEN result, on
   * the WHEN side the ancestor's. When undefined, no WHEN result is available and
   * WHEN-result-consuming tiles are not offered.
   */
  ruleDef?: IBrainRuleDef;
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
    case "output":
      return (tileDef as BrainTileOutputDef).outputType;
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
 * Checks if a tile is admissible given the rule hierarchy's available
 * capabilities and provided output identities. Requirements-bearing tiles are
 * fail-closed: a tile with non-empty `requirements()` passes only when
 * `availableCapabilities` is present and covers every required bit. Output
 * tiles are fail-closed: an output tile passes only when `availableOutputKeys`
 * is present and contains its `outputKey` (a declaring sensor is in scope).
 */
function areRequirementsMet(
  tileDef: IBrainTileDef,
  availableCapabilities: ReadonlyBitSet | undefined,
  availableOutputKeys: UniqueSet<string> | undefined
): boolean {
  const requirements = tileDef.requirements();
  if (!requirements.isEmpty()) {
    if (availableCapabilities === undefined) return false;
    const msb = requirements.msb();
    for (let i = 0; i <= msb; i++) {
      if (requirements.get(i) === 1 && availableCapabilities.get(i) === 0) return false;
    }
  }
  if (tileDef.kind === "output") {
    if (availableOutputKeys === undefined) return false;
    if (!availableOutputKeys.has((tileDef as BrainTileOutputDef).outputKey)) return false;
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
  conversions: IConversionRegistry,
  types: ITypeRegistry
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
  const fieldResult = structFieldTypeCompatibility(outputType, expectedType!, conversions, types);
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
  conversions: IConversionRegistry,
  types: ITypeRegistry
): { compatibility: TileCompatibility; cost: number } | undefined {
  const typeDef = types.get(structTypeId);
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
 * Classifies a tile's output type against an expected type without consulting
 * the conversion registry. An exact match is Exact; a struct output with a
 * field of exactly the expected type is Conversion with cost 1 (one accessor
 * step refines the value); anything else is incompatible. No constraint or an
 * unknown output type is Unchecked.
 */
function classifyExactOrFieldCompatibility(
  outputType: TypeId | undefined,
  expectedType: TypeId | undefined,
  types: ITypeRegistry
): { compatibility: TileCompatibility; cost: number } | undefined {
  if (!hasTypeConstraint(expectedType) || !outputType || outputType === CoreTypeIds.Unknown) {
    return { compatibility: TileCompatibility.Unchecked, cost: 0 };
  }
  if (outputType === expectedType) {
    return { compatibility: TileCompatibility.Exact, cost: 0 };
  }
  if (structHasExactField(outputType, expectedType!, types)) {
    return { compatibility: TileCompatibility.Conversion, cost: 1 };
  }
  return undefined;
}

/** True when `structTypeId` is a struct type with a field of exactly `fieldType`. */
function structHasExactField(structTypeId: TypeId, fieldType: TypeId, types: ITypeRegistry): boolean {
  const typeDef = types.get(structTypeId);
  if (!typeDef || typeDef.coreType !== NativeType.Struct) return false;
  const fields = (typeDef as StructTypeDef).fields;
  for (let i = 0; i < fields.size(); i++) {
    if (fields.get(i).typeId === fieldType) return true;
  }
  return false;
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
 * Finds the BrainActionArgSlot for an arg node of the call spec tree. Slots
 * are matched by spec-node identity: several arg nodes in one call spec may
 * reference the same arg tile (e.g. two anonymous Number params), and each
 * has its own slot.
 */
function findArgSlotBySpec(
  spec: BrainActionCallArgSpec,
  argSlots: ReadonlyList<BrainActionArgSlot>
): BrainActionArgSlot | undefined {
  for (let i = 0; i < argSlots.size(); i++) {
    if (argSlots.get(i).argSpec === spec) return argSlots.get(i);
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
      const slot = findArgSlotBySpec(spec, argSlots);
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
 * Whether the call spec still requires an argument that has no fill,
 * mirroring the parser's required-argument semantics: `optional` items are
 * never required, an `arg` with `required: false` may stay unfilled, a
 * `repeat` requires a fill only when its `min` is positive, a `choice`
 * requires a fill in one of its options (and its filled option must itself
 * be satisfied), and a `conditional` applies only to its active branch.
 *
 * @param rootSpec The root call spec, used for conditional condition lookup.
 */
function hasUnfilledRequiredArg(
  spec: BrainActionCallSpec,
  argSlots: ReadonlyList<BrainActionArgSlot>,
  filledSlotIds: ReadonlyList<number>,
  rootSpec: BrainActionCallSpec
): boolean {
  switch (spec.type) {
    case "arg": {
      if (spec.required === false) return false;
      const slot = findArgSlotBySpec(spec, argSlots);
      return slot !== undefined && !isSlotFilled(slot.slotId, filledSlotIds);
    }
    case "seq":
    case "bag":
      for (const item of spec.items) {
        if (hasUnfilledRequiredArg(item, argSlots, filledSlotIds, rootSpec)) return true;
      }
      return false;
    case "optional":
      return false;
    case "repeat":
      return (spec.min ?? 0) > 0 && !specHasAnyFill(spec.item, argSlots, filledSlotIds);
    case "choice": {
      for (const option of spec.options) {
        if (specHasAnyFill(option, argSlots, filledSlotIds)) {
          return hasUnfilledRequiredArg(option, argSlots, filledSlotIds, rootSpec);
        }
      }
      return true;
    }
    case "conditional": {
      const condSpec = findNamedSpec(rootSpec, spec.condition);
      const conditionMet = condSpec !== undefined && specHasAnyFill(condSpec, argSlots, filledSlotIds);
      if (conditionMet) return hasUnfilledRequiredArg(spec.then, argSlots, filledSlotIds, rootSpec);
      return spec.else !== undefined && hasUnfilledRequiredArg(spec.else, argSlots, filledSlotIds, rootSpec);
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
      const slot = findArgSlotBySpec(spec, argSlots);
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
function hasIncompleteAnonValues(actionExpr: ActuatorExpr | SensorExpr, excludeSlotId?: number): boolean {
  for (let i = 0; i < actionExpr.anons.size(); i++) {
    if (actionExpr.anons.get(i).slotId === excludeSlotId) continue;
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
  types: ITypeRegistry,
  excludeSlotId?: number
): boolean {
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
  const callDef = actionExpr.tileDef.action.callDef;
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
  catalogs: ReadonlyList<ITileCatalog>,
  types: ITypeRegistry
): List<TypeId> {
  const callDef = actionExpr.tileDef.action.callDef;
  const filledSlotIds = collectFilledSlotIds(actionExpr);
  const availableSlots = List.empty<BrainActionArgSlot>();
  collectAvailableArgSlots(callDef.callSpec, callDef.argSlots, filledSlotIds, availableSlots, 1, callDef.callSpec);

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

    // The types the slot accepts: its own parameter type, plus every sibling
    // anonymous option's type when the slot belongs to a choice group (the
    // compiler settles a choice fill against the whole option set).
    const slotAcceptedTypes = List.empty<TypeId>();
    for (let j = 0; j < callDef.argSlots.size(); j++) {
      if (callDef.argSlots.get(j).slotId === slotId) {
        const slotDef = callDef.argSlots.get(j);
        const argTileDef = findTileInCatalogs(slotDef.argSpec.tileId, catalogs);
        if (argTileDef && argTileDef.kind === "parameter") {
          slotAcceptedTypes.push((argTileDef as BrainTileParameterDef).dataType);
        }
        if (slotDef.choiceGroup !== undefined) {
          for (let k = 0; k < callDef.argSlots.size(); k++) {
            const sibling = callDef.argSlots.get(k);
            if (sibling.choiceGroup !== slotDef.choiceGroup || sibling.slotId === slotId) continue;
            if (!sibling.argSpec.anonymous) continue;
            const siblingTileDef = findTileInCatalogs(sibling.argSpec.tileId, catalogs);
            if (siblingTileDef && siblingTileDef.kind === "parameter") {
              slotAcceptedTypes.push((siblingTileDef as BrainTileParameterDef).dataType);
            }
          }
        }
        break;
      }
    }
    if (slotAcceptedTypes.size() === 0) continue;

    // Incomplete value -- user is building an expression
    if (anonExpr.kind !== "empty" && anonExpr.kind !== "errorExpr" && !isCompleteValueExpr(anonExpr)) {
      expectedTypes.push(...slotAcceptedTypes.toArray());
      continue;
    }

    // Struct-pending-accessor: complete value whose type is a struct that
    // doesn't match any accepted type -- user needs to apply accessor tiles.
    if (isCompleteValueExpr(anonExpr)) {
      const outputType = getExprOutputType(anonExpr);
      if (outputType !== undefined && !slotAcceptedTypes.contains(outputType)) {
        const typeDef = types.get(outputType);
        if (typeDef && typeDef.coreType === NativeType.Struct) {
          expectedTypes.push(...slotAcceptedTypes.toArray());
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
    case "output":
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
              // Binary operators always have 2 argTypes; match on LHS type.
              // Skip Nil-typed RHS overloads -- nil is not a tile-selectable type
              // and should not cause ambiguity in expected-type inference.
              if (overload.argTypes[0] === leftType && overload.argTypes[1] !== undefined) {
                const rhs = overload.argTypes[1];
                if (rhs === CoreTypeIds.Nil) continue;
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
 * The complete slot value of an action call that ends exactly at
 * `tileIndex`: the value an infix operator placed at that index would
 * extend. Searches anonymous slot values and parameter values; returns
 * undefined when no complete value ends there.
 */
function slotValueEndingAt(actionExpr: ActuatorExpr | SensorExpr, tileIndex: number): Expr | undefined {
  for (let i = 0; i < actionExpr.anons.size(); i++) {
    const slotExpr = actionExpr.anons.get(i).expr;
    if (isCompleteValueExpr(slotExpr) && slotExpr.span.to === tileIndex) return slotExpr;
  }
  for (let i = 0; i < actionExpr.parameters.size(); i++) {
    const slotExpr = actionExpr.parameters.get(i).expr;
    if (slotExpr.kind === "parameter" && isCompleteValueExpr(slotExpr.value) && slotExpr.value.span.to === tileIndex) {
      return slotExpr.value;
    }
  }
  return undefined;
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
    case "output":
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
 * Checks whether an operator has any overload that directly accepts the
 * given type as its first operand (the left operand of an infix operator,
 * or the single operand of a prefix operator). Returns true if an exact
 * match exists, or false if no overload is compatible.
 *
 * Unlike value-tile suggestions, operators do NOT use conversion-based
 * matching. Suggesting `subtract` when the LHS is a String (via
 * String->Number conversion) is confusing -- only operators with a
 * direct overload for the operand type are offered.
 */
function operatorHasFirstOperandOverload(opDef: BrainTileOperatorDef, operandType: TypeId): boolean {
  const allOverloads = opDef.op.overloads();
  for (let i = 0; i < allOverloads.size(); i++) {
    const overload = allOverloads.get(i);
    const firstArgType = overload.argTypes[0];
    if (firstArgType === operandType) return true;
  }
  return false;
}

/**
 * Computes the effective left operand type for a candidate infix operator,
 * accounting for precedence-based rebinding in the Pratt parser.
 *
 * When the current expression is a completed binaryOp (e.g., `[a] [>] [b]`)
 * and the candidate operator has higher precedence than the outermost operator,
 * the parser would rebind the candidate with the right operand rather than the
 * whole expression. For example, placing `[*]` after `[a] [>] [b]` produces
 * `[a] [>] ([b] [*] ...)` because `*` (precedence 20) binds tighter than `>`
 * (precedence 5). In this case the effective LHS for `*` is `[b]` (Number),
 * not the whole `[a] [>] [b]` (Boolean).
 *
 * Walks nested binaryOp right operands recursively to handle chains like
 * `[a] [>] [b] [+] [c]` where `*` (prec 20 > `+` prec 10) rebinds with `[c]`.
 */
function effectiveLhsType(
  expr: Expr,
  candidatePrecedence: number,
  operatorOverloads: IOperatorOverloads,
  conversions: IConversionRegistry
): TypeId | undefined {
  if (expr.kind === "binaryOp") {
    const outerPrec = expr.operator.op.parse.precedence;
    if (candidatePrecedence > outerPrec) {
      return effectiveLhsType(expr.right, candidatePrecedence, operatorOverloads, conversions);
    }
  }
  return getExprOutputType(expr, operatorOverloads, conversions);
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
    case "output":
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
 * The constraint a value replacement position imposes on candidate tiles,
 * derived from the enclosing AST node. A `value` role without a constraint
 * offers all value-producing tiles unchecked.
 */
type ValueConstraint =
  /** A single expected type; convertible and struct-field matches are offered. */
  | { kind: "typed"; expectedType: TypeId }
  /**
   * Operand of an operator. `types` are the operand types the operator's
   * overloads accept at this position, narrowed by the other operand's type
   * when it is known. The compiler applies operand conversions (binary and
   * unary alike), so convertible and struct-field matches are offered.
   */
  | { kind: "operand"; types: ReadonlyList<TypeId> }
  /**
   * Target of an assignment, or the base chain of a field-access target.
   * Only l-value tiles are valid here (see `isLValueTile`). When `valueType`
   * is known the tile must match it exactly, be reachable from it through a
   * registered conversion (assignment converts the value into the target's
   * type), or reach it through a single exact-typed field accessor step on
   * either side. An undefined `valueType` leaves the type unchecked.
   */
  | { kind: "assignTarget"; valueType?: TypeId }
  /**
   * Base of a field-access chain outside an assignment target. Value tiles
   * are not type-restricted (the field read re-applies to the new base), but
   * a prefix operator placed here receives the chain's field value as its
   * operand and must accept `fieldType`.
   */
  | { kind: "accessorBase"; fieldType: TypeId };

/**
 * Describes the structural role of a tile being replaced in the AST.
 * Used to determine what tiles are valid replacements.
 */
type ReplacementRole =
  /** Top-level or unknown position -- suggest all placement-compatible tiles. */
  | { kind: "expressionPosition" }
  /** Value-producing position (operand, assignment value, parameter value, etc.). */
  | { kind: "value"; constraint?: ValueConstraint }
  /** Infix operator position in a binary expression or assignment. */
  | { kind: "infixOperator"; leftExpr?: Expr; rightExpr?: Expr }
  /** Prefix operator position in a unary expression. */
  | { kind: "prefixOperator"; operandExpr?: Expr }
  /** Parameter, modifier, or anonymous slot tile inside an action call. */
  | { kind: "actionCallArg"; actionExpr: ActuatorExpr | SensorExpr; excludeSlotId?: number }
  /** Accessor tile position in a field access expression. */
  | { kind: "accessorPosition"; structTypeId: TypeId };

/**
 * Builds the operand constraint for one side of an operator from its
 * registered overloads: the set of types the overloads accept at
 * `operandIndex`. When `otherType` is known, only overloads whose other
 * operand accepts it (exactly or via conversion) contribute. Returns
 * undefined when no overload survives, leaving the position unconstrained.
 */
function operandConstraint(
  operator: BrainTileOperatorDef,
  operandIndex: number,
  otherType: TypeId | undefined,
  conversions: IConversionRegistry
): ValueConstraint | undefined {
  const overloads = operator.op.overloads();
  const operandTypes = List.empty<TypeId>();
  for (let i = 0; i < overloads.size(); i++) {
    const overload = overloads.get(i);
    const ownType = overload.argTypes[operandIndex];
    if (ownType === undefined) continue;
    if (otherType !== undefined) {
      const otherSideType = overload.argTypes[1 - operandIndex];
      if (otherSideType === undefined) continue;
      if (otherSideType !== otherType) {
        const path = conversions.findBestPath(otherType, otherSideType);
        if (path === undefined || path.size() === 0) continue;
      }
    }
    let alreadyIncluded = false;
    for (let j = 0; j < operandTypes.size(); j++) {
      if (operandTypes.get(j) === ownType) {
        alreadyIncluded = true;
        break;
      }
    }
    if (!alreadyIncluded) operandTypes.push(ownType);
  }
  if (operandTypes.size() === 0) return undefined;
  return { kind: "operand", types: operandTypes.asReadonly() };
}

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
 * replacements for the tile at that position. Value positions carry the
 * constraint the enclosing node imposes (see `ValueConstraint`).
 *
 * @param expr - The root expression to walk
 * @param tileIndex - The index of the tile being replaced in the flat tile list
 * @param parentRole - The role assigned by the parent node (passed down recursively)
 * @param operatorOverloads - Overload table used to type operands and derive constraints
 * @param conversions - Conversion registry used when narrowing operator overloads
 */
function findReplacementRole(
  expr: Expr,
  tileIndex: number,
  parentRole: ReplacementRole,
  operatorOverloads: IOperatorOverloads,
  conversions: IConversionRegistry
): ReplacementRole {
  switch (expr.kind) {
    case "empty":
    case "literal":
    case "variable":
    case "output":
    case "modifier":
      // Leaf nodes -- the role is whatever the parent says
      return parentRole;

    case "errorExpr":
      if (expr.expr && exprContainsTileIndex(expr.expr, tileIndex)) {
        return findReplacementRole(expr.expr, tileIndex, parentRole, operatorOverloads, conversions);
      }
      return parentRole;

    case "binaryOp": {
      if (exprContainsTileIndex(expr.left, tileIndex)) {
        const rightType = getExprOutputType(expr.right, operatorOverloads, conversions);
        return findReplacementRole(
          expr.left,
          tileIndex,
          { kind: "value", constraint: operandConstraint(expr.operator, 0, rightType, conversions) },
          operatorOverloads,
          conversions
        );
      }
      if (exprContainsTileIndex(expr.right, tileIndex)) {
        const leftType = getExprOutputType(expr.left, operatorOverloads, conversions);
        return findReplacementRole(
          expr.right,
          tileIndex,
          { kind: "value", constraint: operandConstraint(expr.operator, 1, leftType, conversions) },
          operatorOverloads,
          conversions
        );
      }
      // Tile is the operator itself
      return { kind: "infixOperator", leftExpr: expr.left, rightExpr: expr.right };
    }

    case "unaryOp": {
      if (exprContainsTileIndex(expr.operand, tileIndex)) {
        return findReplacementRole(
          expr.operand,
          tileIndex,
          { kind: "value", constraint: operandConstraint(expr.operator, 0, undefined, conversions) },
          operatorOverloads,
          conversions
        );
      }
      // Tile is the prefix operator itself
      return { kind: "prefixOperator", operandExpr: expr.operand };
    }

    case "assignment": {
      if (exprContainsTileIndex(expr.target, tileIndex)) {
        return findReplacementRole(
          expr.target,
          tileIndex,
          {
            kind: "value",
            constraint: {
              kind: "assignTarget",
              valueType: getExprOutputType(expr.value, operatorOverloads, conversions),
            },
          },
          operatorOverloads,
          conversions
        );
      }
      if (exprContainsTileIndex(expr.value, tileIndex)) {
        const expectedType =
          expr.target.kind === "fieldAccess" ? expr.target.accessor.fieldTypeId : expr.target.tileDef.varType;
        return findReplacementRole(
          expr.value,
          tileIndex,
          { kind: "value", constraint: { kind: "typed", expectedType } },
          operatorOverloads,
          conversions
        );
      }
      // The = operator tile -- suggest infix operators
      return { kind: "infixOperator", leftExpr: expr.target, rightExpr: expr.value };
    }

    case "fieldAccess": {
      if (exprContainsTileIndex(expr.object, tileIndex)) {
        // The base keeps an assignment-target requirement from the parent
        // (a writable field on a read-only base is not writable), and a
        // nested chain keeps the outermost accessor's field type -- that is
        // the type the whole chain produces.
        let constraint: ValueConstraint;
        if (parentRole.kind === "value" && parentRole.constraint?.kind === "assignTarget") {
          constraint = { kind: "assignTarget" };
        } else if (parentRole.kind === "value" && parentRole.constraint?.kind === "accessorBase") {
          constraint = parentRole.constraint;
        } else {
          constraint = { kind: "accessorBase", fieldType: expr.accessor.fieldTypeId };
        }
        return findReplacementRole(
          expr.object,
          tileIndex,
          { kind: "value", constraint },
          operatorOverloads,
          conversions
        );
      }
      // The accessor tile itself -- suggest other accessors for the same struct
      return { kind: "accessorPosition", structTypeId: expr.accessor.structTypeId };
    }

    case "parameter": {
      if (exprContainsTileIndex(expr.value, tileIndex)) {
        return findReplacementRole(
          expr.value,
          tileIndex,
          { kind: "value", constraint: { kind: "typed", expectedType: expr.tileDef.dataType } },
          operatorOverloads,
          conversions
        );
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
          return findReplacementRole(
            slot.expr,
            tileIndex,
            { kind: "actionCallArg", actionExpr: expr, excludeSlotId: slot.slotId },
            operatorOverloads,
            conversions
          );
        }
      }
      // Check parameter slots
      for (let i = 0; i < expr.parameters.size(); i++) {
        const slot = expr.parameters.get(i);
        if (exprContainsTileIndex(slot.expr, tileIndex)) {
          return findReplacementRole(
            slot.expr,
            tileIndex,
            { kind: "actionCallArg", actionExpr: expr, excludeSlotId: slot.slotId },
            operatorOverloads,
            conversions
          );
        }
      }
      // Check modifier slots
      for (let i = 0; i < expr.modifiers.size(); i++) {
        const slot = expr.modifiers.get(i);
        if (exprContainsTileIndex(slot.expr, tileIndex)) {
          return findReplacementRole(
            slot.expr,
            tileIndex,
            { kind: "actionCallArg", actionExpr: expr, excludeSlotId: slot.slotId },
            operatorOverloads,
            conversions
          );
        }
      }
      // If the tile is at the action tile's own position, the user is
      // replacing the actuator/sensor itself. Use the parent role so
      // that when this sensor/actuator is nested inside another action
      // call's slot, suggestions are constrained to that slot's context
      // (e.g., value-producing tiles) rather than offering all tiles.
      if (tileIndex === expr.span.from) {
        return parentRole;
      }
      // The tile is inside the action call span but not in any child AST
      // node. This happens with transparent control flow tokens (like
      // parentheses) consumed during expression parsing for a slot
      // (e.g., [say] [(] -- the open paren is consumed as part of the
      // anonymous value but is not reflected in the resulting expression
      // span). Find the owning slot by positional proximity so the
      // replacement offers call spec tiles rather than actuators.
      return {
        kind: "actionCallArg",
        actionExpr: expr,
        excludeSlotId: findOwningSlotId(expr, tileIndex),
      };
    }
  }
}

/**
 * Finds the slot that "owns" a transparent tile (e.g., a parenthesis) inside
 * an action call. The tile was consumed during expression parsing for a slot
 * but falls outside the resulting expression's AST span.
 *
 * Uses positional proximity: prefers a slot whose span starts just after the
 * tile (open paren consumed before the inner expression), then falls back to
 * a slot whose span ends at or before the tile (close paren consumed after
 * the inner expression).
 *
 * Returns the owning slot's ID, or undefined if none can be determined.
 */
function findOwningSlotId(actionExpr: ActuatorExpr | SensorExpr, tileIndex: number): number | undefined {
  let bestBeforeId: number | undefined;
  let bestBeforeDist: number | undefined;
  let bestAfterId: number | undefined;
  let bestAfterDist: number | undefined;

  const checkSlot = (span: Span, slotId: number) => {
    if (span.from > tileIndex) {
      // Tile is before the slot's expression (open paren scenario)
      const dist = span.from - tileIndex;
      if (bestBeforeDist === undefined || dist < bestBeforeDist) {
        bestBeforeDist = dist;
        bestBeforeId = slotId;
      }
    } else if (tileIndex >= span.to) {
      // Tile is after the slot's expression (close paren scenario)
      const dist = tileIndex - span.to;
      if (bestAfterDist === undefined || dist < bestAfterDist) {
        bestAfterDist = dist;
        bestAfterId = slotId;
      }
    }
  };

  for (let i = 0; i < actionExpr.anons.size(); i++) {
    const anonExpr = actionExpr.anons.get(i).expr;
    if (anonExpr.kind !== "empty" && anonExpr.span !== undefined) {
      checkSlot(anonExpr.span, actionExpr.anons.get(i).slotId);
    }
  }
  for (let i = 0; i < actionExpr.parameters.size(); i++) {
    const paramExpr = actionExpr.parameters.get(i).expr;
    if (paramExpr.kind !== "empty" && paramExpr.span !== undefined) {
      checkSlot(paramExpr.span, actionExpr.parameters.get(i).slotId);
    }
  }
  for (let i = 0; i < actionExpr.modifiers.size(); i++) {
    const modExpr = actionExpr.modifiers.get(i).expr;
    if (modExpr.kind !== "empty" && modExpr.span !== undefined) {
      checkSlot(modExpr.span, actionExpr.modifiers.get(i).slotId);
    }
  }

  // Prefer "before slot" (open paren) over "after slot" (close paren)
  return bestBeforeId ?? bestAfterId;
}

// ---- WHEN Result ----

/**
 * The WHEN-result type a parsed WHEN expression produces: the value the
 * runtime captures at WHEN_END for the DO side to consume. A value-bearing
 * event sensor (e.g. `radio receive buffer`) yields its `outputType` and a
 * boolean or composed condition yields `Boolean`. Returns undefined when the
 * expression's type cannot be determined or is not a value (Unknown/Void).
 */
export function whenExprResultType(
  expr: Expr,
  operatorOverloads?: IOperatorOverloads,
  conversions?: IConversionRegistry
): TypeId | undefined {
  const outputType = getExprOutputType(expr, operatorOverloads, conversions);
  if (outputType === undefined || outputType === CoreTypeIds.Unknown || outputType === CoreTypeIds.Void) {
    return undefined;
  }
  return outputType;
}

/**
 * Derives the type of a rule's WHEN result: the value the rule's WHEN side
 * produces and the runtime captures for the DO side to consume.
 *
 * Reads only the WHEN side, typing its expression with `whenExprResultType`.
 *
 * An empty WHEN produces no result of its own; this walks the `ancestor()` chain
 * to the nearest enclosing rule that produces one. Returns undefined when no
 * enclosing rule produces a typable WHEN result.
 */
export function getRuleWhenResultType(
  ruleDef: IBrainRuleDef,
  operatorOverloads?: IOperatorOverloads,
  conversions?: IConversionRegistry
): TypeId | undefined {
  let current: IBrainRuleDef | undefined = ruleDef;
  while (current) {
    const whenTiles = current.when().tiles();
    if (whenTiles.size() > 0) {
      const expr = parseTilesForSuggestions(whenTiles);
      return whenExprResultType(expr, operatorOverloads, conversions);
    }
    current = current.ancestor();
  }
  return undefined;
}

/**
 * The WHEN-result type available to a tile placed on `ruleSide` of `ruleDef`.
 *
 * A DO-side tile reads this rule's own WHEN result (with the empty-WHEN ancestor
 * fall-through of `getRuleWhenResultType`). A WHEN-side tile reads the ancestor's
 * WHEN result -- the rule's own result is not captured while its WHEN is still
 * being evaluated -- so a root rule's WHEN side has none. Returns undefined when
 * no rule is supplied or no enclosing rule produces a typable WHEN result.
 */
export function availableWhenResultType(
  ruleDef: IBrainRuleDef | undefined,
  ruleSide: RuleSide,
  operatorOverloads?: IOperatorOverloads,
  conversions?: IConversionRegistry
): TypeId | undefined {
  if (ruleDef === undefined) return undefined;
  if (ruleSide === RuleSide.When) {
    const ancestor = ruleDef.ancestor();
    return ancestor ? getRuleWhenResultType(ancestor, operatorOverloads, conversions) : undefined;
  }
  return getRuleWhenResultType(ruleDef, operatorOverloads, conversions);
}

// ---- Rule hierarchy gates ----

/**
 * The OR'd `capabilities()` of every tile in the rule's WHEN and DO sides and
 * in all its ancestor rules. Supplies `InsertionContext.availableCapabilities`
 * for positions inside the rule: capability-gated tiles (non-empty
 * `requirements()`) are offered only under a providing tile in this set.
 */
export function collectRuleHierarchyCapabilities(ruleDef: IBrainRuleDef): ReadonlyBitSet {
  let result = new BitSet();
  let current: IBrainRuleDef | undefined = ruleDef;
  while (current) {
    result = collectProvidedCapabilities(current.when().tiles(), result);
    result = collectProvidedCapabilities(current.do().tiles(), result);
    current = current.ancestor();
  }
  return result;
}

/**
 * The output identity keys provided by every tile in the rule's WHEN and DO
 * sides and in all its ancestor rules. Supplies
 * `InsertionContext.availableOutputKeys` for positions inside the rule: an
 * output tile is offered only when its `outputKey` is a member.
 */
export function collectRuleHierarchyOutputKeys(ruleDef: IBrainRuleDef): UniqueSet<string> {
  const result = new UniqueSet<string>();
  let current: IBrainRuleDef | undefined = ruleDef;
  while (current) {
    collectProvidedOutputKeys(current.when().tiles(), result);
    collectProvidedOutputKeys(current.do().tiles(), result);
    current = current.ancestor();
  }
  return result;
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
 * - **Complete inline sensor** (no unfilled slots) -- infix operators (produces a value)
 * - **Complete non-inline sensor** (no unfilled slots, no trailing value) -- nothing
 *   (the parser cannot continue it with an operator or accessor at the top level)
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
export function suggestTiles(
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  services: BrainServices
): TileSuggestionResult {
  const { conversions } = services.shared;
  const { operatorOverloads } = services.edit;
  const { types } = services.runtime;
  const result: TileSuggestionResult = {
    exact: List.empty(),
    withConversion: List.empty(),
  };

  // The WHEN-result type available at this insertion point gates tiles that
  // declare `consumesWhenResult()`; a tile requiring an unavailable type is not
  // offered.
  const availableWhenResult = availableWhenResultType(
    context.ruleDef,
    context.ruleSide,
    operatorOverloads,
    conversions
  );

  const expr: Expr = context.expr ?? { nodeId: 0, kind: "empty" };

  // ---- Replacement mode ----
  if (context.replaceTileIndex !== undefined && expr.kind !== "empty") {
    // When the tile being replaced falls outside the AST span (e.g., a close
    // paren that the parser consumed transparently), fall through to append
    // mode so the user sees infix operators and close paren suggestions.
    if (exprContainsTileIndex(expr, context.replaceTileIndex)) {
      const role = findReplacementRole(
        expr,
        context.replaceTileIndex,
        { kind: "expressionPosition" },
        operatorOverloads,
        conversions
      );
      suggestForReplacementRole(
        role,
        context,
        catalogs,
        conversions,
        types,
        operatorOverloads,
        availableWhenResult,
        result
      );
      return result;
    }
    // Tile is outside the AST (e.g., a paren) -- fall through to append mode.
  }

  // ---- Append mode (existing behavior) ----
  switch (expr.kind) {
    case "empty":
    case "errorExpr":
      suggestExpressionTiles(context, catalogs, conversions, types, availableWhenResult, result);
      break;

    case "actuator":
    case "sensor": {
      const callDef = expr.tileDef.action.callDef;
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
          expr.span.to,
          context.ruleSide,
          catalogs,
          conversions,
          types,
          operatorOverloads,
          availableWhenResult,
          result,
          undefined,
          context.availableCapabilities,
          context.availableOutputKeys,
          context.unclosedParenDepth
        );
      }

      // If the trailing child is a complete value expression, also offer infix
      // operators so the user can extend it (e.g., [priority] [1] -> [priority] [1] [+] ...).
      // For a complete inline sensor (no arg slots), also offer infix ops -- inline sensors
      // are parsed inside the Pratt expression loop so infix operators can follow them.
      // Non-inline sensors are parsed via parseActionCall which returns directly to parseTop,
      // so neither infix operators nor accessors can follow them at the top level (they'd
      // start a new expression).
      if (
        trailingValueExpr(expr) !== undefined ||
        (expr.kind === "sensor" && !needsSlots && callDef.argSlots.size() === 0 && isInlineTileDef(expr.tileDef))
      ) {
        const leftExpr = trailingValueExpr(expr) ?? expr;
        const leftType = operatorOverloads ? getExprOutputType(leftExpr, operatorOverloads, conversions) : undefined;
        suggestInfixOperators(context, catalogs, conversions, result, leftType, operatorOverloads, leftExpr);
        suggestCloseParenIfNeeded(context, catalogs, result);
        const trailingForAccessor = trailingPrimaryExpr(leftExpr);
        // When the trailing value is the standalone action expression itself
        // (a complete no-arg value sensor), no enclosing slot constrains its
        // accessors -- offer them unrestricted, as for a variable or literal.
        // When it is nested in a slot, restrict to the types that slot wants.
        const acceptedTypes = leftExpr === expr ? undefined : collectActionCallExpectedTypes(expr, catalogs, types);
        suggestAccessorTiles(
          context,
          catalogs,
          types,
          conversions,
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
        const callDef = innerExpr.tileDef.action.callDef;
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
            expr.span.to,
            context.ruleSide,
            catalogs,
            conversions,
            types,
            operatorOverloads,
            availableWhenResult,
            result,
            undefined,
            context.availableCapabilities,
            context.availableOutputKeys,
            context.unclosedParenDepth
          );
        }

        // If the trailing child is a complete value or the operand sensor is
        // complete, offer infix operators on the whole unaryOp expression.
        // The sensor counts as complete when no required slot is unfilled and
        // no placed value is pending -- unfilled optional slots do not block
        // continuation, matching the parser.
        // No Inline placement gate here: a prefix operator's operand is parsed inside
        // a Pratt expression, so operators and accessors can follow the sensor even
        // when it is non-inline.
        const operandComplete =
          innerExpr.kind === "sensor" &&
          !hasParametersNeedingValues(innerExpr) &&
          !hasIncompleteAnonValues(innerExpr) &&
          !hasUnfilledRequiredArg(callDef.callSpec, callDef.argSlots, filledSlotIds, callDef.callSpec);
        if (trailingValueExpr(innerExpr) !== undefined || operandComplete) {
          const leftExpr = trailingValueExpr(innerExpr) ?? expr;
          const leftType = operatorOverloads ? getExprOutputType(leftExpr, operatorOverloads, conversions) : undefined;
          suggestInfixOperators(context, catalogs, conversions, result, leftType, operatorOverloads, leftExpr);
          suggestCloseParenIfNeeded(context, catalogs, result);
          const trailingForAccessor = trailingPrimaryExpr(leftExpr);
          // The operand sensor stands alone (no trailing slot value) when
          // leftExpr fell back to the whole unary expression -- offer its
          // accessors unrestricted; otherwise restrict to the slot's types.
          const innerAcceptedTypes =
            leftExpr === expr ? undefined : collectActionCallExpectedTypes(innerExpr, catalogs, types);
          suggestAccessorTiles(
            context,
            catalogs,
            types,
            conversions,
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
          types,
          conversions,
          result,
          getExprOutputType(trailingExpr, operatorOverloads, conversions) ?? getExprOutputType(trailingExpr),
          trailingPrimaryAcceptedTypes(expr, operatorOverloads, conversions)
        );
      } else {
        // Incomplete unaryOp: operand missing. Allow non-inline sensors since
        // they can now appear as operands of prefix operators (e.g., [not] [see]).
        const expectedType = incompleteExprExpectedType(expr, operatorOverloads, conversions);
        const ctx: InsertionContext = expectedType ? { ...context, expectedType } : context;
        suggestExpressionTiles(ctx, catalogs, conversions, types, availableWhenResult, result, true, true);
      }
      break;
    }

    case "literal":
    case "variable":
    case "output":
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
          types,
          conversions,
          result,
          getExprOutputType(trailingExpr, operatorOverloads, conversions) ?? getExprOutputType(trailingExpr),
          trailingPrimaryAcceptedTypes(expr, operatorOverloads, conversions)
        );
      } else {
        const expectedType = incompleteExprExpectedType(expr, operatorOverloads, conversions);
        const ctx: InsertionContext = expectedType ? { ...context, expectedType } : context;
        suggestExpressionTiles(ctx, catalogs, conversions, types, availableWhenResult, result, true);
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

// ---- Open Paren ----

/**
 * Suggests the open paren tile in value sub-expression positions inside
 * action calls. The open paren starts a grouped expression (e.g.,
 * [duration] [(] [1] [+] [2] [)]). suggestExpressionTiles includes
 * it automatically for top-level positions, but action call value
 * suggestions go through suggestExpressionsForAnonymousSlots which
 * only includes value-producing tiles.
 */
function suggestOpenParen(
  ruleSide: RuleSide,
  catalogs: ReadonlyList<ITileCatalog>,
  result: TileSuggestionResult
): void {
  const openParenId = mkControlFlowTileId(CoreControlFlowId.OpenParen);
  for (let ci = 0; ci < catalogs.size(); ci++) {
    const tileDef = catalogs.get(ci).get(openParenId);
    if (tileDef && isPlacementValid(tileDef, ruleSide)) {
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
 *
 * When `prefixOperandType` is set, prefix operators are only included when
 * they have an overload accepting that operand type exactly. Used at the
 * base of a field-access chain, where a prefix operator placed there
 * receives the chain's field value as its operand.
 */
function suggestExpressionTiles(
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  types: ITypeRegistry,
  availableWhenResult: TypeId | undefined,
  result: TileSuggestionResult,
  valueOnly = false,
  allowNonInlineSensors = false,
  prefixOperandType?: TypeId
): void {
  const seen = new UniqueSet<string>();

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      // Skip hidden tiles
      if (tileDef.hidden || tileDef.deprecated) continue;

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

        // At the base of a field-access chain, a prefix operator receives the
        // chain's field value as its operand; only operators with an overload
        // accepting that type exactly are included.
        if (
          opDef.op.parse.fixity === "prefix" &&
          prefixOperandType !== undefined &&
          !operatorHasFirstOperandOverload(opDef, prefixOperandType)
        ) {
          continue;
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
        if (!isInlineTileDef(tileDef)) continue;
      }

      // In value-only mode, skip actuators (they return Void, not a value).
      // Inside unclosed parentheses, actuators are also excluded -- only
      // value-producing expressions are valid inside grouped expressions.
      if ((valueOnly || insideParens) && tileDef.kind === "actuator") continue;

      // Check placement compatibility with rule side
      if (!isPlacementValid(tileDef, context.ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, context.availableCapabilities, context.availableOutputKeys)) continue;

      // A WHEN-result consumer is valid only where its required WHEN result is available.
      if (!whenResultConsumerEligible(tileDef, availableWhenResult, conversions)) continue;

      // Deduplicate across catalogs
      if (seen.has(tileDef.tileId)) continue;
      seen.add(tileDef.tileId);

      // Determine type compatibility
      const outputType = getTileOutputType(tileDef);
      const typeResult = classifyTypeCompatibility(outputType, context.expectedType, conversions, types);

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
 * When the left expression is a binaryOp, higher-precedence candidate operators
 * would rebind with the right operand in the Pratt parser. In that case the
 * effective LHS type is the right operand's type (or a deeper nested operand),
 * not the overall expression's type. This allows e.g. `[a] [>] [b] [*]` where
 * `*` binds with `[b]` (Number) even though `>` produces Boolean.
 *
 * The assignment operator is offered iff `leftExpr` is an l-value; it is
 * exempt from overload filtering.
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
    leftExpr !== undefined && (leftExpr.kind === "variable" || leftExpr.kind === "fieldAccess") && isLValue(leftExpr);

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      if (tileDef.hidden || tileDef.deprecated) continue;
      if (tileDef.kind !== "operator") continue;

      const opDef = tileDef as BrainTileOperatorDef;
      if (opDef.op.parse.fixity !== "infix") continue;

      // Assignment is gated by the l-value check alone; it never consults
      // operator overloads (the compiler lowers assignment to store
      // instructions for any type).
      if (opDef.op.id === CoreOpId.Assign && !lhsIsLValue) continue;

      if (!isPlacementValid(tileDef, context.ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, context.availableCapabilities, context.availableOutputKeys)) continue;

      if (seen.has(tileDef.tileId)) continue;
      seen.add(tileDef.tileId);

      if (canFilter && opDef.op.id !== CoreOpId.Assign) {
        // Check the overall expression type first (covers same/lower precedence operators).
        // For higher-precedence operators that would rebind with the right operand of a
        // binaryOp, also check the effective LHS type at the rebinding point.
        let matched = operatorHasFirstOperandOverload(opDef, leftOperandType);
        if (!matched && leftExpr !== undefined && leftExpr.kind === "binaryOp") {
          const reboundLhsType = effectiveLhsType(leftExpr, opDef.op.parse.precedence, operatorOverloads, conversions);
          if (reboundLhsType !== undefined && reboundLhsType !== leftOperandType) {
            matched = operatorHasFirstOperandOverload(opDef, reboundLhsType);
          }
        }
        if (!matched) continue;
      }

      result.exact.push({
        tileDef,
        compatibility: TileCompatibility.Unchecked,
        conversionCost: 0,
      });
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
  types: ITypeRegistry,
  serviceConversions: IConversionRegistry,
  result: TileSuggestionResult,
  leftExprType: TypeId | undefined,
  acceptedFieldTypes?: ReadonlyList<TypeId>
): void {
  if (leftExprType === undefined) return;

  const typeDef = types.get(leftExprType);
  if (!typeDef || typeDef.coreType !== NativeType.Struct) return;

  const conversions = acceptedFieldTypes ? serviceConversions : undefined;
  const seen = new UniqueSet<string>();

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      if (tileDef.hidden || tileDef.deprecated) continue;
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
          const compat = classifyTypeCompatibility(
            accessorDef.fieldTypeId,
            acceptedFieldTypes.get(ai),
            conversions,
            types
          );
          if (compat) {
            fieldAccepted = true;
            break;
          }
        }
        if (!fieldAccepted) continue;
      }

      if (!isPlacementValid(tileDef, context.ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, context.availableCapabilities, context.availableOutputKeys)) continue;

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

      if (tileDef.hidden || tileDef.deprecated) continue;
      if (tileDef.kind !== "operator") continue;

      const opDef = tileDef as BrainTileOperatorDef;
      if (opDef.op.parse.fixity !== "prefix") continue;

      if (!isPlacementValid(tileDef, ruleSide)) continue;

      // Operator tiles only (filtered above); no output-identity gate applies.
      if (!areRequirementsMet(tileDef, availableCapabilities, undefined)) continue;

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
 * Only includes operators with `fixity === "prefix"` that pass placement
 * checks. When `operandType` is provided, only operators with an overload
 * accepting that operand type exactly are included -- conversion-based
 * matching is not used for operators.
 */
function suggestPrefixOperators(
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  result: TileSuggestionResult,
  operandType?: TypeId
): void {
  const seen = new UniqueSet<string>();

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      if (tileDef.hidden || tileDef.deprecated) continue;
      if (tileDef.kind !== "operator") continue;

      const opDef = tileDef as BrainTileOperatorDef;
      if (opDef.op.parse.fixity !== "prefix") continue;

      if (operandType !== undefined && !operatorHasFirstOperandOverload(opDef, operandType)) continue;

      if (!isPlacementValid(tileDef, context.ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, context.availableCapabilities, context.availableOutputKeys)) continue;

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

// ---- Assignment Target Position ----

/**
 * Suggests tiles for a position an assignment writes to: the target itself,
 * or the base of a field-access target. Only l-value tiles are offered (see
 * `isLValueTile`). When `valueType` is known a tile matches it exactly,
 * through a registered conversion from the value's type to the tile's type
 * (assignment converts the value into the target's type), through a field of
 * the tile's struct type with exactly that type (the target is refined with
 * an accessor), or through a field of the value's struct type with exactly
 * the tile's type (the assigned value is refined instead). An undefined
 * `valueType` offers all l-value tiles unchecked.
 */
function suggestAssignmentTargetTiles(
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  types: ITypeRegistry,
  availableWhenResult: TypeId | undefined,
  valueType: TypeId | undefined,
  result: TileSuggestionResult
): void {
  const seen = new UniqueSet<string>();

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      if (tileDef.hidden || tileDef.deprecated) continue;
      if (!isLValueTile(tileDef)) continue;

      if (!isPlacementValid(tileDef, context.ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, context.availableCapabilities, context.availableOutputKeys)) continue;

      // A WHEN-result consumer is valid only where its required WHEN result is available.
      if (!whenResultConsumerEligible(tileDef, availableWhenResult, conversions)) continue;

      if (seen.has(tileDef.tileId)) continue;
      seen.add(tileDef.tileId);

      const outputType = getTileOutputType(tileDef);
      let typeResult = classifyExactOrFieldCompatibility(outputType, valueType, types);
      if (typeResult === undefined && outputType !== undefined && hasTypeConstraint(valueType)) {
        // The assigned value converts into the target tile's type.
        const path = conversions.findBestPath(valueType!, outputType);
        if (path !== undefined && path.size() > 0) {
          let cost = 0;
          for (let i = 0; i < path.size(); i++) {
            cost += path.get(i).cost;
          }
          typeResult = { compatibility: TileCompatibility.Conversion, cost };
        } else if (structHasExactField(valueType!, outputType, types)) {
          typeResult = { compatibility: TileCompatibility.Conversion, cost: 1 };
        }
      }
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

// ---- Value-Absorbing Sensors ----

/**
 * True when the sensor's call spec has an anonymous slot whose parameter
 * type accepts one of `valueTypes`, exactly or via conversion.
 */
function sensorAnonymousSlotAccepts(
  sensorDef: BrainTileSensorDef,
  valueTypes: ReadonlyList<TypeId>,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  types: ITypeRegistry
): boolean {
  const argSlots = sensorDef.action.callDef.argSlots;
  for (let i = 0; i < argSlots.size(); i++) {
    const slot = argSlots.get(i);
    if (!slot.argSpec.anonymous) continue;
    const argTileDef = findTileInCatalogs(slot.argSpec.tileId, catalogs);
    if (!argTileDef || argTileDef.kind !== "parameter") continue;
    const slotType = (argTileDef as BrainTileParameterDef).dataType;
    for (let vi = 0; vi < valueTypes.size(); vi++) {
      if (classifyTypeCompatibility(valueTypes.get(vi), slotType, conversions, types) !== undefined) return true;
    }
  }
  return false;
}

/**
 * Suggests non-inline sensors that can stand where the side's expression
 * currently starts by hosting the displaced value: the sensor begins a new
 * action call and the tiles after it re-parse as the value of one of its
 * anonymous slots. Only sensors with an anonymous slot that accepts one of
 * `absorbedTypes` (exactly or via conversion) are offered. Inline sensors
 * do not parse juxtaposed arguments and are excluded.
 */
function suggestValueAbsorbingSensors(
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  types: ITypeRegistry,
  availableWhenResult: TypeId | undefined,
  absorbedTypes: ReadonlyList<TypeId>,
  result: TileSuggestionResult
): void {
  const seen = new UniqueSet<string>();

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      if (tileDef.hidden || tileDef.deprecated) continue;
      if (tileDef.kind !== "sensor" || isInlineTileDef(tileDef)) continue;

      if (!isPlacementValid(tileDef, context.ruleSide)) continue;

      // Check capability requirements
      if (!areRequirementsMet(tileDef, context.availableCapabilities, context.availableOutputKeys)) continue;

      // A WHEN-result consumer is valid only where its required WHEN result is available.
      if (!whenResultConsumerEligible(tileDef, availableWhenResult, conversions)) continue;

      if (seen.has(tileDef.tileId)) continue;

      if (!sensorAnonymousSlotAccepts(tileDef as BrainTileSensorDef, absorbedTypes, catalogs, conversions, types)) {
        continue;
      }

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
 * Whether the tile being replaced is the first tile of the side's parsed
 * expression. The head position is parsed by the top-level dispatcher,
 * where a non-inline sensor starts an action call that no operator can
 * continue.
 */
function replacementIsAtExpressionHead(context: InsertionContext): boolean {
  const expr = context.expr;
  if (expr === undefined || expr.kind === "empty" || context.replaceTileIndex === undefined) return false;
  return expr.span !== undefined && expr.span.from === context.replaceTileIndex;
}

/**
 * Routes a replacement role to the appropriate suggestion function.
 */
function suggestForReplacementRole(
  role: ReplacementRole,
  context: InsertionContext,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  types: ITypeRegistry,
  operatorOverloads: IOperatorOverloads,
  availableWhenResult: TypeId | undefined,
  result: TileSuggestionResult
): void {
  switch (role.kind) {
    case "expressionPosition":
      suggestExpressionTiles(
        { ...context, unclosedParenDepth: undefined },
        catalogs,
        conversions,
        types,
        availableWhenResult,
        result
      );
      break;

    case "value": {
      const constraint = role.constraint;
      if (constraint?.kind === "assignTarget") {
        suggestAssignmentTargetTiles(
          context,
          catalogs,
          conversions,
          types,
          availableWhenResult,
          constraint.valueType,
          result
        );
        suggestOpenParen(context.ruleSide, catalogs, result);
        break;
      }
      if (constraint?.kind === "operand") {
        // An operand position parsed inside a Pratt expression accepts a
        // non-inline sensor as a primary. The head of the side's expression
        // does not: a sensor placed there starts an action call that no
        // operator can continue, so only a sensor that can host the
        // displaced value in an anonymous slot is offered.
        const atExpressionHead = replacementIsAtExpressionHead(context);
        suggestExpressionsForAnonymousSlots(
          constraint.types,
          context.ruleSide,
          catalogs,
          conversions,
          types,
          availableWhenResult,
          result,
          context.availableCapabilities,
          context.availableOutputKeys,
          !atExpressionHead
        );
        if (atExpressionHead) {
          suggestValueAbsorbingSensors(
            context,
            catalogs,
            conversions,
            types,
            availableWhenResult,
            constraint.types,
            result
          );
        }
        suggestPrefixOperatorsForValue(
          context.ruleSide,
          catalogs,
          constraint.types,
          result,
          context.availableCapabilities
        );
        suggestOpenParen(context.ruleSide, catalogs, result);
        break;
      }
      if (constraint?.kind === "accessorBase") {
        suggestExpressionTiles(
          context,
          catalogs,
          conversions,
          types,
          availableWhenResult,
          result,
          true,
          false,
          constraint.fieldType
        );
        break;
      }
      const ctx: InsertionContext = {
        ...context,
        expectedType: constraint?.kind === "typed" ? constraint.expectedType : context.expectedType,
      };
      suggestExpressionTiles(ctx, catalogs, conversions, types, availableWhenResult, result, true);
      break;
    }

    case "infixOperator": {
      const leftType =
        role.leftExpr && operatorOverloads
          ? getExprOutputType(role.leftExpr, operatorOverloads, conversions)
          : undefined;
      suggestInfixOperators(context, catalogs, conversions, result, leftType, operatorOverloads, role.leftExpr);
      // A close paren can only stand at an operator replacement when the
      // operator has no parsed right operand: an operand left behind after
      // the paren cannot re-parse.
      const rightAbsent =
        role.rightExpr === undefined || role.rightExpr.kind === "empty" || role.rightExpr.kind === "errorExpr";
      if (rightAbsent) {
        suggestCloseParenIfNeeded(context, catalogs, result);
      }
      if (role.leftExpr) {
        // Mirror the append path after a complete value: replacing the operator
        // with an accessor of the left value's struct type is valid (e.g.,
        // [pos] [=] -> [pos] [x]). Unrestricted accepted types offer all of the
        // struct's accessors, as for a standalone value; suggestAccessorTiles
        // no-ops when the left type is not a struct.
        suggestAccessorTiles(
          context,
          catalogs,
          types,
          conversions,
          result,
          getExprOutputType(role.leftExpr, operatorOverloads, conversions) ?? getExprOutputType(role.leftExpr)
        );
      }
      break;
    }

    case "prefixOperator": {
      const operandType = role.operandExpr
        ? getExprOutputType(role.operandExpr, operatorOverloads, conversions)
        : undefined;
      suggestPrefixOperators(context, catalogs, result, operandType);
      // A non-inline sensor can replace the prefix operator when one of its
      // anonymous slots accepts the operand value: the operand re-parses as
      // the sensor's argument.
      if (operandType !== undefined) {
        suggestValueAbsorbingSensors(
          context,
          catalogs,
          conversions,
          types,
          availableWhenResult,
          List.from([operandType]),
          result
        );
      }
      suggestOpenParen(context.ruleSide, catalogs, result);
      break;
    }

    case "actionCallArg": {
      suggestActionCallTiles(
        role.actionExpr,
        context.replaceTileIndex ?? role.actionExpr.span.to,
        context.ruleSide,
        catalogs,
        conversions,
        types,
        operatorOverloads,
        availableWhenResult,
        result,
        role.excludeSlotId,
        context.availableCapabilities,
        context.availableOutputKeys,
        context.unclosedParenDepth
      );
      // Replacement counterpart of the append path's trailing-value rule:
      // when the replaced tile directly follows a complete slot value, an
      // infix operator can extend that value (the displaced tiles re-parse
      // as its right operand).
      const leftValue =
        context.replaceTileIndex !== undefined
          ? slotValueEndingAt(role.actionExpr, context.replaceTileIndex)
          : undefined;
      if (leftValue !== undefined) {
        const leftType = getExprOutputType(leftValue, operatorOverloads, conversions);
        suggestInfixOperators(context, catalogs, conversions, result, leftType, operatorOverloads, leftValue);
      }
      break;
    }

    case "accessorPosition":
      suggestAccessorTiles(context, catalogs, types, conversions, result, role.structTypeId);
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
 *
 * `insertionTileIndex` is the flat tile index the suggestion is for (the
 * append index, or the replaced tile's index). When a complete slot value
 * ends exactly there, prefix operators are not offered: the parser binds an
 * operator token at that position to the preceding value expression, so a
 * prefix operator cannot start the next slot's value.
 */
function suggestActionCallTiles(
  actionExpr: ActuatorExpr | SensorExpr,
  insertionTileIndex: number,
  ruleSide: RuleSide,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  types: ITypeRegistry,
  operatorOverloads: IOperatorOverloads,
  availableWhenResult: TypeId | undefined,
  result: TileSuggestionResult,
  excludeSlotId?: number,
  availableCapabilities?: ReadonlyBitSet,
  availableOutputKeys?: UniqueSet<string>,
  unclosedParenDepth?: number
): void {
  const callDef = actionExpr.tileDef.action.callDef;
  const filledSlotIds = collectFilledSlotIds(actionExpr, excludeSlotId);

  // Walk the call spec tree to find available arg slots
  const availableSlots = List.empty<BrainActionArgSlot>();
  collectAvailableArgSlots(callDef.callSpec, callDef.argSlots, filledSlotIds, availableSlots, 1, callDef.callSpec);

  // Check whether a value is pending (parameter needing a value or incomplete anon).
  // When a value is pending, only value expressions should be suggested -- named
  // parameter/modifier tiles are suppressed because the user must complete the
  // current parameter or anonymous value expression first.
  // Unclosed parens also suppress named tiles -- the user is building a grouped
  // sub-expression that must be closed before placing additional call spec args.
  const valuePending =
    (unclosedParenDepth ?? 0) > 0 ||
    hasParametersNeedingValues(actionExpr, excludeSlotId) ||
    hasIncompleteAnonValues(actionExpr, excludeSlotId) ||
    hasStructValuePendingAccessor(actionExpr, catalogs, types, excludeSlotId);

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
      // Named call-spec tiles are never output tiles, so no output-identity gate applies.
      if (!areRequirementsMet(argTileDef, availableCapabilities, undefined)) continue;
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
  // (e.g., [say] ["hi"] [+] -- the binaryOp needs a right operand).
  // When unclosed parens are present, also include anon slots with errorExpr --
  // the error was caused by the unclosed paren consuming the slot's expression
  // (e.g., [say] [(] produces errorExpr in the AnonString slot).
  const includeAnonErrors = (unclosedParenDepth ?? 0) > 0;
  const opOverloads = operatorOverloads;
  for (let i = 0; i < actionExpr.anons.size(); i++) {
    const anonExpr = actionExpr.anons.get(i).expr;
    const isIncomplete = anonExpr.kind !== "empty" && anonExpr.kind !== "errorExpr" && !isCompleteValueExpr(anonExpr);
    const isErrorInUnclosedParen = includeAnonErrors && anonExpr.kind === "errorExpr";
    if (isIncomplete || isErrorInUnclosedParen) {
      // When the incomplete expression has an operator-derived expected type
      // (e.g., [1] [+] _ expects Number for the right operand), use that
      // instead of the outer slot type. The operator constraint is the
      // immediate context -- the slot type (e.g., String from AnonString)
      // would incorrectly promote conversion-only tiles to exact matches.
      let usedOperandType = false;
      if (isIncomplete) {
        const operandType = incompleteExprExpectedType(anonExpr, opOverloads, conversions);
        if (operandType !== undefined) {
          valueExpectedTypes.push(operandType);
          usedOperandType = true;
        }
      }

      if (!usedOperandType) {
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
  }

  // Suggest expression tiles matching the expected types
  if (valueExpectedTypes.size() > 0) {
    suggestExpressionsForAnonymousSlots(
      valueExpectedTypes,
      ruleSide,
      catalogs,
      conversions,
      types,
      availableWhenResult,
      result,
      availableCapabilities,
      availableOutputKeys
    );
    // Prefix operators can start value sub-expressions (e.g., [negative] [1]),
    // but not directly after a complete slot value: the parser reads the
    // operator as a continuation of that value.
    if (slotValueEndingAt(actionExpr, insertionTileIndex) === undefined) {
      suggestPrefixOperatorsForValue(ruleSide, catalogs, valueExpectedTypes, result, availableCapabilities);
    }
    // Open paren can start a grouped sub-expression (e.g., [duration] [(] [1] [+] [2] [)]).
    suggestOpenParen(ruleSide, catalogs, result);
  }
}

/**
 * Suggests expression tiles that match one or more expected types. A tile
 * is suggested if it matches any of the expected types (exact or via
 * conversion). The best compatibility across all types is used for the
 * suggestion.
 *
 * When `allowNonInlineSensors` is true, non-inline sensors are included.
 * Used for operator operand positions parsed inside a Pratt expression,
 * where the parser accepts a non-inline sensor as an expression primary.
 */
function suggestExpressionsForAnonymousSlots(
  expectedTypes: ReadonlyList<TypeId>,
  ruleSide: RuleSide,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  types: ITypeRegistry,
  availableWhenResult: TypeId | undefined,
  result: TileSuggestionResult,
  availableCapabilities?: ReadonlyBitSet,
  availableOutputKeys?: UniqueSet<string>,
  allowNonInlineSensors = false
): void {
  const seen = new UniqueSet<string>();

  for (let ci = 0; ci < catalogs.size(); ci++) {
    const catalog = catalogs.get(ci);
    const allTiles = catalog.getAll();
    for (let ti = 0; ti < allTiles.size(); ti++) {
      const tileDef = allTiles.get(ti);

      // Skip hidden tiles
      if (tileDef.hidden || tileDef.deprecated) continue;

      // Only value-producing expression tiles
      if (!isValueProducingTile(tileDef)) continue;

      // Skip non-inline sensors unless explicitly allowed -- action call
      // anonymous slots offer only inline sensors, while operator operand
      // positions also accept non-inline sensors.
      if (tileDef.kind === "sensor" && !allowNonInlineSensors && !isInlineTileDef(tileDef)) continue;

      // Check placement
      if (!isPlacementValid(tileDef, ruleSide)) continue;

      // Check capability + output-identity requirements
      if (!areRequirementsMet(tileDef, availableCapabilities, availableOutputKeys)) continue;

      // A WHEN-result consumer is valid only where its required WHEN result is available.
      if (!whenResultConsumerEligible(tileDef, availableWhenResult, conversions)) continue;

      // Deduplicate
      if (seen.has(tileDef.tileId)) continue;

      const outputType = getTileOutputType(tileDef);
      if (!outputType || outputType === CoreTypeIds.Unknown) continue;

      // Check against each expected type, find best match
      let bestCompatibility: TileCompatibility | undefined;
      let bestCost = 0;

      for (let ei = 0; ei < expectedTypes.size(); ei++) {
        const typeResult = classifyTypeCompatibility(outputType, expectedTypes.get(ei), conversions, types);
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
