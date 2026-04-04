import { CoreActuatorId } from "../../interfaces";
import { getBrainServices } from "../../services";
import fnRestartPage from "./restart-page";
import fnSwitchPage from "./switch-page";
import fnYield from "./yield";

export function registerCoreActuators() {
  const services = getBrainServices();
  services.actions.register(fnSwitchPage.binding);
  services.actions.register(fnRestartPage.binding);
  services.actions.register(fnYield.binding);

  services.functions.register(CoreActuatorId.SwitchPage, false, fnSwitchPage.fn, fnSwitchPage.callDef);
  services.functions.register(CoreActuatorId.RestartPage, false, fnRestartPage.fn, fnRestartPage.callDef);
  services.functions.register(CoreActuatorId.Yield, false, fnYield.fn, fnYield.callDef);
}
