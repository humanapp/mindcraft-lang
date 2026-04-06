import type { BrainServices } from "@mindcraft-lang/core/brain";
import { BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import { type ActionDef, buildActionDescriptor } from "@/brain/fns/action-def";
import fnBump from "@/brain/fns/sensors/bump";
import fnSee from "@/brain/fns/sensors/see";

export function registerSensorTiles(services: BrainServices) {
  const { tiles } = services;

  function registerSensor(fnDef: ActionDef) {
    tiles.registerTileDef(
      new BrainTileSensorDef(fnDef.tileId, buildActionDescriptor("sensor", fnDef), {
        visual: fnDef.visual,
        capabilities: fnDef.capabilities,
      })
    );
  }

  registerSensor(fnBump);
  registerSensor(fnSee);
}
