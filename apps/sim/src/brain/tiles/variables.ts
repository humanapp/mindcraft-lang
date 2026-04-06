import type { MindcraftModuleApi } from "@mindcraft-lang/core";
import { mkVariableFactoryTileId } from "@mindcraft-lang/core/brain";
import { createVariableFactoryTileDef } from "@mindcraft-lang/core/brain/tiles";
import { MyTypeIds } from "../type-system";

const appVariableFactoryTileIds = new Set([
  mkVariableFactoryTileId(MyTypeIds.Vector2),
  mkVariableFactoryTileId(MyTypeIds.ActorRef),
]);

export function registerVariableFactoryTiles(api: MindcraftModuleApi) {
  api.registerTile(createVariableFactoryTileDef(MyTypeIds.Vector2, MyTypeIds.Vector2));
  api.registerTile(createVariableFactoryTileDef(MyTypeIds.ActorRef, MyTypeIds.ActorRef));
}

export function isAppVariableFactoryTileId(tileId: string): boolean {
  return appVariableFactoryTileIds.has(tileId);
}
