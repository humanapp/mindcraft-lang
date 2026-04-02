import {
  type BrainAsyncFunctionEntry,
  getBrainServices,
  type HostAsyncFn,
  mkParameterTileId,
  tiles as tileDefs,
} from "@mindcraft-lang/core/brain";
import type { UserTileLinkInfo } from "../compiler/types.js";

export function registerUserTile(linkInfo: UserTileLinkInfo, hostFn: HostAsyncFn): void {
  const { program } = linkInfo;
  const { functions, tiles, types } = getBrainServices();

  for (const p of program.params) {
    const parameterId = p.anonymous ? `anon.${p.type}` : `user.${program.name}.${p.name}`;
    const paramTileId = mkParameterTileId(parameterId);

    if (!tiles.has(paramTileId)) {
      const typeId = types.resolveByName(p.type);
      if (typeId) {
        tiles.registerTileDef(new tileDefs.BrainTileParameterDef(parameterId, typeId));
      }
    }
  }

  const pgmId = `user.${program.kind === "sensor" ? "sensor" : "actuator"}.${program.name}`;
  const existingEntry = functions.get(pgmId);

  if (existingEntry) {
    (existingEntry as BrainAsyncFunctionEntry).fn = hostFn;
    return;
  }

  const fnEntry = functions.register(pgmId, true, hostFn, program.callDef);

  if (program.kind === "sensor") {
    tiles.registerTileDef(new tileDefs.BrainTileSensorDef(pgmId, fnEntry, program.outputType!));
  } else {
    tiles.registerTileDef(new tileDefs.BrainTileActuatorDef(pgmId, fnEntry));
  }
}
