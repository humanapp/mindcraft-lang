import type { ReadonlyList } from "../../../platform/list";
import {
  CoreSensorId,
  type ExecutionContext,
  type HostSyncFn,
  isNilValue,
  type MapValue,
  NativeType,
  type Value,
  ValueDict,
} from "../../interfaces";
import type { BrainServices } from "../../services";
import fnCurrentPage from "./current-page";
import fnOnPageEntered from "./on-page-entered";
import fnPreviousPage from "./previous-page";
import fnRandom from "./random";
import fnTimeout from "./timeout";

/**
 * Adapter for sensor/actuator host functions whose canonical exec is
 * still MapValue-shaped (it backs the V4.1-untouched
 * `ActionRuntimeBinding.execSync`). Wraps it as a `HostSyncFn` so the
 * same body can also be reached via `HOST_CALL`.
 *
 * Allocates one `MapValue` per call. Only invoked when bytecode
 * actually dispatches a sensor/actuator through `HOST_CALL` -- the
 * compiler emits `ACTION_CALL` for them, so the path is exercised
 * almost exclusively by tests today. The adapter goes away in V4.2
 * when actions migrate to the same positional ABI.
 */
function asHostSync(oldFn: {
  onPageEntered?: (ctx: ExecutionContext) => void;
  exec: (ctx: ExecutionContext, args: MapValue) => Value;
}): HostSyncFn {
  return {
    onPageEntered: oldFn.onPageEntered,
    exec: (ctx, listArgs: ReadonlyList<Value>): Value => {
      const dict = new ValueDict();
      // Only populate non-nil entries: the legacy MapValue semantics
      // distinguish "key absent" from "key = NIL_VALUE", and several
      // sensors still test `args.v.get(i) !== undefined` for presence.
      // V4.2 will rewrite those checks against isNilValue and let this
      // wrapper drop the conditional.
      for (let i = 0; i < listArgs.size(); i++) {
        const v = listArgs.get(i);
        if (!isNilValue(v)) {
          dict.set(i, v);
        }
      }
      const mapArgs: MapValue = { t: NativeType.Map, typeId: "map:<args>", v: dict };
      return oldFn.exec(ctx, mapArgs);
    },
  };
}

/** Register the built-in sensors on `services`. */
export function registerCoreSensors(services: BrainServices) {
  services.actions.register(fnRandom.binding);
  services.actions.register(fnOnPageEntered.binding);
  services.actions.register(fnTimeout.binding);
  services.actions.register(fnCurrentPage.binding);
  services.actions.register(fnPreviousPage.binding);

  services.functions.register(CoreSensorId.Random, false, asHostSync(fnRandom.fn), fnRandom.callDef);
  services.functions.register(
    CoreSensorId.OnPageEntered,
    false,
    asHostSync(fnOnPageEntered.fn),
    fnOnPageEntered.callDef
  );
  services.functions.register(CoreSensorId.Timeout, false, asHostSync(fnTimeout.fn), fnTimeout.callDef);
  services.functions.register(CoreSensorId.CurrentPage, false, asHostSync(fnCurrentPage.fn), fnCurrentPage.callDef);
  services.functions.register(CoreSensorId.PreviousPage, false, asHostSync(fnPreviousPage.fn), fnPreviousPage.callDef);
}
