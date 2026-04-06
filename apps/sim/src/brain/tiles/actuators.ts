import type { BrainServices } from "@mindcraft-lang/core/brain";
import { BrainTileActuatorDef } from "@mindcraft-lang/core/brain/tiles";
import { type ActionDef, buildActionDescriptor } from "@/brain/fns/action-def";
import fnEat from "@/brain/fns/actuators/eat";
import fnMove from "@/brain/fns/actuators/move";
import fnSay from "@/brain/fns/actuators/say";
import fnShoot from "@/brain/fns/actuators/shoot";
import fnTurn from "@/brain/fns/actuators/turn";

export function registerActuatorTiles(services: BrainServices) {
  const { tiles } = services;

  function registerActuator(fnDef: ActionDef) {
    tiles.registerTileDef(
      new BrainTileActuatorDef(fnDef.tileId, buildActionDescriptor("actuator", fnDef), {
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
