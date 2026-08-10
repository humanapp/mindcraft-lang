import { assertUnreachable } from "../platform/assert";
import { StringUtils as SU } from "../platform/string";
import type { ActionKind } from "./function-defs";

/** Brain tile identifier. Build with {@link mkTileId} or domain-specific helpers (e.g. {@link mkSensorTileId}). */
export type TileId = string;

/** Compose a tile id from an `area` (e.g. `"op"`, `"sensor"`) and an `id`. */
export function mkTileId(area: string, id: string): string {
  return `tile.${area}->${id}`;
}

/** Result of {@link parseTileId}: the tile's `area` and `id` fragments. */
export interface ParsedTileId {
  readonly area: string;
  readonly id: string;
}

/** Inverse of {@link mkTileId}. Returns undefined when `tileId` is not a valid tile id. */
export function parseTileId(tileId: string): ParsedTileId | undefined {
  const kPrefix = "tile.";
  const kSep = "->";
  if (!SU.startsWith(tileId, kPrefix)) return undefined;
  const rest = SU.substring(tileId, SU.length(kPrefix));
  const sepIdx = SU.indexOf(rest, kSep);
  if (sepIdx <= 0) return undefined;
  return {
    area: SU.substring(rest, 0, sepIdx),
    id: SU.substring(rest, sepIdx + SU.length(kSep)),
  };
}

export function mkSensorTileId(sensorId: string): string {
  return mkTileId("sensor", sensorId);
}

/**
 * Action key of a compiled user tile or conversion: the owning project's
 * namespace, the action kind, and the action's stable id.
 */
export function mkUserActionKey(namespace: string, kind: ActionKind, actionId: string): string {
  return `${namespace}:user.${kind}.${actionId}`;
}

/**
 * Tile id fragment of a private (bare-named) parameter or modifier arg,
 * scoped by the declaring action's stable id under the project namespace.
 */
export function mkPrivateArgId(namespace: string, actionId: string, argName: string): string {
  return `${namespace}:user.${actionId}.${argName}`;
}

/**
 * Identity name of a user-declared sensor output: the declared output name
 * scoped by the declaring project's namespace. The scoped name is the name
 * half of the `(typeId, name)` output identity.
 */
export function mkScopedOutputName(namespace: string, outputName: string): string {
  return `${namespace}:${outputName}`;
}

/** Tile id fragment of an anonymous parameter tile keyed by a type name. */
export function mkAnonParameterId(typeName: string): string {
  return `anon.${typeName}`;
}

/** Identity components of a compiled user action tile: owning namespace plus stable action id. */
export interface UserActionIdentity {
  readonly namespace: string;
  readonly actionId: string;
}

/** Identity components of a private arg tile: owning namespace, declaring action's stable id, and arg name. */
export interface UserArgIdentity {
  readonly namespace: string;
  readonly actionId: string;
  readonly argName: string;
}

/**
 * A user type name split into its owning namespace and local name (the
 * `/file::binding` part). `namespace` is absent for platform type names.
 */
export interface NamespacedTypeName {
  readonly namespace?: string;
  readonly localName: string;
}

export function mkActuatorTileId(actuatorId: string): string {
  return mkTileId("actuator", actuatorId);
}

/** Tile id of a tile-bearing user action, dispatched on its {@link ActionKind}. Conversions carry no tile surface and are excluded from the parameter type. */
export function mkActionTileId(kind: Exclude<ActionKind, "conversion">, actionId: string): string {
  switch (kind) {
    case "sensor":
      return mkSensorTileId(actionId);
    case "actuator":
      return mkActuatorTileId(actionId);
    default:
      return assertUnreachable(kind);
  }
}

export function mkParameterTileId(parameterId: string): string {
  return mkTileId("parameter", parameterId);
}

export function mkModifierTileId(modifierId: string): string {
  return mkTileId("modifier", modifierId);
}

/**
 * Tile id for an action output value-tile, keyed by output identity (the
 * `typeId` of the value plus the output `name`). Two actions declaring the same
 * `(typeId, name)` produce the same id and therefore share a single tile.
 */
export function mkOutputTileId(typeId: string, name: string): string {
  return mkTileId("out", `${typeId}.${name}`);
}

/**
 * Backing rule-variable key for an action output, keyed by output identity. The
 * `setSensorOutput` write and the output tile read both resolve to this key, so
 * a shared `(typeId, name)` identity round-trips through one rule variable.
 */
export function mkOutputVarKey(typeId: string, name: string): string {
  return `__out.${typeId}.${name}`;
}

export enum CoreParameterId {
  AnonymousBoolean = "anon.boolean",
  AnonymousNumber = "anon.number",
  AnonymousString = "anon.string",
}
