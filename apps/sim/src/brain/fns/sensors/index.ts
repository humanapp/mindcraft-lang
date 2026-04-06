import type { BrainServices } from "@mindcraft-lang/core/brain";
import { buildHostActionBinding } from "../action-def";
import fnBump from "./bump";
import fnSee from "./see";

export function registerSensors(services: BrainServices) {
  const { actions, functions: fns } = services;
  actions.register(buildHostActionBinding("sensor", fnBump));
  actions.register(buildHostActionBinding("sensor", fnSee));
  fns.register(fnBump.tileId, fnBump.isAsync, fnBump.fn, fnBump.callDef);
  fns.register(fnSee.tileId, fnSee.isAsync, fnSee.fn, fnSee.callDef);
}
