import { CoreActuatorId } from "../../interfaces";
import type { BrainServices } from "../../services";
import fnRestartPage from "./restart-page";
import fnSwitchPage from "./switch-page";
import fnYield from "./yield";

/** Register the built-in actuators on `services`. */
export function registerCoreActuators(services: BrainServices) {
  services.actions.register(fnSwitchPage.binding);
  services.actions.register(fnRestartPage.binding);
  services.actions.register(fnYield.binding);

  services.functions.register(CoreActuatorId.SwitchPage, false, fnSwitchPage.fn, fnSwitchPage.callDef);
  services.functions.register(CoreActuatorId.RestartPage, false, fnRestartPage.fn, fnRestartPage.callDef);
  services.functions.register(CoreActuatorId.Yield, false, fnYield.fn, fnYield.callDef);
}
