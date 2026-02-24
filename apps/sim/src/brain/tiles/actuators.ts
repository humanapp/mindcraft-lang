import { getBrainServices } from "@mindcraft-lang/core/brain";
import { BrainTileActuatorDef } from "@mindcraft-lang/core/brain/tiles";
import type { ActionDef } from "@/brain/fns/action-def";
import fnEat from "@/brain/fns/actuators/eat";
import fnMove from "@/brain/fns/actuators/move";
import fnSay from "@/brain/fns/actuators/say";
import fnShoot from "@/brain/fns/actuators/shoot";
import fnTurn from "@/brain/fns/actuators/turn";

export function registerActuatorTiles() {
  const { functions, tiles } = getBrainServices();

  function getFn(tileId: string) {
    const fn = functions.get(tileId);
    if (!fn) {
      throw new Error(`Function not registered: ${tileId}`);
    }
    return fn;
  }

  function registerActuator(fnDef: ActionDef) {
    const fn = getFn(fnDef.tileId);
    tiles.registerTileDef(
      new BrainTileActuatorDef(fnDef.tileId, fn, {
        visual: fnDef.visual,
        capabilities: fnDef.capabilities,
      })
    );
  }

  registerActuator(fnEat);
  registerActuator(fnMove);
  registerActuator(fnSay);
  registerActuator(fnShoot);
  registerActuator(fnTurn);
}
