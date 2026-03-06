import { CoreSensorId } from "../../interfaces";
import { getBrainServices } from "../../services";
import fnOnPageEntered from "./on-page-entered";
import fnRandom from "./random";
import fnTimeout from "./timeout";

export function registerCoreSensors() {
  const fns = getBrainServices().functions;
  fns.register(CoreSensorId.Random, false, fnRandom.fn, fnRandom.callDef);
  fns.register(CoreSensorId.OnPageEntered, false, fnOnPageEntered.fn, fnOnPageEntered.callDef);
  fns.register(CoreSensorId.Timeout, false, fnTimeout.fn, fnTimeout.callDef);
}
