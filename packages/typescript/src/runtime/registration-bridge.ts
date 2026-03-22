import {
  type HostAsyncFn,
  type IFunctionRegistry,
  type ITileCatalog,
  mkParameterTileId,
  type TypeId,
  tiles as tileDefs,
} from "@mindcraft-lang/core/brain";
import type { UserTileLinkInfo } from "../compiler/types.js";

export interface RegistrationServices {
  functions: IFunctionRegistry;
  tiles: ITileCatalog;
  resolveTypeId: (shortName: string) => TypeId | undefined;
}

export function registerUserTile(
  linkInfo: UserTileLinkInfo,
  hostFn: HostAsyncFn,
  services: RegistrationServices
): void {
  const { program } = linkInfo;
  const { functions, tiles, resolveTypeId } = services;

  for (const p of program.params) {
    const parameterId = p.anonymous ? `anon.${p.type}` : `user.${program.name}.${p.name}`;
    const paramTileId = mkParameterTileId(parameterId);

    if (!tiles.has(paramTileId)) {
      const typeId = resolveTypeId(p.type);
      if (typeId) {
        tiles.registerTileDef(new tileDefs.BrainTileParameterDef(parameterId, typeId));
      }
    }
  }

  const pgmId = `user.${program.kind === "sensor" ? "sensor" : "actuator"}.${program.name}`;
  const fnEntry = functions.register(pgmId, true, hostFn, program.callDef);

  if (program.kind === "sensor") {
    tiles.registerTileDef(new tileDefs.BrainTileSensorDef(pgmId, fnEntry, program.outputType!));
  } else {
    tiles.registerTileDef(new tileDefs.BrainTileActuatorDef(pgmId, fnEntry));
  }
}
