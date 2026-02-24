import { getBrainServices } from "@mindcraft-lang/core/brain";
import { BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import type { ActionDef } from "@/brain/fns/action-def";
import fnBump from "@/brain/fns/sensors/bump";
import fnSee from "@/brain/fns/sensors/see";
import fnTimeout from "@/brain/fns/sensors/timeout";

export function registerSensorTiles() {
  const { functions, tiles } = getBrainServices();

  function getFn(tileId: string) {
    const fn = functions.get(tileId);
    if (!fn) {
      throw new Error(`Function not registered: ${tileId}`);
    }
    return fn;
  }

  function registerSensor(fnDef: ActionDef) {
    const fn = getFn(fnDef.tileId);
    tiles.registerTileDef(
      new BrainTileSensorDef(fnDef.tileId, fn, fnDef.returnType, {
        visual: fnDef.visual,
        capabilities: fnDef.capabilities,
      })
    );
  }

  registerSensor(fnTimeout);
  registerSensor(fnBump);
  registerSensor(fnSee);
}
