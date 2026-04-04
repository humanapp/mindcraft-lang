import { Error } from "../../platform/error";
import { type ActionDescriptor, type BrainTileDefCreateOptions, mkActuatorTileId, TilePlacement } from "../interfaces";
import { BrainActionTileBase } from "../model/tiledef";
import fnRestartPage from "../runtime/actuators/restart-page";
import fnSwitchPage from "../runtime/actuators/switch-page";
import fnYield from "../runtime/actuators/yield";
import { getBrainServices } from "../services";

export class BrainTileActuatorDef extends BrainActionTileBase {
  readonly kind = "actuator";
  readonly actuatorId: string;

  constructor(actuatorId: string, action: ActionDescriptor, opts: BrainTileDefCreateOptions = {}) {
    if (action.kind !== "actuator") {
      throw new Error(`BrainTileActuatorDef: expected actuator action for ${actuatorId}`);
    }
    if (opts.placement === undefined) opts.placement = TilePlacement.DoSide;
    super(mkActuatorTileId(actuatorId), action, opts);
    this.actuatorId = actuatorId;
  }
}

export function registerCoreActuatorTileDefs() {
  const tiles = getBrainServices().tiles;
  const register = (
    actuatorId: string,
    action: typeof fnSwitchPage.descriptor,
    opts: BrainTileDefCreateOptions = {}
  ) => {
    const tileDef = new BrainTileActuatorDef(actuatorId, action, opts);
    tiles.registerTileDef(tileDef);
  };
  register(fnSwitchPage.fnId, fnSwitchPage.descriptor);
  register(fnRestartPage.fnId, fnRestartPage.descriptor, { deprecated: true });
  //register(fnYield.fnId);
}
