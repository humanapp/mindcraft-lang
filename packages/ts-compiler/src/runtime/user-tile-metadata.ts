import {
  type ActionDescriptor,
  CoreCapabilityBits,
  type ITileMetadata,
  mkParameterTileId,
  type TypeId,
} from "@mindcraft-lang/core/brain";
import { BrainTileActuatorDef, BrainTileParameterDef, BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import { BitSet } from "@mindcraft-lang/core/util";
import { collectParams } from "../compiler/arg-spec-utils.js";
import type { ExtractedParam, UserAuthoredProgram } from "../compiler/types.js";

/** Resolve a parameter type name to a runtime `TypeId`, or `undefined` when the type is not registered. */
export type UserTileTypeResolver = (typeName: string) => TypeId | undefined;

/** Output of {@link buildUserTileMetadata}: the tile metadata pieces a brain needs to register a user tile. */
export interface BuiltUserTileMetadata {
  actionDescriptor: ActionDescriptor;
  actionTile: BrainTileActuatorDef | BrainTileSensorDef;
  parameterTiles: readonly BrainTileParameterDef[];
}

function buildActionDescriptor(program: UserAuthoredProgram): ActionDescriptor {
  return {
    key: program.key,
    kind: program.kind,
    callDef: program.callDef,
    isAsync: program.isAsync,
    outputType: program.outputType,
  };
}

function getParameterId(tileName: string, param: ExtractedParam): string {
  if (param.anonymous) return `anon.${param.type}`;
  if (param.name.startsWith("parameter.")) return param.name;
  return `user.${tileName}.${param.name}`;
}

function buildParameterTiles(
  program: UserAuthoredProgram,
  resolveTypeId: UserTileTypeResolver
): readonly BrainTileParameterDef[] | undefined {
  const parameterTiles = new Map<string, BrainTileParameterDef>();

  for (const param of collectParams(program.args)) {
    const parameterId = getParameterId(program.name, param);
    if (param.name.startsWith("parameter.")) continue;
    const tileId = mkParameterTileId(parameterId);
    if (parameterTiles.has(tileId)) {
      continue;
    }

    const typeId = resolveTypeId(param.type);
    if (!typeId) {
      return undefined;
    }

    parameterTiles.set(tileId, new BrainTileParameterDef(parameterId, typeId));
  }

  return Array.from(parameterTiles.values());
}

/** Build the action descriptor, action tile, and parameter tiles for a compiled user tile. Returns undefined when a parameter type cannot be resolved. */
export function buildUserTileMetadata(
  program: UserAuthoredProgram,
  resolveTypeId: UserTileTypeResolver
): BuiltUserTileMetadata | undefined {
  const actionDescriptor = buildActionDescriptor(program);
  const parameterTiles = buildParameterTiles(program, resolveTypeId);
  if (!parameterTiles) {
    return undefined;
  }

  const metadata: ITileMetadata = {
    label: program.label ?? program.name,
    iconUrl: program.iconUrl,
    docsMarkdown: program.docsMarkdown,
    tags: program.tags,
  };

  const userTileCaps = new BitSet().set(CoreCapabilityBits.UserTile);

  const actionTile =
    program.kind === "sensor"
      ? new BrainTileSensorDef(program.key, actionDescriptor, { metadata, capabilities: userTileCaps })
      : new BrainTileActuatorDef(program.key, actionDescriptor, { metadata, capabilities: userTileCaps });

  return {
    actionDescriptor,
    actionTile,
    parameterTiles,
  };
}
