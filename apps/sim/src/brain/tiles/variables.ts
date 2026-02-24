import { getBrainServices } from "@mindcraft-lang/core/brain";
import { type BrainTileFactoryDef, registerVariableFactoryTileDef } from "@mindcraft-lang/core/brain/tiles";
import { MyTypeIds } from "../type-system";

export function registerVariableFactoryTiles() {
  registerVariableFactoryTileDef(MyTypeIds.Vector2, MyTypeIds.Vector2);
  registerVariableFactoryTileDef(MyTypeIds.ActorRef, MyTypeIds.ActorRef);
}

export function isAppVariableFactoryTileId(tileId: string): boolean {
  const tileDef = getBrainServices().tiles.get(tileId) as BrainTileFactoryDef | undefined;
  if (!tileDef || tileDef.kind !== "factory") return false;
  // Check all app-specific variable factory tile IDs here
  return tileDef.factoryId === MyTypeIds.Vector2 || tileDef.factoryId === MyTypeIds.ActorRef;
}
