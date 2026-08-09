import { Error } from "../../platform/error";
import { type ActionDescriptor, mkActuatorTileId, type UserActionIdentity } from "../../runtime";
import fnRestartPage from "../../runtime/actuators/restart-page";
import fnSwitchPage from "../../runtime/actuators/switch-page";
import fnYield from "../../runtime/actuators/yield";
import { type BrainTileDefCreateOptions, TilePlacement } from "../interfaces";
import { BrainActionTileBase } from "../model/tiledef";
import type { BrainServices } from "../services";

/** Tile definition for an actuator (`do`-side action) bound to an {@link ActionDescriptor}. */
export class BrainTileActuatorDef extends BrainActionTileBase {
  readonly kind = "actuator";
  readonly actuatorId: string;

  /** Namespace and stable id of the compiled user action backing this tile. Absent for platform actuators. */
  readonly userIdentity?: UserActionIdentity;

  constructor(
    actuatorId: string,
    action: ActionDescriptor,
    opts: BrainTileDefCreateOptions & { userIdentity?: UserActionIdentity } = {}
  ) {
    if (action.kind !== "actuator") {
      throw new Error(`BrainTileActuatorDef: expected actuator action for ${actuatorId}`);
    }
    if (opts.placement === undefined) opts.placement = TilePlacement.DoSide;
    super(mkActuatorTileId(actuatorId), action, opts);
    this.actuatorId = actuatorId;
    this.userIdentity = opts.userIdentity;
  }
}

/** Register the built-in core actuator tiles on `services`. */
export function registerCoreActuatorTileDefs(services: BrainServices) {
  const tiles = services.edit.tiles;
  const register = (
    actuatorId: string,
    action: typeof fnSwitchPage.descriptor,
    opts: BrainTileDefCreateOptions = {}
  ) => {
    const tileDef = new BrainTileActuatorDef(actuatorId, action, opts);
    tiles.registerTileDef(tileDef);
  };
  register(fnSwitchPage.key, fnSwitchPage.descriptor, {
    metadata: { label: "go to page", language: { form: "go to" } },
  });
  register(fnRestartPage.key, fnRestartPage.descriptor, {
    deprecated: true,
    metadata: { label: "restart page", language: { form: "restart this page" } },
  });
  //register(fnYield.key);
}
