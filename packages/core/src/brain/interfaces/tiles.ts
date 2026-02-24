import type { IReadStream, IWriteStream } from "../../platform/stream";
import { StringUtils as SU } from "../../platform/string";
import type { BitSet, ReadonlyBitSet } from "../../util/bitset";
import type { BrainFunctionEntry } from "./functions";
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

export type BrainTileLiteralDefOptions = BrainTileDefCreateOptions & {
  valueLabel?: string;
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
  readonly fnEntry: BrainFunctionEntry;
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

export function mkLiteralTileId(valueType: TypeId, valueStr: string): string {
  return mkTileId("literal", `${valueType}->${valueStr}`);
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
