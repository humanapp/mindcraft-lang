import type { ReadonlyList } from "../../../platform/list";
import {
  CoreActuatorId,
  type ExecutionContext,
  type HostSyncFn,
  isNilValue,
  type MapValue,
  NativeType,
  type Value,
  ValueDict,
} from "../../interfaces";
import type { BrainServices } from "../../services";
import fnRestartPage from "./restart-page";
import fnSwitchPage from "./switch-page";
import fnYield from "./yield";

/**
 * Adapter for actuator host functions whose canonical exec is still
 * MapValue-shaped (it backs the V4.1-untouched
 * `ActionRuntimeBinding.execSync`). See sensors/index.ts for the
 * matching sensor adapter; both go away in V4.2.
 */
function asHostSync(oldFn: {
  onPageEntered?: (ctx: ExecutionContext) => void;
  exec: (ctx: ExecutionContext, args: MapValue) => Value;
}): HostSyncFn {
  return {
    onPageEntered: oldFn.onPageEntered,
    exec: (ctx, listArgs: ReadonlyList<Value>): Value => {
      const dict = new ValueDict();
      // Drop NIL fillers so MapValue presence checks (`args.v.get(i)
      // !== undefined`) on the action-binding side keep working in V4.1.
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

/** Register the built-in actuators on `services`. */
export function registerCoreActuators(services: BrainServices) {
  services.actions.register(fnSwitchPage.binding);
  services.actions.register(fnRestartPage.binding);
  services.actions.register(fnYield.binding);

  services.functions.register(CoreActuatorId.SwitchPage, false, asHostSync(fnSwitchPage.fn), fnSwitchPage.callDef);
  services.functions.register(CoreActuatorId.RestartPage, false, asHostSync(fnRestartPage.fn), fnRestartPage.callDef);
  services.functions.register(CoreActuatorId.Yield, false, asHostSync(fnYield.fn), fnYield.callDef);
}
