import { getBrainServices } from "@mindcraft-lang/core/brain";
import fnBump from "./bump";
import fnSee from "./see";

export function registerSensors() {
  const { functions: fns } = getBrainServices();
  fns.register(fnBump.tileId, fnBump.isAsync, fnBump.fn, fnBump.callDef);
  fns.register(fnSee.tileId, fnSee.isAsync, fnSee.fn, fnSee.callDef);
}
