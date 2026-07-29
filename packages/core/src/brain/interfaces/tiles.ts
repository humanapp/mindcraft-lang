import type { ReadonlyList } from "../../platform/list";
import { MathOps } from "../../platform/math";
import { StringUtils as SU } from "../../platform/string";
import type { TileId } from "../../runtime/tile-ids";
import { mkTileId } from "../../runtime/tile-ids";
import type { BitSet, ReadonlyBitSet } from "../../util/bitset";

export {
  CoreParameterId,
  mkActionTileId,
  mkActuatorTileId,
  mkModifierTileId,
  mkOutputTileId,
  mkOutputVarKey,
  mkParameterTileId,
  mkSensorTileId,
  mkTileId,
  type ParsedTileId,
  parseTileId,
  type TileId,
} from "../../runtime/tile-ids";

import type { ActionDescriptor } from "../../runtime/function-defs";
import type { TypeId } from "../../runtime/type-defs";

// ----------------------------------------------------
// Core Types and Enums
// ----------------------------------------------------

/** Categorization of a brain tile. */
export type BrainTileKind =
  | "undefined"
  | "sensor"
  | "actuator"
  | "parameter"
  | "operator"
  | "variable"
  | "literal"
  | "factory"
  | "controlFlow"
  | "modifier"
  | "accessor"
  | "page"
  | "output"
  | "missing";

/** Identifies which side(s) of a rule (`when`, `do`, or both) a tile is allowed on. */
export enum RuleSide {
  When = 1 << 0,
  Do = 1 << 1,
  Either = When | Do,
}

/** Bitmask describing where a tile may be placed in the editor. */
export enum TilePlacement {
  WhenSide = RuleSide.When,
  DoSide = RuleSide.Do,
  EitherSide = RuleSide.When | RuleSide.Do,
  ChildRule = 1 << 2,
  InsideLoop = 1 << 3,
  /** Marks a sensor/actuator as inline: it participates in Pratt expressions
   *  like a literal (no arguments allowed). */
  Inline = 1 << 4,
}

/**
 * Sentence frame of a tile: which template renders it when it heads a rule's
 * WHEN side as a sensor. A WHEN side headed by any other kind of tile reads as
 * a bare condition and takes no frame.
 *
 * - "verb" -- an action the creature takes ("When I hear ...")
 * - "state" -- a condition it is in, rendered with the locale's copula
 *   ("When I am hungry")
 * - "event" -- something that happens to it ("When this page starts")
 */
export type TileSentenceFrame = "verb" | "state" | "event";

/**
 * Sentence-projection metadata for a tile. Every field is optional; the
 * projection supplies a default for each, so a tile with no `language` group
 * still reads.
 */
export interface ITileLanguageMetadata {
  /**
   * The tile's word in a projected sentence, authored in the source language
   * and localized at display time. Defaults to the tile's label, then its name.
   */
  form?: string;
  /** Sentence frame selecting the WHEN-side template of a sensor. Defaults to "verb". */
  frame?: TileSentenceFrame;
  /**
   * Word completing the sentence when the tile is placed with no object
   * argument ("see" alone reads "see anything"). Defaults to the frame's
   * default bare word.
   */
  bare?: string;
}

/** Display metadata for a tile (label, icon, docs, search tags, sentence words). */
export interface ITileMetadata {
  label: string;
  iconUrl?: string;
  docsMarkdown?: string;
  tags?: readonly string[];
  /** Words the sentence projection reads this tile with. */
  language?: ITileLanguageMetadata;
}

/** Optional flags configurable on tileDef constructors. */
export interface BrainTileDefCreateOptions {
  placement?: TilePlacement;
  deprecated?: boolean;
  hidden?: boolean;
  persist?: boolean;
  capabilities?: BitSet;
  requirements?: BitSet;
  /** Output identity keys (see `mkOutputVarKey`) this tile provides; sensors declaring outputs set these so their output value-tiles surface downstream. */
  providedOutputs?: ReadonlyList<string>;
  /**
   * Declares that this tile requires the rule's WHEN result, set to the `TypeId`
   * the tile expects. The editor offers the tile only where a WHEN result of that
   * type is available. Omit for a tile that does not consume the WHEN result.
   */
  consumesWhenResult?: TypeId;
  /**
   * When true (sensors only), the sensor's returned value is a writable l-value:
   * a field write on its result is permitted. Defaults to false, making the
   * result read-only. Ignored on non-sensor tiles.
   */
  writableResult?: boolean;
  metadata?: ITileMetadata;
}

// ----------------------------------------------------
// Literal Display Format
// ----------------------------------------------------

/**
 * Specifies how a numeric literal value is displayed in the editor.
 *
 * - "default" -- no special formatting (plain number)
 * - "percent" -- value * 100 with "%" suffix
 * - "percent:N" -- value * 100 with N decimal places and "%" suffix
 * - "fixed:N" -- fixed N decimal places (e.g., "fixed:2" -> 3.10)
 * - "thousands" -- comma-separated thousands groups
 * - "time_seconds" -- rounded to 2 decimal places with "s" suffix (e.g., 1.283 -> "1.28s")
 * - "time_ms" -- value * 1000 rounded to integer with "ms" suffix (e.g., 1 -> "1000ms")
 */
export type LiteralDisplayFormat = string;

/** Built-in display-format constants. See {@link LiteralDisplayFormat} for the format string grammar. */
export const LiteralDisplayFormats = {
  Default: "default",
  Percent: "percent",
  Thousands: "thousands",
  TimeSeconds: "time_seconds",
  TimeMs: "time_ms",
} as const;

/** Build a "percent:N" format string. */
export function percentFormat(decimals: number): LiteralDisplayFormat {
  return `percent:${decimals}`;
}

/** Build a "fixed:N" format string. */
export function fixedFormat(decimals: number): LiteralDisplayFormat {
  return `fixed:${decimals}`;
}

/** Parse a display format string into its kind and optional precision. */
export function parseDisplayFormat(fmt: LiteralDisplayFormat): { kind: string; decimals?: number } {
  if (SU.startsWith(fmt, "percent:")) {
    const n = MathOps.parseFloat(SU.substring(fmt, 8));
    return { kind: "percent", decimals: MathOps.isNaN(n) ? undefined : n };
  }
  if (SU.startsWith(fmt, "fixed:")) {
    const n = MathOps.parseFloat(SU.substring(fmt, 6));
    return { kind: "fixed", decimals: MathOps.isNaN(n) ? undefined : n };
  }
  if (fmt === "percent") return { kind: "percent" };
  if (fmt === "thousands") return { kind: "thousands" };
  if (fmt === "time_seconds") return { kind: "time_seconds" };
  if (fmt === "time_ms") return { kind: "time_ms" };
  return { kind: "default" };
}

/** Options for {@link IBrainTileDefBuilder.createLiteralTileDef}. Adds value-formatting controls to the base options. */
export type BrainTileLiteralDefOptions = BrainTileDefCreateOptions & {
  valueLabel?: string;
  displayFormat?: LiteralDisplayFormat;
};

// ----------------------------------------------------
// Tile Definitions
// ----------------------------------------------------

/** Definition of a single brain tile: stable id, kind, display metadata, placement, and capability/requirement bits. */
export interface IBrainTileDef {
  readonly kind: BrainTileKind;
  readonly tileId: TileId;
  metadata?: ITileMetadata;
  placement?: TilePlacement;
  deprecated?: boolean;
  hidden?: boolean;
  persist?: boolean;
  capabilities(): ReadonlyBitSet;
  requirements(): ReadonlyBitSet;
  /** Output identity keys this tile provides (empty for tiles that declare no outputs). */
  providedOutputs(): ReadonlyList<string>;
  /**
   * The `TypeId` of the WHEN result this tile requires, or `undefined` for a tile
   * that does not consume the WHEN result.
   */
  consumesWhenResult(): TypeId | undefined;
}

export interface IBrainActionTileDef extends IBrainTileDef {
  readonly action: ActionDescriptor;
}

/** Narrows a tile def to {@link IBrainActionTileDef} (a sensor or actuator, the only kinds carrying an `action` descriptor). */
export function isActionTileDef(tileDef: IBrainTileDef): tileDef is IBrainActionTileDef {
  return "action" in tileDef;
}

/**
 * Whether `tileDef` carries the {@link TilePlacement.Inline} bit. An inline tile
 * takes no arguments and participates in Pratt expressions like a literal, so
 * infix operators and accessors may follow it.
 */
export function isInlineTileDef(tileDef: IBrainTileDef): boolean {
  return tileDef.placement !== undefined && (tileDef.placement & TilePlacement.Inline) !== 0;
}

// ----------------------------------------------------
// Tile ID Factory Functions
// ----------------------------------------------------

export function mkOperatorTileId(opId: string): string {
  return mkTileId("op", opId);
}

export function mkControlFlowTileId(cfId: string): string {
  return mkTileId("cf", cfId);
}

export function mkVariableTileId(varId: string): string {
  return mkTileId("var", varId);
}

export function mkVariableFactoryTileId(factoryId: string): string {
  return mkTileId("var.factory", factoryId);
}

export function mkLiteralTileId(valueType: TypeId, valueStr: string, displayFormat?: LiteralDisplayFormat): string {
  const base = `${valueType}->${valueStr}`;
  if (displayFormat && displayFormat !== LiteralDisplayFormats.Default) {
    return mkTileId("literal", `${base}[${displayFormat}]`);
  }
  return mkTileId("literal", base);
}

export function mkLiteralFactoryTileId(factoryId: string): string {
  return mkTileId("lit.factory", factoryId);
}

export function mkAccessorTileId(structTypeId: string, fieldName: string): string {
  return mkTileId("accessor", `${structTypeId}->${fieldName}`);
}

export function mkPageTileId(pageId: string): string {
  return mkTileId("page", pageId);
}

export function isPageTileId(tileId: string): boolean {
  return SU.startsWith(tileId, "tile.page->");
}

export function getPageIdFromTileId(tileId: string): string | undefined {
  const prefix = "tile.page->";
  if (SU.startsWith(tileId, prefix)) {
    return SU.substring(tileId, SU.length(prefix));
  }
  return undefined;
}

// ----------------------------------------------------
// Core Capability Bits
// Bits 0-31 are reserved for core language use.
// Apps must start at APP_CAPABILITY_BIT_OFFSET (32).
// ----------------------------------------------------

export const APP_CAPABILITY_BIT_OFFSET = 32;

export const CoreCapabilityBits = {
  PageSensor: 0,
  UserTile: 1,
  /**
   * Marks a value-bearing event sensor: it delivers a data value when it fires
   * and returns nil when there is no value this think (absent). A bare WHEN that
   * is exactly such a sensor is presence-gated (fires on a delivered falsy value,
   * skips only on nil); nil must be excluded from the sensor's value domain.
   */
  PresenceGated: 2,
} as const;

// ----------------------------------------------------
// Core Tile IDs
// ----------------------------------------------------

export enum CoreControlFlowId {
  Group = "group",
  OpenParen = "open-paren",
  CloseParen = "close-paren",
  Await = "await",
  //ForEach = "for-each",
  //Continue = "continue",
  //Break = "break",
}

export enum CoreVariableFactoryId {
  Boolean = "boolean",
  Number = "number",
  String = "string",
  BooleanList = "boolean.list",
  NumberList = "number.list",
  StringList = "string.list",
  BooleanMap = "boolean.map",
  NumberMap = "number.map",
  StringMap = "string.map",
}

export enum CoreLiteralFactoryId {
  Boolean = "boolean",
  Number = "number",
  String = "string",
}

export const CoreVariableFactoryTileIds: string[] = [
  mkVariableFactoryTileId(CoreVariableFactoryId.Boolean),
  mkVariableFactoryTileId(CoreVariableFactoryId.Number),
  mkVariableFactoryTileId(CoreVariableFactoryId.String),
  mkVariableFactoryTileId(CoreVariableFactoryId.BooleanList),
  mkVariableFactoryTileId(CoreVariableFactoryId.NumberList),
  mkVariableFactoryTileId(CoreVariableFactoryId.StringList),
  mkVariableFactoryTileId(CoreVariableFactoryId.BooleanMap),
  mkVariableFactoryTileId(CoreVariableFactoryId.NumberMap),
  mkVariableFactoryTileId(CoreVariableFactoryId.StringMap),
];

export function isCoreVariableFactoryTileId(tileId: string): boolean {
  return CoreVariableFactoryTileIds.includes(tileId);
}

export function isVariableFactoryTileId(tileId: string): boolean {
  return SU.startsWith(tileId, "tile.var.factory->");
}

export const CoreLiteralFactoryTileIds: string[] = [
  mkLiteralFactoryTileId(CoreLiteralFactoryId.Boolean),
  mkLiteralFactoryTileId(CoreLiteralFactoryId.Number),
  mkLiteralFactoryTileId(CoreLiteralFactoryId.String),
];

export function isCoreLiteralFactoryTileId(tileId: string): boolean {
  return CoreLiteralFactoryTileIds.includes(tileId);
}
