import {
  type ActionDescriptor,
  type BytecodeResolvedAction,
  getBrainServices,
  mkParameterTileId,
  tiles as tileDefs,
} from "@mindcraft-lang/core/brain";
import type { UserAuthoredProgram } from "../compiler/types.js";

function buildActionDescriptor(program: UserAuthoredProgram): ActionDescriptor {
  return {
    key: program.key,
    kind: program.kind,
    callDef: program.callDef,
    isAsync: program.isAsync,
    outputType: program.outputType,
  };
}

export function registerUserTile(program: UserAuthoredProgram): void {
  const { actions, tiles, types } = getBrainServices();

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

  const actionDescriptor = buildActionDescriptor(program);
  const actionBinding: BytecodeResolvedAction = {
    binding: "bytecode",
    descriptor: actionDescriptor,
    artifact: program,
  };

  actions.register(actionBinding);

  if (program.kind === "sensor") {
    const tileDef = new tileDefs.BrainTileSensorDef(program.key, actionDescriptor);
    if (!tiles.has(tileDef.tileId)) {
      tiles.registerTileDef(tileDef);
    }
  } else {
    const tileDef = new tileDefs.BrainTileActuatorDef(program.key, actionDescriptor);
    if (!tiles.has(tileDef.tileId)) {
      tiles.registerTileDef(tileDef);
    }
  }
}
