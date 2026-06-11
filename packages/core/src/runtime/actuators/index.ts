import type { BrainServices } from "../../brain/services";
import { CoreHostActions } from "../abi-ids";
import fnRestartPage from "./restart-page";
import fnSwitchPage from "./switch-page";
import fnYield from "./yield";

/** Register the built-in actuators on `services`. */
export function registerCoreActuators(services: BrainServices) {
  services.runtime.actions.register(fnSwitchPage.binding);
  services.runtime.actions.register(fnRestartPage.binding);
  services.runtime.actions.register(fnYield.binding);

  services.runtime.functions.register(
    CoreHostActions.SwitchPage.fnId,
    CoreHostActions.SwitchPage.key,
    false,
    fnSwitchPage.fn,
    fnSwitchPage.callDef
  );
  services.runtime.functions.register(
    CoreHostActions.RestartPage.fnId,
    CoreHostActions.RestartPage.key,
    false,
    fnRestartPage.fn,
    fnRestartPage.callDef
  );
  services.runtime.functions.register(
    CoreHostActions.Yield.fnId,
    CoreHostActions.Yield.key,
    false,
    fnYield.fn,
    fnYield.callDef
  );
}
