import { getBrainServices } from "@mindcraft-lang/core/brain";
import { buildHostActionBinding } from "../action-def";
import fnEat from "./eat";
import fnMove from "./move";
import fnSay from "./say";
import fnShoot from "./shoot";
import fnTurn from "./turn";

export function registerActuators() {
  const { actions, functions: fns } = getBrainServices();
  actions.register(buildHostActionBinding("actuator", fnMove));
  actions.register(buildHostActionBinding("actuator", fnSay));
  actions.register(buildHostActionBinding("actuator", fnEat));
  actions.register(buildHostActionBinding("actuator", fnTurn));
  actions.register(buildHostActionBinding("actuator", fnShoot));
  fns.register(fnMove.tileId, fnMove.isAsync, fnMove.fn, fnMove.callDef);
  fns.register(fnSay.tileId, fnSay.isAsync, fnSay.fn, fnSay.callDef);
  fns.register(fnEat.tileId, fnEat.isAsync, fnEat.fn, fnEat.callDef);
  fns.register(fnTurn.tileId, fnTurn.isAsync, fnTurn.fn, fnTurn.callDef);
  fns.register(fnShoot.tileId, fnShoot.isAsync, fnShoot.fn, fnShoot.callDef);
}
