import { MathOps } from "../../platform/math";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import { StringUtils as SU } from "../../platform/string";
import type { BitSet, ReadonlyBitSet } from "../../util/bitset";
import type { ActionDescriptor } from "./functions";
import type { TypeId } from "./type-system";

// ----------------------------------------------------
// Core Types and Enums
// ----------------------------------------------------

export type TileId = string; // brain tile identifier

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
  | "missing";

export enum RuleSide {
  When = 1 << 0,
  Do = 1 << 1,
  Either = When | Do,
}

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

export interface ITileVisual {
  label: string;
  iconUrl?: string;
}

export interface BrainTileDefCreateOptions {
  placement?: TilePlacement;
  deprecated?: boolean;
  hidden?: boolean;
  persist?: boolean;
  capabilities?: BitSet;
  requirements?: BitSet;
  visual?: ITileVisual;
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

export type BrainTileLiteralDefOptions = BrainTileDefCreateOptions & {
  valueLabel?: string;
  displayFormat?: LiteralDisplayFormat;
};

export function mkTileId(area: string, id: string): string {
  return `tile.${area}->${id}`;
}

// ----------------------------------------------------
// Tile Definitions
// ----------------------------------------------------

export interface IBrainTileDef {
  readonly kind: BrainTileKind;
  readonly tileId: TileId;
  visual?: ITileVisual; // platform-specific visual representation, supplied at registration time via `tileVisualProvider`
  placement?: TilePlacement;
  deprecated?: boolean;
  hidden?: boolean;
  persist?: boolean;
  capabilities(): ReadonlyBitSet;
  requirements(): ReadonlyBitSet;
  serializeHeader(stream: IWriteStream): void;
  serialize(stream: IWriteStream): void;
}

export interface IBrainActionTileDef extends IBrainTileDef {
  readonly action: ActionDescriptor;
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

export function mkSensorTileId(sensorId: string): string {
  return mkTileId("sensor", sensorId);
}

export function mkActuatorTileId(actuatorId: string): string {
  return mkTileId("actuator", actuatorId);
}

export function mkParameterTileId(parameterId: string): string {
  return mkTileId("parameter", parameterId);
}

export function mkModifierTileId(modifierId: string): string {
  return mkTileId("modifier", modifierId);
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

export enum CoreActuatorId {
  SwitchPage = "switch-page",
  RestartPage = "restart-page",
  Yield = "yield",
}

export enum CoreSensorId {
  Random = "random",
  OnPageEntered = "on-page-entered",
  Timeout = "sensor.timeout",
  CurrentPage = "current-page",
  PreviousPage = "previous-page",
}

export enum CoreParameterId {
  AnonymousBoolean = "anon.boolean",
  AnonymousNumber = "anon.number",
  AnonymousString = "anon.string",
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

export const CoreLiteralFactoryTileIds: string[] = [
  mkLiteralFactoryTileId(CoreLiteralFactoryId.Boolean),
  mkLiteralFactoryTileId(CoreLiteralFactoryId.Number),
  mkLiteralFactoryTileId(CoreLiteralFactoryId.String),
];

export function isCoreLiteralFactoryTileId(tileId: string): boolean {
  return CoreLiteralFactoryTileIds.includes(tileId);
}
