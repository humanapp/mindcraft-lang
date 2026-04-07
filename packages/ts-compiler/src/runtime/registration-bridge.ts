import { type BrainServices, type BytecodeResolvedAction, getBrainServices } from "@mindcraft-lang/core/brain";
import type { UserAuthoredProgram } from "../compiler/types.js";
import { buildUserTileMetadata } from "./user-tile-metadata.js";

export function registerUserTile(program: UserAuthoredProgram, services?: BrainServices): void {
  const { actions, tiles, types } = services ?? getBrainServices();
  let unresolvedTypeName: string | undefined;
  const metadata = buildUserTileMetadata(program, (typeName) => {
    const typeId = types.resolveByName(typeName);
    if (!typeId && unresolvedTypeName === undefined) {
      unresolvedTypeName = typeName;
    }
    return typeId;
  });
  if (!metadata) {
    throw new Error(`Unknown parameter type "${unresolvedTypeName ?? "unknown"}" for "${program.key}"`);
  }

  const { actionDescriptor, actionTile, parameterTiles } = metadata;
  const actionBinding: BytecodeResolvedAction = {
    binding: "bytecode",
    descriptor: actionDescriptor,
    artifact: program,
  };

  for (const parameterTile of parameterTiles) {
    if (!tiles.has(parameterTile.tileId)) {
      tiles.registerTileDef(parameterTile);
    }
  }

  actions.register(actionBinding);

  if (!tiles.has(actionTile.tileId)) {
    tiles.registerTileDef(actionTile);
  }
}
