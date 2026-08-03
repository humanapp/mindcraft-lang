import type { BrainServices } from "../../brain/services";
import { CoreHostActions } from "../abi-ids";
import fnCurrentPage from "./current-page";
import fnOnPageEntered from "./on-page-entered";
import fnOtherwise from "./otherwise";
import fnPreviousPage from "./previous-page";
import fnRandom from "./random";
import fnTimeout from "./timeout";

/** Register the built-in sensors on `services`. */
export function registerCoreSensors(services: BrainServices) {
  services.runtime.actions.register(fnRandom.binding);
  services.runtime.actions.register(fnOnPageEntered.binding);
  services.runtime.actions.register(fnTimeout.binding);
  services.runtime.actions.register(fnCurrentPage.binding);
  services.runtime.actions.register(fnPreviousPage.binding);
  services.runtime.actions.register(fnOtherwise.binding);

  services.runtime.functions.register(
    CoreHostActions.Random.fnId,
    CoreHostActions.Random.key,
    false,
    fnRandom.fn,
    fnRandom.callDef
  );
  services.runtime.functions.register(
    CoreHostActions.OnPageEntered.fnId,
    CoreHostActions.OnPageEntered.key,
    false,
    fnOnPageEntered.fn,
    fnOnPageEntered.callDef
  );
  services.runtime.functions.register(
    CoreHostActions.Timeout.fnId,
    CoreHostActions.Timeout.key,
    false,
    fnTimeout.fn,
    fnTimeout.callDef
  );
  services.runtime.functions.register(
    CoreHostActions.CurrentPage.fnId,
    CoreHostActions.CurrentPage.key,
    false,
    fnCurrentPage.fn,
    fnCurrentPage.callDef
  );
  services.runtime.functions.register(
    CoreHostActions.PreviousPage.fnId,
    CoreHostActions.PreviousPage.key,
    false,
    fnPreviousPage.fn,
    fnPreviousPage.callDef
  );
  services.runtime.functions.register(
    CoreHostActions.Otherwise.fnId,
    CoreHostActions.Otherwise.key,
    false,
    fnOtherwise.fn,
    fnOtherwise.callDef
  );
}
