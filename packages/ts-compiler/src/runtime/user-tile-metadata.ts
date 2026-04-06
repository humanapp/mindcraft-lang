import { type ActionDescriptor, mkParameterTileId, type TypeId } from "@mindcraft-lang/core/brain";
import { BrainTileActuatorDef, BrainTileParameterDef, BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import type { ExtractedParam, UserAuthoredProgram } from "../compiler/types.js";

export type UserTileTypeResolver = (typeName: string) => TypeId | undefined;

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
  return param.anonymous ? `anon.${param.type}` : `user.${tileName}.${param.name}`;
}

function buildParameterTiles(
  program: UserAuthoredProgram,
  resolveTypeId: UserTileTypeResolver
): readonly BrainTileParameterDef[] | undefined {
  const parameterTiles = new Map<string, BrainTileParameterDef>();

  for (const param of program.params) {
    const parameterId = getParameterId(program.name, param);
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

export function buildUserTileMetadata(
  program: UserAuthoredProgram,
  resolveTypeId: UserTileTypeResolver
): BuiltUserTileMetadata | undefined {
  const actionDescriptor = buildActionDescriptor(program);
  const parameterTiles = buildParameterTiles(program, resolveTypeId);
  if (!parameterTiles) {
    return undefined;
  }

  const actionTile =
    program.kind === "sensor"
      ? new BrainTileSensorDef(program.key, actionDescriptor)
      : new BrainTileActuatorDef(program.key, actionDescriptor);

  return {
    actionDescriptor,
    actionTile,
    parameterTiles,
  };
}
