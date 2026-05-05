import { StringUtils as SU } from "../platform/string";

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

export function mkActuatorTileId(actuatorId: string): string {
  return mkTileId("actuator", actuatorId);
}

export function mkParameterTileId(parameterId: string): string {
  return mkTileId("parameter", parameterId);
}

export function mkModifierTileId(modifierId: string): string {
  return mkTileId("modifier", modifierId);
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
