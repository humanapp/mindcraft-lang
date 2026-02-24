import { CoreActuatorId } from "../../interfaces";
import { getBrainServices } from "../../services";
import fnRestartPage from "./restart-page";
import fnSwitchPage from "./switch-page";
import fnYield from "./yield";

export function registerCoreActuators() {
  const fns = getBrainServices().functions;
  fns.register(CoreActuatorId.SwitchPage, false, fnSwitchPage.fn, fnSwitchPage.callDef);
  fns.register(CoreActuatorId.RestartPage, false, fnRestartPage.fn, fnRestartPage.callDef);
  fns.register(CoreActuatorId.Yield, false, fnYield.fn, fnYield.callDef);
}
