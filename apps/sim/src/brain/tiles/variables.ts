import {
  createVariableFactoryTileDef,
  type MindcraftModuleApi,
  mkVariableFactoryTileId,
} from "@mindcraft-lang/core/app";
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
