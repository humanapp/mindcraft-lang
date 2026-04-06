import { type BrainServices, mkVariableFactoryTileId } from "@mindcraft-lang/core/brain";
import { registerVariableFactoryTileDef } from "@mindcraft-lang/core/brain/tiles";
import { MyTypeIds } from "../type-system";

const appVariableFactoryTileIds = new Set([
  mkVariableFactoryTileId(MyTypeIds.Vector2),
  mkVariableFactoryTileId(MyTypeIds.ActorRef),
]);

export function registerVariableFactoryTiles(services: BrainServices) {
  registerVariableFactoryTileDef(MyTypeIds.Vector2, MyTypeIds.Vector2, undefined, services);
  registerVariableFactoryTileDef(MyTypeIds.ActorRef, MyTypeIds.ActorRef, undefined, services);
}

export function isAppVariableFactoryTileId(tileId: string): boolean {
  return appVariableFactoryTileIds.has(tileId);
}
