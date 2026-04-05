import { CoreSensorId } from "../../interfaces";
import type { BrainServices } from "../../services";
import fnCurrentPage from "./current-page";
import fnOnPageEntered from "./on-page-entered";
import fnPreviousPage from "./previous-page";
import fnRandom from "./random";
import fnTimeout from "./timeout";

export function registerCoreSensors(services: BrainServices) {
  services.actions.register(fnRandom.binding);
  services.actions.register(fnOnPageEntered.binding);
  services.actions.register(fnTimeout.binding);
  services.actions.register(fnCurrentPage.binding);
  services.actions.register(fnPreviousPage.binding);

  services.functions.register(CoreSensorId.Random, false, fnRandom.fn, fnRandom.callDef);
  services.functions.register(CoreSensorId.OnPageEntered, false, fnOnPageEntered.fn, fnOnPageEntered.callDef);
  services.functions.register(CoreSensorId.Timeout, false, fnTimeout.fn, fnTimeout.callDef);
  services.functions.register(CoreSensorId.CurrentPage, false, fnCurrentPage.fn, fnCurrentPage.callDef);
  services.functions.register(CoreSensorId.PreviousPage, false, fnPreviousPage.fn, fnPreviousPage.callDef);
}
