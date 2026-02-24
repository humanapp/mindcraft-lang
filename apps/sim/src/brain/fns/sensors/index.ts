import { getBrainServices } from "@mindcraft-lang/core/brain";
import fnBump from "./bump";
import fnSee from "./see";
import fnTimeout from "./timeout";

export function registerSensors() {
  const { functions: fns } = getBrainServices();
  fns.register(fnTimeout.tileId, fnTimeout.isAsync, fnTimeout.fn, fnTimeout.callDef);
  fns.register(fnBump.tileId, fnBump.isAsync, fnBump.fn, fnBump.callDef);
  fns.register(fnSee.tileId, fnSee.isAsync, fnSee.fn, fnSee.callDef);
}
