import { Error } from "../../platform/error";
import {
  type BrainFunctionEntry,
  type BrainTileDefCreateOptions,
  CoreActuatorId,
  CoreParameterId,
  mkActuatorTileId,
  mkParameterTileId,
  TilePlacement,
} from "../interfaces";
import { BrainActionTileBase, BrainTileDefBase } from "../model/tiledef";
import fnRestartPage from "../runtime/actuators/restart-page";
import fnSwitchPage from "../runtime/actuators/switch-page";
import fnYield from "../runtime/actuators/yield";
import { getBrainServices } from "../services";

export class BrainTileActuatorDef extends BrainActionTileBase {
  readonly kind = "actuator";
  readonly actuatorId: string;

  constructor(actuatorId: string, fnEntry: BrainFunctionEntry, opts: BrainTileDefCreateOptions = {}) {
    if (opts.placement === undefined) opts.placement = TilePlacement.DoSide;
    super(mkActuatorTileId(actuatorId), fnEntry, opts);
    this.actuatorId = actuatorId;
  }
}

export function registerCoreActuatorTileDefs() {
  const tiles = getBrainServices().tiles;
  const register = (actuatorId: string, opts: BrainTileDefCreateOptions = {}) => {
    const getFn = (fnId: string): BrainFunctionEntry => {
      const fnEntry = getBrainServices().functions.get(fnId);
      if (!fnEntry) throw new Error(`getFunctionEntryOrThrow: missing function entry for ${fnId}`);
      return fnEntry;
    };
    const fnEntry = getFn(actuatorId);
    const tileDef = new BrainTileActuatorDef(actuatorId, fnEntry, opts);
    tiles.registerTileDef(tileDef);
  };
  register(fnSwitchPage.fnId);
  register(fnRestartPage.fnId);
  //register(fnYield.fnId);
}
