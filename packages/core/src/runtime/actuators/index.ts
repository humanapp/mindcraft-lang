import type { BrainServices } from "../../brain/services";
import { CoreActuatorId } from "../tile-ids";
import fnRestartPage from "./restart-page";
import fnSwitchPage from "./switch-page";
import fnYield from "./yield";

/** Register the built-in actuators on `services`. */
export function registerCoreActuators(services: BrainServices) {
  services.runtime.actions.register(fnSwitchPage.binding);
  services.runtime.actions.register(fnRestartPage.binding);
  services.runtime.actions.register(fnYield.binding);

  services.runtime.functions.register(CoreActuatorId.SwitchPage, false, fnSwitchPage.fn, fnSwitchPage.callDef);
  services.runtime.functions.register(CoreActuatorId.RestartPage, false, fnRestartPage.fn, fnRestartPage.callDef);
  services.runtime.functions.register(CoreActuatorId.Yield, false, fnYield.fn, fnYield.callDef);
}
